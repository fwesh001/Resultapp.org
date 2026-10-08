"""Read-only audit: find rows tied to doomed tenants by ANY key (subdomain or
tenant_id/tenant), so an irreversible purge cannot leave orphans behind.

    py scripts/audit_tenant_orphans.py vhs sha
"""

from __future__ import annotations

import os
import sys

import psycopg2

KEEP = [a.strip().lower() for a in sys.argv[1:]] or ["vhs", "sha"]


def conn_():
    return psycopg2.connect(
        host=os.getenv("PG_HOST", "localhost"),
        port=os.getenv("PG_PORT", "5432"),
        user=os.getenv("PG_SUPERUSER_USER", "postgres"),
        password=os.getenv("PG_SUPERUSER_PASSWORD"),
        dbname=os.getenv("PG_SUPERUSER_DB", "postgres"),
    )


def main() -> int:
    conn = conn_()
    cur = conn.cursor()

    cur.execute("SELECT id, subdomain FROM schools ORDER BY created_at ASC;")
    rows = cur.fetchall()
    ids = {r[0]: r[1] for r in rows}
    doomed = {k: v for k, v in ids.items() if v not in KEEP}
    print(f"keep    : {KEEP}")
    print(f"doomed  : {len(doomed)} -> {sorted(doomed.values())}")
    if not doomed:
        print("nothing to purge")
        return 0
    id_list = list(doomed.keys())

    # 1) subdomain-keyed tables
    cur.execute(
        """
        SELECT table_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='subdomain'
        GROUP BY table_name ORDER BY table_name;
        """
    )
    sub_tables = [r[0] for r in cur.fetchall()]
    print(f"\nsubdomain-keyed tables ({len(sub_tables)}): {sub_tables}")

    # 2) tenant_id-keyed tables (orphans would survive a subdomain-only purge)
    cur.execute(
        """
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name IN ('tenant_id','tenant','school_id')
        GROUP BY table_name, column_name ORDER BY table_name;
        """
    )
    tid = cur.fetchall()
    print(f"\ntenant_id/school_id-keyed columns: {tid}")

    total = 0
    print("\n--- rows per table (doomed tenants only) ---")
    for t in sub_tables:
        names = sorted(doomed.values())
        hits = []
        for nm in names:
            cur.execute(f"SELECT COUNT(*) FROM {t} WHERE subdomain = %s;", (nm,))
            c = cur.fetchone()[0]
            if c:
                hits.append(f"{nm}={c}")
        if hits:
            total += sum(int(h.split("=")[1]) for h in hits)
            print(f"  {t}: {', '.join(hits)}")

    print("\n--- tenant_id-keyed tables ---")
    any_tid = False
    for t, col in tid:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t} WHERE {col} = ANY(%s);", (id_list,))
            c = cur.fetchone()[0]
        except Exception as exc:
            print(f"  {t}.{col}: ERROR {exc.__class__.__name__}")
            continue
        if c:
            any_tid = True
            total += c
            print(f"  {t}.{col}: {c} rows  <-- would survive a subdomain-only purge")
    if not any_tid:
        print("  (none)")

    print(f"\nTOTAL rows removable: {total}")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())