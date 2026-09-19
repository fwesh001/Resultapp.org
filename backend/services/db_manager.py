"""
PostgreSQL automation for ResultApp Droplet.
Creates isolated database + user per school (e.g. subdomain 'vhs' -> database 'vhs_db', user 'vhs_user').

Design goals:
- idempotent checks (fail fast if DB/user exists)
- secure random password
- minimal privileges (GRANT ALL on DATABASE + schema public)
- clean rollback helpers
"""

import logging
import secrets
import string
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config (from env; defaults safe for Droplet)
# ---------------------------------------------------------------------------

def _pg_config():
    return {
        "host": os.getenv("PG_HOST", "localhost"),
        "port": int(os.getenv("PG_PORT", "5432")),
        "user": os.getenv("PG_SUPERUSER", "postgres"),
        "password": os.getenv("PG_SUPERUSER_PASSWORD", ""),
        "dbname": os.getenv("PG_SUPERUSER_DB", "postgres"),
    }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RESERVED_DB_NAMES = {"postgres", "template0", "template1"}

def _sanitize_subdomain(subdomain: str) -> str:
    """Validate and normalize subdomain for use as DB identifiers."""
    if not subdomain or len(subdomain) < 3:
        raise ValueError("Subdomain must be >= 3 chars")
    # already validated upstream, but enforce lowercase alnum+hyphen
    norm = subdomain.lower().strip()
    if not norm.replace("-", "").isalnum():
        raise ValueError("Subdomain contains invalid characters")
    return norm

def _db_identifiers(subdomain: str) -> Dict[str, str]:
    """
    Derive postgres identifiers from subdomain.
    Hyphens replaced with underscores because unquoted postgres identifiers
    cannot contain hyphens.
    """
    base = _sanitize_subdomain(subdomain).replace("-", "_")
    # Postgres max identifier 63 chars; keep well under
    db_name = f"{base}_db"[:60]
    db_user = f"{base}_user"[:60]
    if db_name in RESERVED_DB_NAMES:
        db_name = f"school_{db_name}"
        db_user = f"school_{db_user}"
    return {"base": base, "db_name": db_name, "db_user": db_user}

def _generate_password(length: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits
    # ensure at least one of each class
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.islower() for c in pwd) and any(c.isupper() for c in pwd) and any(c.isdigit() for c in pwd):
            return pwd

