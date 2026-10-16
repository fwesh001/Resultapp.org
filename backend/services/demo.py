"""
Ephemeral demo tenants — path-routed under demo.resultapp.org/<id>.

Why this exists
---------------
Prospects need a realistic, clickable school without us minting a Vercel
domain, a Cloudflare TXT, or a certificate per demo. Tenant isolation in this
codebase is a `subdomain` string in shared Postgres tables, and the Next.js
app renders purely from the rewritten route param — so a registry row whose
subdomain is e.g. ``demo-k7q2xa`` is instantly servable at
``demo.resultapp.org/demo-k7q2xa`` with zero DNS work.

Safety properties (all asserted by static checks, see scripts/):
  * The ``demo-`` slug prefix is reserved: paid provisioning rejects it, so a
    demo row can never collide with (or be mistaken for) a real tenant.
  * ``subscription_status='demo'`` namespaces every row; billing/MRR queries
    must exclude it, notifications skip it, and the sweeper only touches it.
  * No Vercel, Cloudflare, email, or payment calls anywhere in this module.
  * Seeding is deterministic (fixed RNG seed) so every demo looks curated and
    support can reproduce exactly what a prospect sees.

Cleanup: sweep_expired_demos() hard-deletes demo rows older than the TTL
(soft-delete would accumulate every demo row forever). Driven by a systemd
timer, not by request traffic.
"""

import json
import logging
import random
import secrets
import string
import time
from typing import Any, Dict, List, Optional

from psycopg2.extras import execute_values

from services import db_manager as db
from services.rate_limit import check as rate_check

logger = logging.getLogger(__name__)

DEMO_PREFIX = "demo-"
DEMO_ID_CHARS = string.ascii_lowercase + string.digits
DEMO_ID_LEN = 6

#: Abuse brakes. The per-IP limit lives in the Next.js proxy (only it sees
#: the real client IP); these are the server-side backstops.
DEMO_GLOBAL_PER_MINUTE = 5
DEMO_MAX_ACTIVE = 25
DEMO_TTL_SECONDS = 3600

#: Lean seed scale — chosen so provisioning stays sub-second.
DEMO_STUDENT_COUNT = 40
DEMO_STAFF_COUNT = 6
DEMO_CLASSES = ("JSS1A", "JSS1B", "JSS2A", "JSS3A")
DEMO_SUBJECTS = (
    "Mathematics",
    "English Language",
    "Basic Science",
    "Social Studies",
    "Civic Education",
    "Agricultural Science",
    "Computer Studies",
    "Yoruba Language",
    "Home Economics",
    "CRS",
)
#: Core subjects get full grade coverage; the rest exist for browsing.
DEMO_CORE_SUBJECTS = DEMO_SUBJECTS[:6]
DEMO_TEMPLATE_NAME = "Junior Secondary Standard"
DEMO_SESSION = "2026/2027"
DEMO_STAFF_PIN = "123456"

#: Fixed seed — every demo is identical (curated, reproducible, comparable).
DEMO_RNG_SEED = 20260707

_FIRST_NAMES = (
    "Adaeze", "Chiamaka", "Ngozi", "Funke", "Aisha", "Fatima", "Zainab",
    "Tunde", "Emeka", "Olumide", "Ibrahim", "Yusuf", "Kelechi", "Nnamdi",
    "Amina", "Bisi", "Chidi", "Dayo", "Efe", "Gbenga", "Halima", "Ifeanyi",
    "Jide", "Kemi",
)
_LAST_NAMES = (
    "Okafor", "Adeleke", "Bello", "Eze", "Ogunleye", "Ibrahim", "Nwosu",
    "Adeyemi", "Osei", "Bakare", "Chukwu", "Danladi", "Ekpong", "Falana",
    "Garba", "Hassan", "Idowu", "Jegede", "Kalu", "Lawal", "Musa", "Nwachukwu",
    "Obi", "Sule",
)
_STAFF_NAMES = (
    ("Demo Guide", "admin"),
    ("Mrs. A. Balogun", "teacher"),
    ("Mr. E. Okonkwo", "teacher"),
    ("Miss F. Abdullahi", "teacher"),
    ("Mr. S. Alabi", "teacher"),
    ("Mrs. N. Eze", "teacher"),
)
_BEHAVIOURS = ("Punctuality", "Neatness", "Honesty", "Obedience", "Politeness")
_BEHAVIOUR_SCALE = ("A", "B", "C", "D", "E")


def _new_demo_id() -> str:
    rand = "".join(secrets.choice(DEMO_ID_CHARS) for _ in range(DEMO_ID_LEN))
    return f"{DEMO_PREFIX}{rand}"


