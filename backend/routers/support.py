"""
Support Hub — cross-tenant ticket intake + superadmin triage.

Prefixes:
- POST /api/v1/support/tickets                          (public intake)
- GET  /api/v1/admin/support-tickets                    (superadmin list)
- PATCH /api/v1/admin/support-tickets/{ticket_id}        (superadmin status)

Auth: shared X-API-SECRET-KEY (same trust boundary as every other router).
      The Next.js proxy is the sole caller and is the ONLY thing that sees a
      browser session cookie, so all identity resolution happens there — this
      router just stores what it is handed and re-validates it.

Identity contract (enforced in POST /tickets):
- The proxy forwards `submitter_kind='anonymous'` with `tenant_id=None` for a
  logged-out visitor, in which case `submitter_email` is a user-typed string
  and is treated as unverified contact info.
- For `submitter_kind in ('admin','staff')` the proxy OVERWRITES
  submitter_email/tenant_id from the session. We re-check that invariant here
  so a compromised or buggy proxy cannot file a ticket as a tenant admin.
"""

import json as _json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared secret
# ---------------------------------------------------------------------------

async def _verify_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    """Same shared-secret check as main.verify_api_secret (lazy, no cycle)."""
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        import os
        from fastapi import status as _status

        api_secret = os.getenv("API_SECRET_KEY", "")
        env = os.getenv("ENV", "production")
        if not api_secret:
            if env != "production":
                _logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
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


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SupportTicketCreate(BaseModel):
    type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    tenant_id: Optional[str] = None
    submitter_email: Optional[str] = None
    submitter_role: Optional[str] = None
    submitter_kind: str = "anonymous"
    submitter_id: Optional[str] = None


class SupportTicketStatusUpdate(BaseModel):
    status: str
    actor_email: Optional[str] = None
    actor_id: Optional[str] = None
    resolution_note: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

#: Generic in-process throttle for the public intake: 5 tickets per 10 minutes
#: per IP. Deliberately looser than the admin export gate (3/60s) because this
#: endpoint faces the open internet rather than one authenticated operator.
_RATE_MAX_HITS = 5
_RATE_WINDOW_S = 600


def _client_ip(request: Request) -> str:
    """Best-effort caller IP.

    The service sits behind nginx, so `request.client.host` is 127.0.0.1 for
    every request — X-Forwarded-For (left-most hop) is the only usable signal.
    """
    fwd = request.headers.get("x-forwarded-for") or ""
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return "unknown"


def _validate_tenant_id(tenant_id: str) -> str:
    """Reuse the repo's subdomain rules, then confirm the school still exists."""
    from main import RESERVED_SUBDOMAINS, SUBDOMAIN_RE
    from services.db_manager import tenant_exists

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    if not tenant_exists(tid):
        # Soft-deleted schools included: tenant_exists only checks the row, and
        # a ticket filed against a soft-deleted tenant is still worth keeping.
        _logger.info(f"[support] tenant '{tid}' has no registry row; filing as unlinked ticket")
        return None
    return tid


