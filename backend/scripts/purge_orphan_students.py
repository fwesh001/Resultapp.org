#!/usr/bin/env python3
"""Purge orphaned student academic records (LEGAL_REMEDIATION.md P0 item 2).

The student delete endpoint now cascades transactionally, but every student
removed *before* that fix left their dependent rows behind. `tenant_grades`,
`student_academic_records`, `student_behavioral_records` and
`result_publications` all key on the admission-number string and none carries
an FK to `tenant_students`, so nothing cleaned them up.

Those orphans are a live correctness bug, not only a privacy one.
`tenant_students` is UNIQUE(subdomain, student_id), so if a withdrawn
admission number has since been re-enrolled, the new pupil is sitting on the
previous child's scores, behavioural ratings, free-text remarks and publication
state — and reads as already published, so publishing them costs zero credits.

WHAT THIS SCRIPT WILL AND WILL NOT DELETE
----------------------------------------
It deletes ONLY rows whose (tenant, student_id) has no matching
`tenant_students` row. It refuses to resolve a *collision* — where the
admission number has been re-enrolled and now belongs to a different child —
because nothing in the schema records which pupil a given grade row belonged
to. Collisions are reported for manual review and are never touched.

It also cannot tell a genuine withdrawal from a deletion made in error. An
orphan row is ambiguous: the school may have removed the pupil deliberately, or
the pupil may still be on the roster under a different admission number. Run
with --export first, and confirm with the affected schools before --execute.

Safety order
------------
    py scripts/purge_orphan_students.py                    # 1. dry run
    py scripts/purge_orphan_students.py --collisions-only  # 2. audit reuse
    py scripts/purge_orphan_students.py --export orphans.csv  # 3. keep a copy
    py scripts/purge_orphan_students.py --export orphans.csv --execute

Flags
-----
    --dry-run            (default) report only, writes nothing to the database
    --execute            perform the deletes. DESTRUCTIVE and irreversible
    --collisions-only    report admission-number reuse and exit
    --export PATH        write every row that WOULD be deleted to a CSV bundle
                         (directory of .csv files). Always do this before
                         --execute.
    --tenant SLUG        restrict to one school. Strongly recommended for the
                         first run so the blast radius is one school.

Usage (from backend/ dir, venv active)
"""

import argparse
import csv
import os
import sys

# Allow running as `python scripts/purge_orphan_students.py` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: (table, tenant column). tenant_grades/result_publications use `subdomain`;
#: the two SQLAlchemy tables use `tenant_id`. All live in the same database and
#: schema, so a single connection covers every one of them.
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


def orphan_predicate(tenant_col, tenant=None, alias="d", inner_alias="s"):
    """SQL predicate selecting rows with no matching tenant_students row.

    Built in one place so the dry run, the export and the delete can never
    disagree about what counts as an orphan — a mismatch there would mean
    deleting something the report did not show you.
    """
    sql = (
        f"NOT EXISTS ("
        f"  SELECT 1 FROM tenant_students {inner_alias} "
        f"  WHERE {inner_alias}.subdomain = {alias}.{tenant_col} "
        f"    AND LOWER({inner_alias}.student_id) = LOWER({alias}.student_id)"
        f")"
    )
    if tenant:
        sql += f" AND {alias}.{tenant_col} = %s"
    return sql


def _params(tenant):
    return (tenant,) if tenant else ()


def _scan_orphans(cur, tenant=None):
    """Per-table orphan counts, grouped by tenant."""
    report = {}
    for table, tenant_col in DEPENDENT_TABLES:
        try:
            cur.execute(
                f"""
                SELECT d.{tenant_col} AS tid, COUNT(*)
                FROM {table} d
                WHERE {orphan_predicate(tenant_col, tenant)}
                GROUP BY d.{tenant_col}
                ORDER BY COUNT(*) DESC;
                """,
                _params(tenant),
            )
            report[table] = {str(r[0]): int(r[1]) for r in cur.fetchall() if r[0] is not None}
        except Exception as e:
            report[table] = {"__error__": str(e)}
    return report


def _sample_orphans(cur, table, tenant_col, tenant=None, limit=SAMPLE_LIMIT):
    try:
        cur.execute(
            f"""
            SELECT d.{tenant_col} AS tid, d.student_id
            FROM {table} d
            WHERE {orphan_predicate(tenant_col, tenant)}
            LIMIT %s;
            """,
            _params(tenant) + (limit,),
        )
        return [(str(r[0]), str(r[1])) for r in cur.fetchall()]
    except Exception as e:
        return [("(error)", str(e))]


def _find_collisions(cur, tenant=None):
    """Admission numbers whose dependent rows reference a pupil not on the roster.

    A collision is an orphan whose admission number may since have been
    re-enrolled to someone else. Reported, never deleted automatically.
    """
    findings = []
    for table, tenant_col in DEPENDENT_TABLES:
        try:
            cur.execute(
                f"""
                SELECT d.{tenant_col} AS tid, d.student_id, COUNT(*)
                FROM {table} d
                WHERE {orphan_predicate(tenant_col, tenant)}
                GROUP BY d.{tenant_col}, d.student_id
                ORDER BY COUNT(*) DESC
                LIMIT 50;
                """,
                _params(tenant),
            )
            for tid, sid, n in cur.fetchall():
                findings.append((table, str(tid), str(sid), int(n)))
        except Exception as e:
            findings.append((table, "(error)", str(e), 0))
    return findings


