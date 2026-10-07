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
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_STUDENTS_TABLE} "
            "(subdomain, student_id, full_name, class_name, gender) VALUES %s",
            students,
        )
        counts["students"] = len(students)

        # --- Staff: DEMO-ADM login + 5 teachers, shared PIN 123456 ---
        # The hash is computed inside Postgres (pgcrypto) so the PIN never
        # travels as a hash constant and NOT NULL is satisfied on insert.
        staff = []
        for i, (name, role) in enumerate(_STAFF_NAMES):
            staff.append((subdomain, "DEMO-ADM" if i == 0 else f"DEMO-T{i:02d}", name, role))
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_STAFF_TABLE} "
            "(subdomain, staff_id, full_name, role, password_hash) VALUES %s",
            staff,
            template="(%s, %s, %s, %s, crypt('123456', gen_salt('bf')))",
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
                        subdomain, sid, subject, term,
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
            "(subdomain, student_id, subject_name, term, academic_scores, behavioural_traits) "
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


def sweep_expired_demos(max_age_seconds: int = DEMO_TTL_SECONDS, limit: int = 50) -> Dict[str, Any]:
    """Hard-delete demo tenants older than the TTL. Demo-only by construction:
    the ``demo-`` prefix cannot belong to a paid tenant (provision rejects it),
    and the age gate never touches young rows even under clock skew."""
    conn = db._connect_as_superuser()
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
        child_tables = (
            "result_publications",
            db.TENANT_GRADES_TABLE,
            db.TENANT_FORM_ASSIGNMENTS_TABLE,
            db.TENANT_ALLOCATIONS_TABLE,
            db.TENANT_SUBJECTS_TABLE,
            db.TENANT_STAFF_TABLE,
            db.TENANT_STUDENTS_TABLE,
            db.BILLING_LEDGER_TABLE,
            db.CREDIT_LEDGER_TABLE,
            "tenant_consents",
        )
        for sub in targets:
            try:
                for tbl in child_tables:
                    # billing/credit ledgers key on subdomain too; consents likewise.
                    cur.execute(f"DELETE FROM {tbl} WHERE subdomain = %s;", (sub,))
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
    finally:
        conn.close()
    return {"swept": swept, "count": len(swept)}