def _active_demo_count(cur) -> int:
    cur.execute(
        f"""
        SELECT COUNT(*) FROM {db.SCHOOLS_REGISTRY_TABLE}
        WHERE subdomain LIKE 'demo-%%' AND deleted_at IS NULL;
        """
    )
    row = cur.fetchone()
    return int(row[0] or 0) if row else 0


def _score(rng: random.Random, low: int, high: int) -> int:
    return max(low, min(high, int(rng.gauss((low + high) / 2, (high - low) / 5))))


def provision_demo_tenant() -> Dict[str, Any]:
    """Create + seed one ephemeral demo tenant. Returns the public handoff."""
    started = time.monotonic()

    allowed, retry_after = rate_check("demo:global", DEMO_GLOBAL_PER_MINUTE, 60)
    if not allowed:
        raise ValueError(f"Demo provisioning is busy — retry in {retry_after}s")

    conn = db._connect_as_superuser()
    try:
        cur = conn.cursor()
        if _active_demo_count(cur) >= DEMO_MAX_ACTIVE:
            raise ValueError("Demo capacity is full right now — please try again soon")
    finally:
        conn.close()

    subdomain = ""
    for _ in range(5):
        candidate = _new_demo_id()
        if not db.tenant_exists(candidate):
            subdomain = candidate
            break
    if not subdomain:
        raise ValueError("Could not allocate a demo id — please retry")

    db.register_school(
        subdomain=subdomain,
        school_name="Demo Academy",
        email=f"{subdomain}@demo.resultapp.org",
        city="Lagos",
        state="Lagos",
        motto="Exploring ResultApp, live",
        admin_name="Demo Guide",
        student_count=DEMO_STUDENT_COUNT,
        subscription_status="demo",
        terms_version="demo-1.0",
        privacy_version="demo-1.0",
        accepted_by="demo-provision",
        consent_ip="127.0.0.1",
    )
    db.topup_slots(
        subdomain,
        DEMO_STUDENT_COUNT,
        f"init-slot:{subdomain}",
        "Demo seed capacity",
        0,
    )
    seed_demo_data(subdomain)

    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"[DEMO] Provisioned '{subdomain}' in {elapsed_ms}ms")
    return {
        "subdomain": subdomain,
        "url": f"https://demo.resultapp.org/{subdomain}",
        "staff_id": "DEMO-ADM",
        "staff_pin": DEMO_STAFF_PIN,
        "student_count": DEMO_STUDENT_COUNT,
        "expires_in_seconds": DEMO_TTL_SECONDS,
        "provisioning_ms": elapsed_ms,
    }