def _export(conn, cur, path, tenant=None):
    """Write every row that would be deleted, one CSV per table.

    This is the only way to recover the free-text remarks about a child once
    they are gone, so it is not optional in practice.
    """
    os.makedirs(path, exist_ok=True)
    written = {}
    for table, tenant_col in DEPENDENT_TABLES:
        out = os.path.join(path, f"{table}.csv")
        try:
            sql = (
                f"COPY (SELECT * FROM {table} d "
                f"WHERE {orphan_predicate(tenant_col, tenant)}) "
                f"TO STDOUT WITH (FORMAT csv, HEADER)"
            )
            with open(out, "w", newline="", encoding="utf-8") as fh:
                with conn.cursor() as c:
                    c.copy_expert(sql, fh, params=_params(tenant))
            written[table] = out
        except Exception as e:
            written[table] = f"ERROR: {e}"
    return written


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Purge orphaned student academic records. Dry run by default.",
    )
    parser.add_argument("--execute", action="store_true",
                        help="ACTUALLY DELETE. Omit for a dry run.")
    parser.add_argument("--collisions-only", action="store_true",
                        help="Report admission-number reuse collisions and exit.")
    parser.add_argument("--export", metavar="DIR",
                        help="Write the rows that would be deleted to DIR as CSVs.")
    parser.add_argument("--tenant", metavar="SLUG",
                        help="Restrict to one school (strongly recommended first run).")
    args = parser.parse_args()

    # Refuse a destructive run that has no export, BEFORE touching the database.
    # The export is the only way to recover the free-text remarks about a child
    # once they are gone.
    if args.execute and not args.export:
        print("=" * 72)
        print("REFUSING TO RUN")
        print("=" * 72)
        print("  --execute requires --export <dir>.")
        print()
        print("  Without an export, the rows about to be deleted are unrecoverable,")
        print("  including free-text teacher and principal remarks about a child.")
        print("  Your droplet snapshot is a full-disk image; restoring it means a new")
        print("  droplet on a new IP, which is a poor rollback path for one DELETE.")
        print()
        print("  Run this first:")
        print("      py scripts/purge_orphan_students.py --export <dir>")
        print("  review the output, then repeat with --execute.")
        return 2

    conn = None
    try:
        conn = _connect()
        cur = conn.cursor()

        print("=" * 72)
        print("ORPHAN STUDENT RECORD REAPER")
        print(f"mode:   {'DESTRUCTIVE (--execute)' if args.execute else 'DRY RUN — no database writes'}")
        print(f"scope:  {'tenant ' + args.tenant if args.tenant else 'ALL tenants'}")
        if args.tenant is None:
            print()
            print("  Note: no --tenant, so this scans every school. Consider starting with")
            print("        a single school so the blast radius is one tenant.")
        print("=" * 72)

        report = _scan_orphans(cur, args.tenant)

        total = 0
        for table, per_tenant in report.items():
            if "__error__" in per_tenant:
                print(f"\n[{table}] SCAN ERROR: {per_tenant['__error__']}")
                continue
            table_total = sum(per_tenant.values())
            total += table_total
            print(f"\n[{table}] {table_total} orphaned row(s) across {len(per_tenant)} tenant(s)")
            samples = _sample_orphans(cur, table, *([c for t, c in DEPENDENT_TABLES if t == table][0],
                                                    args.tenant))
            for tid, count in list(per_tenant.items())[:20]:
                print(f"    {tid:<32} {count}")
                for s_tid, s_sid in samples:
                    if s_tid == tid:
                        print(f"        e.g. student_id={s_sid}")

        print(f"\nTOTAL orphaned rows across all tables: {total}")

        collisions = _find_collisions(cur, args.tenant)
        if collisions:
            print("\n" + "-" * 72)
            print("ADMISSION-NUMBER REUSE (manual review required, never auto-deleted)")
            print("-" * 72)
            for table, tid, sid, n in collisions:
                print(f"    {table:<28} {tid:<24} {sid:<20} {n} row(s)")
            print(
                "\n  These rows belong to a pupil who is no longer on the roster, but the\n"
                "  admission number may since have been re-enrolled to someone else. The\n"
                "  schema does not record which pupil a grade row belonged to, so this\n"
                "  script cannot separate the two. Inspect each one by hand."
            )
        else:
            print("\nNo admission-number reuse detected.")

        if args.export:
            written = _export(conn, cur, args.export, args.tenant)
            print(f"\nExported rows-to-be-deleted to {os.path.abspath(args.export)}/")
            for table, out in written.items():
                print(f"    {table:<30} {out}")

        if args.collisions_only:
            print("\n--collisions-only: exiting without deleting.")
            return 0

        if not args.execute:
            print("\nDRY RUN COMPLETE — nothing was written to the database.")
            print("Next: --export <dir>, confirm the schools, then --execute.")
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
                    f"DELETE FROM {table} d WHERE {orphan_predicate(tenant_col, args.tenant)};",
                    _params(args.tenant),
                )
                removed[table] = cur.rowcount
            except Exception as e:
                removed[table] = f"ERROR: {e}"
                print(f"  !! {table}: {e}")

        cur.execute("COMMIT;")

        print("\nRemoved per table:")
        for table, n in removed.items():
            print(f"    {table:<30} {n}")

        after = _scan_orphans(cur, args.tenant)
        remaining = sum(sum(v.values()) for v in after.values() if "__error__" not in v)
        print(f"\nRemaining orphaned rows: {remaining}")
        print("Restore point: the pre-purge export above, plus your droplet snapshot.")
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
