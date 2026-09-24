"""
Notification Inbox — per-user tenant inbox APIs (Phase 2).

Prefix: /api/v1/tenant/{tenant_id}/notifications (+ staff_router for nudges)
Auth:   shared X-API-SECRET-KEY (same trust boundary as credits router).
        User scoping is enforced by the Next.js proxy via session cookies;
        this router trusts the proxy + validates tenant/user identifiers.
        The nudge endpoint additionally requires the Next.js proxy to hold
        a tenant admin_session (see app/api/admin/nudge/route.ts).

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
- POST /api/v1/tenant/{tenant_id}/staff/nudge      admin → staff grading reminder
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

    Delegates to the shared service resolver so read paths (inbox,
    mark-read, unread-count) agree with write paths (nudge/targeted
    dispatch) on row identity. Admin identifiers normalize to
    LOWER(email). Unknown → 404; ambiguous → 409 with retry hint.
    """
    from services.notifications import (
        StaffAmbiguousError,
        StaffNotFoundError,
        resolve_staff_user_id,
    )

    identifier = (user_id or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="user_id is required")
    if user_type == "admin":
        return identifier.lower()
    try:
        # Read path keeps legacy scope: inactive rows still resolve (their
        # sessions predate deactivation); name matching stays enabled.
        return resolve_staff_user_id(cur, tid, identifier, include_inactive=True)
    except StaffAmbiguousError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except StaffNotFoundError:
        raise HTTPException(status_code=404, detail="Staff user not found")


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
        search = (q or "").strip()
        if search:
            # Escape LIKE wildcards so the query is a literal case-insensitive match.
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where_read += " AND (n.title ILIKE %s ESCAPE '\\' OR n.message ILIKE %s ESCAPE '\\')"
            like = f"%{escaped}%"
            params.extend([like, like])
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


# ---------------------------------------------------------------------------
# In-app staff nudge (replaces external WhatsApp nudges)
# ---------------------------------------------------------------------------

#: Cooldown window — repeat nudges for the same (staff, subject, class, term)
#: within this window return {duplicate: True} instead of dispatching.
NUDGE_COOLDOWN_HOURS = 24

staff_router = APIRouter(
    prefix="/api/v1/tenant/{tenant_id}/staff",
    tags=["notifications"],
    dependencies=[Depends(_verify_secret)],
)


class StaffNudgeRequest(BaseModel):
    # Staff identifier — at least one required (id | staff_id | email | name).
    staff_id: Optional[str] = Field(default=None)
    staff_name: Optional[str] = Field(default=None)
    staff_email: Optional[str] = Field(default=None)
    subject_name: str = Field(..., min_length=1, max_length=120)
    class_name: str = Field(..., min_length=1, max_length=60)
    term: Optional[str] = Field(default=None, max_length=64)


