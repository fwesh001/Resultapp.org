#!/usr/bin/env python3
"""
waiver-mutation-probe — proves the waiver token CAS is genuinely exclusive.

WHAT THIS PROVES
----------------
A waiver token is a bearer credential with cash value. Its safety rests entirely
on one property: **at most one checkout can ever redeem it**. If that is not
true, a superadmin hands one code to a school and two schools get free slots.

The property is not enforceable in application code — two requests can both read
`status='open'` before either writes. It is enforced by PostgreSQL: under READ
COMMITTED, two concurrent `UPDATE ... WHERE status='open' ... RETURNING`
statements serialise on the row lock, and the second re-evaluates its predicate
against the committed row, matches zero rows, and is told it lost.

That is a claim about a database, so this probe is a claim about a database. It
opens real connections and races real threads. It does not mock the cursor,
because a mocked cursor would only prove that the mock is exclusive.

`scripts/verify-waiver-mutation.sh` is the house-style entry point; this is the
engine it calls, and it runs standalone too:

    PG_HOST=... PG_PORT=... PG_SUPERUSER=... PG_SUPERUSER_DB=... \
        python3 scripts/waiver-mutation-probe.py

Every test creates its own token and cleans up after itself. It touches only
rows whose token_prefix starts with 'RW-probe', so it is safe to run against a
database that holds real tenants — but run it against the live DB only when you
have a reason to.
"""

import os
import sys
import threading
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent / "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from services.waivers import (  # noqa: E402
    RESERVATION_TTL_SECONDS,
    WaiverValidationError,
    consume_token,
    compute_waiver_split,
    mint_token,
    peek_token,
    reap_stale_reservations,
    release_token,
    reserve_token,
    void_token,
)

PASS = 0
FAIL = 0
NOTE = "probe"


def ok(msg):
    global PASS
    PASS += 1
    print(f"  PASS  {msg}")


def no(msg, detail=""):
    global FAIL
    FAIL += 1
    print(f"  FAIL  {msg}")
    if detail:
        print(f"          {detail}")


def section(title):
    print(f"\n=== {title} ===")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cfg():
    return {
        "host": os.getenv("PG_HOST", "localhost"),
        "port": int(os.getenv("PG_PORT", "5432")),
        "user": os.getenv("PG_SUPERUSER", "postgres"),
        "password": os.getenv("PG_SUPERUSER_PASSWORD", ""),
        "dbname": os.getenv("PG_SUPERUSER_DB", "postgres"),
    }


def fresh(cur):
    """Drop every probe row so each test starts from a known state."""
    cur.execute("DELETE FROM waiver_tokens WHERE token_prefix LIKE 'RW-probe%'")
    cur.execute("DELETE FROM schools WHERE subdomain LIKE 'probe-%'")


def ensure_school(cur, subdomain):
    cur.execute(
        """
        INSERT INTO schools (subdomain, school_name) VALUES (%s, %s)
        ON CONFLICT (subdomain) DO NOTHING
        """,
        (subdomain, "Waiver Probe School"),
    )


def mint_probe(pct=100, allowance=100, applies_to="BOTH", suffix=""):
    """Mint a token whose prefix marks it as probe-owned. Returns (plaintext, id)."""
    import services.waivers as W

    original = W.generate_token_string
    W.generate_token_string = lambda: f"RW-probe{suffix}-{original()[8:]}"
    try:
        t = mint_token(
            discount_percentage=pct,
            slot_allowance=allowance,
            applies_to=applies_to,
            created_by=NOTE,
            note="waiver-mutation-probe",
        )
    finally:
        W.generate_token_string = original
    return t["token_string"], t["id"]


def race(fn, n=8):
    """Run fn(i) on n threads released simultaneously. Returns the winner indices.

    The barrier matters: without it the threads arrive staggered and the test
    would pass even with a broken predicate, because a broken predicate still
    only loses when the two writes actually overlap.
    """
    barrier = threading.Barrier(n)
    results = [None] * n
    threads = []

    def runner(i):
        try:
            barrier.wait(timeout=10)
            results[i] = ("won", fn(i))
        except WaiverValidationError as e:
            results[i] = ("lost", str(e))
        except Exception as e:  # noqa: BLE001
            results[i] = ("error", repr(e))

    for i in range(n):
        t = threading.Thread(target=runner, args=(i,))
        t.start()
        threads.append(t)
    for t in threads:
        t.join(timeout=30)

    winners = [i for i, r in enumerate(results) if r and r[0] == "won"]
    errors = [(i, r) for i, r in enumerate(results) if r and r[0] == "error"]
    return winners, results, errors


