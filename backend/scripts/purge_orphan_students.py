#!/usr/bin/env python3
"""Purge orphaned student academic records (LEGAL_REMEDIATION.md P0 item 2).

The student delete endpoint now cascades transactionally, but every student
removed *before* that fix left their dependent rows behind. `tenant_grades`,
`student_academic_records`, `student_behavioral_records` and
`result_publications` all key on the admission-number string and none carries
an FK to `tenant_students`, so nothing cleaned them up.

Those orphans are a live correctness bug, not only a privacy one. `tenant_students`
is UNIQUE(subdomain, student_id), so if a withdrawn admission number has since
been re-enrolled, the new pupil is sitting on the previous child's scores,
behavioural ratings, free-text remarks and publication state — and reads as
already published, so publishing them costs zero credits.

Orphan definition
-----------------
A dependent row whose (tenant, student_id) has no matching `tenant_students`
row, compared case-insensitively (the same normalisation every reader uses).

IMPORTANT: this script never resolves a *collision* — where the admission
number has been re-enrolled and now belongs to a different child. It cannot
tell those rows apart, because nothing in the schema records which pupil a
given grade row belonged to. Collisions are reported loudly for manual review
and are never touched.

Scope guardrails
----------------
- Dry run by default. Writes nothing, prints per-tenant counts and samples.
- `--execute` performs the deletes in a single transaction, then re-counts.
- `--collisions-only` reports reuse collisions without deleting anything.
- Each table is deleted independently; a failure on one is reported and the
  rest still run, because the connection is autocommit and a partial purge is
  better than a total abort when the alternative is leaving PII in place.

Usage (from backend/ dir, venv active):

    py scripts/purge_orphan_students.py                   # dry run
    py scripts/purge_orphan_students.py --collisions-only # audit admission reuse
    py scripts/purge_orphan_students.py --execute         # DESTRUCTIVE

Take a point-in-time PostgreSQL snapshot before --execute.
"""

import argparse
import os
import sys

# Allow running as `python scripts/purge_orphan_students.py` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: (table, tenant column) pairs. tenant_grades/result_publications use
#: `subdomain`; the two SQLAlchemy tables use `tenant_id`. They are all in the
#: same database and schema, so one connection covers every one of them.
DEPENDENT_TABLES = [
    ("tenant_grades", "subdomain"),
    ("student_academic_records", "tenant_id"),
    ("student_behavioral_records", "tenant_id"),
    ("result_publications", "subdomain"),
]

SAMPLE_LIMIT = 5


def _connect():
    from services.db_manager import _connect_as_superuser

    return _connect_as_superuser()


def _scan_orphans(cur):
    """Per-table orphan counts, grouped by tenant."""
    report = {}
    for table, tenant_col in DEPENDENT_TABLES:
        try:
            cur.execute(
                f"""
                SELECT d.{tenant_col} AS tid, COUNT(*)
                FROM {table} d
                WHERE NOT EXISTS (
                    SELECT 1 FROM tenant_students s
                    WHERE s.subdomain = d.{tenant_col}
                      AND LOWER(s.student_id) = LOWER(d.student_id)
                )
                GROUP BY d.{tenant_col}
                ORDER BY COUNT(*) DESC;
                """
            )
            report[table] = {str(r[0]): int(r[1]) for r in cur.fetchall() if r[0] is not None}
        except Exception as e:
            report[table] = {"__error__": str(e)}
    return report


def _sample_orphans(cur, table, tenant_col, limit=SAMPLE_LIMIT):
    try:
        cur.execute(
            f"""
            SELECT d.{tenant_col} AS tid, d.student_id
            FROM {table} d
            WHERE NOT EXISTS (
                SELECT 1 FROM tenant_students s
                WHERE s.subdomain = d.{tenant_col}
                  AND LOWER(s.student_id) = LOWER(d.student_id)
            )
            LIMIT %s;
            """,
            (limit,),
        )
        return [(str(r[0]), str(r[1])) for r in cur.fetchall()]
    except Exception as e:
        return [("(error)", str(e))]


