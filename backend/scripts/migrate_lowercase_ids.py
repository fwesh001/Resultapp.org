"""
One-time migration: lowercase all student_id prefixes and id_prefix.

Run on droplet: python scripts/migrate_lowercase_ids.py
Idempotent, logs collisions where LOWER() would violate UNIQUE.

Covers:
  schools.id_prefix
  tenant_students.student_id
  tenant_grades.student_id
  result_publications.student_id
  student_academic_records.student_id (legacy SQLAlchemy)
  student_behavioral_records.student_id (legacy)

Requires PG_SUPERUSER env (same as db_manager).
"""
import os
import sys
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.db_manager import _connect_as_superuser, SCHOOLS_REGISTRY_TABLE, TENANT_STUDENTS_TABLE, TENANT_GRADES_TABLE, RESULT_PUBLICATIONS_TABLE

PRECHECKS = [
    # show potential UNIQUE collisions before lowering
    (f"SELECT subdomain, student_id, LOWER(student_id) FROM {TENANT_STUDENTS_TABLE} WHERE student_id <> LOWER(student_id) LIMIT 20", "tenant_students collisions preview"),
    (f"SELECT subdomain, student_id, LOWER(student_id) FROM {TENANT_GRADES_TABLE} WHERE student_id <> LOWER(student_id) LIMIT 20", "tenant_grades collisions preview"),
]

MIGRATIONS = [
    # schools prefix
    (f"UPDATE {SCHOOLS_REGISTRY_TABLE} SET id_prefix = LOWER(id_prefix), updated_at = NOW() WHERE id_prefix IS NOT NULL AND id_prefix <> LOWER(id_prefix)", "schools.id_prefix"),
    # tenant_students: normalize prefix before slash to lower, keep rest
    # Simple LOWER for full id is safe because ids are prefix/number; number part unaffected
    (f"UPDATE {TENANT_STUDENTS_TABLE} SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id)", "tenant_students.student_id"),
    (f"UPDATE {TENANT_GRADES_TABLE} SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id)", "tenant_grades.student_id"),
    (f"UPDATE {RESULT_PUBLICATIONS_TABLE} SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id)", "result_publications.student_id"),
]

LEGACY_TABLES = ["student_academic_records", "student_behavioral_records"]

def main(dry_run=False):
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # precheck collisions: count duplicates after LOWER
        for sql, label in [
            (f"SELECT subdomain, LOWER(student_id) as lower_id, COUNT(*) c FROM {TENANT_STUDENTS_TABLE} GROUP BY subdomain, lower_id HAVING COUNT(*) > 1", "tenant_students duplicate lower_ids"),
            (f"SELECT subdomain, LOWER(student_id) as lower_id, COUNT(*) c FROM {TENANT_GRADES_TABLE} GROUP BY subdomain, LOWER(student_id), subject_name, term HAVING COUNT(*) > 1", "tenant_grades duplicate"),
        ]:
            cur.execute(sql)
            rows = cur.fetchall()
            if rows:
                logger.warning(f"Collision detected for {label}: {rows[:5]} — must dedupe manually before migration")
                if not dry_run:
                    print(f"Aborting due to collisions in {label}", file=sys.stderr)
                    sys.exit(1)

        if dry_run:
            logger.info("DRY RUN — previewing changes")
            for sql, label in PRECHECKS:
                cur.execute(sql)
                rows = cur.fetchall()
                logger.info(f"{label}: {len(rows)} rows would change: {rows[:3]}")
            return

        for sql, label in MIGRATIONS:
            try:
                cur.execute(sql)
                logger.info(f"{label}: {cur.rowcount} rows updated")
            except Exception as e:
                if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                    logger.error(f"{label} failed due to UNIQUE collision: {e}. Resolve duplicates manually.")
                    conn.rollback()
                    sys.exit(2)
                raise
        # legacy tables — best effort, ignore if not exist
        for tbl in LEGACY_TABLES:
            try:
                cur.execute(f"UPDATE {tbl} SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id)")
                logger.info(f"{tbl}.student_id: {cur.rowcount} rows updated")
            except Exception as e:
                logger.warning(f"{tbl} skipped (not exists or error): {e}")
                conn.rollback()
                # reopen transaction after rollback
                cur = conn.cursor()

        conn.commit()
        logger.info("Migration complete — all prefixes now lowercased (vhs/001).")

        # post verify
        for sql in [
            f"SELECT COUNT(*) FROM {TENANT_STUDENTS_TABLE} WHERE student_id <> LOWER(student_id)",
            f"SELECT COUNT(*) FROM {TENANT_GRADES_TABLE} WHERE student_id <> LOWER(student_id)",
            f"SELECT COUNT(*) FROM {SCHOOLS_REGISTRY_TABLE} WHERE id_prefix IS NOT NULL AND id_prefix <> LOWER(id_prefix)",
        ]:
            cur.execute(sql)
            logger.info(f"Verify {sql}: {cur.fetchone()[0]} remaining upper")

    except SystemExit:
        raise
    except Exception as e:
        logger.exception(f"Migration failed: {e}")
        if conn:
            conn.rollback()
        sys.exit(3)
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    main(dry_run=dry)
