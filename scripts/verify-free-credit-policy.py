#!/usr/bin/env python3
"""Decision-path tests for the conditional free-credit grant (Phase 3).

Exercises `resolve_initial_credit_grant`'s logic without touching Postgres:
the DB accessors are stubbed so only the policy branch runs. Mirrors the real
implementation in backend/services/db_manager.py.

Run: python scripts/verify-free-credit-policy.py
"""

import sys

TRIAL_CREDITS = 30
FREE_CREDITS_MIN_STUDENTS = 500  # inclusive


def resolve_initial_credit_grant(student_count, enabled: bool) -> int:
    """Copy of the real decision path, with the toggle stubbed."""
    try:
        count = max(0, int(student_count or 0))
    except (TypeError, ValueError):
        count = 0
    if not enabled:
        return 0
    if count < FREE_CREDITS_MIN_STUDENTS:
        return 0
    return TRIAL_CREDITS


failures = 0


def check(label: str, got, want) -> None:
    global failures
    ok = got == want
    if not ok:
        failures += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")


print("=== Threshold is INCLUSIVE: exactly 500 qualifies ===")
check("toggle ON,  499 students (below threshold)", resolve_initial_credit_grant(499, True), 0)
check("toggle ON,  500 students (exactly threshold)", resolve_initial_credit_grant(500, True), 30)
check("toggle ON,  501 students (above threshold)", resolve_initial_credit_grant(501, True), 30)
check("toggle ON, 1000 students", resolve_initial_credit_grant(1000, True), 30)

print("\n=== Toggle OFF withholds the grant at every size ===")
check("toggle OFF, 500 students", resolve_initial_credit_grant(500, False), 0)
check("toggle OFF, 5000 students", resolve_initial_credit_grant(5000, False), 0)

print("\n=== Small schools never get free credits while ON ===")
for n in (0, 1, 50, 150, 499):
    check(f"toggle ON, {n} students", resolve_initial_credit_grant(n, True), 0)

print("\n=== Bad / hostile input fails closed to 0 ===")
for bad in (None, "", "abc", [], {}):
    try:
        got = resolve_initial_credit_grant(bad, True)
    except Exception as e:  # noqa: BLE001
        got = f"RAISED {e}"
    check(f"student_count={bad!r}", got, 0)

print("\n=== Negative and float inputs are clamped, not honoured ===")
check("student_count=-5", resolve_initial_credit_grant(-5, True), 0)
check("student_count=500.0 (float, exact)", resolve_initial_credit_grant(500.0, True), 30)
check("student_count=499.9 (float, below)", resolve_initial_credit_grant(499.9, True), 0)

print(f"\n{'ALL CHECKS PASSED' if failures == 0 else str(failures) + ' FAILURE(S)'}")
sys.exit(1 if failures else 0)
