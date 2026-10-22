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

#: The report-card archive persona: one published term in the PREVIOUS
#: academic session, so the student dashboard shows a two-row history and the
#: report page can be exercised with ?academic_session=.
DEMO_PRIOR_SESSION = "2025/2026"
DEMO_PRIOR_TERM = "Term 3"

#: Command-Center fuel. Without a credit balance the demo admin's publish
#: attempt dies on an insufficient-credits wall; a small grant lets the
#: prospect push a real draft result through the publication flow several
#: times over without ever touching the test-mode checkout.
DEMO_CREDIT_GRANT = 10

#: Fixed seed — every demo is identical (curated, reproducible, comparable).
DEMO_RNG_SEED = 20260707

#: Persona students — deterministic names wired to the report-card states the
#: onboarding card advertises (mirrored 1:1 in lib/demoPersonas.ts):
#:
#:   STD001  published, curated full record        -> released card
#:   STD002  published + "student_term_clearance"   -> "Result Withheld" (fee hold)
#:   STD003  published with ZERO grade rows         -> the absent/empty card
#:   STD013  graded but never published             -> public 404 / admin draft
#:   STD020  never published at all                 -> dashboard "no results yet"
#:
#: The names are pinned (not rng) so the UI can print them next to the IDs
#: without any backend round-trip. The first three sit together in JSS1A so
#: the three edge-case cards share one class cohort.
_DEMO_PERSONA_STUDENT: Dict[str, tuple] = {
    "STD001": ("Amara Okafor", "Female"),
    "STD002": ("Chidi Nwosu", "Male"),
    "STD003": ("Kemi Adeleke", "Female"),
    "STD013": ("Tunde Bakare", "Male"),
    "STD020": ("Fatima Hassan", "Female"),
}
#: The Absentee persona — excluded from the Term 1 grade loop so their card
#: renders the published-but-empty state.
_DEMO_ABSENT_STUDENT = "STD003"
#: One total per core subject for the Scholar persona (fixed, not sampled) so
#: the showcase card looks hand-crafted rather than stochastic.
_DEMO_SCHOLAR_TOTALS = (94, 92, 95, 90, 93, 91)
_DEMO_SCHOLAR_REMARK = "A brilliant and focused student. Keep up the good work."
_DEMO_PRINCIPAL_REMARK = "An outstanding performance this term. Keep up the excellent work!"
#: Last session's closing card: the JSS1A cohort's base score, decremented per
#: seat so STD001 finished top of the class in the archived term too.
_DEMO_PRIOR_BASE = 93
_DEMO_PRIOR_STEP = 2

#: Form classes — exactly one form teacher per class (UNIQUE(subdomain,
#: class_name)). Chosen to complete the persona story: DEMO-T02 is Form
#: Master of JSS1A (the Scholar/Bursar/Absentee cohort), DEMO-T03 — the
#: moderator deputy — leads JSS2A, and the two filler teachers take the rest
#: so every class resolves a signature row on its report cards.
_DEMO_FORM_CLASSES = (
    ("JSS1A", "DEMO-T02"),
    ("JSS1B", "DEMO-T04"),
    ("JSS2A", "DEMO-T03"),
    ("JSS3A", "DEMO-T05"),
)

