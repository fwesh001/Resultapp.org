#!/usr/bin/env python3
"""
waiver-rollback-probe — proves a token burn and its slot grant are one atomic
unit, on the two endpoints that can actually spend one.

THE CLAIM UNDER TEST
--------------------
The waiver token is consumed inside the same transaction that grants the slots
and writes the ledger. Therefore:

  * if the slot grant fails, the token is NOT consumed — the customer gets
    their code back and can retry, and the school is not left holding a spent
    token for seats nobody received;
  * if a ledger write fails, same;
  * if the whole thing succeeds, the token IS consumed and the seats exist.

"Atomic" is not a property you can assert in prose. It has to be shown by
failing the real code path and then looking at the database.

HOW THE FAILURE IS INJECTED
---------------------------
A real PostgreSQL trigger that raises, scoped to subdomains beginning `probe-`.
Deliberately NOT a mock and NOT a monkeypatched cursor:

  * A mocked connection would prove the mock rolls back.
  * Deliberately breaking the code under test would prove nothing about the
    code that ships.
  * A trigger fails the statement at the database, which is the only layer that
    can prove the ROLLBACK reached the token row.

The trigger is dropped in the cleanup, so a crashed run cannot leave one behind
armed against a real tenant.

Usage:
    PG_HOST=... PG_PORT=... PG_SUPERUSER=... PG_SUPERUSER_DB=... \
        python3 scripts/waiver-rollback-probe.py
"""

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_BACKEND = str(_ROOT / "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import logging  # noqa: E402

logging.disable(logging.CRITICAL)

from fastapi import HTTPException  # noqa: E402

PASS = 0
FAIL = 0


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


def section(t):
    print(f"\n=== {t} ===")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def conn_new():
    from services.db_manager import _connect_as_superuser_transactional

    return _connect_as_superuser_transactional()


def q1(sql, args=None):
    c = conn_new()
    try:
        cur = c.cursor()
        cur.execute(sql, args) if args is not None else cur.execute(sql)
        row = cur.fetchone()
        c.rollback()
        return row
    finally:
        c.close()


def qa(sql, args=None):
    c = conn_new()
    try:
        cur = c.cursor()
        cur.execute(sql, args) if args is not None else cur.execute(sql)
        rows = cur.fetchall()
        c.rollback()
        return rows
    finally:
        c.close()


def exec_(sql, args=None):
    c = conn_new()
    try:
        cur = c.cursor()
        # None, never (): psycopg2 only skips `%` interpolation when vars is
        # exactly None. Passing an empty tuple switches interpolation ON, and
        # every `LIKE 'probe-%'` in this file then dies with a confusing
        # "tuple index out of range".
        cur.execute(sql, args) if args is not None else cur.execute(sql)
        c.commit()
    finally:
        c.close()


def token_row(tid):
    return q1(
        "SELECT status, reservation_tx_ref, slots_waived, slots_forfeited, "
        "discount_ngn, charged_slots, charged_ngn, used_by_tenant "
        "FROM waiver_tokens WHERE id=%s",
        (tid,),
    )


def balance(sub):
    r = q1("SELECT COALESCE(slots_balance,0) FROM schools WHERE subdomain=%s", (sub,))
    return int(r[0]) if r else None


def ledger_rows(sub):
    return qa(
        "SELECT transaction_type, amount, amount_ngn, reference_id FROM billing_ledger "
        "WHERE subdomain=%s ORDER BY id",
        (sub,),
    )


def mrr():
    """Exactly the expression platform_stats() uses."""
    r = q1(
        "SELECT COALESCE(SUM(amount_ngn),0) FROM billing_ledger "
        "WHERE transaction_type IN ('CREDIT_PURCHASE','SLOT_PURCHASE') "
        "AND subdomain NOT LIKE 'demo-%'"
    )
    return int(r[0] or 0)


def make_school(sub, slots=0, active=True, status="active", reason=None):
    exec_(
        """
        INSERT INTO schools (subdomain, school_name, slots_balance, is_active,
                             subscription_status, suspension_reason)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (subdomain) DO UPDATE
            SET slots_balance=EXCLUDED.slots_balance, is_active=EXCLUDED.is_active,
                subscription_status=EXCLUDED.subscription_status,
                suspension_reason=EXCLUDED.suspension_reason
        """,
        (sub, "Rollback Probe School", slots, active, status, reason),
    )


def install_trigger(table, timing, when_prefix="probe-"):
    """Arm a fault injector. Returns the trigger name so cleanup can drop it.

    Built entirely as literals, with NO psycopg2 parameters. Two reasons:

      * psycopg2's `%` interpolation scans the whole query string including
        inside `$$ ... $$`, so mixing bind params with a dollar-quoted PL/pgSQL
        body is a quoting minefield.
      * `when_prefix` ends in `%` for the LIKE. With no params passed,
        psycopg2 does no interpolation at all and the literal survives intact.

    `when_prefix` is a test constant, never user input, so inlining it here is
    safe and is not the kind of thing this helper would ever be given.
    """
    fn = f"probe_boom_{table}"
    exec_(
        f"""
        CREATE OR REPLACE FUNCTION {fn}() RETURNS trigger AS $probe$
        BEGIN
            IF NEW.subdomain LIKE '{when_prefix}%' THEN
                RAISE EXCEPTION 'injected failure on {table}.{timing}';
            END IF;
            RETURN NEW;
        END;
        $probe$ LANGUAGE plpgsql;
        """
    )
    tg = f"t_probe_boom_{table}"
    exec_(
        f"CREATE TRIGGER {tg} BEFORE {timing} ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION {fn}();"
    )
    return tg


def drop_trigger(table):
    for stmt in (
        f"DROP TRIGGER IF EXISTS t_probe_boom_{table} ON {table};",
        f"DROP FUNCTION IF EXISTS probe_boom_{table}();",
    ):
        try:
            exec_(stmt)
        except Exception:
            pass


def mint(pct, allowance, applies_to="BOTH"):
    import services.waivers as W

    orig = W.generate_token_string
    W.generate_token_string = lambda: f"RW-rbprobe-{orig()[10:]}"
    try:
        return W.mint_token(
            discount_percentage=pct,
            slot_allowance=allowance,
            applies_to=applies_to,
            created_by="rollback-probe",
            note="waiver-rollback-probe",
        )
    finally:
        W.generate_token_string = orig


def reserve(code, ref, scope="BOTH", tenant=None):
    from services.waivers import reserve_token

    return reserve_token(code, ref, applies_to=scope, tenant_id=tenant)


def cleanup():
    for t in ("schools", "billing_ledger"):
        drop_trigger(t)
    exec_("DELETE FROM waiver_tokens WHERE token_prefix LIKE 'RW-rbprobe%'")
    exec_("DELETE FROM billing_ledger WHERE subdomain LIKE 'probe-%'")
    exec_("DELETE FROM audit_logs WHERE subdomain LIKE 'probe-%'")
    exec_("DELETE FROM credit_ledger WHERE subdomain LIKE 'probe-%'")
    exec_("DELETE FROM pending_registrations WHERE subdomain LIKE 'probe-%'")
    exec_("DELETE FROM schools WHERE subdomain LIKE 'probe-%'")


# ---------------------------------------------------------------------------

_PROVISION_CALLED = []


def _stub_out_network():
    """Silence the best-effort side effects so the test is about SQL.

    Welcome email, Vercel domain registration and the notification fan-out all
    fire inside provision_school and all swallow their own errors. Left alone
    they turn a transaction test into a network test with unpredictable timeouts
    — and a DNS lookup that succeeds would make the run depend on the internet.
    """
    import main as M

    M.send_welcome_email = lambda **kw: True
    M.send_failure_alert = lambda **kw: True
    try:
        import services.notifications as N

        N.dispatch_event = lambda *a, **k: None
    except Exception:
        pass
    try:
        import services.vercel_domains as V

        V.start_domain_verification = lambda sub: {
            "configured": True,
            "success": True,
            "added": True,
            "verified": True,
        }
    except Exception:
        pass


class _Req:
    """Duck-typed Request. provision_school only reads request.client."""

    client = None


def provision(payload_dict):
    import main as M

    from main import ProvisionRequest

    payload = ProvisionRequest(**payload_dict)
    import asyncio

    return asyncio.run(M.provision_school(payload, _Req()))


def waived_topup(sub, **kw):
    from routers.credits import WaivedSlotTopUpRequest, topup_slots_with_waiver

    payload = WaivedSlotTopUpRequest(**kw)
    return topup_slots_with_waiver(sub, payload)


# ---------------------------------------------------------------------------


def main():
    from services.db_manager import init_consent_tables, init_schools_registry

    # Must happen before any provision() call: the network side effects inside
    # provision_school are best-effort, so they will not raise, they will just
    # hang on DNS and make a SQL test depend on the internet.
    _stub_out_network()
    init_schools_registry()
    # register_school() writes schools + tenant_consents in one transaction, so
    # provision needs both tables.
    init_consent_tables()
    cleanup()

    try:
        # ===================================================================
        section("1. split bill, happy path (the baseline everything else compares to)")
        make_school("probe-split", slots=100)
        t = mint(pct=100, allowance=50)
        reserve(t["token_string"], "rb_split")
        before_mrr = mrr()
        res = waived_topup(
            "probe-split",
            waiver_token_id=t["id"],
            reservation_tx_ref="rb_split",
            requested_slots=70,
            transaction_id="flw-rb-split",
            amount_ngn=2000,
        )
        if res["slots_balance"] == 170:
            ok(f"70 slots added to a 100-slot tenant -> balance {res['slots_balance']}")
        else:
            no("balance wrong", str(res))
        if balance("probe-split") == 170:
            ok("slots_balance committed in the database")
        else:
            no("slots_balance not persisted", str(balance("probe-split")))
        row = token_row(t["id"])
        if row and row[0] == "consumed":
            ok("token consumed")
        else:
            no("token not consumed", str(row))
        if row and row[2:8] == (50, 0, 5000, 20, 2000, "probe-split"):
            ok(f"audit: 50 waived / 0 forfeited / NGN 5000 off / 20 charged / tenant recorded")
        else:
            no("audit fields wrong", str(row))
        lr = ledger_rows("probe-split")
        types = {r[0]: r for r in lr}
        if "SLOT_PURCHASE" in types and types["SLOT_PURCHASE"][2] == 2000:
            ok("SLOT_PURCHASE row carries NGN 2000 (the money actually taken)")
        else:
            no("paid row wrong", str(types.get("SLOT_PURCHASE")))
        if "SLOT_WAIVER" in types and types["SLOT_WAIVER"][1] == 50 and types["SLOT_WAIVER"][2] == 0:
            ok("SLOT_WAIVER row carries 50 slots at NGN 0")
        else:
            no("waiver row wrong", str(types.get("SLOT_WAIVER")))
        if mrr() - before_mrr == 2000:
            ok("MRR moved by exactly NGN 2000 — the discount is invisible to revenue")
        else:
            no("MRR drifted", f"delta={mrr() - before_mrr}")

        # ===================================================================
        section("2. THE CLAIM: slot UPDATE fails -> token is NOT consumed")
        make_school("probe-failupd", slots=10)
        t2 = mint(pct=100, allowance=40)
        reserve(t2["token_string"], "rb_failupd")
        before_bal = balance("probe-failupd")
        before_mrr = mrr()
        install_trigger("schools", "UPDATE")
        try:
            try:
                waived_topup(
                    "probe-failupd",
                    waiver_token_id=t2["id"],
                    reservation_tx_ref="rb_failupd",
                    requested_slots=60,
                    transaction_id="flw-rb-failupd",
                    amount_ngn=2000,
                )
                no("the injected failure did NOT stop the top-up", "trigger never fired")
            except HTTPException as e:
                if e.status_code == 500:
                    ok(f"top-up refused with 500 (injected failure): {str(e.detail)[:60]}")
                else:
                    no(f"unexpected status {e.status_code}", str(e.detail))
        finally:
            drop_trigger("schools")

        row = token_row(t2["id"])
        if row and row[0] == "reserved":
            ok("TOKEN ROLLED BACK to 'reserved' — the customer's code is intact")
        elif row and row[0] == "consumed":
            no("TOKEN WAS BURNED despite the rollback", str(row))
        else:
            no("token in an unexpected state", str(row))
        if row and row[1] == "rb_failupd":
            ok("reservation ref intact, so the checkout can retry the same code")
        else:
            no("reservation ref lost", str(row))
        if balance("probe-failupd") == before_bal:
            ok(f"slots_balance unchanged at {before_bal} — no phantom seats")
        else:
            no("SLOTS WERE GRANTED on a rolled-back transaction", str(balance("probe-failupd")))
        if ledger_rows("probe-failupd") == []:
            ok("no ledger rows written — the paid row rolled back too")
        else:
            no("LEDGER ROWS SURVIVED the rollback", str(ledger_rows("probe-failupd")))
        if mrr() == before_mrr:
            ok("MRR untouched")
        else:
            no("MRR moved on a failed transaction", str(mrr() - before_mrr))

        section("2b. the released token is immediately retryable")
        try:
            res = waived_topup(
                "probe-failupd",
                waiver_token_id=t2["id"],
                reservation_tx_ref="rb_failupd",
                requested_slots=60,
                transaction_id="flw-rb-failupd-retry",
                amount_ngn=2000,
            )
            if balance("probe-failupd") == before_bal + 60 and token_row(t2["id"])[0] == "consumed":
                ok(f"retry succeeded: balance {res['slots_balance']}, token now consumed")
            else:
                no("retry did not complete cleanly", f"{res} {token_row(t2['id'])}")
        except HTTPException as e:
            no("retry after rollback failed", str(e.detail))

        # ===================================================================
        section("3. ledger INSERT fails -> token is NOT consumed")
        make_school("probe-failins", slots=10)
        t3 = mint(pct=50, allowance=40)
        reserve(t3["token_string"], "rb_failins")
        before_bal = balance("probe-failins")
        install_trigger("billing_ledger", "INSERT")
        try:
            try:
                waived_topup(
                    "probe-failins",
                    waiver_token_id=t3["id"],
                    reservation_tx_ref="rb_failins",
                    requested_slots=60,
                    transaction_id="flw-rb-failins",
                    amount_ngn=3000,
                )
                no("the injected failure did NOT stop the top-up", "trigger never fired")
            except HTTPException:
                ok("top-up refused (injected ledger failure)")
        finally:
            drop_trigger("billing_ledger")
        row = token_row(t3["id"])
        if row and row[0] == "reserved":
            ok("TOKEN ROLLED BACK to 'reserved'")
        else:
            no("token not rolled back", str(row))
        if balance("probe-failins") == before_bal and ledger_rows("probe-failins") == []:
            ok("no slots and no ledger rows survived")
        else:
            no("partial write leaked", f"bal={balance('probe-failins')} rows={ledger_rows('probe-failins')}")

        # ===================================================================
        section("4. provision path: slot UPDATE fails -> token is NOT consumed")
        t4 = mint(pct=100, allowance=50)
        reserve(t4["token_string"], "rb_prov")
        install_trigger("schools", "UPDATE")
        try:
            resp = provision(
                dict(
                    school_name="Rollback Probe School",
                    subdomain="probe-prov",
                    admin_email="probe@resultapp.org",
                    admin_name="Probe Admin",
                    admin_password="ProbePassword123!",
                    student_count=70,
                    transaction_id="flw-rb-prov",
                    amount_ngn=2000,
                    terms_version="1.0",
                    privacy_version="1.0",
                    accepted_terms=True,
                    waiver_token_id=t4["id"],
                    waiver_reservation_tx_ref="rb_prov",
                )
            )
        finally:
            drop_trigger("schools")
        if resp.slot_grant_error:
            ok(f"provision reported slot_grant_error instead of failing silently: {resp.slot_grant_error[:70]}")
        else:
            no("provision reported a clean success despite the failed grant", str(resp))
        row = token_row(t4["id"])
        if row and row[0] == "reserved":
            ok("TOKEN ROLLED BACK on the provision path too")
        else:
            no("provision consumed the token on a failed grant", str(row))
        if balance("probe-prov") in (0, None):
            ok(f"school exists with {balance('probe-prov')} slots — visible, not silent")
        else:
            no("slots granted on a rolled-back provision", str(balance("probe-prov")))
        if ledger_rows("probe-prov") == []:
            ok("no ledger rows written")
        else:
            no("ledger rows survived", str(ledger_rows("probe-prov")))

        # ===================================================================
        section("5. the 100% bypass takes no transaction at all")
        make_school("probe-bypass", slots=10)
        t5 = mint(pct=100, allowance=100)
        reserve(t5["token_string"], "rb_bypass")
        before_mrr = mrr()
        res = waived_topup(
            "probe-bypass",
            waiver_token_id=t5["id"],
            reservation_tx_ref="rb_bypass",
            requested_slots=80,
            # deliberately NO transaction_id and NO amount_ngn
        )
        if res["waiver"]["bypass_gateway"] is True and res["waiver"]["charged_ngn"] == 0:
            ok("bypass: charged NGN 0, gateway correctly reported as bypassable")
        else:
            no("bypass flags wrong", str(res["waiver"]))
        if balance("probe-bypass") == 90:
            ok("80 free slots granted without a gateway")
        else:
            no("bypass balance wrong", str(balance("probe-bypass")))
        types = {r[0] for r in ledger_rows("probe-bypass")}
        if types == {"SLOT_WAIVER"}:
            ok("only a SLOT_WAIVER row written — no fake SLOT_PURCHASE")
        else:
            no("unexpected ledger shape", str(types))
        if mrr() == before_mrr:
            ok("MRR untouched by a fully-waived purchase")
        else:
            no("MRR moved on a bypass", str(mrr() - before_mrr))

        section("5b. a gateway charge on a fully-waived order is refused")
        make_school("probe-bypassbad", slots=10)
        t5b = mint(pct=100, allowance=100)
        reserve(t5b["token_string"], "rb_bypassbad")
        try:
            waived_topup(
                "probe-bypassbad",
                waiver_token_id=t5b["id"],
                reservation_tx_ref="rb_bypassbad",
                requested_slots=80,
                transaction_id="flw-should-not-exist",
            )
            no("a charge was accepted on a fully-waived order", "")
        except HTTPException as e:
            if e.status_code == 400:
                ok(f"refused 400: {e.detail}")
            else:
                no(f"unexpected status {e.status_code}", str(e.detail))
        if token_row(t5b["id"])[0] == "reserved":
            ok("token untouched by the refusal")

        # ===================================================================
        section("6. a partial waiver REQUIRES a transaction id")
        make_school("probe-notx", slots=10)
        t6 = mint(pct=50, allowance=30)
        reserve(t6["token_string"], "rb_notx")
        try:
            waived_topup(
                "probe-notx",
                waiver_token_id=t6["id"],
                reservation_tx_ref="rb_notx",
                requested_slots=60,
                # no transaction_id
            )
            no("A PARTIAL WAIVER GRANTED SLOTS WITH NO TRANSACTION ID", "")
        except HTTPException as e:
            if e.status_code == 400:
                ok(f"refused 400: {e.detail}")
            else:
                no(f"unexpected status {e.status_code}", str(e.detail))
        if balance("probe-notx") == 10 and token_row(t6["id"])[0] == "reserved":
            ok("no slots, no burn — refused before opening the transaction")

        # ===================================================================
        section("7. duplicate transaction id does not double-grant")
        make_school("probe-dup", slots=10)
        t7 = mint(pct=50, allowance=30)
        reserve(t7["token_string"], "rb_dup")
        first = waived_topup(
            "probe-dup",
            waiver_token_id=t7["id"],
            reservation_tx_ref="rb_dup",
            requested_slots=60,
            transaction_id="flw-rb-dup",
            amount_ngn=3000,
        )
        second = waived_topup(
            "probe-dup",
            waiver_token_id=t7["id"],
            reservation_tx_ref="rb_dup",
            requested_slots=60,
            transaction_id="flw-rb-dup",
            amount_ngn=3000,
        )
        if second.get("duplicate") is True:
            ok("second POST reported duplicate rather than re-granting")
        else:
            no("duplicate not detected", str(second))
        if balance("probe-dup") == 70:
            ok("balance moved exactly once (10 -> 70)")
        else:
            no("double grant", str(balance("probe-dup")))

        # ===================================================================
        section("8. a waiver must NOT lift a non-payment suspension")
        make_school("probe-susp", slots=10, active=False, status="suspended", reason="nonpayment")
        t8 = mint(pct=100, allowance=60)
        reserve(t8["token_string"], "rb_susp")
        waived_topup(
            "probe-susp",
            waiver_token_id=t8["id"],
            reservation_tx_ref="rb_susp",
            requested_slots=60,
        )
        act = q1("SELECT is_active, subscription_status FROM schools WHERE subdomain='probe-susp'")
        if act[0] is False:
            ok("a fully-waived purchase did NOT reactivate a non-payment suspension")
        else:
            no("A FREE WAIVER UN-SUSPENDED A DEADBEAT TENANT", str(act))

        make_school("probe-susp2", slots=10, active=False, status="suspended", reason="nonpayment")
        t9 = mint(pct=50, allowance=30)
        reserve(t9["token_string"], "rb_susp2")
        waived_topup(
            "probe-susp2",
            waiver_token_id=t9["id"],
            reservation_tx_ref="rb_susp2",
            requested_slots=60,
            transaction_id="flw-rb-susp2",
            amount_ngn=3000,
        )
        act2 = q1("SELECT is_active, subscription_status FROM schools WHERE subdomain='probe-susp2'")
        if act2[0] is True:
            ok("a real payment DOES restore a non-payment suspension")
        else:
            no("payment failed to restore", str(act2))

        make_school("probe-susp3", slots=10, active=False, status="suspended", reason="abuse")
        t10 = mint(pct=100, allowance=30)
        reserve(t10["token_string"], "rb_susp3")
        waived_topup(
            "probe-susp3",
            waiver_token_id=t10["id"],
            reservation_tx_ref="rb_susp3",
            requested_slots=60,
            transaction_id="flw-rb-susp3",
            amount_ngn=3000,
        )
        act3 = q1("SELECT is_active FROM schools WHERE subdomain='probe-susp3'")
        if act3[0] is False:
            ok("an 'abuse' suspension is still not liftable by paying or waiving")
        else:
            no("ABUSE SUSPENSION LIFTED", str(act3))

        # ===================================================================
        section("9. the free-credit exploit is closed")
        from services.db_manager import (
            FREE_CREDITS_MIN_STUDENTS,
            resolve_initial_credit_grant,
        )

        # Backwards compatibility: an un-updated caller must be unaffected.
        legacy = resolve_initial_credit_grant(600)
        if legacy == 30:
            ok(f"legacy call resolve_initial_credit_grant({600}) still grants 30 — rollout safe")
        else:
            no("legacy behaviour changed during rollout", str(legacy))

        full_waiver = resolve_initial_credit_grant(600, paid_slots=0)
        if full_waiver == 0:
            ok("100% waiver on 600 slots grants 0 free credits (was 30 — the exploit)")
        else:
            no("EXPLOT STILL OPEN", str(full_waiver))
        paid_enough = resolve_initial_credit_grant(600, paid_slots=FREE_CREDITS_MIN_STUDENTS)
        if paid_enough == 30:
            ok("a genuinely-paying 600-slot school still gets its 30 credits")
        else:
            no("paying schools lost their credits", str(paid_enough))
        threshold = resolve_initial_credit_grant(600, paid_slots=FREE_CREDITS_MIN_STUDENTS - 1)
        if threshold == 0:
            ok(f"one slot below the paid threshold ({FREE_CREDITS_MIN_STUDENTS - 1}) gets nothing")

        section("9b. end-to-end: a fully-waived registration gets slots but no credits")
        t11 = mint(pct=100, allowance=600)
        reserve(t11["token_string"], "rb_freecredit")
        resp = provision(
            dict(
                school_name="Rollback Probe School",
                subdomain="probe-freecredit",
                admin_email="probe2@resultapp.org",
                admin_name="Probe Admin",
                admin_password="ProbePassword123!",
                student_count=600,
                terms_version="1.0",
                privacy_version="1.0",
                accepted_terms=True,
                waiver_token_id=t11["id"],
                waiver_reservation_tx_ref="rb_freecredit",
            )
        )
        if resp.slot_grant_error:
            no(f"provision failed: {resp.slot_grant_error}")
        else:
            if balance("probe-freecredit") == 600:
                ok("600 free slots granted")
            else:
                no("slots wrong", str(balance("probe-freecredit")))
            cr = q1("SELECT COALESCE(credit_balance,0) FROM schools WHERE subdomain='probe-freecredit'")
            if int(cr[0]) == 0:
                ok("...and ZERO free publishing credits (the farming path is closed)")
            else:
                no("FREE-CREDIT FARM STILL WORKS", f"credit_balance={cr[0]}")
            if resp.waiver and resp.waiver["bypass_gateway"] is True:
                ok("response advertises bypass_gateway so the client skips Flutterwave")
            if token_row(t11["id"])[0] == "consumed":
                ok("token consumed on the successful bypass")

    finally:
        section("CLEANUP")
        cleanup()
        print("  triggers dropped, probe rows removed")

    print("\n==========================================")
    print(f"  {PASS} passed, {FAIL} failed")
    print("==========================================")
    if FAIL == 0:
        print("  ROLLBACK ATOMICITY OK — a token is only ever consumed")
        print("  when the seats it paid for actually land.")
    else:
        print("  THE BURN IS NOT ATOMIC WITH THE GRANT. Do not ship this.")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