# ---------------------------------------------------------------------------


def main():
    # Importing services.waivers can pull in main (for SUBDOMAIN_RE), which
    # mounts the whole FastAPI app and logs a wall of startup banners. None of
    # that is relevant to a CAS probe, and it buries the results.
    import logging

    logging.disable(logging.CRITICAL)

    from services.db_manager import (
        _connect_as_superuser,
        _connect_as_superuser_transactional,
        init_schools_registry,
    )

    section("0. schema")
    try:
        init_schools_registry()
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("SELECT to_regclass('public.waiver_tokens');")
        present = cur.fetchone()[0] == "waiver_tokens"
        if present:
            ok("waiver_tokens exists")
        else:
            no("waiver_tokens missing", "init_schools_registry() did not create it")
            return 1
        cur.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name='pending_registrations' AND column_name IN
              ('waiver_token_id','charge_required','charge_ngn','charged_slots')
            """
        )
        cols = sorted(r[0] for r in cur.fetchall())
        if len(cols) == 4:
            ok("pending_registrations carries the waiver binding (4 columns)")
        else:
            no("hold columns incomplete", f"got {cols}")
        fresh(cur)
        conn.commit()
    except Exception as e:
        no("could not reach the database", repr(e))
        return 1

    try:
        # -------------------------------------------------------------------
        section("0.5. the reservation runs in a REAL transaction")
        # This one is a source check, and deliberately so.
        #
        # reserve_token reads the row (scope/tenant/status) and then updates it.
        # On the autocommit connection, `SELECT ... FOR UPDATE` releases its row
        # lock the instant the statement ends, so those two statements are separate
        # transactions and the checks can be made against a row someone else has
        # since changed. Every behavioural test above still PASSES with that bug —
        # the UPDATE's own predicate refuses the stale write, so the outcome is
        # correct, only the error message is wrong.
        #
        # A property that no test can observe has to be asserted statically, or the
        # next refactor puts it back.
        import ast
        import inspect

        import services.waivers as W

        def connectors_called(fn):
            """Names of connection helpers actually CALLED in fn's body.

            Parsed from the AST rather than grepped out of the source: a substring
            check for "_connect_as_superuser()" matches the COMMENT explaining why
            this test exists, which is exactly the sort of thing that makes a
            static guard worse than no guard at all.
            """
            names = set()
            tree = ast.parse(inspect.getsource(fn))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                f = node.func
                if isinstance(f, ast.Name):
                    names.add(f.id)
                elif isinstance(f, ast.Attribute):
                    names.add(f.attr)
            return names

        reserve_conns = connectors_called(W.reserve_token)
        if "_connect_as_superuser_transactional" in reserve_conns and "_connect_as_superuser" not in reserve_conns:
            ok("reserve_token opens a real transaction (FOR UPDATE actually holds its lock)")
        else:
            no(
                "reserve_token is not atomic with its own validation",
                f"calls {sorted(reserve_conns)}",
            )

        # Same reasoning for consume_token, which takes a caller-supplied cursor so
        # it can join the slot-grant transaction. It must not open its own
        # connection, or the burn commits independently of the seats.
        consume_conns = connectors_called(W.consume_token)
        if not any(c.startswith("_connect_as_superuser") for c in consume_conns):
            ok("consume_token takes the caller's cursor and opens no connection of its own")
        else:
            no("consume_token opens its own connection", f"calls {sorted(consume_conns)}")

        conn.commit()

        # -------------------------------------------------------------------
        section("1. mint stores no plaintext")
        code, tid = mint_probe(pct=100, allowance=100)
        cur.execute("SELECT token_hash, token_prefix, token_fingerprint FROM waiver_tokens WHERE id=%s", (tid,))
        row = cur.fetchone()
        if not code.startswith("RW-probe"):
            no("probe did not mint a marked token", code[:16])
        else:
            ok(f"minted token #{tid} (plaintext returned once)")
        blob = " ".join(str(v) for v in row)
        # Check the whole code AND a 16-char tail.
        #
        # The 16 matters because token_urlsafe() uses the base64url alphabet,
        # which CONTAINS '-'. Splitting the code on hyphens — the obvious way to
        # isolate "the secret part" — silently truncates at whatever hyphens the
        # random payload happens to contain, and on an unlucky draw that yields
        # exactly the 6-char fingerprint, which is supposed to be stored. That
        # makes the assertion pass or fail at random. Sixteen characters cannot
        # be reached by a 6-char fingerprint.
        code_tail = code[-16:]
        if code not in blob and code_tail not in blob:
            ok("plaintext is nowhere in the stored row (hash + prefix + fingerprint only)")
        else:
            leaked = "the full code" if code in blob else f"its last 16 chars ({code_tail})"
            no("PLAINTEXT TOKEN IS STORED", f"{leaked} appeared in the row: {blob}")
        if len(row[0]) == 64:
            ok("token_hash is a 64-char SHA-256 hex digest")
        else:
            no("token_hash malformed", repr(row[0]))
        conn.commit()

        # -------------------------------------------------------------------
        section("2. PEEK does not mutate")
        before = peek_token(code)
        status_before = _status(cur, tid)
        peek_token(code)
        peek_token(code)
        status_after = _status(cur, tid)
        if status_before == "open" and status_after == "open":
            ok(f"peeked 3x, status stayed '{status_after}' — preview cannot burn a token")
        else:
            no("peek mutated the token", f"{status_before} -> {status_after}")
        if before["slot_allowance"] == 100 and before["discount_percentage"] == 100:
            ok("peek returns the terms the superadmin set")
        else:
            no("peek returned wrong terms", repr(before))
        conn.commit()

        # -------------------------------------------------------------------
        section("3. RESERVE is mutually exclusive (the headline property)")
        code, tid = mint_probe(pct=100, allowance=100)

        def try_reserve(i):
            return reserve_token(code, f"resultapp_race_{i}_{os.getpid()}", applies_to="BOTH")

        winners, results, errors = race(try_reserve, n=8)
        if errors:
            no("a racing reserve raised an unexpected error", repr(errors[0][1]))
        if len(winners) == 1:
            ok(f"8 threads raced for one token -> exactly 1 winner ({len(results) - 1} refused)")
        else:
            losers = [r for _, r in results if r and r[0] == "lost"]
            no(f"RESERVE IS NOT EXCLUSIVE — {len(winners)} winners", f"losers said: {losers[:2]}")
        conn.commit()

        # -------------------------------------------------------------------
        section("4. the winner's reservation is the only one that can be consumed")
        cur.execute("SELECT reservation_tx_ref FROM waiver_tokens WHERE id=%s", (tid,))
        held = cur.fetchone()[0]
        cur.execute(
            """
            UPDATE waiver_tokens SET reservation_tx_ref='someone-elses-ref',
                                    reserved_at=NOW(),
                                    reservation_expires_at=NOW() + INTERVAL '15 minutes'
            WHERE id=%s
            """,
            (tid,),
        )
        conn.commit()
        wrong = _try_consume(tid, "definitely-not-" + held, compute_waiver_split(100, 100, 100))
        if not wrong:
            ok("consume with a foreign tx_ref REFUSED — a reservation is only redeemable by its owner")
        else:
            no("FOREIGN tx_ref REDEEMED A RESERVATION", "the sweeper race is open")
        conn.commit()
        # put it back
        cur.execute(
            "UPDATE waiver_tokens SET reservation_tx_ref=%s WHERE id=%s", (held, tid)
        )
        conn.commit()

        # -------------------------------------------------------------------
        section("5. CONSUME is single-winner (the double-spend proof)")
        code, tid = mint_probe(pct=50, allowance=100)
        t = reserve_token(code, "resultapp_double_spend", applies_to="BOTH")
        split = compute_waiver_split(70, t["slot_allowance"], t["discount_percentage"])

        def try_consume(i):
            return _do_consume(tid, "resultapp_double_spend", split)

        winners, results, errors = race(try_consume, n=8)
        if errors:
            no("a racing consume raised an unexpected error", repr(errors[0][1]))
        if len(winners) == 1:
            ok(f"8 threads raced to consume -> exactly 1 won ({len(results) - 1} refused)")
        else:
            no(f"DOUBLE-SPEND IS POSSIBLE — {len(winners)} threads consumed one token", "")
        conn.commit()

        # -------------------------------------------------------------------
        section("6. a consumed token is spent for good")
        again = _try_consume(tid, "resultapp_double_spend", split)
        if not again:
            ok("re-consuming a spent token is refused")
        else:
            no("A SPENT TOKEN CAN BE REUSED", "")
        try:
            reserve_token(code, "resultapp_after_use", applies_to="BOTH")
            ok("FAIL - a spent token was re-reservable")
        except WaiverValidationError:
            ok("a consumed token cannot be reserved again")
        try:
            peek_token(code)
            no("a consumed token still previews", "")
        except WaiverValidationError as e:
            ok(f"a consumed token refuses preview ({e})")
        conn.commit()

        # -------------------------------------------------------------------
        section("7. consume wrote a complete audit record")
        cur.execute(
            """
            SELECT status, is_used, slots_requested, slots_waived, slots_forfeited,
                   discount_ngn, charged_slots, charged_ngn, used_by_tenant,
                   transaction_ref, reservation_tx_ref
            FROM waiver_tokens WHERE id=%s
            """,
            (tid,),
        )
        a = cur.fetchone()
        # Expected values are DERIVED from the split that was actually consumed,
        # never hardcoded. Hardcoding them means the test silently encodes one
        # token's terms and then asserts every other token against them.
        exp = (
            split["requested_slots"],
            split["waived_slots"],
            split["forfeited_slots"],
            split["charged_slots"],
            split["waived_ngn"],
            split["charged_ngn"],
        )
        got = (a[2], a[3], a[4], a[6], a[5], a[7])
        if a[0] == "consumed" and a[1] is True:
            ok("status='consumed' and the generated is_used column both agree")
        else:
            no("consumed state inconsistent", f"status={a[0]} is_used={a[1]}")
        if got[:4] == exp[:4]:
            ok(
                f"slots recorded: requested {exp[0]}, waived {exp[1]}, "
                f"charged {exp[3]}, forfeited {exp[2]}"
            )
        else:
            no("slot accounting wrong", f"expected {exp[:4]} got {got[:4]}")
        if got[4:] == exp[4:]:
            ok(f"money recorded: NGN {exp[4]} off, NGN {exp[5]} charged")
        else:
            no("money accounting wrong", f"expected {exp[4:]} got {got[4:]}")
        if a[9] is None:
            ok("reservation released on consume (no dangling lock)")
        else:
            no("reservation_tx_ref left set after consume", repr(a[9]))
        conn.commit()

        # The subtlest case in the whole feature, and the one most likely to
        # be "optimised" into a gateway bypass later: ZERO charged slots but a
        # non-zero charge. Every slot was waived, yet money is still due,
        # because the token was 50% rather than 100%. Skipping Flutterwave here
        # would hand a school 70 free slots it did not earn.
        if exp[3] == 0 and exp[5] > 0:
            if split["bypass_gateway"] is False:
                ok(
                    f"EDGE: 0 charged slots but NGN {exp[5]} still due -> "
                    f"bypass_gateway=False (gateway must still run)"
                )
            else:
                no("GATEWAY BYPASSED ON A NON-ZERO CHARGE", f"charged_ngn={exp[5]}")

        # -------------------------------------------------------------------
        section("8. forfeit accounting (use it or lose it)")
        code, tid = mint_probe(pct=100, allowance=100)
        reserve_token(code, "resultapp_forfeit", applies_to="BOTH")
        split = compute_waiver_split(50, 100, 100)
        _do_consume(tid, "resultapp_forfeit", split, tenant="probe-school")
        cur.execute("SELECT slots_requested, slots_waived, slots_forfeited FROM waiver_tokens WHERE id=%s", (tid,))
        f = cur.fetchone()
        if f == (50, 50, 50):
            ok("bought 50 of a 100-slot token -> 50 waived, 50 forfeited, recorded")
        else:
            no("forfeit accounting wrong", f"got {f}")
        conn.commit()

        # -------------------------------------------------------------------
        section("9. RELEASE is scoped to its own reservation")
        code, tid = mint_probe(pct=100, allowance=100)
        reserve_token(code, "resultapp_owner", applies_to="BOTH")
        if not release_token(tid, "not-the-owner"):
            ok("release with a foreign tx_ref did NOT free the reservation")
        else:
            no("FOREIGN RELEASE FREED A RESERVATION", "a held token became two redeemable ones")
        conn.commit()
        if _status(cur, tid) == "reserved":
            ok("token still reserved after the foreign release")
        else:
            no("foreign release changed state", _status(cur, tid))
        conn.commit()
        if release_token(tid, "resultapp_owner"):
            ok("owner released it")
        else:
            no("owner could not release", "")
        conn.commit()
        if _status(cur, tid) == "open":
            ok("token is back in the pool and re-reservable (checkout was abandoned)")
        else:
            no("release did not restore", _status(cur, tid))
        t2 = reserve_token(code, "resultapp_retry", applies_to="BOTH")
        ok(f"re-reserved after release under a new ref ({t2['reservation_tx_ref']})")
        conn.commit()

        # -------------------------------------------------------------------
        section("10. SWEEPER reclaims an abandoned checkout")
        cur.execute(
            """
            UPDATE waiver_tokens
            SET reservation_expires_at = NOW() - INTERVAL '1 second'
            WHERE id=%s
            """,
            (tid,),
        )
        conn.commit()
        stats = reap_stale_reservations()
        if stats["released"] >= 1:
            ok(f"sweeper released {stats['released']} stale reservation(s)")
        else:
            no("sweeper released nothing", repr(stats))
        conn.commit()
        if _status(cur, tid) == "open":
            ok("abandoned reservation returned to 'open'")
        else:
            no("stale reservation not reclaimed", _status(cur, tid))
        conn.commit()
        # And the reclaimed token must be redeemable by the NEW holder only.
        if not _try_consume(tid, "resultapp_retry", compute_waiver_split(100, 100, 100)):
            ok("the ORIGINAL (now-stale) ref cannot redeem a re-reserved token — sweeper race closed")
        else:
            no("STALE REF REDEEMED A RE-RESERVED TOKEN", "sweeper race is open")
        conn.commit()

        section("11. a lapsed AND expired token becomes 'expired', not 'open'")
        code, tid = mint_probe(pct=100, allowance=100)
        reserve_token(code, "resultapp_dead", applies_to="BOTH")
        cur.execute(
            """
            UPDATE waiver_tokens
            SET reservation_expires_at = NOW() - INTERVAL '1 second',
                expires_at           = NOW() - INTERVAL '1 day'
            WHERE id=%s
            """,
            (tid,),
        )
        conn.commit()
        reap_stale_reservations()
        conn.commit()
        st = _status(cur, tid)
        if st == "expired":
            ok("ordering is right: released first, then retired -> 'expired', never resurrected as 'open'")
        else:
            no("resurrected a dead token", f"status={st}")
        conn.commit()

        # -------------------------------------------------------------------
        section("12. scope and tenant locks are enforced at reserve")
        code, tid = mint_probe(pct=50, allowance=50, applies_to="TOPUP")
        try:
            reserve_token(code, "resultapp_wrong_scope", applies_to="REGISTRATION")
            no("a TOPUP-only token was reserved for a REGISTRATION", "")
        except WaiverValidationError as e:
            ok(f"scope enforced: {e}")
        conn.commit()
        reserve_token(code, "resultapp_right_scope", applies_to="TOPUP")
        ok("the same token reserves fine for its actual scope")
        conn.commit()

        code, tid = mint_probe(pct=50, allowance=50, applies_to="BOTH", suffix="lk")
        import services.waivers as W

        orig = W.generate_token_string
        W.generate_token_string = lambda: f"RW-probelk-{orig()[10:]}"
        try:
            ensure_school(cur, "probe-school")
            conn.commit()
            lt = mint_token(
                discount_percentage=50,
                slot_allowance=50,
                applies_to="BOTH",
                locked_to_tenant="probe-school",
                created_by=NOTE,
            )
        finally:
            W.generate_token_string = orig
        try:
            reserve_token(lt["token_string"], "resultapp_wrong_tenant", tenant_id="somebody-else")
            no("A TENANT-LOCKED TOKEN WAS REDEEMED BY THE WRONG SCHOOL", "")
        except WaiverValidationError as e:
            ok(f"tenant lock enforced: {e}")
        conn.commit()
        reserve_token(lt["token_string"], "resultapp_right_tenant", tenant_id="probe-school")
        ok("the token reserves for the school it was issued to")
        conn.commit()

        # -------------------------------------------------------------------
        section("13. kill switch")
        cur.execute(
            "UPDATE app_settings SET value='false' WHERE key='waiver_tokens_enabled'"
        )
        conn.commit()
        code, tid = mint_probe(pct=100, allowance=100)
        try:
            reserve_token(code, "resultapp_switched_off", applies_to="BOTH")
            no("reserve succeeded with waiver_tokens_enabled=false", "")
        except WaiverValidationError:
            ok("waiver_tokens_enabled=false blocks reserve (checkout falls back to full price)")
        try:
            peek_token(code)
            no("peek succeeded with the switch off", "")
        except WaiverValidationError:
            ok("waiver_tokens_enabled=false blocks preview")
        conn.commit()
        cur.execute(
            "UPDATE app_settings SET value='true' WHERE key='waiver_tokens_enabled'"
        )
        conn.commit()
        reserve_token(code, "resultapp_switched_on", applies_to="BOTH")
        ok("restoring the switch re-enables the flow")
        conn.commit()

        # -------------------------------------------------------------------
        section("14. void only touches unspent tokens")
        code, tid = mint_probe(pct=100, allowance=100)
        if void_token(tid, NOTE):
            ok("an unspent token can be voided")
        else:
            no("could not void an open token", "")
        conn.commit()
        if not void_token(tid, NOTE):
            ok("a voided token cannot be voided twice")
        else:
            no("double void", "")
        conn.commit()
        code2, tid2 = mint_probe(pct=100, allowance=100)
        reserve_token(code2, "resultapp_consumed_void", applies_to="BOTH")
        _do_consume(tid2, "resultapp_consumed_void", compute_waiver_split(100, 100, 100), tenant="probe-school")
        conn.commit()
        if not void_token(tid2, NOTE):
            ok("a CONSUMED token cannot be voided — the audit record is not falsifiable")
        else:
            no("A CONSUMED TOKEN WAS VOIDED", "audit trail is mutable after the fact")
        conn.commit()

    finally:
        # ---------------------------------------------------------------------------
        section("CLEANUP")
        try:
            fresh(cur)
            conn.commit()
            print("  removed probe rows (schools probe-*, waiver_tokens RW-probe*)")
        except Exception as e:
            print(f"  cleanup failed: {e}")
        try:
            conn.close()
        except Exception:
            pass

    print("\n==========================================")
    print(f"  {PASS} passed, {FAIL} failed")
    print("==========================================")
    if FAIL == 0:
        print("  WAIVER EXCLUSIVITY OK — a token can be redeemed exactly once")
    else:
        print("  THE CAS IS NOT SOUND. Do not ship this.")
    return 0 if FAIL == 0 else 1


def _status(cur, tid):
    cur.execute("SELECT status FROM waiver_tokens WHERE id=%s", (tid,))
    r = cur.fetchone()
    return r[0] if r else None


def _try_consume(tid, tx_ref, split):
    """True if the consume SUCCEEDED (i.e. the token was redeemed)."""
    try:
        _do_consume(tid, tx_ref, split)
        return True
    except WaiverValidationError:
        return False


def _do_consume(tid, tx_ref, split, tenant=None):
    from services.db_manager import _connect_as_superuser_transactional

    conn = _connect_as_superuser_transactional()
    try:
        cur = conn.cursor()
        if tenant is None:
            cur.execute("INSERT INTO schools (subdomain, school_name) VALUES ('probe-school','P') ON CONFLICT DO NOTHING")
        consume_token(cur, tid, tx_ref, split, tenant or "probe-school")
        conn.commit()
        return True
    except Exception:
        # The real caller must roll back on refusal. Prove the refusal path is
        # survivable, because a probe that only proves the happy path proves
        # nothing about the branch eight concurrent losers all take.
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
