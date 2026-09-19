"""
Credit & Command — token ledger engine (platform owner: monetization core).

Prefix: /api/v1/tenant/{tenant_id}/credits
Auth:   shared X-API-SECRET-KEY (same trust boundary as admin router).

Rules:
- 1 credit = 1 published report card. Data entry, previews, drafts = free.
- Publication deducts at point of publish; re-prints cost 0 (UNIQUE gate).
- Money is verified by the Next.js proxy (Flutterwave verify) before topup;
  this router trusts the proxy + enforces idempotency via reference_id.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from typing import Optional as _Optional
from fastapi import Header as _Header
import os as _os
import logging as _logging

_logger = _logging.getLogger(__name__)


async def _verify_secret(
    x_api_secret_key: _Optional[str] = _Header(None, alias="X-API-SECRET-KEY"),
):
    """Same shared-secret check as main.verify_api_secret (lazy, no cycle)."""
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        from fastapi import HTTPException as _HTTPException, status as _status

        api_secret = _os.getenv("API_SECRET_KEY", "")
        env = _os.getenv("ENV", "production")
        if not api_secret:
            if env != "production":
                _logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
                return True
            raise _HTTPException(
                status_code=_status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfigured: API_SECRET_KEY not set",
            )
        if not x_api_secret_key:
            raise _HTTPException(status_code=_status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, api_secret):
            raise _HTTPException(status_code=_status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(prefix="/api/v1/tenant/{tenant_id}/credits", tags=["credits"], dependencies=[Depends(_verify_secret)])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class TopUpRequest(BaseModel):
    credit_count: Optional[int] = Field(None, gt=0, le=10000)
    student_count: Optional[int] = Field(None, gt=0, le=10000)
    transaction_id: str = Field(..., min_length=1)


class PublishRequest(BaseModel):
    term: str = Field(...)
    academic_session: Optional[str] = Field(None)
    student_ids: List[str] = Field(..., min_length=1, max_length=3000)
    published_by: Optional[str] = Field(None, max_length=120)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


def _ensure_tenant(tid: str) -> None:
    from services.db_manager import get_school_by_subdomain

    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")


def _validate_term(term: str) -> str:
    from services.db_manager import VALID_TERMS

    if term not in VALID_TERMS:
        raise HTTPException(status_code=400, detail=f"Invalid term '{term}'. Expected one of {list(VALID_TERMS)}")
    return term


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/balance", summary="Fetch spendable credit balance")
def get_balance(tenant_id: str):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    from services.db_manager import get_credit_balance

    return {"subdomain": tid, "credit_balance": get_credit_balance(tid)}


@router.get("/ledger", summary="Fetch credit ledger history (newest first)")
def get_ledger(tenant_id: str, limit: int = 50, offset: int = 0):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    from services.db_manager import get_credit_ledger

    entries = get_credit_ledger(tid, limit=limit, offset=offset)
    return {"subdomain": tid, "entries": entries, "limit": limit, "offset": offset}


@router.get("/publications", summary="Check publication state")
def get_publications(
    tenant_id: str,
    term: Optional[str] = None,
    academic_session: Optional[str] = None,
    student_id: Optional[str] = None,
):
    """Single-student check (?student_id=) returns {published: bool};
    otherwise lists published student_ids for the term/session."""
    from services.db_manager import (
        _connect_as_superuser,
        _row_to_dict,
        current_academic_session,
    )

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    session = (academic_session or "").strip() or current_academic_session()

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        if student_id:
            if term:
                _validate_term(term)
            cur.execute(
                """
                SELECT 1 FROM result_publications
                WHERE subdomain = %s AND student_id = %s
                  AND (%s IS NULL OR term = %s)
                  AND academic_session = %s
                LIMIT 1;
                """,
                (tid, student_id.strip(), term, term, session),
            )
            return {
                "subdomain": tid,
                "student_id": student_id,
                "term": term,
                "academic_session": session,
                "published": cur.fetchone() is not None,
            }
        if term:
            _validate_term(term)
        cur.execute(
            """
            SELECT student_id, term, academic_session, published_by, published_at
            FROM result_publications
            WHERE subdomain = %s
              AND (%s IS NULL OR term = %s)
              AND academic_session = %s
            ORDER BY published_at DESC;
            """,
            (tid, term, term, session),
        )
        rows = cur.fetchall()
        pubs = []
        for r in rows:
            d = _row_to_dict(r, cur)
            if d.get("published_at") is not None:
                try:
                    d["published_at"] = d["published_at"].isoformat()
                except Exception:
                    d["published_at"] = str(d["published_at"])
            pubs.append(d)
        return {
            "subdomain": tid,
            "term": term,
            "academic_session": session,
            "count": len(pubs),
            "publications": pubs,
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/topup", summary="Record a verified credit top-up (PURCHASE)")
def topup_credits(tenant_id: str, payload: TopUpRequest):
    """Credit a tenant after the Next.js proxy verified the Flutterwave tx.

    Idempotent on transaction_id: replays return the original entry
    without double-crediting the balance.
    """
    from services.db_manager import _connect_as_superuser, _row_to_dict, get_credit_balance

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    count = payload.credit_count if payload.credit_count is not None else payload.student_count
    if not count or count <= 0 or count > 10000:
        raise HTTPException(status_code=400, detail="credit_count (1-10000) is required")
    tx_id = payload.transaction_id.strip()
    reference_id = f"flw:{tx_id}"

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        cur.execute(
            """
            INSERT INTO credit_ledger
                (subdomain, amount, transaction_type, reference_id, description)
            VALUES (%s, %s, 'PURCHASE', %s, %s)
            ON CONFLICT (reference_id) DO NOTHING
            RETURNING id, subdomain, amount, transaction_type, reference_id, description, created_at;
            """,
            (tid, int(count), reference_id, f"Credit top-up: {count} credits via Flutterwave {tx_id}"),
        )
        row = cur.fetchone()
        if row is None:
            # Replay — return original state without touching the balance.
            cur.execute("ROLLBACK;")
            existing = None
            try:
                conn2 = _connect_as_superuser()
                cur2 = conn2.cursor()
                cur2.execute(
                    "SELECT id, subdomain, amount, transaction_type, reference_id, description, created_at "
                    "FROM credit_ledger WHERE reference_id = %s;",
                    (reference_id,),
                )
                r2 = cur2.fetchone()
                existing = _row_to_dict(r2, cur2) if r2 is not None else {}
                conn2.close()
            except Exception:
                pass
            return {
                "success": True,
                "duplicate": True,
                "subdomain": tid,
                "credit_balance": get_credit_balance(tid),
                "entry": existing or {},
            }
        cur.execute(
            """
            UPDATE schools
            SET credit_balance = COALESCE(credit_balance, 0) + %s, updated_at = NOW()
            WHERE subdomain = %s
            RETURNING credit_balance;
            """,
            (int(count), tid),
        )
        new_balance = int(cur.fetchone()[0] or 0)
        # Dual-write to unified billing_ledger (token_type=CREDIT) — idempotent on billing reference
        cur.execute(
            """
            INSERT INTO billing_ledger
                (subdomain, token_type, amount, transaction_type, reference_id, description)
            VALUES (%s, 'CREDIT', %s, 'CREDIT_PURCHASE', %s, %s)
            ON CONFLICT (reference_id) DO NOTHING;
            """,
            (tid, int(count), f"billing:{reference_id}", f"Credit top-up: {count} credits via Flutterwave {tx_id}"),
        )
        cur.execute("COMMIT;")
        entry = _row_to_dict(row, cur)
        try:
            entry["created_at"] = entry["created_at"].isoformat()
        except Exception:
            entry["created_at"] = str(entry.get("created_at") or "")
        _logger.info(f"[credits] Top-up {count} credits for '{tid}' via {tx_id} (balance {new_balance})")
        return {
            "success": True,
            "duplicate": False,
            "subdomain": tid,
            "credited": int(count),
            "credit_balance": new_balance,
            "entry": entry,
        }
    except HTTPException:
        raise
    except Exception as e:
        try:
            if conn:
                with conn.cursor() as rb_cur:
                    rb_cur.execute("ROLLBACK;")
        except Exception:
            pass
        _logger.exception(f"[credits] Top-up failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Top-up failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


class SlotTopUpRequest(BaseModel):
    slot_count: Optional[int] = Field(None, gt=0, le=10000)
    student_count: Optional[int] = Field(None, gt=0, le=10000)
    transaction_id: str = Field(..., min_length=1)


@router.post("/slots/topup", summary="Purchase slots (capacity) — tiered pricing")
def topup_slots_endpoint(tenant_id: str, payload: SlotTopUpRequest):
    """Slot purchase — tiered pricing (same tiers as registration). Dual-writes billing_ledger."""
    from services.db_manager import BILLING_LEDGER_TABLE, SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    count = payload.slot_count if payload.slot_count is not None else payload.student_count
    if not count or count <= 0 or count > 10000:
        raise HTTPException(status_code=400, detail="slot_count (1-10000) is required")
    tx_id = payload.transaction_id.strip()
    reference_id = f"flw-slot:{tx_id}"
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        cur.execute(
            """
            INSERT INTO billing_ledger
                (subdomain, token_type, amount, transaction_type, reference_id, description)
            VALUES (%s, 'SLOT', %s, 'SLOT_PURCHASE', %s, %s)
            ON CONFLICT (reference_id) DO NOTHING
            RETURNING id, subdomain, token_type, amount, transaction_type, reference_id, description, created_at;
            """,
            (tid, int(count), reference_id, f"Slot purchase: {count} slots via Flutterwave {tx_id}"),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute("ROLLBACK;")
            from services.db_manager import get_slots_balance

            return {
                "success": True,
                "duplicate": True,
                "subdomain": tid,
                "slots_balance": get_slots_balance(tid),
                "entry": {},
            }
        cur.execute(
            f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET slots_balance = COALESCE(slots_balance, 0) + %s,
                student_count = GREATEST(COALESCE(student_count,0), COALESCE(slots_balance,0) + %s),
                updated_at = NOW()
            WHERE subdomain = %s
            RETURNING slots_balance;
            """,
            (int(count), int(count), tid),
        )
        new_balance = int(cur.fetchone()[0] or 0)
        cur.execute("COMMIT;")
        _logger.info(f"[slots] Top-up {count} slots for '{tid}' via {tx_id} (balance {new_balance})")
        return {
            "success": True,
            "duplicate": False,
            "subdomain": tid,
            "credited": int(count),
            "slots_balance": new_balance,
            "entry": _row_to_dict(row, cur) if row is not None else {},
        }
    except HTTPException:
        raise
    except Exception as e:
        try:
            if conn:
                with conn.cursor() as rb:
                    rb.execute("ROLLBACK;")
        except Exception:
            pass
        _logger.exception(f"[slots] Top-up failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Slot top-up failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.get("/slots/balance", summary="Fetch remaining slot capacity")
def get_slots_balance_endpoint(tenant_id: str):
    from services.db_manager import get_slots_balance

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    return {"subdomain": tid, "slots_balance": get_slots_balance(tid)}


@router.get("/billing-ledger", summary="Unified billing ledger (SLOT/CREDIT)")
def get_billing_ledger_endpoint(
    tenant_id: str, token_type: str | None = None, limit: int = 50, offset: int = 0
):
    from services.db_manager import get_billing_ledger

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    entries = get_billing_ledger(tid, token_type=token_type, limit=limit, offset=offset)
    return {"subdomain": tid, "entries": entries, "token_type": token_type, "limit": limit, "offset": offset}


@router.get("/config/credit-price", summary="Fetch flat credit price (NGN)")
def get_credit_price_endpoint(tenant_id: str):
    from services.db_manager import get_credit_price

    _validate_tenant_id(tenant_id)
    _ensure_tenant(tenant_id)
    return {"credit_price": get_credit_price()}


@router.put("/config/credit-price", summary="Set flat credit price (superadmin tunable)")
def set_credit_price_endpoint(tenant_id: str, payload: dict):
    # Allow any tenant_id for superadmin tuning, but validate tenant exists for audit trail
    _validate_tenant_id(tenant_id)
    # Don't require tenant exists for global setting — allow superadmin to tune globally
    price = payload.get("credit_price") if isinstance(payload, dict) else None
    if price is None:
        raise HTTPException(status_code=400, detail="credit_price is required")
    from services.db_manager import set_credit_price

    try:
        new_price = set_credit_price(int(price))
        return {"success": True, "credit_price": new_price}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/publish", summary="Publish report cards (1 credit each, re-prints free)")
def publish_reports(tenant_id: str, payload: PublishRequest):
    from services.db_manager import current_academic_session, publish_student_results

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    _validate_term(payload.term)
    session = (payload.academic_session or "").strip() or current_academic_session()
    try:
        result = publish_student_results(
            subdomain=tid,
            term=payload.term,
            academic_session=session,
            student_ids=payload.student_ids,
            published_by=(payload.published_by or "").strip() or None,
        )
        return {"success": True, **result}
    except ValueError as e:
        msg = str(e)
        status = 402 if "Insufficient credits" in msg else 400
        raise HTTPException(status_code=status, detail=msg)
    except Exception as e:
        _logger.exception(f"[credits] Publish failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Publication failed: {e}")
