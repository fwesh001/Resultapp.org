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
from typing import Dict, Optional, Any

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
                   created_at, updated_at
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


def _row_to_dict(row, cursor) -> Dict[str, Any]:
    """Convert a psycopg2 cursor row to a dict using cursor column names."""
    if row is None:
        return {}
    cols = [desc[0] for desc in cursor.description]
    return dict(zip(cols, row))