#: Gradebook map: one allocation per (class x core subject) cell, each naming
#: the staff_id responsible. Replaces the old round-robin so each persona's
#: "what to try" is guaranteed: DEMO-T01 owns subjects across three classes
#: but no form class; DEMO-T02's English Language lives in their JSS1A form
#: class (subject + traits editing in one portal); DEMO-T03 teaches their own
#: JSS2A cohort. Index order matches DEMO_CORE_SUBJECTS exactly.
_DEMO_ALLOCATIONS: Dict[str, tuple] = {
    "JSS1A": ("DEMO-T01", "DEMO-T02", "DEMO-T01", "DEMO-T03", "DEMO-T03", "DEMO-T02"),
    "JSS1B": ("DEMO-T02", "DEMO-T02", "DEMO-T04", "DEMO-T04", "DEMO-T01", "DEMO-T04"),
    "JSS2A": ("DEMO-T03", "DEMO-T03", "DEMO-T03", "DEMO-T01", "DEMO-T05", "DEMO-T05"),
    "JSS3A": ("DEMO-T01", "DEMO-T04", "DEMO-T05", "DEMO-T05", "DEMO-T04", "DEMO-T03"),
}

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
    # (full_name, role). `role` is a DISPLAY string only ("what this person is
    # called" — permission rides on is_moderator / form assignments /
    # allocations), so the persona story is carried by the combination of
    # columns, never by the job title on its own.
    #   DEMO-ADM — the guide with full admin rights (also the school admin
    #              login: email + DEMO_STAFF_PIN clears /admin/login).
    #   DEMO-T01 — subject teacher only (pure gradebook persona).
    #   DEMO-T02 — subject teacher + Form Master of JSS1A (traits/remarks
    #              persona).
    #   DEMO-T03 — "Vice Principal" + is_moderator: staff login then
    #              auto-elevates into the Moderator Console (deputy RBAC
    #              persona: publish results, place clearance holds).
    #   DEMO-T04/T05 — ordinary teachers who own the remaining classes so the
    #              roster stays fully allocated.
    ("Demo Guide", "admin"),
    ("Mrs. A. Balogun", "teacher"),
    ("Mr. E. Okonkwo", "teacher"),
    ("Miss F. Abdullahi", "Vice Principal"),
    ("Mr. S. Alabi", "teacher"),
    ("Mrs. N. Eze", "teacher"),
)
#: The staff row promoted into the Moderator deputy persona. Kept as a named
#: constant so the provision response and any UI copy refer to the same ID.
DEMO_MODERATOR_ID = "DEMO-T03"
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


def _curated_scores(total: float) -> Dict[str, int]:
    """Split a /100 total into the demo template's fixed components.

    Mirrors "Junior Secondary Standard": Assignment 1 (/10) + Test 1 (/30) +
    Exam (/60). Curated rows use this instead of the sampled _score() because
    the onboarding card tells the prospect "look at this student", and a card
    that contradicts the copy (or silently misses a subject) undercuts the
    demo. Always fully in-range — no clamping surprises at the extremes.
    """
    assignment = max(0, min(10, round(total / 10)))
    test = max(0, min(30, round(total * 0.30)))
    exam = max(0, min(60, round(total * 0.60)))
    return {"Assignment 1": assignment, "Test 1": test, "Exam": exam}


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
        # The demo admin console walk-through is the demo's centrepiece (roster,
        # Command Center publishing, credits/test-mode billing). Without this
        # hash the /admin/login store-1 query finds NULL admin_password_hash and
        # every attempt dead-ends on the "set up your admin password" wall.
        # register_school bcrypt-hashes the value inside Postgres (crypt); the
        # plaintext is the publicly advertised demo PIN, so nothing secret can
        # leak through client-side parameter binding.
        admin_password_hash=DEMO_STAFF_PIN,
    )
    db.topup_slots(
        subdomain,
        DEMO_STUDENT_COUNT,
        f"init-slot:{subdomain}",
        "Demo seed capacity",
        0,
    )
    seed_demo_data(subdomain)

    # Command-Center fuel. grant_initial_credits commits its own idempotent
    # ledger row (reference init:<subdomain>), and a failure here must never
    # fail provisioning — publish would just meet the insufficient-credits
    # wall, the same outcome the pre-fix demo had.
    try:
        db.grant_initial_credits(subdomain, DEMO_CREDIT_GRANT)
    except Exception as exc:
        logger.warning(f"[DEMO] Credit grant skipped for {subdomain}: {exc.__class__.__name__}: {exc}")

    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"[DEMO] Provisioned '{subdomain}' in {elapsed_ms}ms")
    # The handoff payload doubles as the credentials manifest for the onboarding
    # card. Everything here is deterministic Constants, not generated secrets —
    # the UI mirrors these in lib/demoPersonas.ts and scripts/verify-demo-
    # isolation.mjs pins that both sides agree, so the card can never show
    # credentials the seed did not create.
    admin_email = f"{subdomain}@demo.resultapp.org"
    return {
        "subdomain": subdomain,
        "url": f"https://demo.resultapp.org/{subdomain}",
        "staff_id": "DEMO-ADM",
        "staff_pin": DEMO_STAFF_PIN,
        "admin_email": admin_email,
        "credentials": {
            "admin": {
                "staff_id": "DEMO-ADM",
                "email": admin_email,
                "pin": DEMO_STAFF_PIN,
            },
            "staff": [
                {"staff_id": sid, "full_name": name, "role": role}
                for sid, name, role in zip(
                    ["DEMO-ADM", "DEMO-T01", "DEMO-T02", "DEMO-T03", "DEMO-T04", "DEMO-T05"],
                    [n for n, _ in _STAFF_NAMES],
                    [r for _, r in _STAFF_NAMES],
                )
            ],
            "student_pin": DEMO_STAFF_PIN,
            "students": ["STD001", "STD002", "STD003", "STD013", "STD020"],
        },
        "student_count": DEMO_STUDENT_COUNT,
        "expires_in_seconds": DEMO_TTL_SECONDS,
        "provisioning_ms": elapsed_ms,
    }