def _connect_as_superuser():
    cfg = _pg_config()
    if not cfg["password"]:
        logger.warning("PG_SUPERUSER_PASSWORD is empty — ensure postgres peer/trust auth or set password")
    conn = psycopg2.connect(**cfg)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    return conn

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_school_database(subdomain: str, student_count: Optional[int] = None) -> Dict[str, str]:
    """
    Create isolated DB + user for a school.

    Returns dict with:
      db_name, db_user, db_password, db_host, db_port

    Raises: ValueError (validation), RuntimeError (exists / pg error)
    """
    ids = _db_identifiers(subdomain)
    db_name = ids["db_name"]
    db_user = ids["db_user"]
    db_password = _generate_password()
    cfg = _pg_config()

    logger.info(f"[DB] Provisioning database '{db_name}' with user '{db_user}' for subdomain '{subdomain}'")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        # --- Check existence (fail fast, idempotent) ---
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (db_name,))
        if cur.fetchone():
            raise RuntimeError(f"Database '{db_name}' already exists — subdomain '{subdomain}' is taken")

        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s;", (db_user,))
        if cur.fetchone():
            raise RuntimeError(f"Database user '{db_user}' already exists")

        # --- CREATE USER ---
        # Use psycopg2.sql for safe quoting
        cur.execute(
            sql.SQL("CREATE USER {} WITH PASSWORD %s;").format(sql.Identifier(db_user)),
            (db_password,)
        )
        logger.info(f"[DB] Created user '{db_user}'")

        # --- CREATE DATABASE WITH OWNER ---
        encoding = os.getenv("PG_ENCODING", "UTF8")
        template = os.getenv("PG_TEMPLATE", "template0")
        cur.execute(
            sql.SQL("CREATE DATABASE {} OWNER {} ENCODING %s TEMPLATE %s;").format(
                sql.Identifier(db_name), sql.Identifier(db_user)
            ),
            (encoding, template),
        )
        logger.info(f"[DB] Created database '{db_name}' owned by '{db_user}'")

        # --- Grant privileges on database and public schema ---
        # Connect to the new DB to grant schema privileges
        # Reuse superuser connection but need to touch new DB
        cur.execute(sql.SQL("GRANT ALL PRIVILEGES ON DATABASE {} TO {};").format(
            sql.Identifier(db_name), sql.Identifier(db_user)
        ))

        # Open a second connection specifically to the new DB for schema grants
        new_db_conn = psycopg2.connect(
            host=cfg["host"], port=cfg["port"], user=cfg["user"],
            password=cfg["password"], dbname=db_name
        )
        new_db_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        try:
            nc = new_db_conn.cursor()
            nc.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {};").format(sql.Identifier(db_user)))
            # For RosarioSIS which may need to create tables
            nc.execute(sql.SQL("ALTER DATABASE {} OWNER TO {};").format(sql.Identifier(db_name), sql.Identifier(db_user)))
            nc.close()
        finally:
            new_db_conn.close()

        logger.info(f"[DB] Privileges granted for '{db_user}' on '{db_name}'")

        return {
            "db_name": db_name,
            "db_user": db_user,
            "db_password": db_password,
            "db_host": cfg["host"],
            "db_port": str(cfg["port"]),
            "subdomain": subdomain,
        }

    except (ValueError, RuntimeError):
        raise
    except Exception as e:
        logger.exception(f"[DB] Failed to provision database for '{subdomain}': {e}")
        # Attempt rollback of partial creates
        try:
            rollback_database(db_name, db_user)
        except Exception as rb_e:
            logger.error(f"[DB] Rollback also failed: {rb_e}")
        raise RuntimeError(f"Database provisioning failed: {e}") from e
    finally:
        if conn:
            conn.close()