def seed_demo_data(subdomain: str) -> Dict[str, int]:
    """Deterministic lean seed: roster, subjects, allocations, template,
    grades, publications. Direct SQL (no network, no emails)."""
    rng = random.Random(DEMO_RNG_SEED)
    conn = db._connect_as_superuser()
    counts = {"students": 0, "staff": 0, "subjects": 0, "allocations": 0, "grades": 0, "publications": 0}
    try:
        cur = conn.cursor()

        # --- Students: 10 per class, STD001..STD040 ---
        students = []
        for ci, class_name in enumerate(DEMO_CLASSES):
            for i in range(DEMO_STUDENT_COUNT // len(DEMO_CLASSES)):
                n = ci * (DEMO_STUDENT_COUNT // len(DEMO_CLASSES)) + i + 1
                students.append((
                    subdomain,
                    f"STD{n:03d}",
                    f"{rng.choice(_FIRST_NAMES)} {rng.choice(_LAST_NAMES)}",
                    class_name,
                    rng.choice(("Male", "Female")),
                ))
        # The default password is hashed inside Postgres (pgcrypto) and arrives
        # as a bound parameter, so the plaintext never reaches a query log —
        # same treatment as the roster router's insert paths.
        #
        # Appended to each tuple rather than via execute_values(template_args=),
        # which needs psycopg2 >= 2.8; this keeps demo seeding working on an
        # older pinned driver.
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_STUDENTS_TABLE} "
            "(subdomain, student_id, full_name, class_name, gender, password_hash, must_change_password) VALUES %s",
            [(*s, db.DEFAULT_ROSTER_PASSWORD) for s in students],
            template="(%s, %s, %s, %s, %s, crypt(%s, gen_salt('bf')), TRUE)",
        )
        counts["students"] = len(students)

        # --- Staff: DEMO-ADM login + 5 teachers, shared PIN 123456 ---
        staff = []
        for i, (name, role) in enumerate(_STAFF_NAMES):
            staff.append((subdomain, "DEMO-ADM" if i == 0 else f"DEMO-T{i:02d}", name, role))
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_STAFF_TABLE} "
            "(subdomain, staff_id, full_name, role, password_hash) VALUES %s",
            [(*m, db.DEFAULT_ROSTER_PASSWORD) for m in staff],
            template="(%s, %s, %s, %s, crypt(%s, gen_salt('bf')))",
        )
        counts["staff"] = len(staff)

        # --- Subjects ---
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_SUBJECTS_TABLE} (subdomain, subject_name) VALUES %s",
            [(subdomain, s) for s in DEMO_SUBJECTS],
        )
        counts["subjects"] = len(DEMO_SUBJECTS)

        # --- Allocations: core subjects round-robined over teachers/classes ---
        teachers = [s[2] for s in staff[1:]]
        allocations = []
        for ci, class_name in enumerate(DEMO_CLASSES):
            for si, subject in enumerate(DEMO_CORE_SUBJECTS):
                allocations.append((subdomain, subject, teachers[(si + ci) % len(teachers)], class_name))
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_ALLOCATIONS_TABLE} "
            "(subdomain, subject_name, staff_name, class_name) VALUES %s",
            allocations,
        )
        counts["allocations"] = len(allocations)

        # --- One grading template (40/60 CA/Exam + behaviour scale) ---
        cur.execute(
            """
            INSERT INTO grading_templates
                (tenant_id, name, academic_structure, behavioral_structure,
                 applies_to_classes, is_active)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb, TRUE)
            RETURNING id;
            """,
            (
                subdomain,
                DEMO_TEMPLATE_NAME,
                json.dumps({
                    "components": [
                        {"name": "CA", "weight": 40, "items": [
                            {"name": "Assignment 1", "max_score": 10},
                            {"name": "Test 1", "max_score": 30},
                        ]},
                        {"name": "Exam", "weight": 60, "max_score": 60},
                    ]
                }),
                json.dumps({"traits": list(_BEHAVIOURS), "scale": list(_BEHAVIOUR_SCALE)}),
                json.dumps([]),
            ),
        )

        # --- Grades: Term 1 full coverage, Term 2 first half of each class ---
        grades = []
        for si, (sub, sid, _name, _cls, _g) in enumerate(students):
            terms = ("Term 1",) if si % 2 else ("Term 1", "Term 2")
            for term in terms:
                for subject in DEMO_CORE_SUBJECTS:
                    if rng.random() < 0.12:
                        continue  # a few genuinely missing entries
                    grades.append((
                        subdomain, sid, subject, term, DEMO_SESSION,
                        json.dumps({
                            "Assignment 1": _score(rng, 4, 10),
                            "Test 1": _score(rng, 12, 30),
                            "Exam": _score(rng, 24, 60),
                        }),
                        json.dumps({t: rng.choice(_BEHAVIOUR_SCALE[:3]) for t in _BEHAVIOURS}),
                    ))
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_GRADES_TABLE} "
            "(subdomain, student_id, subject_name, term, academic_session, academic_scores, behavioural_traits) "
            "VALUES %s",
            grades,
        )
        counts["grades"] = len(grades)

        # --- Publications: Term 1 for the first 12 pupils (result-checker demo) ---
        pubs = [(subdomain, f"STD{n:03d}", "Term 1", DEMO_SESSION, "Demo Guide") for n in range(1, 13)]
        execute_values(
            cur,
            f"INSERT INTO {db.RESULT_PUBLICATIONS_TABLE} "
            "(subdomain, student_id, term, academic_session, published_by) VALUES %s",
            pubs,
        )
        counts["publications"] = len(pubs)

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    logger.info(f"[DEMO] Seeded '{subdomain}': {counts}")
    return counts


