#!/usr/bin/env python3
"""Clean orphaned STAFF_GRADING_REMINDER inbox rows (identity-mismatch fix).

Orphan definition: a notification_reads row joined to a STAFF_GRADING_REMINDER
notification whose user_id is NOT any tenant_staff.id::text in that row's
tenant (e.g. raw staff_id strings, names, or emails written by earlier
builds, or rows pointing at deleted staff rows). Such rows can never match
the canonical-UUID inbox query, yet unread ones keep tripping the 24h nudge
cooldown — deleting them resets the cooldown for retesting.

Scope guardrails:
- Only touches rows under STAFF_GRADING_REMINDER notifications.
- Never touches rows whose user_id matches a staff UUID in that tenant,
  regardless of is_active (deactivated staff rows stay valid).
- --dry-run (default): prints per-tenant orphan counts + samples, writes nothing.
- --execute: deletes the orphan reads, then deletes parent notifications left
  with zero reads. Prints what was removed.

Usage (from backend/ dir, venv active):
    py scripts/clean_orphan_nudge_reads.py            # dry run
    py scripts/clean_orphan_nudge_reads.py --execute  # delete
"""

import argparse
import os
import sys

# Allow running as `python scripts/clean_orphan_nudge_reads.py` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


ORPHAN_WHERE = """
    n.event_type = 'STAFF_GRADING_REMINDER'
    AND NOT EXISTS (
        SELECT 1 FROM tenant_staff s
        WHERE s.subdomain = r.tenant_id AND s.id::text = r.user_id
    )
"""


def _scan(cur):
    cur.execute(
        f"""
        SELECT r.tenant_id, COUNT(*),
               COUNT(*) FILTER (WHERE r.is_read = FALSE) AS unread
        FROM notification_reads r
        JOIN notifications n ON n.id = r.notification_id
        WHERE {ORPHAN_WHERE}
        GROUP BY r.tenant_id
        ORDER BY r.tenant_id;
        """
    )
    per_tenant = cur.fetchall()
    cur.execute(
        f"""
        SELECT r.tenant_id, r.user_id, r.user_type, r.is_read,
               n.id, LEFT(n.title, 80) AS title, n.created_at
        FROM notification_reads r
        JOIN notifications n ON n.id = r.notification_id
        WHERE {ORPHAN_WHERE}
        ORDER BY n.created_at DESC
        LIMIT 20;
        """
    )
    sample = cur.fetchall()
    cur.execute(
        f"""
        SELECT COUNT(*) FROM notification_reads r
        JOIN notifications n ON n.id = r.notification_id
        WHERE {ORPHAN_WHERE};
        """
    )
    total = int(cur.fetchone()[0] or 0)
    return total, per_tenant, sample


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean orphaned nudge inbox rows.")
    parser.add_argument("--execute", action="store_true", help="Delete orphans (default is dry-run)")
    args = parser.parse_args()

    from services.db_manager import _connect_as_superuser

    conn = _connect_as_superuser()
    try:
        cur = conn.cursor()
        total, per_tenant, sample = _scan(cur)
        print(f"Orphan STAFF_GRADING_REMINDER reads: {total}")
        for tenant, count, unread in per_tenant:
            print(f"  {tenant}: {count} orphan(s), {unread} unread")
        if sample:
            print("Sample (tenant | user_id | type | read | notif_id | title | created):")
            for row in sample:
                print("  " + " | ".join("" if v is None else str(v) for v in row))
        if total == 0:
            print("Nothing to clean.")
            return 0
        if not args.execute:
            print("Dry-run only — re-run with --execute to delete.")
            return 0
        cur.execute(
            f"""
            DELETE FROM notification_reads r
            USING notifications n
            WHERE r.notification_id = n.id AND {ORPHAN_WHERE};
            """
        )
        reads_deleted = cur.rowcount or 0
        # Remove parent reminders left with zero inbox rows (fully orphaned dispatches).
        cur.execute(
            """
            DELETE FROM notifications n
            WHERE n.event_type = 'STAFF_GRADING_REMINDER'
              AND NOT EXISTS (
                  SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id
              );
            """
        )
        parents_deleted = cur.rowcount or 0
        conn.commit()
        print(f"Deleted {reads_deleted} orphan read(s), {parents_deleted} childless notification(s).")
        print("Cooldown reset — nudges for these staff/subjects will dispatch fresh.")
        return 0
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        print(f"Error: {e}", file=sys.stderr)
        return 1
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
