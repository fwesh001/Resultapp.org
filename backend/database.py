"""
ResultApp — SQLAlchemy connection management (Phase 2: Dynamic Grading Engine)

Design:
- Reuses existing PG_* env vars from _pg_config() (PG_HOST/PORT/SUPERUSER/PASSWORD/DB)
- Keeps raw psycopg2 path intact for provisioner (services/db_manager.py) — this
  engine is additive, not a replacement.
- tenant_id = subdomain string (index) mirrors middleware.ts & schools registry

Usage:
    from database import Base, engine, SessionLocal, get_db
"""

import os
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


def _build_database_url() -> str:
    host = os.getenv("PG_HOST", "localhost")
    port = os.getenv("PG_PORT", "5432")
    user = os.getenv("PG_SUPERUSER", "postgres")
    password = os.getenv("PG_SUPERUSER_PASSWORD", "")
    dbname = os.getenv("PG_SUPERUSER_DB", "postgres")
    # URL-encode password if it contains special chars
    try:
        from urllib.parse import quote_plus
        password_enc = quote_plus(password) if password else ""
    except Exception:
        password_enc = password
    auth = f"{user}:{password_enc}" if password_enc else user
    return f"postgresql+psycopg2://{auth}@{host}:{port}/{dbname}"


DATABASE_URL = _build_database_url()

# pool_pre_ping handles stale connections on Droplet long-running workers
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """
    FastAPI dependency that yields a SQLAlchemy Session and guarantees close.
    Usage: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_grading_tables() -> None:
    """
    Create grading tables if they do not exist.
    Safe to call on every startup (create_all is idempotent).
    Import models inside to avoid circular imports.
    """
    try:
        # Import here so Base metadata is populated before create_all
        import models  # noqa: F401  pylint: disable=unused-import

        Base.metadata.create_all(bind=engine)
        # Additive live-DB guards for columns added after first deploy
        # (create_all does not ALTER existing tables).
        from sqlalchemy import text as _text

        with engine.begin() as _conn:
            _conn.execute(_text(
                "ALTER TABLE grading_templates "
                "ADD COLUMN IF NOT EXISTS applies_to_classes JSONB NOT NULL DEFAULT '[]'"
            ))
            _conn.execute(_text(
                "ALTER TABLE grading_templates "
                "ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"
            ))
            _conn.execute(_text(
                "ALTER TABLE grading_templates "
                "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
            ))
        logger.info("[DB] Grading tables ensured (grading_templates, student_academic_records, student_behavioral_records)")
    except Exception as e:
        logger.error(f"[DB] Failed to init grading tables: {e}")
        raise