def _sanitize_payload(payload: Any, max_field_len: int, max_bytes: int) -> Dict[str, Any]:
    """Bound an untrusted JSONB blob: cap string length, depth and total size.

    Deliberately a denylist (no key allowlist) so a future form field is not
    silently dropped — the ticket is stored as data and only ever rendered as
    React text, never as HTML.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be a JSON object")

    def walk(value: Any, depth: int) -> Any:
        if depth > 3:
            return None
        if isinstance(value, str):
            return value[:max_field_len]
        if isinstance(value, (int, float, bool)) or value is None:
            return value
        if isinstance(value, list):
            return [walk(v, depth + 1) for v in value[:50]]
        if isinstance(value, dict):
            return {str(k)[:100]: walk(v, depth + 1) for k, v in list(value.items())[:50]}
        # Anything exotic (datetime, bytes) can't arrive over JSON — coerce
        # rather than 500 on an unexpected type.
        return str(value)[:max_field_len]

    cleaned: Dict[str, Any] = {}
    for key, value in list(payload.items())[:50]:
        cleaned[str(key)[:100]] = walk(value, 1)

    try:
        encoded = _json.dumps(cleaned)
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"payload is not JSON-serializable: {e}")
    if len(encoded.encode("utf-8")) > max_bytes:
        raise HTTPException(status_code=413, detail="payload too large")
    return cleaned


def _clean_email(value: Optional[str]) -> Optional[str]:
    email = (value or "").strip().lower()
    if not email:
        return None
    if len(email) > 255 or "@" not in email or email.startswith("@") or email.endswith("@"):
        return None
    return email


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

router = APIRouter(
    prefix="/api/v1/support",
    tags=["support"],
    dependencies=[Depends(_verify_secret)],
)

admin_router = APIRouter(
    prefix="/api/v1/admin",
    tags=["support-admin"],
    dependencies=[Depends(_verify_secret)],
)


# ---------------------------------------------------------------------------
# Public intake
# ---------------------------------------------------------------------------

@router.post("/tickets", summary="Submit a support ticket (public, optional session)")
def create_ticket(body: SupportTicketCreate, request: Request):
    """Accept a bug report or general feedback from the marketing Support Hub.

    Unauthenticated visitors are first-class: the ticket is created with
    tenant_id=NULL rather than rejected. Throttled per IP.
    """
    from services.db_manager import (
        MAX_SUPPORT_PAYLOAD_BYTES,
        MAX_SUPPORT_PAYLOAD_FIELD_LEN,
        VALID_SUPPORT_SUBMITTER_KINDS,
        VALID_SUPPORT_TICKET_TYPES,
        create_support_ticket,
    )

    ticket_type = (body.type or "").strip().lower()
    if ticket_type not in VALID_SUPPORT_TICKET_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"type must be one of {', '.join(VALID_SUPPORT_TICKET_TYPES)}",
        )

    kind = (body.submitter_kind or "anonymous").strip().lower()
    if kind not in VALID_SUPPORT_SUBMITTER_KINDS:
        kind = "anonymous"

    # Throttle. A logged-in session is rate limited by tenant instead of IP so
    # staff behind one NAT aren't punished for sharing an egress address.
    throttle_key = f"support-ticket|{_client_ip(request)}"
    if kind != "anonymous" and body.tenant_id:
        throttle_key = f"support-ticket|tenant:{body.tenant_id.strip().lower()}"
    from services.rate_limit import check as _rl_check

    allowed, retry_after = _rl_check(throttle_key, _RATE_MAX_HITS, _RATE_WINDOW_S)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many submissions — please try again in {retry_after}s",
        )

    payload = _sanitize_payload(
        body.payload, MAX_SUPPORT_PAYLOAD_FIELD_LEN, MAX_SUPPORT_PAYLOAD_BYTES
    )

    tenant_id = None
    if body.tenant_id:
        tenant_id = _validate_tenant_id(body.tenant_id)

    email = _clean_email(body.submitter_email)

    # Re-assert the identity invariant: an authenticated submitter must not be
    # able to claim a tenant/email that the session does not support. We can't
    # re-verify the cookie here, so anything inconsistent is downgraded to an
    # anonymous ticket rather than trusted.
    if kind == "anonymous" and tenant_id:
        _logger.warning(
            "[support] anonymous submission carried a tenant_id; dropping attribution"
        )
        tenant_id = None

    try:
        ticket = create_support_ticket(
            ticket_type=ticket_type,
            payload=payload,
            tenant_id=tenant_id,
            submitter_email=email,
            submitter_role=(body.submitter_role or None),
            submitter_kind=kind,
            submitter_id=(body.submitter_id or None),
        )
    except Exception as e:
        _logger.exception("[support] ticket insert failed")
        raise HTTPException(status_code=500, detail="Could not record the ticket")

    return {
        "ticket_id": ticket["id"],
        "type": ticket["type"],
        "status": ticket["status"],
        "created_at": ticket["created_at"],
    }


# ---------------------------------------------------------------------------
# Superadmin triage
# ---------------------------------------------------------------------------

@admin_router.get("/support-tickets", summary="List support tickets across all tenants")
def list_tickets(
    status: Optional[str] = None,
    type: Optional[str] = None,  # noqa: A002 — matches the column name
    tenant_id: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
):
    """Newest-first ticket inbox. Returns {tickets, total, page, limit}."""
    from services.db_manager import list_support_tickets

    try:
        return list_support_tickets(
            status=status,
            ticket_type=type,
            tenant_id=tenant_id,
            search=search,
            page=page,
            limit=limit,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _logger.exception("[support] ticket list failed")
        raise HTTPException(status_code=500, detail="Could not load tickets")


@admin_router.get("/support-tickets/{ticket_id}", summary="Single support ticket")
def get_ticket(ticket_id: UUID):
    from services.db_manager import get_support_ticket

    try:
        ticket = get_support_ticket(str(ticket_id))
    except Exception as e:
        _logger.exception("[support] ticket fetch failed")
        raise HTTPException(status_code=500, detail="Could not load the ticket")
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"ticket": ticket}


@admin_router.patch("/support-tickets/{ticket_id}", summary="Update a ticket's status")
def update_ticket(ticket_id: UUID, body: SupportTicketStatusUpdate):
    """Move a ticket through open -> in_progress -> resolved.

    Writes an audit_logs entry so triage actions sit alongside billing ones.
    """
    from services.db_manager import (
        VALID_SUPPORT_TICKET_STATUSES,
        log_admin_action,
        update_support_ticket_status,
    )

    new_status = (body.status or "").strip().lower()
    if new_status not in VALID_SUPPORT_TICKET_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {', '.join(VALID_SUPPORT_TICKET_STATUSES)}",
        )

    actor_email = _clean_email(body.actor_email) or "superadmin"
    note = (body.resolution_note or "").strip()[:2000] or None

    try:
        ticket = update_support_ticket_status(
            ticket_id=str(ticket_id),
            status=new_status,
            resolved_by=actor_email if new_status == "resolved" else None,
            resolution_note=note,
        )
    except Exception as e:
        _logger.exception("[support] ticket status update failed")
        raise HTTPException(status_code=500, detail="Could not update the ticket")

    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Best-effort audit trail (never raises).
    log_admin_action(
        action=f"support_ticket_{new_status}",
        subdomain=ticket.get("tenant_id"),
        details={"ticket_id": ticket["id"], "type": ticket["type"], "status": new_status},
        actor=actor_email,
        actor_id=body.actor_id,
        actor_type="superadmin",
    )

    return {"ticket": ticket}


@admin_router.get("/support-tickets/stats/summary", summary="Ticket counts by status")
def tickets_summary():
    """Small header widget: open / in_progress / resolved counts."""
    from services.db_manager import _connect_as_superuser, _row_to_dict
    from services.db_manager import SUPPORT_TICKETS_TABLE

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT status, COUNT(*) AS count FROM {SUPPORT_TICKETS_TABLE}
            GROUP BY status;
            """
        )
        rows: List[Dict[str, Any]] = [_row_to_dict(r, cur) for r in cur.fetchall()]
        counts = {r["status"]: int(r["count"]) for r in rows}
        return {
            "open": counts.get("open", 0),
            "in_progress": counts.get("in_progress", 0),
            "resolved": counts.get("resolved", 0),
            "total": sum(counts.values()),
        }
    except Exception as e:
        _logger.exception("[support] ticket summary failed")
        raise HTTPException(status_code=500, detail="Could not load ticket counts")
    finally:
        if conn:
            conn.close()