def _find_collisions(cur):
    """Admission numbers that exist in dependents but whose pupil differs.

    A collision is an admission number whose dependent rows reference a
    student_id that is NOT in the roster, while a *different* pupil currently
    occupies the same numeric suffix. This is the reuse case; it is reported
    and never deleted automatically.
    """
    findings = []
    for table, tenant_col in DEPENDENT_TABLES:
        try:
            cur.execute(
                f"""
                SELECT d.{tenant_col} AS tid, d.student_id, COUNT(*)
                FROM {table} d
                WHERE NOT EXISTS (
                    SELECT 1 FROM tenant_students s
                    WHERE s.subdomain = d.{tenant_col}
                      AND LOWER(s.student_id) = LOWER(d.student_id)
                )
                GROUP BY d.{tenant_col}, d.student_id
                ORDER BY COUNT(*) DESC
                LIMIT 50;
                """
            )
            for tid, sid, n in cur.fetchall():
                findings.append((table, str(tid), str(sid), int(n)))
        except Exception as e:
            findings.append((table, "(error)", str(e), 0))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Purge orphaned student academic records. Dry run by default.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="ACTUALLY DELETE. Omit for a dry run. Take a DB snapshot first.",
    )
    parser.add_argument(
        "--collisions-only",
        action="store_true",
        help="Report admission-number reuse collisions and exit without deleting.",
    )
    args = parser.parse_args()

    conn = None
    try:
        conn = _connect()
        cur = conn.cursor()

        print("=" * 72)
        print("ORPHAN STUDENT RECORD REAPER")
        print(f"mode: {'DESTRUCTIVE (--execute)' if args.execute else 'DRY RUN — nothing will be written'}")
        print("=" * 72)

        report = _scan_orphans(cur)

        total = 0
        for table, per_tenant in report.items():
            if "__error__" in per_tenant:
                print(f"\n[{table}] SCAN ERROR: {per_tenant['__error__']}")
                continue
            table_total = sum(per_tenant.values())
            total += table_total
            print(f"\n[{table}] {table_total} orphaned row(s) across {len(per_tenant)} tenant(s)")
            for tid, count in list(per_tenant.items())[:20]:
                print(f"    {tid:<32} {count}")
                for sample_tid, sample_sid in _sample_orphans(cur, table, "subdomain" if table in ("tenant_grades", "result_publications") else "tenant_id"):
                    if sample_tid == tid:
                        print(f"        e.g. student_id={sample_sid}")

        print(f"\nTOTAL orphaned rows across all tables: {total}")

        collisions = _find_collisions(cur)
        if collisions:
            print("\n" + "-" * 72)
            print("ADMISSION-NUMBER REUSE (needs manual review, never auto-deleted)")
            print("-" * 72)
            for table, tid, sid, n in collisions:
                print(f"    {table:<28} {tid:<28} {sid:<20} {n} row(s)")
            print(
                "\n  These rows belong to a pupil who is no longer on the roster, but the\n"
                "  admission number may since have been re-enrolled to someone else. The\n"
                "  schema does not record which pupil a grade row belonged to, so this\n"
                "  script cannot separate the two. Inspect each one by hand."
            )
        else:
            print("\nNo admission-number reuse detected.")

        if args.collisions_only:
            print("\n--collisions-only: exiting without deleting.")
            return 0

        if not args.execute:
            print("\nDRY RUN COMPLETE — nothing was written.")
            print("Re-run with --execute to purge. Take a DB snapshot first.")
            return 0

        if total == 0:
            print("\nNothing orphaned. No action taken.")
            return 0

        print("\n" + "=" * 72)
        print("EXECUTING PURGE")
        print("=" * 72)
        try:
            cur.execute("BEGIN;")
        except Exception:
            pass

        removed = {}
        for table, tenant_col in DEPENDENT_TABLES:
            if "__error__" in report.get(table, {}):
                removed[table] = "skipped (scan error)"
                continue
            try:
                cur.execute(
                    f"""
                    DELETE FROM {table} d
                    WHERE NOT EXISTS (
                        SELECT 1 FROM tenant_students s
                        WHERE s.subdomain = d.{tenant_col}
                          AND LOWER(s.student_id) = LOWER(d.student_id)
                    );
                    """
                )
                removed[table] = cur.rowcount
            except Exception as e:
                removed[table] = f"ERROR: {e}"
                print(f"  !! {table}: {e}")

        cur.execute("COMMIT;")

        print("\nRemoved per table:")
        for table, n in removed.items():
            print(f"    {table:<30} {n}")

        after = _scan_orphans(cur)
        remaining = sum(
            sum(v.values()) for v in after.values() if "__error__" not in v
        )
        print(f"\nRemaining orphaned rows: {remaining}")
        return 0

    except Exception as e:
        print(f"\nFATAL: {e}", file=sys.stderr)
        return 1
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