@staff_router.post("/nudge", summary="Nudge a staffer about pending grades (admin)")
def nudge_staff(tenant_id: str, payload: StaffNudgeRequest):
    """Dispatch STAFF_GRADING_REMINDER to one staffer with a grading-hub CTA.

    Auth: shared secret (FastAPI) + tenant admin_session enforced by the
    Next.js proxy (app/api/admin/nudge). 24h per-(staff, subject, class, term)
    cooldown: repeats return {duplicate: True} without writing.
    """
    from urllib.parse import quote as _quote

    from services.db_manager import (
        NOTIFICATION_READS_TABLE,
        NOTIFICATIONS_TABLE,
        TENANT_STAFF_TABLE,
        VALID_TERMS,
        _connect_as_superuser,
        get_school_by_subdomain,
    )
    from services.notifications import dispatch_event

    tid = _validate_tenant_id(tenant_id)
    school = get_school_by_subdomain(tid)
    if school is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")

    subject = (payload.subject_name or "").strip()
    class_name = (payload.class_name or "").strip()
    if not subject or not class_name:
        raise HTTPException(status_code=400, detail="subject_name and class_name are required")
    term = (payload.term or "").strip() or None
    if term is not None and term not in VALID_TERMS:
        raise HTTPException(status_code=400, detail=f"Invalid term '{term}'")

    identifier = (
        (payload.staff_id or "").strip()
        or (payload.staff_email or "").strip()
        or (payload.staff_name or "").strip()
    )
    if not identifier:
        raise HTTPException(status_code=400, detail="staff_id, staff_email or staff_name is required")

    # CTA deep link into the Smart Staff Hub (auto-opens the grading modal).
    cta = (
        f"/{tid}/staff/grading?action=grade"
        f"&subject={_quote(subject)}&class={_quote(class_name)}"
    )
    if term:
        cta += f"&term={_quote(term)}"

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Resolve staffer → canonical id::text via the shared resolver
        # (same semantics as the inbox read path; active-only here).
        from services.notifications import (
            StaffAmbiguousError as _Ambiguous,
            StaffNotFoundError as _NotFound,
            resolve_staff_user_id as _resolve,
        )

        try:
            canonical = _resolve(cur, tid, identifier)
        except _Ambiguous as e:
            raise HTTPException(status_code=409, detail=str(e))
        except _NotFound:
            raise HTTPException(status_code=404, detail="Staff user not found")
        cur.execute(
            f"SELECT full_name FROM {TENANT_STAFF_TABLE} WHERE subdomain = %s AND id::text = %s;",
            (tid, canonical),
        )
        name_row = cur.fetchone()
        staff_name = str((name_row[0] if name_row else None) or identifier)

        # 24h cooldown: same staffer + exact CTA (subject/class/term) + still unread.
        cur.execute(
            f"""
            SELECT n.id FROM {NOTIFICATIONS_TABLE} n
            JOIN {NOTIFICATION_READS_TABLE} r ON r.notification_id = n.id
            WHERE n.tenant_id = %s AND n.event_type = 'STAFF_GRADING_REMINDER'
              AND r.tenant_id = %s AND r.user_id = %s AND r.user_type = 'staff'
              AND r.is_read = FALSE
              AND n.cta_link = %s
              AND n.created_at > NOW() - (%s || ' hours')::INTERVAL
            LIMIT 1;
            """,
            (tid, tid, canonical, cta, str(NUDGE_COOLDOWN_HOURS)),
        )
        existing = cur.fetchone()
        if existing is not None:
            return {
                "success": True,
                "duplicate": True,
                "notification_id": int(existing[0]),
                "subdomain": tid,
                "detail": f"Reminder already sent within {NUDGE_COOLDOWN_HOURS}h",
            }

        result = dispatch_event(
            "STAFF_GRADING_REMINDER",
            tid,
            {
                "subject_name": subject,
                "class_name": class_name,
                "term": term or "",
                "staff_name": staff_name,
                "school_name": school.get("school_name") or tid,
                "subdomain": tid,
            },
            cta_link=cta,
            target_user_id=canonical,
            target_user_type="staff",
        )
        return {"success": True, "duplicate": False, "subdomain": tid, **result}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _logger.exception(f"[notifications] nudge failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Nudge failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


VALID_ANNOUNCEMENT_TYPES = ("Meeting", "Urgent", "Reminder", "General")


class StaffBroadcastRequest(BaseModel):
    message_type: str = Field(..., min_length=1, max_length=20)
    title: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=2000)


@staff_router.post("/broadcast", summary="Send a categorized announcement to all staff (admin)")
def broadcast_to_staff(tenant_id: str, payload: StaffBroadcastRequest):
    """Tenant admin → all active staff announcement (ANNOUNCEMENT category).

    Auth: shared secret (FastAPI) + tenant admin_session enforced by the
    Next.js proxy (app/api/admin/announcements). Title is formatted as
    "[{message_type}] {title}". The composing admin gets a pre-read
    visibility copy (no bell); staff get unread inbox rows.
    """
    from services.db_manager import _connect_as_superuser, get_school_by_subdomain
    from services.notifications import dispatch_manual

    tid = _validate_tenant_id(tenant_id)
    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")

    mtype = (payload.message_type or "").strip()
    if mtype not in VALID_ANNOUNCEMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"message_type must be one of {list(VALID_ANNOUNCEMENT_TYPES)}",
        )
    title = (payload.title or "").strip()
    message = (payload.message or "").strip()
    if not title or not message:
        raise HTTPException(status_code=400, detail="title and message are required")

    # Staff identity check: tenant must have at least one active staffer.
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        from services.db_manager import TENANT_STAFF_TABLE

        cur.execute(
            f"SELECT COUNT(*) FROM {TENANT_STAFF_TABLE} "
            f"WHERE subdomain = %s AND COALESCE(is_active, TRUE) = TRUE;",
            (tid,),
        )
        if int(cur.fetchone()[0] or 0) == 0:
            raise HTTPException(status_code=400, detail="No active staff to announce to")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    try:
        result = dispatch_manual(
            category="ANNOUNCEMENT",
            title=f"[{mtype}] {title}",
            message=message,
            tenant_id=tid,
            target_role="staff_only",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _logger.exception(f"[notifications] staff broadcast failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Announcement failed: {e}")
    return {"success": True, "subdomain": tid, "message_type": mtype, **result}


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