def _tenant_child_tables(conn) -> List[tuple]:
    """Every tenant-scoped table, ordered so deletes never trip a foreign key.

    Returns [(table, column, value_kind)] where value_kind is 'subdomain' or
    'id' -- matching what that column actually stores, which is NOT always the
    obvious thing. `notifications.tenant_id` holds the SUBDOMAIN despite the
    name, and purge_tenants.py shipped a bug for years because it assumed
    otherwise.

    WHY DISCOVERY, NOT A LIST
    -------------------------
    A hardcoded child list is a promise that someone remembers to update it.
    The previous list omitted audit_logs, grading_templates, notification_reads
    and pending_registrations -- none of which have a foreign key to schools --
    so every sweep orphaned rows that silently broke pg_dump restorability. The
    table set is derived from the database, so a table added next month is swept
    without anyone editing this file.

    Three sources, because each catches something the others miss:

      1. every table with a `subdomain` column      -- the common case
      2. every table with a `tenant_id` column      -- named confusingly
      3. every table holding ANY foreign key to     -- catches waiver_tokens.
         schools, whatever the column is called        locked_to_tenant and
                                                      used_by_tenant, which
                                                      match neither name above

    ORDER
    -----
    A topological sort over the foreign-key graph, so a referencing table is
    emptied before the table it references. The only live inter-child edge is
    notification_reads -> notifications, but deriving the order means a new
    child-to-child FK cannot start aborting sweeps. The schools row itself is
    excluded here and deleted last by the caller, which keeps its CASCADE
    triggers as a backstop rather than the primary mechanism.
    """
    cur = conn.cursor()
    registry = db.SCHOOLS_REGISTRY_TABLE

    # For every table with an FK to schools, BOTH ends of that FK matter:
    #   child_cols  -- the column in THIS table  (waiver_tokens.locked_to_tenant)
    #   parent_cols -- the schools column it points at (schools.subdomain)
    # Reading only the referenced side and calling it the child's column is a
    # silent bug: it pairs waiver_tokens with a `subdomain` column it does not
    # have, and the sweep then dies on "column does not exist".
    cur.execute(
        """
        SELECT src.relname,
               array_agg(child.attname  ORDER BY k.ord),
               array_agg(parent.attname ORDER BY k.ord)
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_class tgt ON tgt.oid = con.confrelid
        JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, fattnum, ord)
             ON TRUE
        JOIN pg_attribute child  ON child.attrelid  = src.oid AND child.attnum  = k.attnum
        JOIN pg_attribute parent ON parent.attrelid = tgt.oid AND parent.attnum = k.fattnum
        WHERE con.contype = 'f' AND tgt.relname = %s
        GROUP BY src.relname
        """,
        (registry,),
    )
    fk_rows = cur.fetchall() or []
    fk_child_cols = {t: list(cs) for t, cs, _ in fk_rows}
    fk_parent_cols = {t: list(ps) for t, _, ps in fk_rows}

    # Candidate (table, column) pairs.
    cur.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('subdomain', 'tenant_id')
        ORDER BY table_name
        """
    )
    candidates = set(cur.fetchall() or [])
    for table, cols in fk_child_cols.items():
        for col in cols:
            candidates.add((table, col))
    candidates = {(t, col) for (t, col) in candidates if t != registry}

    if not candidates:
        return []

    # Which schools column does each candidate column hold? Ask the FK; fall
    # back to probing the data for tables with no FK at all.
    cur.execute("SELECT subdomain, id::text FROM schools;")
    rows = cur.fetchall() or []
    subs = {r[0] for r in rows}
    uuids = {r[1] for r in rows}

    by_table: Dict[str, List[tuple]] = {}
    for table, col in sorted(candidates):
        parents = fk_parent_cols.get(table) or []
        if len(parents) == 1:
            kind = "id" if parents[0] == "id" else "subdomain"
        else:
            cur.execute(
                f'SELECT DISTINCT "{col}"::text FROM public."{table}" '
                f'WHERE "{col}" IS NOT NULL LIMIT 200;'
            )
            vals = {r[0] for r in (cur.fetchall() or [])}
            kind = "id" if (vals & uuids and not (vals & subs)) else "subdomain"
        by_table.setdefault(table, []).append((table, col, kind))

    # One predicate per table: prefer `subdomain`, it is unambiguous.
    chosen: List[tuple] = []
    for table, entries in by_table.items():
        entries.sort(key=lambda e: (e[1] != "subdomain", e[1]))
        chosen.append(entries[0])

    # Foreign keys BETWEEN child tables, for the delete order. Stored as
    # dependents[parent] = {tables that reference it} rather than the natural
    # direction, because what we need to enforce is "a referencing table is
    # emptied before the table it references".
    #
    # Emitting the PARENT first happens to work today only because
    # notification_reads -> notifications is ON DELETE CASCADE. With a RESTRICT
    # or NO ACTION FK the parent delete would abort the whole sweep. Child-first
    # is safe regardless of what action the FK carries, so that is the order.
    tables = {t for (t, _, _) in chosen}
    dependents: Dict[str, set] = {t: set() for t in tables}
    if tables:
        cur.execute(
            """
            SELECT DISTINCT src.relname, tgt.relname
            FROM pg_constraint con
            JOIN pg_class src ON src.oid = con.conrelid
            JOIN pg_class tgt ON tgt.oid = con.confrelid
            WHERE con.contype = 'f' AND src.relname <> tgt.relname
            """
        )
        for src_t, tgt_t in cur.fetchall() or []:
            if src_t in tables and tgt_t in tables:
                dependents[tgt_t].add(src_t)

    ordered: List[tuple] = []
    remaining = {t: set(v) for t, v in dependents.items()}
    by_name = {e[0]: e for e in chosen}
    while remaining:
        ready = sorted(t for t, deps in remaining.items() if not deps)
        if not ready:                      # a cycle; emit the rest deterministically
            ready = [sorted(remaining)[0]]
        for t in ready:
            ordered.append(by_name[t])
            del remaining[t]
            for deps in remaining.values():
                deps.discard(t)
    return ordered


def _sweep_orphans(conn, swept: List[str]) -> Dict[str, int]:
    """Swept tenants' rows that are still present. Must be empty after a sweep."""
    if not swept:
        return {}
    cur = conn.cursor()
    registry = db.SCHOOLS_REGISTRY_TABLE
    found: Dict[str, int] = {}
    for table, col, kind in _tenant_child_tables(conn):
        if kind == "id":
            cur.execute(f"SELECT id FROM {registry} WHERE subdomain = ANY(%s);", (swept,))
            ids = [r[0] for r in (cur.fetchall() or [])]
            if not ids:
                continue
            cur.execute(
                f'SELECT count(*) FROM public."{table}" WHERE "{col}" = ANY(%s);', (ids,)
            )
        else:
            cur.execute(
                f'SELECT count(*) FROM public."{table}" WHERE "{col}" = ANY(%s);', (swept,)
            )
        row = cur.fetchone()
        n = int(row[0]) if row else 0
        if n:
            found[f"{table}.{col}"] = n
    return found


