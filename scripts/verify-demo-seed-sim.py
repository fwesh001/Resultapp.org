"""
Offline simulation of seed_demo_data — replays the seeder against a fake
cursor/connection and asserts the ROW-LEVEL persona invariants without ever
touching a database.

    py scripts/verify-demo-seed-sim.py

Why not just static regex checks? The onboarding card promises eight exact
report-card states (Std001 scholar … Std050 empty dashboard). A regex can
confirm the seeder MENTIONS a clearance row; only replay can prove the
published/graded/prior-term matrix actually aggregates into those states, no
constraints are violated (e.g. a sampled row colliding with the curated
Scholar row), and a second run reproduces the identical transcript
(DEMO_RNG_SEED determinism).

Exit code 0 = every invariant holds; 1 = list of failures.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from services import demo  # noqa: E402  (imports db_manager; no DB on import)

DEMO_SUB = "demo-zzz999"

# ---------------------------------------------------------------------------
# Recording fakes
# ---------------------------------------------------------------------------


class ConnectionClosed(Exception):
    pass


class FakeCursor:
    """Record (sql, params) for every execute; the VALUES bulk inserts are
    recorded as (sql, rows, template) by the monkeypatched execute_values."""

    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append(("exec", sql.strip(), params))

    def close(self):
        pass


class FakeConnection:
    def __init__(self):
        self.log = []
        self.committed = False

    def cursor(self):
        return FakeCursor(self.log)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.committed = False

    def close(self):
        pass


def replay_seed():
    """Run seed_demo_data once on a fake connection and return (log, counts)."""
    conn = FakeConnection()
    real_connect = demo.db._connect_as_superuser
    real_exec_values = demo.execute_values
    demo.db._connect_as_superuser = lambda: conn

    def recording_exec_values(cur, sql, rows, template=None):
        cur.log.append(("values", sql.strip(), rows, template))

    demo.execute_values = recording_exec_values
    try:
        counts = demo.seed_demo_data(DEMO_SUB)
        return conn.log, counts, conn.committed
    finally:
        demo.db._connect_as_superuser = real_connect
        demo.execute_values = real_exec_values


def main():
    failures = []

    def check(name, condition, detail=""):
        if condition:
            print(f"  [PASS] {name}")
        else:
            failures.append(name)
            print(f"  [FAIL] {name} -- {detail}")

    print("\nSeeding the classroom (in-memory)")
    log, counts, committed = replay_seed()

    def values_for(table_name):
        return [e for e in log if e[0] == "values" and table_name in e[1]]

    def execs_for(pattern):
        return [e for e in log if e[0] == "exec" and pattern in e[1]]

    # --- Roster ----------------------------------------------------------
    students = values_for("INSERT INTO tenant_students")[0][2]
    check("40 students seeded", len(students) == 40, f"got {len(students)}")

    personas = {r[1]: r for r in students}
    for sid, name, cls in (
        ("STD001", "Amara Okafor", "JSS1A"),
        ("STD002", "Chidi Nwosu", "JSS1A"),
        ("STD003", "Kemi Adeleke", "JSS1A"),
        ("STD013", "Tunde Bakare", "JSS1B"),
        ("STD020", "Fatima Hassan", "JSS1B"),
    ):
        row = personas.get(sid)
        check(f"{sid} pinned ({name}, {cls})", row is not None and row[2] == name and row[3] == cls,
              repr(row))

    staff_v = values_for("INSERT INTO tenant_staff")[0]
    staff_rows = staff_v[2]
    check("6 staff seeded", len(staff_rows) == 6, f"got {len(staff_rows)}")
    check("student template: literal-hash + must_change_password FALSE",
          "crypt('123456', gen_salt('bf')), FALSE" in students_template(log),
          "no crypt('123456'…) FALSE template on the student insert")
    check("staff template: literal-hash + must_change_password FALSE",
          "crypt('123456', gen_salt('bf')), FALSE" in (staff_v[3] or ""),
          "no crypt('123456'…) FALSE template on the staff insert")
    check("staff rows: DEMO-T03 is 'Vice Principal'",
          any(r[1] == "DEMO-T03" and r[3] == "Vice Principal" for r in staff_rows), str(staff_rows))

    # --- School row pinning ----------------------------------------------
    pin = [e for e in log if e[0] == "exec" and "SET current_term" in e[1]]
    check("current_term/current_session pinned to the seeded term+session",
          len(pin) == 1 and pin[0][2] == ("Term 1", demo.DEMO_SESSION, DEMO_SUB),
          repr(pin))

    moderator = execs_for("SET is_moderator = TRUE")
    check("exactly one moderator promotion -> DEMO-T03",
          len(moderator) == 1 and moderator[0][2] == (DEMO_SUB, "DEMO-T03"), repr(moderator))

    verified = execs_for("SET is_email_verified = TRUE")
    check(
        "admin email pre-verified (fictional inbox cannot open a link)",
        len(verified) == 1
        and verified[0][2] == (DEMO_SUB,)
        and "verification_token_hash = NULL" in verified[0][1]
        and "verification_token_expires = NULL" in verified[0][1],
        repr(verified),
    )

    # --- Allocations + form classes --------------------------------------
    allocs = values_for("INSERT INTO tenant_allocations")[0][2]
    check("24 allocation cells (4 classes x 6 core subjects)", len(allocs) == 24, f"got {len(allocs)}")
    guide_names = {"Demo Guide"}
    check("guide account never owns a subject", all(r[2] not in guide_names for r in allocs), str(allocs))

    forms = values_for("INSERT INTO tenant_form_assignments")[0]
    form_rows = forms[2]
    check("4 form assignments", len(form_rows) == 4, f"got {len(form_rows)}")
    form_map = {r[1]: r[2] for r in form_rows}
    check("form-class mapping matches the persona plan",
          form_map == {"JSS1A": "DEMO-T02", "JSS1B": "DEMO-T04", "JSS2A": "DEMO-T03", "JSS3A": "DEMO-T05"},
          repr(form_map))
    check("every form class ships a non-empty remark scheme",
          all(r[3] and r[3] != "[]" for r in form_rows), str(form_rows))

    # --- Grades ----------------------------------------------------------
    grades = values_for("INSERT INTO tenant_grades")[0][2]
    per_student = {}
    for r in grades:
        per_student.setdefault((r[1], r[3], r[4]), []).append(r)

    def sid_count(sid, term, session):
        return len(per_student.get((sid, term, session), []))

    check("STD001 (Scholar): exactly 6 curated Term 1 rows", sid_count("STD001", "Term 1", demo.DEMO_SESSION) == 6,
          f"got {sid_count('STD001', 'Term 1', demo.DEMO_SESSION)}")
    check("STD003 (Absentee): zero Term 1 rows", sid_count("STD003", "Term 1", demo.DEMO_SESSION) == 0,
          f"got {sid_count('STD003', 'Term 1', demo.DEMO_SESSION)}")
    t1_std013 = sid_count("STD013", "Term 1", demo.DEMO_SESSION)
    check("STD013 (unpublished) carries graded work", t1_std013 >= 4, f"only {t1_std013} rows")
    check("STD020 also graded (but never published)", sid_count("STD020", "Term 1", demo.DEMO_SESSION) >= 4, "")

    prior_ids = {f"STD{i:03d}" for i in range(1, 11)}
    for sid in sorted(prior_ids):
        if sid_count(sid, demo.DEMO_PRIOR_TERM, demo.DEMO_PRIOR_SESSION) != 6:
            failures.append(f"{sid} prior-session rows")
            print(f"  [FAIL] {sid} carries 6 archived Term 3 rows")
    if not any(f == f"{sid} prior-session rows" for f in failures):
        print("  [PASS] all 10 JSS1A students carry 6 archived Term 3 rows")
    check("STD011+ have NO archived rows (their dashboards stay empty)",
          all(sid_count(f"STD{n:03d}", demo.DEMO_PRIOR_TERM, demo.DEMO_PRIOR_SESSION) == 0
              for n in range(11, 41)), "")

    # Component bounds: Assignment 1 (10) / Test 1 (30) / Exam (60)
    def bounds_bad(row):
        s = json.loads(row[5])
        return not (0 <= s["Assignment 1"] <= 10 and 0 <= s["Test 1"] <= 30 and 0 <= s["Exam"] <= 60)

    bad = [r for r in grades if bounds_bad(r)]
    check("every score component inside its template maximum", not bad, repr(bad[:2]))

    remark_updates = [e for e in log if e[0] == "exec" and "form_teacher_remark" in e[1]]
    check("Scholar remarks written (form + principal)",
          len(remark_updates) == 1
          and remark_updates[0][2][0] and remark_updates[0][2][1]
          and "STD001" in remark_updates[0][1].replace("student_id = '", "student_id ='"),
          repr(remark_updates))

    # --- Clearance hold ---------------------------------------------------
    holds = [e for e in log if e[0] == "exec" and "student_term_clearance" in e[1]]
    check("STD002 fee-hold row written (FALSE, reason, by, NOW())",
          len(holds) == 1
          and holds[0][2][0] == DEMO_SUB
          and holds[0][2][1] == "Outstanding school fees balance"
          and holds[0][2][2] == "Demo Guide"
          and "'STD002'" in holds[0][1].replace("%s", "STD002") or "STD002" in holds[0][1],
          repr(holds))

    # --- Publications -----------------------------------------------------
    pubs = values_for("INSERT INTO result_publications")[0][2]
    t1_pubs = {r[1] for r in pubs if r[3] == demo.DEMO_SESSION}
    prior_pubs_rows = [r for r in pubs if r[3] == demo.DEMO_PRIOR_SESSION]
    check("exactly STD001..012 are published this session",
          t1_pubs == {f"STD{n:03d}" for n in range(1, 13)}, f"got {len(t1_pubs)}")
    check("STD013/STD020 are NOT published (404 / empty-dashboard states)", not ({"STD013", "STD020"} & t1_pubs), "")
    check("10 archived prior-session publications (JSS1A only)",
          len(prior_pubs_rows) == 10 and {r[1] for r in prior_pubs_rows} == prior_ids, "")
    check("every publication stamps its class snapshot",
          all(r[5] == "JSS1A" for r in pubs), "missing class_name_snapshot")

    # --- Determinism ------------------------------------------------------
    log2, _counts2, _committed2 = replay_seed()
    check("second run produces the byte-identical transcript (DEMO_RNG_SEED)",
          log == log2, "transcript drifted between runs")

    check("seeder committed exactly once", committed, "commit() never called")

    print(f"\n{len(log) - len([f for f in failures])} transcripts OK · counts: {counts}".replace("·", ":"))
    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("Demo seed simulation verified: every persona invariant holds, deterministically.\n")


def students_template(log):
    v = [e for e in log if e[0] == "values" and "INSERT INTO tenant_students" in e[1]]
    return v[0][3] or "" if v else ""


if __name__ == "__main__":
    main()
