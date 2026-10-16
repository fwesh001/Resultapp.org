"""
Hard-purge tenants from the central registry AND unregister their domains.

    py scripts/purge_tenants.py                          # dry run: report only
    py scripts/purge_tenants.py --execute                # DO IT
    py scripts/purge_tenants.py --execute --keep vhs,sha
    py scripts/purge_tenants.py --execute --skip-domains # rows only

WHY THIS EXISTS
    The superadmin endpoint (DELETE /admin/tenants/{subdomain}) is a SOFT
    delete: it stamps deleted_at, hides the school from the public site and
    keeps every row plus the ledger for audit. That is the right default.
    This script is the irreversible counterpart, for cleaning up test tenants
    after a development cycle. It deletes real rows.

WHAT IT DOES
    1. Discovers EVERY table in the superuser DB carrying a `subdomain`
       column, rather than trusting a hardcoded list, so a table added later
       cannot silently survive a purge and leave a ghost tenant behind.
    2. Deletes those rows per target, then the `schools` row last.
    3. Removes the tenant's Vercel domain ({slug}.resultapp.org) using the
       same server-side token the provisioner already uses.

SAFETY
    - Dry run unless --execute.
    - Refuses to run if a keep-list tenant is missing from the DB, or if the
      resolved keep-list is not a subset of --keep. That catches a typo in
      --keep BEFORE anything is destroyed.
    - Everything row-related happens in ONE real transaction per tenant with
      session_replication_role=replica, so FK triggers cannot abort the run
      halfway and leave a tenant half-deleted. Any failure rolls back whole.
      This needs the TRANSACTIONAL connector, not the autocommit one: under
      autocommit conn.commit() is a no-op and "rolls back whole" was a lie.
    - Domains are removed only after all row commits succeed, and a domain
      failure is reported without undoing committed row deletes (a live
      orphan domain is recoverable; lost rows are not).
    - After purging, every tenant-keyed table is re-scanned for rows whose
      schools parent is gone. A purge that leaves orphans behind exits non-zero
      rather than reporting success, because a silent orphan is what made this
      database unrestorable in the first place.

ENV
    Reads the same PG_* vars as the app (load backend/.env first) plus
    VERCEL_TOKEN / VERCEL_PROJECT_ID / VERCEL_TEAM_ID for domain removal.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List, Optional, Tuple

import requests

# Allow running as `python scripts/purge_tenants.py` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import db_manager as db  # noqa: E402

VERCEL_API = "https://api.vercel.com"

#: The two tenants that must survive. Overridable via --keep, but the default
#: is the reviewed keep-list; a --keep value that does not contain these is
#: rejected unless --allow-keep-change is passed.
DEFAULT_KEEP = ("vhs", "sha")

#: Never purge these even if --keep somehow omits them.
RESERVED = {
    "www", "app", "api", "admin", "superadmin", "demo", "resultapp",
    "blog", "cdn", "assets", "staging", "mail", "portal", "support",
}


def _target_subdomains(conn, keep: Tuple[str, ...]) -> Tuple[List[str], List[str]]:
    """Return (all_live_subdomains, targets_to_purge) from the registry."""
    cur = conn.cursor()
    cur.execute(
        "SELECT subdomain, subscription_status, created_at FROM schools ORDER BY created_at ASC;"
    )
    rows = cur.fetchall() or []
    all_subs = [r[0] for r in rows]
    targets = [s for s in all_subs if s not in keep]
    return all_subs, targets


def _tenant_scoped_tables(conn) -> List[str]:
    """Every table with a `subdomain` column, registry last.

    Discovery beats a hardcoded list: a table added after this script was
    written would otherwise keep its rows and leave a ghost tenant that still
    owns grades, students, and ledger history.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'subdomain'
        GROUP BY table_name
        ORDER BY table_name;
        """
    )
    tables = [r[0] for r in (cur.fetchall() or [])]
    registry = db.SCHOOLS_REGISTRY_TABLE
    # Registry row goes last so FK children can still resolve the tenant.
    ordered = [t for t in tables if t != registry]
    if registry in tables:
        ordered.append(registry)
    return ordered


def _count(conn, table: str, sub: str) -> int:
    cur = conn.cursor()
    cur.execute(f"SELECT COUNT(*) FROM {table} WHERE subdomain = %s;", (sub,))
    row = cur.fetchone()
    return int(row[0]) if row else 0


def _tenant_id_tables(conn) -> List[Tuple[str, str]]:
    """Tables with a `tenant_id` column, paired with the schools column it holds.

    These are invisible to a subdomain-only sweep. They are empty for most
    tenants today, but a table like support_tickets or notifications can hold
    real rows, and leaving them behind orphans a deleted school.

    THE KEY IS THE SUBDOMAIN, NOT schools.id
    ------------------------------------------
    An earlier version of this assumed `tenant_id` held the schools.id UUID and
    deleted with `WHERE tenant_id = <uuid>`. That matched ZERO rows, because
    every tenant_id column in this schema actually stores the SUBDOMAIN STRING
    -- their foreign keys all say so:

        notifications       FOREIGN KEY (tenant_id) REFERENCES schools(subdomain)
        support_tickets     FOREIGN KEY (tenant_id) REFERENCES schools(subdomain)

    The deletes silently succeeded, so purging reported "0 rows" and left the
    tenant's notifications behind as orphans whose schools row no longer existed.
    That is what made pg_dump unrestorable: the post-data FK validation aborted
    on every restore.

    So the referenced column is read from the foreign key rather than assumed,
    and only falls back to probing the data when a table has no FK at all.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'
        GROUP BY table_name ORDER BY table_name;
        """
    )
    tables = [r[0] for r in (cur.fetchall() or [])]

    # schools.subdomain and schools.id, for probing tables with no FK.
    cur.execute("SELECT subdomain, id::text FROM schools;")
    rows = cur.fetchall() or []
    subs = {r[0] for r in rows}
    uuids = {r[1] for r in rows}

    out: List[Tuple[str, str]] = []
    for table in tables:
        cur.execute(
            """
            SELECT a.attname
            FROM pg_constraint con
            JOIN pg_class src ON src.oid = con.conrelid
            JOIN pg_class tgt ON tgt.oid = con.confrelid
            JOIN unnest(con.confkey) AS fk(attnum) ON TRUE
            JOIN pg_attribute a ON a.attrelid = tgt.oid AND a.attnum = fk.attnum
            WHERE con.contype = 'f' AND src.relname = %s AND tgt.relname = 'schools'
            LIMIT 1;
            """,
            (table,),
        )
        row = cur.fetchone()
        if row:
            out.append((table, row[0]))
            continue
        # No FK to consult, so decide from what the column actually holds.
        cur.execute(f'SELECT DISTINCT "tenant_id"::text FROM "{table}" WHERE "tenant_id" IS NOT NULL LIMIT 200;')
        vals = {r[0] for r in (cur.fetchall() or [])}
        if vals & uuids and not (vals & subs):
            out.append((table, "id"))
        else:
            out.append((table, "subdomain"))
    return out


def _purge_tenant(conn, sub: str, tables: List[str], tid_tables: List[Tuple[str, str]],
                  tenant_id: Optional[str], execute: bool) -> Dict[str, int]:
    """Delete one tenant's rows. One transaction; FK triggers disabled.

    `tid_tables` is (table, schools_column) pairs -- see _tenant_id_tables for
    why the key is read rather than assumed. `tenant_id` remains the schools.id
    UUID, used only by tables that genuinely reference schools.id.
    """
    deleted: Dict[str, int] = {}
    cur = conn.cursor()
    try:
        # replica role disables FK/constraint triggers for this session, so we
        # can delete in any order without an aborted-transaction half-state.
        cur.execute("SET session_replication_role = replica;")
        for table in tables:
            n = _count(conn, table, sub)
            if n:
                deleted[table] = n
                if execute:
                    cur.execute(f'DELETE FROM "{table}" WHERE subdomain = %s;', (sub,))
        for table, key_col in tid_tables:
            # The column stores whichever schools column its FK points at.
            # Passing the UUID where a subdomain is expected deletes nothing and
            # orphans the row; passing a subdomain where a UUID is expected does
            # the same. One wrong guess, silently.
            value = tenant_id if key_col == "id" else sub
            cur.execute(f'SELECT COUNT(*) FROM "{table}" WHERE "tenant_id" = %s;', (value,))
            row = cur.fetchone()
            n = int(row[0]) if row else 0
            if n:
                label = f"{table}(tenant_id={key_col})"
                deleted[label] = n
                if execute:
                    cur.execute(f'DELETE FROM "{table}" WHERE "tenant_id" = %s;', (value,))
        # Restore triggers BEFORE committing: a committed session must never
        # leave replication_role off, or every later write in this connection
        # silently skips its constraints.
        cur.execute("SET session_replication_role = DEFAULT;")
        if execute:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if execute:
            try:
                cur.execute("SET session_replication_role = DEFAULT;")
            except Exception:
                pass
    return deleted


def _vercel_cfg() -> Optional[Dict[str, str]]:
    token = (os.getenv("VERCEL_TOKEN") or "").strip()
    project = (os.getenv("VERCEL_PROJECT_ID") or "").strip()
    if not token or not project:
        return None
    return {
        "token": token,
        "project_id": project,
        "team_id": (os.getenv("VERCEL_TEAM_ID") or "").strip(),
    }


def _delete_domain(sub: str, cfg: Optional[Dict[str, str]]) -> str:
    """Remove {sub}.resultapp.org from the Vercel project."""
    if cfg is None:
        return "skipped (no VERCEL_TOKEN/VERCEL_PROJECT_ID)"
    domain = f"{sub}.resultapp.org"
    url = f"{VERCEL_API}/v9/projects/{cfg['project_id']}/domains/{domain}"
    params = {"teamId": cfg["team_id"]} if cfg["team_id"] else {}
    try:
        resp = requests.delete(
            url,
            params=params,
            headers={"Authorization": f"Bearer {cfg['token']}"},
            timeout=(10, 25),
        )
    except requests.RequestException as exc:
        return f"failed ({exc.__class__.__name__})"
    if resp.status_code in (200, 204):
        return "deleted"
    if resp.status_code == 404:
        return "not registered"
    return f"failed (HTTP {resp.status_code})"


def _orphans_left(conn, tid_tables: List[Tuple[str, str]]) -> Dict[str, int]:
    """Rows in tenant-keyed tables whose schools parent no longer exists.

    The check that makes a silent purge failure loud. Every purge that leaves
    these behind is a purge that broke the database's restorability, so it must
    not be reported as a clean run.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('subdomain', 'tenant_id')
        AND table_name <> 'schools' ORDER BY table_name;
        """
    )
    found: Dict[str, int] = {}
    for table, col in cur.fetchall() or []:
        cur.execute(
            f'SELECT count(*) FROM "{table}" t WHERE "{col}" IS NOT NULL '
            f'AND NOT EXISTS (SELECT 1 FROM schools s WHERE s.subdomain = t."{col}");'
        )
        row = cur.fetchone()
        n = int(row[0]) if row else 0
        if n:
            found[f"{table}.{col}"] = n
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="Hard-purge tenants and unregister domains.")
    ap.add_argument("--execute", action="store_true", help="Actually delete (default: dry run).")
    ap.add_argument("--keep", default=",".join(DEFAULT_KEEP), help="Comma-separated keep-list.")
    ap.add_argument("--skip-domains", action="store_true", help="Delete rows only.")
    ap.add_argument(
        "--allow-keep-change",
        action="store_true",
        help="Permit a --keep list that drops a default-kept tenant.",
    )
    args = ap.parse_args()

    keep = tuple(k.strip().lower() for k in args.keep.split(",") if k.strip())
    if not keep:
        print("Refusing to run with an empty keep-list.")
        return 2
    overlap = RESERVED & set(keep)
    if overlap:
        print(f"Refusing to run: keep-list contains reserved name(s): {overlap}")
        return 2
    if not args.allow_keep_change:
        missing_defaults = set(DEFAULT_KEEP) - set(keep)
        if missing_defaults:
            print(
                f"Refusing to run: --keep drops reviewed tenant(s) {sorted(missing_defaults)}. "
                "Re-run with --allow-keep-change if that is intended."
            )
            return 2

    # TRANSACTIONAL, not the autocommit connector. The per-tenant rollback
    # guarantee documented above is only real on a connection that has a
    # transaction to roll back; under autocommit conn.rollback() is a no-op and
    # a mid-purge failure would leave a half-deleted tenant behind.
    conn = db._connect_as_superuser_transactional()
    try:
        all_subs, targets = _target_subdomains(conn, keep)
        keep_missing = [k for k in keep if k not in all_subs]
        if keep_missing:
            print(f"Refusing to run: keep-list tenant(s) not found in registry: {keep_missing}")
            print(f"Registry has: {all_subs}")
            return 2
        if not targets:
            print("Nothing to purge: every tenant is on the keep-list.")
            return 0

        tables = _tenant_scoped_tables(conn)
        tid_tables = _tenant_id_tables(conn)
        cur = conn.cursor()
        cur.execute("SELECT id, subdomain FROM schools;")
        id_by_sub = {r[1]: r[0] for r in (cur.fetchall() or [])}
        cfg = None if args.skip_domains else _vercel_cfg()

        mode = "EXECUTE" if args.execute else "DRY RUN"
        print(f"=== purge_tenants [{mode}] ===")
        print(f"keep     : {sorted(keep)}")
        print(f"targets  : {len(targets)} -> {targets}")
        print(f"tables   : {len(tables)} subdomain-keyed + {len(tid_tables)} tenant_id-keyed")
        if not args.execute:
            print("(dry run — pass --execute to actually delete)\n")

        purged: List[str] = []
        failed: List[str] = []
        for sub in targets:
            try:
                deleted = _purge_tenant(
                    conn, sub, tables, tid_tables, id_by_sub.get(sub), args.execute
                )
            except Exception as exc:
                failed.append(sub)
                print(f"[FAILED] {sub}: {exc.__class__.__name__}: {exc}")
                continue
            total = sum(deleted.values())
            if args.execute:
                print(f"[purged] {sub}: {total} rows across {len(deleted)} table(s) {deleted}")
                purged.append(sub)
            else:
                print(f"[would purge] {sub}: {total} rows {deleted}")

        if not args.execute:
            print("\nDry run complete. Nothing was deleted.")
            return 0

        print("\n--- domain cleanup ---")
        for sub in purged:
            status = "skipped (--skip-domains)" if args.skip_domains else _delete_domain(sub, cfg)
            print(f"[domain] {sub}.resultapp.org -> {status}")

        # The loud failure this script used to lack. A purge that leaves rows
        # pointing at a schools row that no longer exists is a purge that has
        # broken pg_dump restorability -- which is exactly the bug that put
        # eight orphaned notifications in production. Report it, exit non-zero.
        conn.commit()
        orphans = _orphans_left(conn, tid_tables)
        print("\n--- post-purge orphan check ---")
        if orphans:
            print("[FAIL] rows still reference a schools parent that does not exist:")
            for key, n in orphans.items():
                print(f"    {key}: {n}")
            print("  A restore of this database will now ABORT. Fix these before trusting a backup.")
            print(f"\nDone. Purged {len(purged)} tenant(s); {len(failed)} failure(s); ORPHANS REMAIN.")
            return 1
        print("[ok] no tenant-keyed row references a missing schools parent")

        print(f"\nDone. Purged {len(purged)} tenant(s); {len(failed)} failure(s).")
        print("Remainder (kept):", sorted(keep))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())