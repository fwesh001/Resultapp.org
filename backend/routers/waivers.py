"""
Waiver token HTTP surface.

Two routers with deliberately different trust levels:

    waiver_admin   /api/v1/admin/waivers   superadmin lifecycle (list/mint/void)
    waiver_public  /api/v1/waiver          checkout (preview/reserve/release)

WHY THEY ARE SEPARATE
---------------------
The public half is reachable without a superadmin session — a school typing a
code at checkout has no session and cannot have one. That makes it the
untrusted surface of the whole feature, and it is where the two things that
actually matter live: the token's terms (preview) and its reservation (reserve).

Both are rate limited. A waiver token is a bearer credential with cash value,
and preview is a public endpoint that reports whether a guessed code exists and
what it is worth. Without a throttle that is a free oracle for brute-forcing
codes at whatever rate the network allows.


WHY PREVIEW IS ITS OWN ENDPOINT AND NOT A FIELD ON HOLD
-------------------------------------------------------
It is read-only by construction. `peek_token()` cannot mutate a row, so
retyping a code in the wizard renders the same breakdown forever and never
consumes the school's entitlement. Anything that reserved as a side effect of
being looked at would be a trap: the customer reads a price, goes to make tea,
comes back, and their code is gone.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

_logger = logging.getLogger(__name__)


async def _verify_secret(x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY")):
    """Same shared-secret check as main.verify_api_secret (lazy, no cycle)."""
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        import os as _os
        from fastapi import status as _status

        api_secret = _os.getenv("API_SECRET_KEY", "")
        env = _os.getenv("ENV", "production")
        if not api_secret:
            if env != "production":
                return True
            raise HTTPException(
                status_code=_status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfigured: API_SECRET_KEY not set",
            )
        if not x_api_secret_key:
            raise HTTPException(status_code=_status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, api_secret):
            raise HTTPException(status_code=_status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


async def _verify_superadmin_secret(x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY")):
    """Superadmin guard — identical to routers/admin.py's, kept local to avoid
    a cross-router import at module load."""
    try:
        from routers.admin import _verify_superadmin_secret as _inner

        return await _inner(x_api_secret_key)
    except HTTPException:
        raise
    except Exception:
        return await _verify_secret(x_api_secret_key)


waiver_admin = APIRouter(
    prefix="/api/v1/admin/waivers",
    tags=["waivers"],
    dependencies=[Depends(_verify_superadmin_secret)],
)
waiver_public = APIRouter(
    prefix="/api/v1/waiver",
    tags=["waivers"],
    dependencies=[Depends(_verify_secret)],
)


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

#: A school retyping a code, or pasting the wrong one twice, is normal. Ten a
#: minute is well clear of that and still far too slow to grind a 144-bit code.
_PREVIEW_MAX_HITS = 10
_PREVIEW_WINDOW_S = 60
#: Reserving is heavier and rarer. Tight, because an attacker who can reserve
#: can hold a code hostage — though only for RESERVATION_TTL_SECONDS, after
#: which the sweeper returns it.
_RESERVE_MAX_HITS = 6


def _throttle(scope: str, key: str, max_hits: int, window_s: int) -> None:
    from services.rate_limit import check

    allowed, retry_after = check(f"waiver:{scope}:{key}", max_hits=max_hits, window_s=window_s)
    if not allowed:
        _logger.warning(f"[waiver] throttled {scope} for '{key}' ({retry_after}s)")
        raise HTTPException(
            status_code=429,
            detail=f"Too many attempts. Try again in {retry_after} seconds.",
        )


def _caller_key(x_forwarded_for: Optional[str], fallback: str = "anon") -> str:
    return (x_forwarded_for or fallback).split(",")[0].strip()[:64] or "anon"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class MintWaiverRequest(BaseModel):
    discount_percentage: int = Field(..., ge=1, le=100)
    slot_allowance: int = Field(..., ge=1, le=10000)
    applies_to: str = Field("BOTH", description="REGISTRATION | TOPUP | BOTH")
    locked_to_tenant: Optional[str] = Field(None, max_length=60)
    restores_suspension: bool = False
    ttl_days: int = Field(30, ge=1, le=365)
    note: Optional[str] = Field(None, max_length=500)
    #: Forwarded from lib/superadminAuth.readSuperadminIdentity(). The backend
    #: CANNOT verify this: /api/v1/admin/* is guarded solely by the shared
    #: secret, so anyone holding it could impersonate any superadmin. It is an
    #: attestation from a trusted caller, not an authenticated identity.
    created_by: str = Field("superadmin", max_length=120)


class PreviewWaiverRequest(BaseModel):
    token_string: str = Field(..., min_length=1, max_length=128)
    requested_slots: int = Field(..., ge=1, le=10000)
    applies_to: str = Field("BOTH")
    tenant_id: Optional[str] = Field(None, max_length=60)


class ReserveWaiverRequest(BaseModel):
    token_string: str = Field(..., min_length=1, max_length=128)
    #: The checkout reference this reservation will be redeemed under. For
    #: registration this is the pending_registrations tx_ref.
    tx_ref: str = Field(..., min_length=1, max_length=128)
    applies_to: str = Field("BOTH")
    tenant_id: Optional[str] = Field(None, max_length=60)


class ReleaseWaiverRequest(BaseModel):
    token_id: int = Field(..., ge=1)
    tx_ref: str = Field(..., min_length=1, max_length=128)


class QuoteWaiverRequest(BaseModel):
    token_id: int = Field(..., ge=1)
    #: Proof that this caller owns the reservation. Paired with the id, so a
    #: sequential-id guess gets nothing: without the matching ref the caller
    #: has not held this token and is not told its terms.
    reservation_tx_ref: str = Field(..., min_length=1, max_length=128)
    requested_slots: int = Field(..., ge=1, le=10000)


class VoidWaiverRequest(BaseModel):
    created_by: str = Field("superadmin", max_length=120)


# ---------------------------------------------------------------------------
# Admin lifecycle
# ---------------------------------------------------------------------------


@waiver_admin.post("", summary="Mint a waiver token (superadmin)")
def mint_waiver_token(body: MintWaiverRequest):
    """Issue a token. The plaintext is in the response ONCE and never stored."""
    from services.waivers import WaiverValidationError, mint_token

    try:
        return {
            "success": True,
            "token": mint_token(
                discount_percentage=body.discount_percentage,
                slot_allowance=body.slot_allowance,
                applies_to=body.applies_to,
                locked_to_tenant=body.locked_to_tenant,
                restores_suspension=body.restores_suspension,
                created_by=body.created_by,
                note=body.note,
                ttl_days=body.ttl_days,
            ),
        }
    except WaiverValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _logger.exception(f"[waiver] mint failed: {e}")
        raise HTTPException(status_code=500, detail="Could not create the waiver token")


@waiver_admin.get("", summary="List waiver tokens (superadmin)")
def list_waiver_tokens(
    status: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
):
    """Newest first. Never returns token_hash — it is not needed to audit."""
    from services.db_manager import WAIVER_TOKENS_TABLE, _connect_as_superuser

    lim = max(1, min(int(limit or 20), 200))
    off = max(0, int(offset or 0))
    st = (status or "").strip().lower() or None
    if st and st not in ("open", "reserved", "consumed", "voided", "expired"):
        raise HTTPException(status_code=400, detail=f"status must be one of open|reserved|consumed|voided|expired")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        where = "WHERE status = %s" if st else ""
        args = [st] if st else []
        cur.execute(
            f"""
            SELECT id, token_prefix, token_fingerprint, discount_percentage,
                   slot_allowance, applies_to, locked_to_tenant, restores_suspension,
                   status, is_used, expires_at, created_by, created_at, note,
                   slots_requested, slots_waived, slots_forfeited, discount_ngn,
                   charged_slots, charged_ngn, used_by_tenant, used_at, transaction_ref
            FROM {WAIVER_TOKENS_TABLE}
            {where}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s;
            """,
            (*args, lim, off),
        )
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        cur.execute(f"SELECT COUNT(*) FROM {WAIVER_TOKENS_TABLE} {where};", tuple(args))
        total = int(cur.fetchone()[0] or 0)
        for r in rows:
            for k in ("expires_at", "created_at", "used_at"):
                if r.get(k) is not None:
                    r[k] = str(r[k])
        return {"success": True, "tokens": rows, "total": total, "limit": lim, "offset": off}
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception(f"[waiver] list failed: {e}")
        raise HTTPException(status_code=500, detail="Could not list waiver tokens")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@waiver_admin.get("/{token_id}", summary="Full audit row for one token (superadmin)")
def get_waiver_token(token_id: int):
    from services.waivers import get_token

    row = get_token(token_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No such waiver token")
    return {"success": True, "token": row}


@waiver_admin.post("/{token_id}/void", summary="Cancel an unspent token (superadmin)")
def void_waiver_token(token_id: int, body: VoidWaiverRequest):
    """Only 'open' tokens can be voided.

    A reserved token is mid-checkout and returns to open on its own; a consumed
    one is a historical record, and rewriting it would be falsifying the audit
    trail rather than correcting it.
    """
    from services.waivers import void_token

    if not void_token(token_id, body.created_by):
        raise HTTPException(
            status_code=409,
            detail="Only an unspent (open) token can be voided. A reserved token "
            "returns to the pool on its own, and a consumed token is a permanent record.",
        )
    return {"success": True, "id": token_id, "status": "voided"}


@waiver_admin.post("/reap", summary="Reap stale reservations now (superadmin)")
def reap_waivers():
    """The same sweep that runs on boot, exposed so an operator can reclaim a
    token after a bad deploy without waiting for a restart."""
    from services.waivers import reap_stale_reservations

    return {"success": True, **reap_stale_reservations()}


# ---------------------------------------------------------------------------
# Checkout surface (untrusted caller, rate limited)
# ---------------------------------------------------------------------------


@waiver_public.post("/preview", summary="Read a token's terms WITHOUT reserving it")
def preview_waiver(
    body: PreviewWaiverRequest,
    x_forwarded_for: Optional[str] = Header(None, alias="X-Forwarded-For"),
):
    """Stateless. Returns the split for a given slot count.

    Mutating this would be a trap: the school reads a price, comes back later,
    and finds their code burned by having looked at it.
    """
    from services.waivers import (
        WaiverValidationError,
        compute_waiver_split,
        peek_token,
        waivers_enabled,
    )

    if not waivers_enabled():
        raise HTTPException(status_code=503, detail="Waiver codes are not available right now")

    _throttle("preview", _caller_key(x_forwarded_for), _PREVIEW_MAX_HITS, _PREVIEW_WINDOW_S)

    try:
        terms = peek_token(body.token_string)
    except WaiverValidationError as e:
        raise HTTPException(status_code=404, detail=str(e))

    scope = (body.applies_to or "BOTH").strip().upper()
    if terms["applies_to"] not in ("BOTH", scope):
        raise HTTPException(
            status_code=409,
            detail=f"This code is only valid for {terms['applies_to'].lower()} purchases",
        )
    tenant = (body.tenant_id or "").strip().lower() or None
    if terms["locked_to_tenant"] and tenant and terms["locked_to_tenant"] != tenant:
        raise HTTPException(status_code=409, detail="This code was issued to a different school")

    try:
        split = compute_waiver_split(
            requested_slots=body.requested_slots,
            slot_allowance=terms["slot_allowance"],
            discount_percentage=terms["discount_percentage"],
        )
    except WaiverValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "success": True,
        "token_id": terms["id"],
        "discount_percentage": terms["discount_percentage"],
        "slot_allowance": terms["slot_allowance"],
        "applies_to": terms["applies_to"],
        "locked_to_tenant": terms["locked_to_tenant"],
        "expires_at": str(terms["expires_at"]) if terms["expires_at"] else None,
        "split": split,
    }


@waiver_public.post("/reserve", summary="Claim a token for one checkout")
def reserve_waiver(
    body: ReserveWaiverRequest,
    x_forwarded_for: Optional[str] = Header(None, alias="X-Forwarded-For"),
):
    """open -> reserved. The compare-and-swap that stops a token being spent twice.

    Must happen BEFORE checkout opens, not after payment, or two tabs can both
    pay and only one will end up holding the entitlement.
    """
    from services.waivers import WaiverValidationError, reserve_token, waivers_enabled

    if not waivers_enabled():
        raise HTTPException(status_code=503, detail="Waiver codes are not available right now")

    _throttle("reserve", _caller_key(x_forwarded_for), _RESERVE_MAX_HITS, _PREVIEW_WINDOW_S)

    try:
        return {
            "success": True,
            "reservation": reserve_token(
                body.token_string,
                body.tx_ref,
                applies_to=body.applies_to,
                tenant_id=body.tenant_id,
            ),
        }
    except WaiverValidationError as e:
        # 409, not 404: the code exists and is not available. The distinction
        # is safe to make because preview already returned 404 for codes that
        # do not exist at all.
        raise HTTPException(status_code=409, detail=str(e))


@waiver_public.post("/quote", summary="Split for a token THIS checkout already holds")
def quote_waiver(body: QuoteWaiverRequest):
    """The split for a reservation the caller already owns. Read-only.

    WHY THIS EXISTS RATHER THAN REUSING /preview
    ----------------------------------------------
    `peek_token()` refuses a token in the 'reserved' state, because from the
    outside an unverified caller must not be able to read a held code's terms.
    But the checkout that DID reserve it legitimately needs the split again, at
    the moment it verifies the Flutterwave charge against it.

    Without this, the top-up path would have to verify the payment BEFORE
    knowing what it should be — which means either charging against the
    undiscounted list price and silently under-refunding, or trusting a
    client-supplied "expected" number. Both are worse than one more endpoint.

    The reservation_tx_ref is the proof of ownership. Ids are sequential and
    guessable; refs are minted by the caller's own checkout, so holding both is
    what makes this safe to expose unauthenticated.
    """
    from services.db_manager import _connect_as_superuser
    from services.waivers import (
        WaiverValidationError,
        compute_waiver_split,
        reservation_match_sql,
        waivers_enabled,
    )

    if not waivers_enabled():
        raise HTTPException(status_code=503, detail="Waiver codes are not available right now")

    _throttle("quote", f"token:{body.token_id}", 30, _PREVIEW_WINDOW_S)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Same two-part predicate consume_token uses, so a quote and a burn can
        # never disagree about who owns the reservation.
        cur.execute(
            reservation_match_sql(),
            (body.token_id, body.reservation_tx_ref),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=409, detail="That waiver code is not available")

        term_id, pct, allowance = int(row[0]), int(row[1]), int(row[2])
        try:
            split = compute_waiver_split(
                requested_slots=body.requested_slots,
                slot_allowance=allowance,
                discount_percentage=pct,
            )
        except WaiverValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "token_id": term_id, "split": split}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@waiver_public.post("/release", summary="Return an abandoned reservation to the pool")
def release_waiver(body: ReleaseWaiverRequest):
    """reserved -> open. Scoped to the reservation's own tx_ref, so a cancelled
    tab cannot free a token that a different checkout is about to redeem."""
    from services.waivers import release_token

    released = release_token(body.token_id, body.tx_ref)
    return {"success": True, "released": released}