def seed_demo_data(subdomain: str) -> Dict[str, int]:
    """Deterministic lean seed: roster, subjects, allocations, template,
    grades, publications. Direct SQL (no network, no emails)."""
    rng = random.Random(DEMO_RNG_SEED)
    conn = db._connect_as_superuser()
    counts = {
        "students": 0,
        "staff": 0,
        "subjects": 0,
        "allocations": 0,
        "form_assignments": 0,
        "grades": 0,
        "prior_grades": 0,
        "publications": 0,
        "clearance_holds": 0,
    }
    try:
        cur = conn.cursor()

        # --- Students: 10 per class, STD001..STD040 -------------------------
        # Persona students are PINNED (name + gender) so the onboarding card
        # can print the exact roster without a fetch; the rest draw from the
        # fixed-seed name pools and stay random-but-reproducible. The first
        # three personas share JSS1A by numbering, so their report cards rank
        # against one another like real classmates would.
        students = []
        for ci, class_name in enumerate(DEMO_CLASSES):
            for i in range(DEMO_STUDENT_COUNT // len(DEMO_CLASSES)):
                n = ci * (DEMO_STUDENT_COUNT // len(DEMO_CLASSES)) + i + 1
                sid = f"STD{n:03d}"
                if sid in _DEMO_PERSONA_STUDENT:
                    full_name, gender = _DEMO_PERSONA_STUDENT[sid]
                else:
                    full_name = f"{rng.choice(_FIRST_NAMES)} {rng.choice(_LAST_NAMES)}"
                    gender = rng.choice(("Male", "Female"))
                students.append((subdomain, sid, full_name, class_name, gender))
        # The password hash is computed INSIDE Postgres (pgcrypto): the literal
        # '123456' is a public, advertised demo constant, so inlining it in the
        # SQL template keeps plaintext out of even the client-side parameter
        # binding that psycopg2 performs.
        #
        # must_change_password is seeded FALSE on purpose: demo credentials are
        # printed on the onboarding card, so the password-change nag would both
        # read as friction and invite a prospect to change the PIN out from
        # under the card. (Real-tenant seeds keep TRUE.)
        #
        # Plain tuples instead of execute_values(template_args=), which needs
        # psycopg2 >= 2.8; this keeps demo seeding working on an older pinned
        # driver.
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_STUDENTS_TABLE} "
            "(subdomain, student_id, full_name, class_name, gender, password_hash, must_change_password) VALUES %s",
            students,
            template="(%s, %s, %s, %s, %s, crypt('123456', gen_salt('bf')), FALSE)",
        )
        counts["students"] = len(students)

        # --- Staff: DEMO-ADM + 3 staff personas + 2 filler teachers --------
        # All share DEMO_STAFF_PIN ("123456"), hashed in Postgres exactly like
        # the students above (see that block for the FALSE rationale).
        staff = []
        for i, (name, role) in enumerate(_STAFF_NAMES):
            staff.append((subdomain, "DEMO-ADM" if i == 0 else f"DEMO-T{i:02d}", name, role))
        staff_names_by_id = {m[1]: m[2] for m in staff}
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_STAFF_TABLE} "
            "(subdomain, staff_id, full_name, role, password_hash, must_change_password) VALUES %s",
            staff,
            template="(%s, %s, %s, %s, crypt('123456', gen_salt('bf')), FALSE)",
        )
        counts["staff"] = len(staff)

        # The Moderator deputy: is_moderator is a capability flag, NOT the role
        # string, so it is promoted here exactly the way
        # allocations.set_staff_moderator does — boolean + grant timestamp,
        # display role untouched. Only DEMO-T03 gets it.
        cur.execute(
            f"UPDATE {db.TENANT_STAFF_TABLE} "
            "SET is_moderator = TRUE, moderator_granted_at = NOW() "
            "WHERE subdomain = %s AND staff_id = %s;",
            (subdomain, DEMO_MODERATOR_ID),
        )

        # --- Pin the academic clock ----------------------------------------
        # The demo data is fixed to DEMO_SESSION, but the report page resolves
        # "which session am I in?" from schools.current_session first and only
        # falls back to a clock-derived value. Leaving NULL here means every
        # demo provisioned after the September rollover silently starts
        # requesting a session with no publications — every result lookup
        # would 404 forever. Pin both knobs explicitly; this is self-healing
        # insurance, not styling.
        cur.execute(
            f"UPDATE {db.SCHOOLS_REGISTRY_TABLE} "
            "SET current_term = %s, current_session = %s WHERE subdomain = %s;",
            ("Term 1", DEMO_SESSION, subdomain),
        )

        # --- Subjects ---
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_SUBJECTS_TABLE} (subdomain, subject_name) VALUES %s",
            [(subdomain, s) for s in DEMO_SUBJECTS],
        )
        counts["subjects"] = len(DEMO_SUBJECTS)

        # --- Allocations: curated persona map, not a round-robin -----------
        # Every (class x core subject) cell points at a staff_id, translated
        # through the roster's full names below because tenant_allocations
        # matches on staff_name (a name string, per staff_auth). DEMO-T01
        # teaches across three classes but no form class; DEMO-T02 teaches
        # their own form class (subject + traits editing in one portal);
        # DEMO-T03 the moderator teaches their JSS2A cohort.
        allocations = []
        for class_name, owner_ids in _DEMO_ALLOCATIONS.items():
            for si, subject in enumerate(DEMO_CORE_SUBJECTS):
                allocations.append((
                    subdomain,
                    subject,
                    staff_names_by_id[owner_ids[si]],
                    class_name,
                ))
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_ALLOCATIONS_TABLE} "
            "(subdomain, subject_name, staff_name, class_name) VALUES %s",
            allocations,
        )
        counts["allocations"] = len(allocations)

        # --- Form assignments: one Form Master per class --------------------
        # Seeded directly rather than via the roster router (no HTTP in this
        # module), so the class's Smart-Remarks scheme is written here too —
        # the same DEFAULT the router would have stamped on first assignment.
        # Without these rows the report cards render a blank signatory line
        # and the Form-Master persona has no "My Form Class" link.
        from services.remark_schemes import (
            DEFAULT_FORM_TEACHER_SCHEME as _DEFAULT_FORM_TEACHER_SCHEME,
            validate_scheme as _validate_remark_scheme,
        )

        _scheme_json = json.dumps(_validate_remark_scheme(_DEFAULT_FORM_TEACHER_SCHEME))
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_FORM_ASSIGNMENTS_TABLE} "
            "(subdomain, class_name, staff_id, teacher_remark_scheme) VALUES %s",
            [
                (subdomain, class_name, staff_id, _scheme_json)
                for class_name, staff_id in _DEMO_FORM_CLASSES
            ],
        )
        counts["form_assignments"] = len(_DEMO_FORM_CLASSES)

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

        # --- Grades ---------------------------------------------------------
        # Term 1 (2026/2027): the fixed-seed spread for everyone EXCEPT the
        # two persona overrides:
        #   * STD003 "The Absentee" — excluded entirely, so their published
        #     Term 1 carries deliberately ZERO grade rows and the report card
        #     renders the "carries no scores (e.g. absent)" state.
        #   * STD001 "The Scholar" — curated below (not sampled) so the main
        #     showcase card reads as invented-but-handcrafted numbers with a
        #     complete subject set.
        # The fixed seed is still consumed in a stable order by the remaining
        # students, determinism survives: same seed -> same demo, every time.
        grades = []
        for si, (sub, sid, _name, _cls, _g) in enumerate(students):
            if sid == _DEMO_ABSENT_STUDENT:
                continue
            terms = ("Term 1",) if si % 2 else ("Term 1", "Term 2")
            for term in terms:
                if sid == "STD001" and term == "Term 1":
                    # Curated below; a sampled row for the same
                    # (student, subject, term, session) cell would break the
                    # grade unique constraint.
                    continue
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
        for si, subject in enumerate(DEMO_CORE_SUBJECTS):
            grades.append((
                subdomain, "STD001", subject, "Term 1", DEMO_SESSION,
                json.dumps(_curated_scores(_DEMO_SCHOLAR_TOTALS[si])),
                json.dumps({t: "A" for t in _BEHAVIOURS}),
            ))
        # Last session's closing result — the ARCHIVE persona. Only JSS1A
        # (STD001..STD010) carries a published Term 3 in 2025/2026: that is
        # exactly what the student dashboard archive and
        # ?academic_session= deep links are for, while the JSS1B/JSS2A/JSS3A
        # kids stay publication-free so the "no results published yet"
        # dashboard state survives. Scores are deterministic arithmetic
        # (base per student, ±4 wobble per subject), not sampling, because
        # these numbers appear on a card a prospect evaluates.
        prior_grades = []
        prior_pubs = []
        for i in range(10):
            sid = f"STD{i + 1:03d}"
            base = _DEMO_PRIOR_BASE - (i * _DEMO_PRIOR_STEP)
            for j, subject in enumerate(DEMO_CORE_SUBJECTS):
                wobble = ((i * 5 + j * 3) % 9) - 4
                prior_grades.append((
                    subdomain, sid, subject, DEMO_PRIOR_TERM, DEMO_PRIOR_SESSION,
                    json.dumps(_curated_scores(max(35, min(99, base + wobble)))),
                    json.dumps({t: rng.choice(_BEHAVIOUR_SCALE[:3]) for t in _BEHAVIOURS}),
                ))
            prior_pubs.append((subdomain, sid, DEMO_PRIOR_TERM, DEMO_PRIOR_SESSION))
        grades.extend(prior_grades)
        counts["prior_grades"] = len(prior_grades)
        execute_values(
            cur,
            f"INSERT INTO {db.TENANT_GRADES_TABLE} "
            "(subdomain, student_id, subject_name, term, academic_session, academic_scores, behavioural_traits) "
            "VALUES %s",
            grades,
        )
        counts["grades"] = len(grades)

        # The Scholar's voice: the report card's remark/signature block reads
        # the form-teacher and principal remark columns. One targeted UPDATE
        # keeps the bulk insert's tuple shape simple.
        cur.execute(
            f"UPDATE {db.TENANT_GRADES_TABLE} "
            "SET form_teacher_remark = %s, principal_remark = %s "
            "WHERE subdomain = %s AND student_id = 'STD001' "
            "  AND term = 'Term 1' AND academic_session = %s;",
            (_DEMO_SCHOLAR_REMARK, _DEMO_PRINCIPAL_REMARK, subdomain, DEMO_SESSION),
        )

        # --- Financial hold: STD002 "The Bursar's Case" ---------------------
        # The ONLY row the withheld report-card state needs: published Term 1
        # plus a sparse student_term_clearance row with is_financially_cleared
        # FALSE. Idempotent on the natural unique key, mirroring what
        # clearance.py's PUT writes (fail-open default means everyone else is
        # implicitly cleared).
        cur.execute(
            f"""
            INSERT INTO {db.STUDENT_CLEARANCE_TABLE}
                (subdomain, student_id, term, academic_session,
                 is_financially_cleared, hold_reason, held_by, held_at)
            VALUES (%s, 'STD002', 'Term 1', %s,
                    FALSE, %s, %s, NOW())
            ON CONFLICT (subdomain, student_id, term, academic_session) DO NOTHING;
            """,
            (
                subdomain,
                DEMO_SESSION,
                "Outstanding school fees balance",
                "Demo Guide",
            ),
        )
        counts["clearance_holds"] = 1

        # --- Publications ----------------------------------------------------
        # Term 1 for the first 12 pupils (the result-checker demo: published
        # STD001-012, and deliberately none after STD012 so STD013+ stay in
        # the unpublished/404 world). The Absentee IS published — that is the
        # whole point of a published result with zero grade rows. Plus last
        # session's JSS1A archive rows. class_name_snapshot is stamped at
        # insert time (what the publish action would record) so the archived
        # cards rank against the same 10-seat cohort.
        pubs = [
            (subdomain, f"STD{n:03d}", "Term 1", DEMO_SESSION, "Demo Guide", "JSS1A")
            for n in range(1, 13)
        ]
        pubs += [
            (subdomain, sid, DEMO_PRIOR_TERM, DEMO_PRIOR_SESSION, "Demo Guide", "JSS1A")
            for (subdomain, sid, _t, _s) in prior_pubs
        ]
        execute_values(
            cur,
            f"INSERT INTO {db.RESULT_PUBLICATIONS_TABLE} "
            "(subdomain, student_id, term, academic_session, published_by, class_name_snapshot) VALUES %s",
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