def sweep_expired_demos(max_age_seconds: int = DEMO_TTL_SECONDS, limit: int = 50) -> Dict[str, Any]:
    """Hard-delete demo tenants older than the TTL. Demo-only by construction:
    the ``demo-`` prefix cannot belong to a paid tenant (provision rejects it),
    and the age gate never touches young rows even under clock skew.

    The child tables are DISCOVERED from the database, not hardcoded -- a missed
    table orphans rows that break pg_dump restorability, and the previous
    hardcoded list had already missed four. Transactional, so a mid-sweep
    failure rolls back whole instead of leaving a half-deleted tenant, and the
    sweep asserts afterwards that nothing was left behind.
    """
    conn = db._connect_as_superuser_transactional()
    swept: List[str] = []
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT subdomain FROM {db.SCHOOLS_REGISTRY_TABLE}
            WHERE subdomain LIKE 'demo-%%'
              AND deleted_at IS NULL
              AND created_at < NOW() - (%s || ' seconds')::interval
            ORDER BY created_at ASC
            LIMIT %s;
            """,
            (str(int(max_age_seconds)), int(limit)),
        )
        targets = [r[0] for r in (cur.fetchall() or [])]
        if not targets:
            # Same shape as the swept path. Returning a different dict here made
            # the response depend on whether anything happened to be expired --
            # so "nothing to do" looked different from "swept cleanly", and a
            # caller checking for `clean` could not tell which had happened.
            return {"swept": [], "count": 0, "clean": True}
        child_tables = _tenant_child_tables(conn)
        logger.info(
            "[DEMO] Sweeping %d demo(s) across %d discovered tenant table(s)",
            len(targets), len(child_tables),
        )
        for sub in targets:
            try:
                # Children first (FK-graph order), registry last so its CASCADE
                # triggers remain a backstop rather than the mechanism.
                for table, col, kind in child_tables:
                    if kind == "id":
                        cur.execute(f"SELECT id FROM {db.SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s;", (sub,))
                        row = cur.fetchone()
                        if not row:
                            continue
                        value = row[0]
                    else:
                        value = sub
                    cur.execute(f'DELETE FROM public."{table}" WHERE "{col}" = %s;', (value,))
                cur.execute(
                    f"DELETE FROM {db.SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s;",
                    (sub,),
                )
                conn.commit()
                swept.append(sub)
                logger.info(f"[DEMO] Swept expired demo '{sub}'")
            except Exception as exc:
                conn.rollback()
                logger.error(f"[DEMO] Sweep failed for '{sub}': {exc.__class__.__name__}: {exc}")
        leftovers = _sweep_orphans(conn, swept)
        if leftovers:
            logger.error("[DEMO] Sweep left rows behind for swept tenant(s): %s", leftovers)
            return {"swept": swept, "count": len(swept), "orphans": leftovers, "clean": False}
        return {"swept": swept, "count": len(swept), "clean": True}
    finally:
        conn.close()
