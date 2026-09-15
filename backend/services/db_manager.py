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
from typing import Dict, Optional

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