def rollback_database(db_name: str, db_user: str) -> None:
    """
    Drop database and user — used for rollback if later pipeline steps fail.
    Terminates active connections before DROP.
    """
    logger.warning(f"[DB] Rolling back — dropping DB '{db_name}' and user '{db_user}'")
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        # Terminate connections to target DB so DROP succeeds
        cur.execute(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = %s AND pid <> pg_backend_pid();
            """,
            (db_name,)
        )

        # Drop DB if exists
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (db_name,))
        if cur.fetchone():
            cur.execute(sql.SQL("DROP DATABASE IF EXISTS {};").format(sql.Identifier(db_name)))
            logger.info(f"[DB] Dropped database '{db_name}'")

        # Drop user if exists
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s;", (db_user,))
        if cur.fetchone():
            cur.execute(sql.SQL("DROP USER IF EXISTS {};").format(sql.Identifier(db_user)))
            logger.info(f"[DB] Dropped user '{db_user}'")

    except Exception as e:
        logger.error(f"[DB] Rollback error for '{db_name}'/'{db_user}': {e}")
        raise
    finally:
        if conn:
            conn.close()

def database_exists(subdomain: str) -> bool:
    """Check if a school DB already exists (for idempotency checks)."""
    ids = _db_identifiers(subdomain)
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (ids["db_name"],))
        return cur.fetchone() is not None
    finally:
        if conn:
            conn.close()

def test_connection() -> bool:
    """Health check: can we connect as superuser?"""
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("SELECT 1;")
        return cur.fetchone() == (1,)
    except Exception as e:
        logger.error(f"[DB] Connection test failed: {e}")
        return False
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Schools registry (central metadata store in the superuser DB)
# ---------------------------------------------------------------------------

SCHOOLS_REGISTRY_TABLE = "schools"


def init_schools_registry() -> None:
    """Create the schools registry table if it does not exist."""
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # gen_random_uuid() is core in Postgres 13+; provide it for older versions.
        cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {SCHOOLS_REGISTRY_TABLE} (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subdomain     VARCHAR(60) UNIQUE NOT NULL,
                school_name   VARCHAR(120) NOT NULL,
                email         VARCHAR(255),
                phone         VARCHAR(20),
                address       TEXT,
                city          VARCHAR(100),
                state         VARCHAR(100),
                country       VARCHAR(100) DEFAULT 'NG',
                logo_url      TEXT,
                hero_bg_url   VARCHAR(512),
                motto         TEXT,
                proprietor_name VARCHAR(200),
                registration_number VARCHAR(100),
                is_verified   BOOLEAN DEFAULT FALSE,
                is_active     BOOLEAN DEFAULT TRUE,
                subscription_plan VARCHAR(100),
                subscription_status VARCHAR(50) DEFAULT 'unpaid',
                student_count INTEGER DEFAULT 0,
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                updated_at    TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        # Phase 3: ensure existing deployments get the default without dropping data
        cur.execute(f"""
            ALTER TABLE {SCHOOLS_REGISTRY_TABLE}
            ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'unpaid';
        """)
        # Settings pipeline: hero background image for the tenant landing page
        cur.execute(f"""
            ALTER TABLE {SCHOOLS_REGISTRY_TABLE}
            ADD COLUMN IF NOT EXISTS hero_bg_url VARCHAR(512);
        """)
        # Report metadata: new term resumption date (single global per tenant, per user clarification)
        cur.execute(f"""
            ALTER TABLE {SCHOOLS_REGISTRY_TABLE}
            ADD COLUMN IF NOT EXISTS new_term_begins VARCHAR(32);
        """)
        # Credit & Command: spendable token balance (zero-downtime, additive only)
        cur.execute(f"""
            ALTER TABLE {SCHOOLS_REGISTRY_TABLE}
            ADD COLUMN IF NOT EXISTS credit_balance INTEGER DEFAULT 0;
        """)
        cur.execute(f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET credit_balance = 0
            WHERE credit_balance IS NULL;
        """)
        cur.execute(f"""
            ALTER TABLE {SCHOOLS_REGISTRY_TABLE}
            ADD COLUMN IF NOT EXISTS id_prefix VARCHAR(20);
        """)
        cur.execute(f"""
            ALTER TABLE {SCHOOLS_REGISTRY_TABLE}
            ADD COLUMN IF NOT EXISTS slots_balance INTEGER DEFAULT 0;
        """)
        cur.execute(f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET slots_balance = 0
            WHERE slots_balance IS NULL;
        """)
        # Backfill slots_balance from legacy student_count for zero-downtime parity
        cur.execute(f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE} s
            SET slots_balance = COALESCE(s.student_count, 0)
            WHERE COALESCE(s.slots_balance, 0) = 0
              AND COALESCE(s.student_count, 0) > 0;
        """)
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS billing_ledger (
                id               SERIAL PRIMARY KEY,
                subdomain        VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                token_type       VARCHAR(10) NOT NULL CHECK (token_type IN ('SLOT','CREDIT')),
                amount           INTEGER NOT NULL,
                transaction_type VARCHAR(50) NOT NULL,
                reference_id     VARCHAR(100) UNIQUE,
                description      TEXT,
                created_at       TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_billing_ledger_subdomain
            ON billing_ledger (subdomain);
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_billing_ledger_token
            ON billing_ledger (subdomain, token_type);
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_billing_ledger_created
            ON billing_ledger (created_at DESC);
        """)
        # Lightweight key-value settings for Superadmin tunables (credit_price, etc.)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key        VARCHAR(100) PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        cur.execute("""
            INSERT INTO app_settings (key, value)
            VALUES ('credit_price', '200')
            ON CONFLICT (key) DO NOTHING;
        """)
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS credit_ledger (
                id               SERIAL PRIMARY KEY,
                subdomain        VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                amount           INTEGER NOT NULL,
                transaction_type VARCHAR(50) NOT NULL,
                reference_id     VARCHAR(100) UNIQUE,
                description      TEXT,
                created_at       TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_credit_ledger_subdomain
            ON credit_ledger (subdomain);
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_credit_ledger_created
            ON credit_ledger (created_at DESC);
        """)
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS result_publications (
                id               SERIAL PRIMARY KEY,
                subdomain        VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                student_id       VARCHAR(100) NOT NULL,
                term             VARCHAR(50) NOT NULL CHECK (term IN ('Term 1', 'Term 2', 'Term 3')),
                academic_session VARCHAR(50) NOT NULL,
                published_by     VARCHAR(100),
                published_at     TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(subdomain, student_id, term, academic_session)
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_publications_lookup
            ON result_publications (subdomain, student_id, term);
        """)
        # One-time migration: paid tenants keep working — convert their
        # legacy student_count quota into an opening credit balance with a
        # matching PURCHASE ledger row. Guarded by ledger absence so
        # replays (and legitimately spent-down balances) are never re-credited.
        # NOTE: Must run AFTER tables are created (otherwise rollback wipes DDL).
        cur.execute(f"""
            INSERT INTO {CREDIT_LEDGER_TABLE}
                (subdomain, amount, transaction_type, reference_id, description)
            SELECT subdomain, student_count, 'PURCHASE',
                   'backfill:' || subdomain,
                   'Legacy quota migrated to credit balance'
            FROM {SCHOOLS_REGISTRY_TABLE} s
            WHERE s.subscription_status = 'active'
              AND COALESCE(s.student_count, 0) > 0
              AND NOT EXISTS (
                  SELECT 1 FROM {CREDIT_LEDGER_TABLE} l
                  WHERE l.subdomain = s.subdomain
              )
            ON CONFLICT (reference_id) DO NOTHING;
        """)
        cur.execute(f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE} s
            SET credit_balance = s.student_count
            WHERE s.subscription_status = 'active'
              AND COALESCE(s.credit_balance, 0) = 0
              AND NOT EXISTS (
                  SELECT 1 FROM {CREDIT_LEDGER_TABLE} l
                  WHERE l.subdomain = s.subdomain
              );
        """)
        cur.execute(f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET subscription_status = 'unpaid'
            WHERE subscription_status IS NULL OR subscription_status = '';
        """)
        cur.execute(f"""
            CREATE INDEX IF NOT EXISTS ix_schools_subscription_status
            ON {SCHOOLS_REGISTRY_TABLE} (subscription_status);
        """)
        conn.commit()
        logger.info(f"[DB] Schools registry table '{SCHOOLS_REGISTRY_TABLE}' ready (subscription_status default 'unpaid')")
    except Exception as e:
        logger.error(f"[DB] Failed to initialize schools registry: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


def register_school(subdomain: str, school_name: str, **kwargs) -> Dict[str, Any]:
    """Register a newly provisioned school in the central registry."""
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            INSERT INTO {SCHOOLS_REGISTRY_TABLE}
                (subdomain, school_name, email, phone, address, city, state, country,
                 logo_url, hero_bg_url, motto, proprietor_name, registration_number,
                 is_verified, is_active, subscription_plan, subscription_status, student_count)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (subdomain) DO UPDATE SET
                school_name = EXCLUDED.school_name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                address = EXCLUDED.address,
                city = EXCLUDED.city,
                state = EXCLUDED.state,
                country = EXCLUDED.country,
                logo_url = EXCLUDED.logo_url,
                hero_bg_url = EXCLUDED.hero_bg_url,
                motto = EXCLUDED.motto,
                proprietor_name = EXCLUDED.proprietor_name,
                registration_number = EXCLUDED.registration_number,
                updated_at = NOW()
            RETURNING *;
            """,
            (
                subdomain,
                school_name,
                kwargs.get("email"),
                kwargs.get("phone"),
                kwargs.get("address"),
                kwargs.get("city"),
                kwargs.get("state"),
                kwargs.get("country", "NG"),
                kwargs.get("logo_url"),
                kwargs.get("hero_bg_url"),
                kwargs.get("motto"),
                kwargs.get("proprietor_name"),
                kwargs.get("registration_number"),
                kwargs.get("is_verified", False),
                kwargs.get("is_active", True),
                kwargs.get("subscription_plan"),
                kwargs.get("subscription_status", "unpaid"),
                kwargs.get("student_count"),
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return _row_to_dict(row, cur)
    except Exception as e:
        logger.error(f"[DB] Failed to register school '{subdomain}': {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def get_school_by_subdomain(subdomain: str) -> Optional[Dict[str, Any]]:
    """Retrieve school metadata from the registry by subdomain."""
    subdomain = _sanitize_subdomain(subdomain)
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT id, subdomain, school_name, email, phone, address, city, state, country,
                   logo_url, hero_bg_url, motto, proprietor_name, registration_number,
                   is_verified, is_active, subscription_plan, subscription_status, student_count,
                     credit_balance, slots_balance, id_prefix, new_term_begins, created_at, updated_at
            FROM {SCHOOLS_REGISTRY_TABLE}
            WHERE subdomain = %s;
            """,
            (subdomain,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return _row_to_dict(row, cur)
    except Exception as e:
        logger.error(f"[DB] Failed to fetch school '{subdomain}': {e}")
        return None
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Credit & Command — token ledger + publication gate (zero-downtime, additive)
# ---------------------------------------------------------------------------

CREDIT_LEDGER_TABLE = "credit_ledger"
RESULT_PUBLICATIONS_TABLE = "result_publications"
BILLING_LEDGER_TABLE = "billing_ledger"
APP_SETTINGS_TABLE = "app_settings"

#: Free trial credits granted on registration (frictionless onboarding).
TRIAL_CREDITS = 30
TRIAL_SLOTS = 0  # slots are purchased via student_count; credits are the trial gift

#: Default flat price per publishing credit (NGN) — superadmin tunable via app_settings.
DEFAULT_CREDIT_PRICE = 200


def current_academic_session(now: Optional[datetime] = None) -> str:
    """Derive the academic session label dynamically (YYYY/YYYY+1).

    Nigerian school year starts in September: Sep–Dec belongs to the
    session starting this year, Jan–Aug belongs to the session that
    started last year.
    """
    ref = now or datetime.now(timezone.utc)
    if ref.month >= 9:
        return f"{ref.year}/{ref.year + 1}"
    return f"{ref.year - 1}/{ref.year}"


def get_credit_balance(subdomain: str) -> int:
    """Return the spendable credit balance for a tenant (0 if unknown)."""
    subdomain = _sanitize_subdomain(subdomain)
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"SELECT credit_balance FROM {SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s;",
            (subdomain,),
        )
        row = cur.fetchone()
        if row is None:
            return 0
        return int(row[0] or 0)
    except Exception as e:
        logger.error(f"[DB] Failed to fetch credit balance for '{subdomain}': {e}")
        return 0
    finally:
        if conn:
            conn.close()


def get_credit_ledger(subdomain: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Return ledger entries for a tenant, newest first."""
    subdomain = _sanitize_subdomain(subdomain)
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT id, subdomain, amount, transaction_type, reference_id,
                   description, created_at
            FROM {CREDIT_LEDGER_TABLE}
            WHERE subdomain = %s
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s;
            """,
            (subdomain, limit, offset),
        )
        rows = cur.fetchall()
        out = []
        for r in rows:
            d = _row_to_dict(r, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            else:
                d["created_at"] = str(d.get("created_at") or "")
            out.append(d)
        return out
    except Exception as e:
        logger.error(f"[DB] Failed to fetch ledger for '{subdomain}': {e}")
        return []
    finally:
        if conn:
            conn.close()


def add_credit_ledger_entry(
    subdomain: str,
    amount: int,
    transaction_type: str,
    reference_id: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Insert an immutable ledger entry. Duplicate reference_id → returns existing row."""
    subdomain = _sanitize_subdomain(subdomain)
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            INSERT INTO {CREDIT_LEDGER_TABLE}
                (subdomain, amount, transaction_type, reference_id, description)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (reference_id) DO NOTHING
            RETURNING id, subdomain, amount, transaction_type, reference_id,
                      description, created_at;
            """,
            (subdomain, int(amount), transaction_type, reference_id, description),
        )
        row = cur.fetchone()
        if row is None and reference_id:
            # Replay with an existing reference — return the original entry.
            cur.execute(
                f"""
                SELECT id, subdomain, amount, transaction_type, reference_id,
                       description, created_at
                FROM {CREDIT_LEDGER_TABLE}
                WHERE reference_id = %s;
                """,
                (reference_id,),
            )
            row = cur.fetchone()
        conn.commit()
        d = _row_to_dict(row, cur) if row is not None else {}
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        return d
    except Exception as e:
        logger.error(f"[DB] Failed to insert ledger entry for '{subdomain}': {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def grant_initial_credits(subdomain: str, amount: int = TRIAL_CREDITS) -> Dict[str, Any]:
    """Grant trial credits to a newly provisioned tenant (INITIAL_GRANT).

    Sets schools.credit_balance and writes the ledger row atomically.
    Safe to call once per tenant — reference_id makes replays idempotent.
    """
    subdomain = _sanitize_subdomain(subdomain)
    amount = max(0, int(amount or 0))
    reference_id = f"init:{subdomain}"
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            INSERT INTO {CREDIT_LEDGER_TABLE}
                (subdomain, amount, transaction_type, reference_id, description)
            VALUES (%s, %s, 'INITIAL_GRANT', %s, %s)
            ON CONFLICT (reference_id) DO NOTHING
            RETURNING id;
            """,
            (subdomain, amount, reference_id, f"Trial credit grant upon registration ({amount} credits)"),
        )
        inserted = cur.fetchone()
        if inserted is not None:
            cur.execute(
                f"""
                UPDATE {SCHOOLS_REGISTRY_TABLE}
                SET credit_balance = COALESCE(credit_balance, 0) + %s,
                    updated_at = NOW()
                WHERE subdomain = %s;
                """,
                (amount, subdomain),
            )
        conn.commit()
        logger.info(f"[DB] Initial grant of {amount} credits for '{subdomain}' (new={inserted is not None})")
        return {"subdomain": subdomain, "granted": amount, "new_grant": inserted is not None}
    except Exception as e:
        logger.error(f"[DB] Failed to grant initial credits for '{subdomain}': {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def is_result_published(subdomain: str, student_id: str, term: str, academic_session: str) -> bool:
    """Check whether a student's report card is published (unlocked) for a term."""
    subdomain = _sanitize_subdomain(subdomain)
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT 1 FROM {RESULT_PUBLICATIONS_TABLE}
            WHERE subdomain = %s AND student_id = %s
              AND term = %s AND academic_session = %s
            LIMIT 1;
            """,
            (subdomain, student_id, term, academic_session),
        )
        return cur.fetchone() is not None
    except Exception as e:
        logger.error(f"[DB] Failed to check publication for '{subdomain}/{student_id}': {e}")
        return False
    finally:
        if conn:
            conn.close()


def publish_student_results(
    subdomain: str,
    term: str,
    academic_session: str,
    student_ids: List[str],
    published_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Publish report cards, deducting 1 credit per newly published student.

    Re-publishing an already-published (subdomain, student, term, session)
    row costs 0 credits (ON CONFLICT DO NOTHING + deduction only for
    newly inserted rows). Row-locks the school row (FOR UPDATE) so
    concurrent publishes cannot overspend the balance.
    """
    subdomain = _sanitize_subdomain(subdomain)
    unique_ids = sorted({str(s).strip() for s in (student_ids or []) if str(s).strip()})
    if not unique_ids:
        raise ValueError("No student_ids provided for publication")
    batch_ref = f"pub:{subdomain}:{term}:{academic_session}:{len(unique_ids)}:{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    conn = None
    try:
        conn = _connect_as_superuser()
        # Autocommit is ON for superuser connections — use explicit transaction.
        cur = conn.cursor()
        cur.execute("BEGIN;")
        cur.execute(
            f"SELECT credit_balance FROM {SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s FOR UPDATE;",
            (subdomain,),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute("ROLLBACK;")
            raise ValueError(f"Unknown tenant '{subdomain}'")
        balance = int(row[0] or 0)
        # Determine which students are not yet published (free re-prints excluded).
        cur.execute(
            f"""
            SELECT student_id FROM {RESULT_PUBLICATIONS_TABLE}
            WHERE subdomain = %s AND term = %s AND academic_session = %s
              AND student_id = ANY(%s);
            """,
            (subdomain, term, academic_session, unique_ids),
        )
        already = {r[0] for r in cur.fetchall()}
        to_publish = [s for s in unique_ids if s not in already]
        if len(to_publish) > balance:
            cur.execute("ROLLBACK;")
            raise ValueError(
                f"Insufficient credits: need {len(to_publish)}, balance is {balance}"
            )
        published_now = 0
        if to_publish:
            cur.execute(
                f"""
                INSERT INTO {RESULT_PUBLICATIONS_TABLE}
                    (subdomain, student_id, term, academic_session, published_by)
                SELECT %s, sid, %s, %s, %s
                FROM UNNEST(%s::text[]) AS sid
                ON CONFLICT (subdomain, student_id, term, academic_session) DO NOTHING
                RETURNING id;
                """,
                (subdomain, term, academic_session, published_by, to_publish),
            )
            published_now = len(cur.fetchall())
            if published_now:
                cur.execute(
                    f"""
                    UPDATE {SCHOOLS_REGISTRY_TABLE}
                    SET credit_balance = credit_balance - %s, updated_at = NOW()
                    WHERE subdomain = %s
                    RETURNING credit_balance;
                    """,
                    (published_now, subdomain),
                )
                balance = int(cur.fetchone()[0] or 0)
                cur.execute(
                    f"""
                    INSERT INTO {CREDIT_LEDGER_TABLE}
                        (subdomain, amount, transaction_type, reference_id, description)
                    VALUES (%s, %s, 'PUBLICATION_DEDUCTION', %s, %s);
                    """,
                    (
                        subdomain,
                        -published_now,
                        batch_ref,
                        f"Published {published_now} report card(s) for {term} {academic_session}"
                        + (f" by {published_by}" if published_by else ""),
                    ),
                )
        cur.execute("COMMIT;")
        logger.info(
            f"[DB] Published {published_now} card(s) for '{subdomain}' {term} "
            f"(skipped {len(already)} already published, balance {balance})"
        )
        return {
            "subdomain": subdomain,
            "term": term,
            "academic_session": academic_session,
            "published_now": published_now,
            "already_published": sorted(already),
            "new_balance": balance,
            "reference_id": batch_ref if published_now else None,
        }
    except Exception:
        try:
            if conn:
                with conn.cursor() as rb_cur:
                    rb_cur.execute("ROLLBACK;")
        except Exception:
            pass
        raise
    finally:
        if conn:
            conn.close()

TENANT_STUDENTS_TABLE = "tenant_students"
TENANT_STAFF_TABLE = "tenant_staff"
TENANT_ALLOCATIONS_TABLE = "tenant_allocations"
TENANT_SUBJECTS_TABLE = "tenant_subjects"
TENANT_GRADES_TABLE = "tenant_grades"

VALID_TERMS = ("Term 1", "Term 2", "Term 3")


def init_roster_registry() -> None:
    """Create tenant_students, tenant_staff, tenant_allocations if they don't exist."""
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")

        # Students
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {TENANT_STUDENTS_TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subdomain VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                student_id VARCHAR(60) NOT NULL,
                full_name VARCHAR(120) NOT NULL,
                class_name VARCHAR(60) NOT NULL,
                gender VARCHAR(20),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(subdomain, student_id)
            );
        """)

        # Staff — with password_hash for Staff Authentication (default PIN 123456 hashed via pgcrypto)
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {TENANT_STAFF_TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subdomain VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                staff_id VARCHAR(60) NOT NULL,
                full_name VARCHAR(120) NOT NULL,
                email VARCHAR(255),
                phone VARCHAR(20),
                role VARCHAR(50) NOT NULL,
                password_hash VARCHAR(255),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(subdomain, staff_id)
            );
        """)
        # Ensure existing deployments get password_hash column (NOT NULL constraint added after backfill)
        cur.execute(f"ALTER TABLE {TENANT_STAFF_TABLE} ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);")
        cur.execute(f"UPDATE {TENANT_STAFF_TABLE} SET password_hash = crypt('123456', gen_salt('bf')) WHERE password_hash IS NULL;")
        # Enforce NOT NULL after backfill (idempotent)
        cur.execute(f"ALTER TABLE {TENANT_STAFF_TABLE} ALTER COLUMN password_hash SET NOT NULL;")

        # Allocations — subject → staff → class
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {TENANT_ALLOCATIONS_TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subdomain VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                subject_name VARCHAR(120) NOT NULL,
                staff_name VARCHAR(120) NOT NULL,
                class_name VARCHAR(60) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(subdomain, subject_name, class_name)
            );
        """)

        # Subjects — master list per tenant (for relational Allocate)
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {TENANT_SUBJECTS_TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subdomain VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                subject_name VARCHAR(120) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(subdomain, subject_name)
            );
        """)

        # Grades — per-student per-subject per-term scores (focused grading workflow)
        # student_id is a logical link to tenant_students.student_id (not enforced as FK
        # so roster edits never cascade-delete grades).
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {TENANT_GRADES_TABLE} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subdomain VARCHAR(60) NOT NULL REFERENCES {SCHOOLS_REGISTRY_TABLE}(subdomain) ON DELETE CASCADE,
                student_id VARCHAR(60) NOT NULL,
                subject_name VARCHAR(120) NOT NULL,
                term VARCHAR(64) NOT NULL CHECK (term IN ('Term 1', 'Term 2', 'Term 3')),
                academic_scores JSONB DEFAULT '{{}}'::jsonb,
                behavioural_traits JSONB DEFAULT '{{}}'::jsonb,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(subdomain, student_id, subject_name, term)
            );
        """)

        # Indexes for fast subdomain-scoped lookups
        for tbl in [TENANT_STUDENTS_TABLE, TENANT_STAFF_TABLE, TENANT_ALLOCATIONS_TABLE, TENANT_SUBJECTS_TABLE, TENANT_GRADES_TABLE]:
            cur.execute(f"CREATE INDEX IF NOT EXISTS ix_{tbl}_subdomain ON {tbl}(subdomain);")
            cur.execute(f"CREATE INDEX IF NOT EXISTS ix_{tbl}_created_at ON {tbl}(created_at DESC);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS ix_{TENANT_GRADES_TABLE}_subject_term ON {TENANT_GRADES_TABLE}(subject_name, term);")
        # Spec-required indexes for tenant_grades (Failsafe Grading Workflow)
        cur.execute(f"CREATE INDEX IF NOT EXISTS ix_{TENANT_GRADES_TABLE}_subdomain_subject_term ON {TENANT_GRADES_TABLE}(subdomain, subject_name, term);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS ix_{TENANT_GRADES_TABLE}_student_id ON {TENANT_GRADES_TABLE}(student_id);")

        conn.commit()
        logger.info("[DB] Roster tables ready (tenant_students, tenant_staff, tenant_allocations, tenant_subjects, tenant_grades)")
    except Exception as e:
        logger.error(f"[DB] Failed to initialize roster registry: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


def _row_to_dict(row, cursor) -> Dict[str, Any]:
    """Convert a psycopg2 cursor row to a dict using cursor column names."""
    if row is None:
        return {}
    cols = [desc[0] for desc in cursor.description]
    return dict(zip(cols, row))
