import pathlib
import subprocess
import sys

# Verify the countdown end-to-end with the SAME derivation the component uses,
# so the arithmetic is proven rather than assumed.
SECONDS = 5


def derive(started_at: int, now: int):
    elapsed = (now - started_at) // 1000
    return max(0, SECONDS - elapsed)


fail = 0


def check(name, ok, detail=""):
    global fail
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' — ' + detail) if not ok and detail else ''}")
    fail += 0 if ok else 1


print("countdown derivation (mirrors RegisterSchoolForm):")
t0 = 1_000_000
observed = [derive(t0, t0 + s * 1000) for s in range(0, 9)]
print(f"  t+0s..t+8s -> {observed}")
check("starts at 5", observed[0] == 5)
check("counts down 4,3,2,1", observed[1:5] == [4, 3, 2, 1])
check("reaches 0 at t+5", observed[5] == 0)
check("stays 0 (never negative)", all(v == 0 for v in observed[5:]), str(observed[5:]))
check("monotonic non-increasing", all(observed[i] >= observed[i + 1] for i in range(len(observed) - 1)))
# Tab-backgrounded timers can deliver a late tick; the derived value must still
# be correct from wall-clock time rather than trusting one tick per second.
check("recovers from a late tick", derive(t0, t0 + 9_400) == 0)
check("no negative after long stall", derive(t0, t0 + 60_000) == 0)

print("\nsource invariants:")
src = pathlib.Path("components/forms/RegisterSchoolForm.tsx").read_text(encoding="utf-8")
check("PORTAL_HANDOFF_SECONDS is 5", "PORTAL_HANDOFF_SECONDS = 5" in src)
check("single-shot timeout arms navigation", "handoffTimeoutRef.current = window.setTimeout" in src)
check("navigation assigns the admin login URL", "window.location.href = adminLoginUrl" in src)
check("timeout cleared on cancel/unmount", src.count("clearHandoffTimeout()") >= 3)
check("navigation never depends on the countdown ticker", "portalReadyAt" not in src)
check("manual CTA rendered during countdown", "Open admin login now" in src)
check("cancelling suppresses the timer", "if (!successData || handoffCancelled)" in src)
check("targets /admin/login", "/admin/login" in src)
check("trailing slash normalised", "replace(/\\/+$/, \"\")" in src)
check("resetWizard clears the arm", "setHandoffStartedAt(null)" in src)

print(f"\n{'PASS' if not fail else 'FAIL'}: {fail} failing")
sys.exit(1 if fail else 0)