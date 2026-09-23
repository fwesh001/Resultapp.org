"""
Notification Inbox — per-user tenant inbox APIs (Phase 2).

Prefix: /api/v1/tenant/{tenant_id}/notifications
Auth:   shared X-API-SECRET-KEY (same trust boundary as credits router).
        User scoping is enforced by the Next.js proxy via session cookies;
        this router trusts the proxy + validates tenant/user identifiers.

Identity:
- staff user_id canonical form = tenant_staff.id::text (UUID). The `user_id`
  query param accepts id | staff_id | email and is resolved to the canonical
  id first (mirrors staff_auth dashboard resolution).
- admin user_id = LOWER(schools.email), user_type='admin'.

Endpoints:
- GET  /                                          inbox list (newest first)
- GET  /unread-count                               lightweight bell poll
- POST /{notification_id}/read                     mark one as read
- POST /read-all                                   mark all as read
"""

import logging
from typing import Optional

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


router = APIRouter(
    prefix="/api/v1/tenant/{tenant_id}/notifications",
    tags=["notifications"],
    dependencies=[Depends(_verify_secret)],
)

_logger = logging.getLogger(__name__)


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


def _validate_user_type(user_type: Optional[str]) -> str:
    ut = (user_type or "staff").strip().lower()
    if ut not in ("staff", "admin"):
        raise HTTPException(status_code=400, detail="user_type must be staff or admin")
    return ut


def _resolve_user_id(cur, tid: str, user_id: str, user_type: str) -> str:
    """Resolve any staff identifier to canonical tenant_staff.id::text.

    Admin identifiers normalize to LOWER(email). Raises 404 for unknown staff.
    """
    from services.db_manager import TENANT_STAFF_TABLE

    identifier = (user_id or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="user_id is required")
    if user_type == "admin":
        return identifier.lower()
    cur.execute(
        f"""
        SELECT id::text FROM {TENANT_STAFF_TABLE}
        WHERE subdomain = %s AND (id::text = %s OR staff_id = %s OR email = %s)
        LIMIT 1;
        """,
        (tid, identifier, identifier, identifier),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Staff user not found")
    return str(row[0])


def _iso(value) -> str:
    try:
        return value.isoformat()
    except Exception:
        return str(value or "")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class MarkReadRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    user_type: Optional[str] = Field(default="staff")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", summary="List inbox notifications (newest first)")
def list_inbox(
    tenant_id: str,
    user_id: str,
    user_type: Optional[str] = "staff",
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
    q: Optional[str] = None,
):
    from services.db_manager import (
        NOTIFICATION_READS_TABLE,
        NOTIFICATIONS_TABLE,
        _connect_as_superuser,
        _row_to_dict,
        get_school_by_subdomain,
    )

    tid = _validate_tenant_id(tenant_id)
    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
    ut = _validate_user_type(user_type)
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        canonical = _resolve_user_id(cur, tid, user_id, ut)
        where_read = "r.tenant_id = %s AND r.user_id = %s"
        params: list = [tid, canonical]
        if unread_only:
            where_read += " AND r.is_read = FALSE"
        cur.execute(
            f"""
            SELECT n.id, n.category, n.title, n.message, n.cta_link,
                   n.event_type, n.created_at, r.is_read, r.read_at
            FROM {NOTIFICATION_READS_TABLE} r
            JOIN {NOTIFICATIONS_TABLE} n ON n.id = r.notification_id
            WHERE {where_read}
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT %s OFFSET %s;
            """,
            tuple(params) + (limit, offset),
        )
        rows = cur.fetchall()
        items = []
        for row in rows:
            d = _row_to_dict(row, cur)
            d["created_at"] = _iso(d.get("created_at"))
            d["read_at"] = _iso(d.get("read_at")) if d.get("read_at") else None
            d["is_read"] = bool(d.get("is_read"))
            items.append(d)
        cur.execute(
            f"""
            SELECT COUNT(*) FROM {NOTIFICATION_READS_TABLE} r
            WHERE r.tenant_id = %s AND r.user_id = %s AND r.is_read = FALSE;
            """,
            (tid, canonical),
        )
        unread_count = int(cur.fetchone()[0] or 0)
        return {
            "subdomain": tid,
            "user_id": canonical,
            "user_type": ut,
            "unread_count": unread_count,
            "notifications": items,
            "limit": limit,
            "offset": offset,
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.get("/unread-count", summary="Lightweight unread badge count")
def unread_count(tenant_id: str, user_id: str, user_type: Optional[str] = "staff"):
    from services.db_manager import (
        NOTIFICATION_READS_TABLE,
        _connect_as_superuser,
        get_school_by_subdomain,
    )

    tid = _validate_tenant_id(tenant_id)
    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
    ut = _validate_user_type(user_type)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        canonical = _resolve_user_id(cur, tid, user_id, ut)
        cur.execute(
            f"""
            SELECT COUNT(*) FROM {NOTIFICATION_READS_TABLE} r
            WHERE r.tenant_id = %s AND r.user_id = %s AND r.is_read = FALSE;
            """,
            (tid, canonical),
        )
        return {
            "subdomain": tid,
            "user_id": canonical,
            "user_type": ut,
            "unread_count": int(cur.fetchone()[0] or 0),
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/{notification_id}/read", summary="Mark one notification as read")
def mark_read(tenant_id: str, notification_id: int, payload: MarkReadRequest):
    from services.db_manager import (
        NOTIFICATION_READS_TABLE,
        _connect_as_superuser,
        get_school_by_subdomain,
    )

    tid = _validate_tenant_id(tenant_id)
    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
    ut = _validate_user_type(payload.user_type)
    if int(notification_id) <= 0:
        raise HTTPException(status_code=400, detail="Invalid notification_id")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        canonical = _resolve_user_id(cur, tid, payload.user_id, ut)
        cur.execute(
            f"""
            UPDATE {NOTIFICATION_READS_TABLE}
            SET is_read = TRUE, read_at = NOW()
            WHERE notification_id = %s AND tenant_id = %s AND user_id = %s
            RETURNING notification_id;
            """,
            (int(notification_id), tid, canonical),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Notification not found in inbox")
        conn.commit()
        return {"success": True, "notification_id": int(notification_id), "user_id": canonical}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        _logger.exception(f"[notifications] mark_read failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Mark-read failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/read-all", summary="Mark all inbox notifications as read")
def mark_all_read(tenant_id: str, payload: MarkReadRequest):
    from services.db_manager import (
        NOTIFICATION_READS_TABLE,
        _connect_as_superuser,
        get_school_by_subdomain,
    )

    tid = _validate_tenant_id(tenant_id)
    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
    ut = _validate_user_type(payload.user_type)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        canonical = _resolve_user_id(cur, tid, payload.user_id, ut)
        cur.execute(
            f"""
            UPDATE {NOTIFICATION_READS_TABLE}
            SET is_read = TRUE, read_at = NOW()
            WHERE tenant_id = %s AND user_id = %s AND is_read = FALSE;
            """,
            (tid, canonical),
        )
        marked = cur.rowcount or 0
        conn.commit()
        return {"success": True, "marked": int(marked), "user_id": canonical}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        _logger.exception(f"[notifications] read-all failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Read-all failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
