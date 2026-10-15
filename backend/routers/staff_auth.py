"""
Staff Authentication & Dashboard — per-tenant staff portal
Prefix: /api/v1/tenant/{tenant_id}/staff
Protected by _verify_allocations_secret fallback (system-to-system)
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
import os
import logging

logger = logging.getLogger(__name__)

#: Minimum new-password length for staff. Six, matching the seeded default PIN
#: ("123456") and the student policy, rather than the eight the admin policy
#: enforces. Staff sign in with a short credential by design; an 8-char floor
#: would block the very first thing a new teacher tries to do.
MIN_STAFF_PASSWORD = 6
MAX_PASSWORD_LEN = 128

#: Password change requires supplying the current password, so it is a guessing
#: surface. These buckets are keyed with a "staff-" prefix rather than reusing
#: the student ones — a shared key would let one portal's traffic throttle the
#: other.
STAFF_PASSWORD_MAX_PER_ACCOUNT = 5
STAFF_PASSWORD_WINDOW_S = 60
STAFF_PASSWORD_MAX_PER_IP = 20


async def _verify_allocations_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        from fastapi import HTTPException as HTTPExc, status as Status

        API_SECRET = os.getenv("API_SECRET_KEY", "")
        ENV = os.getenv("ENV", "production")
        if not API_SECRET:
            if ENV != "production":
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
                return True
            raise HTTPExc(status_code=Status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Server misconfigured: API_SECRET_KEY not set")
        if not x_api_secret_key:
            raise HTTPExc(status_code=Status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, API_SECRET):
            raise HTTPExc(status_code=Status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(prefix="/api/v1/tenant/{tenant_id}/staff", tags=["staff"], dependencies=[Depends(_verify_allocations_secret)])


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


# ---------------------------------------------------------------------------
# POST /login — dual-login Staff ID or Email + PIN
# ---------------------------------------------------------------------------

class StaffLoginRequest(BaseModel):
    identifier: str = Field(..., description="Staff ID or Email")
    password: str = Field(..., description="PIN/Password")


class StaffPasswordChange(BaseModel):
    staff_id: str = Field(..., description="The authenticated staff row id")
    current_password: str = Field(...)
    new_password: str = Field(...)


def _client_ip(request: Request) -> str:
    if request is not None and getattr(request, "client", None):
        fwd = request.headers.get("x-forwarded-for") or ""
        if fwd:
            return fwd.split(",")[0].strip()
        return request.client.host or "unknown"
    return "unknown"


def _throttle_password_flow(request: Request, tid: str, ident: str) -> None:
    """Per-account and per-IP limiter for the change-password endpoint.

    Never throws on limiter failure. A rate-limit outage must not stop a
    teacher changing their password — they would be locked out of the portal
    until the limiter recovers. Same fail-open choice the student flow makes,
    for the same reason.
    """
    try:
        from services.rate_limit import check as _rl_check

        ok_acct, retry_acct = _rl_check(
            f"staff-password:{tid}:{ident.lower()}",
            max_hits=STAFF_PASSWORD_MAX_PER_ACCOUNT,
            window_s=STAFF_PASSWORD_WINDOW_S,
        )
        if not ok_acct:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Please wait a moment and try again.",
                headers={"Retry-After": str(retry_acct)},
            )

        ok_ip, retry_ip = _rl_check(
            f"staff-password-ip:{_client_ip(request)}",
            max_hits=STAFF_PASSWORD_MAX_PER_IP,
            window_s=STAFF_PASSWORD_WINDOW_S,
        )
        if not ok_ip:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts from this network. Please wait a moment.",
                headers={"Retry-After": str(retry_ip)},
            )
    except HTTPException:
        raise
    except Exception:
        logger.warning("[staff_auth] rate limit unavailable; continuing unthrottled", exc_info=True)


@router.post("/login", summary="Staff login via Staff ID or Email + PIN")
def staff_login(tenant_id: str, payload: StaffLoginRequest):
    tid = _validate_tenant_id(tenant_id)
    identifier = (payload.identifier or "").strip()
    password = payload.password or ""

    if not identifier or not password:
        raise HTTPException(status_code=400, detail="identifier and password are required")

    from services.db_manager import TENANT_STAFF_TABLE, _connect_as_superuser, _row_to_dict

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Dual-login: staff_id OR email (both case-insensitive so legacy
        # uppercase IDs like STAFF/001 keep working), password via crypt.
        #
        # must_change_password rides along so the Next.js proxy can bake it into
        # the session cookie at sign-in. COALESCE guards rows written before the
        # column existed — a NULL must read as "needs changing", not as False.
        cur.execute(
            f"""
            SELECT id, staff_id, full_name, email, role,
                   COALESCE(is_moderator, FALSE) AS is_moderator,
                   COALESCE(must_change_password, TRUE) AS must_change_password
            FROM {TENANT_STAFF_TABLE}
            WHERE subdomain = %s
              AND (LOWER(staff_id) = LOWER(%s) OR LOWER(email) = LOWER(%s))
              AND password_hash = crypt(%s, password_hash)
            """,
            (tid, identifier, identifier, password),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        d = _row_to_dict(row, cur)
        d["id"] = str(d["id"])
        d["must_change_password"] = bool(d.get("must_change_password"))
        logger.info(f"[staff_auth] login success {tid}/{identifier} -> {d['staff_id']}")
        return {"staff": d, "tenant_id": tid}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[staff_auth] login failed for {tid}/{identifier}: {e}")
        raise HTTPException(status_code=500, detail=f"Login failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Dashboard core — shared by the path and query variants below.
# NOTE: staff_ids may contain "/" (e.g. "staff/001"), which cannot travel
# safely in a path segment across server versions. New callers must use
# GET /dashboard?staff_id=... ; /{staff_id}/dashboard is kept for
# backward compatibility (slash-free IDs only).
# ---------------------------------------------------------------------------

def _load_staff_dashboard(tid: str, sid: str) -> dict:
    from services.db_manager import TENANT_ALLOCATIONS_TABLE, TENANT_STAFF_TABLE, TENANT_FORM_ASSIGNMENTS_TABLE, _connect_as_superuser, _row_to_dict
    from datetime import datetime

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        # Resolve staff full_name via OR query (staff_id string OR UUID).
        # staff_id/email match case-insensitively (legacy uppercase IDs);
        # cast id to text for comparison to allow both.
        cur.execute(
            f"""
            SELECT full_name, staff_id, id, role, signature_url, signature_data,
                   COALESCE(is_moderator, FALSE) AS is_moderator,
                   COALESCE(must_change_password, TRUE) AS must_change_password
            FROM {TENANT_STAFF_TABLE}
            WHERE subdomain = %s AND (LOWER(staff_id) = LOWER(%s) OR id::text = %s OR LOWER(email) = LOWER(%s))
            LIMIT 1
            """,
            (tid, sid, sid, sid),
        )
        staff_row = cur.fetchone()
        if staff_row is None:
            raise HTTPException(status_code=404, detail="Staff not found")
        staff = _row_to_dict(staff_row, cur)
        staff["must_change_password"] = bool(staff.get("must_change_password"))
        staff_name = staff.get("full_name")

        # Now fetch allocations where staff_name matches
        cur.execute(
            f"""
            SELECT id, subdomain, subject_name, staff_name, class_name, created_at
            FROM {TENANT_ALLOCATIONS_TABLE}
            WHERE subdomain = %s AND staff_name = %s
            ORDER BY class_name, subject_name
            """,
            (tid, staff_name),
        )
        rows = cur.fetchall()
        allocs = []
        for r in rows:
            d = _row_to_dict(r, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            elif d.get("created_at") is not None:
                d["created_at"] = str(d["created_at"])
            d["id"] = str(d["id"])
            allocs.append(d)

        # Form-teacher assignments for this staffer (contextual allocations).
        cur.execute(
            f"""
            SELECT class_name FROM {TENANT_FORM_ASSIGNMENTS_TABLE}
            WHERE subdomain = %s AND LOWER(staff_id) = LOWER(%s)
            ORDER BY class_name
            """,
            (tid, str(staff.get("staff_id") or "")),
        )
        form_classes = [{"class_name": r[0]} for r in cur.fetchall()]

        # Also return staff profile (signature included for the profile page).
        #
        # `role` was never in the SELECT above, so `staff.get("role") if "role"
        # in staff else None` always evaluated to None and the profile page's
        # role display has been permanently blank. It is selected now.
        #
        # `is_moderator` rides along for the same reason and matters more: the
        # staff session cookie is minted at login with a 12-hour TTL, so a
        # member promoted a minute ago still carries is_moderator=false in their
        # cookie and would not see their Admin Portal link until they signed out
        # and back in. Reading it live here lets the layout use the current value
        # instead of a stale claim.
        return {
            "staff": {
                "id": str(staff.get("id")),
                "staff_id": staff.get("staff_id"),
                "full_name": staff_name,
                "role": staff.get("role"),
                "is_moderator": bool(staff.get("is_moderator")),
                "signature_url": staff.get("signature_url") or None,
                "signature_data": staff.get("signature_data") or None,
            },
            "allocations": allocs,
            "count": len(allocs),
            "form_classes": form_classes,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[staff_auth] dashboard failed for {tid}/{sid}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load dashboard: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# PATCH profile — self-service signature upload (staff-only).
# NOTE: staff_ids may contain "/" (e.g. "staff/001"), which cannot travel
# safely in a path segment across server versions. The canonical route is
# PATCH /profile?staff_id=... ; /{identifier}/profile is kept for backward
# compatibility (slash-free identifiers only).
# ---------------------------------------------------------------------------

class StaffProfileUpdate(BaseModel):
    signature_url: Optional[str] = Field(default=None, max_length=512)
    # Drawn signature, stored inline as a base64 PNG data URI. Mutually
    # exclusive with signature_url (see the single-signature rule below).
    #
    # NOT Field(max_length=...): the cap is enforced in _update_staff_signature
    # via the shared validator, which also checks the PNG magic bytes. A Pydantic
    # length cap alone would accept an arbitrary base64 blob.
    signature_data: Optional[str] = None


def _update_staff_signature(
    tid: str,
    ident: str,
    signature_url: Optional[str],
    signature_data: Optional[str] = None,
) -> dict:
    from services.db_manager import TENANT_STAFF_TABLE, _connect_as_superuser, _row_to_dict
    from services.signature_data import validate_signature_data as _validate_sig
    from datetime import datetime

    ident = (ident or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="identifier is required")

    # At least one signature field must be present in the payload.
    if signature_url is None and signature_data is None:
        raise HTTPException(status_code=400, detail="signature_url or signature_data is required")

    # Validate the drawn payload BEFORE any DB work, so a malformed one costs
    # nothing and can never half-apply.
    sig_data = None
    if signature_data is not None:
        try:
            sig_data = _validate_sig(signature_data, "signature_data")
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    url = signature_url.strip() if isinstance(signature_url, str) else None
    if isinstance(signature_url, str) and len(url or "") > 512:
        raise HTTPException(status_code=422, detail="signature_url too long (max 512 chars)")

    # Single-signature rule: exactly one may be active. A drawn signature clears
    # the uploaded URL and vice versa, so a teacher can never end up with two
    # candidate images and no defined precedence at render time.
    if signature_data is not None:
        url = None
    else:
        sig_data = None

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE {TENANT_STAFF_TABLE}
            SET signature_url = %s, signature_data = %s
            WHERE subdomain = %s
              AND (LOWER(staff_id) = LOWER(%s) OR id::text = %s OR LOWER(email) = LOWER(%s))
            RETURNING id, subdomain, staff_id, full_name, email, phone, role,
                      signature_url, signature_data, created_at;
            """,
            (url or None, sig_data, tid, ident, ident, ident),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Staff not found")
        row = cur.fetchone()
        conn.commit()
        d = _row_to_dict(row, cur)
        d["id"] = str(d["id"])
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        return {"success": True, "staff": d}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[staff_auth] profile update failed for {tid}/{ident}: {e}")
        raise HTTPException(status_code=500, detail=f"Profile update failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.patch("/profile", summary="Update own staff profile via query identifier")
def update_staff_profile_by_query(
    tenant_id: str,
    payload: StaffProfileUpdate,
    staff_id: Optional[str] = Query(None),
):
    """Canonical self-edit route. Identity enforcement (caller may only edit
    their own row) lives in the Next.js proxy via staff_session; this router
    trusts the proxy under the shared secret (established pattern).
    """
    tid = _validate_tenant_id(tenant_id)
    return _update_staff_signature(tid, staff_id or "", payload.signature_url, payload.signature_data)


@router.patch("/{identifier}/profile", summary="Update own staff profile (signature)")
def update_staff_profile(tenant_id: str, identifier: str, payload: StaffProfileUpdate):
    """Legacy path variant — kept for backward compatibility (slash-free IDs)."""
    tid = _validate_tenant_id(tenant_id)
    return _update_staff_signature(tid, identifier, payload.signature_url, payload.signature_data)


@router.get("/dashboard", summary="Get staff dashboard allocations (query-param staff_id)")
def staff_dashboard_by_query(tenant_id: str, staff_id: str = ""):
    """Query-param variant — the canonical route for staff_ids containing "/"."""
    tid = _validate_tenant_id(tenant_id)
    sid = (staff_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="staff_id is required")
    return _load_staff_dashboard(tid, sid)


@router.get("/{staff_id}/dashboard", summary="Get staff dashboard allocations")
def staff_dashboard(tenant_id: str, staff_id: str):
    """Legacy path variant — kept for backward compatibility (slash-free IDs)."""
    tid = _validate_tenant_id(tenant_id)
    sid = (staff_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="staff_id is required")
    return _load_staff_dashboard(tid, sid)


# ---------------------------------------------------------------------------
# POST /password — staff self-service credential change
# ---------------------------------------------------------------------------


@router.post("/password", summary="Change this staff member's password")
def change_staff_password(
    tenant_id: str,
    payload: StaffPasswordChange,
    request: Request = None,  # type: ignore[assignment]
):
    """Verify the current password, then set the new one.

    staff_id arrives in the BODY, not as a path param. FastAPI silently
    promotes an untyped path-style parameter to a QUERY parameter, which is how
    an early version of the student equivalent rejected every real request with
    a 422 while still reading as correct.

    Identity is established by the Next.js proxy, which reads the signed
    staff_session cookie and substitutes its own staff_id — whatever arrives in
    this body is only ever the value the proxy chose to forward.

    The current password is required so a left-open session on a shared staff
    room machine cannot silently reassign the account to whoever finds it next.

    must_change_password is cleared here. That column is the ONLY thing that
    clears it — the proxy deliberately does not clear it from the cookie, so a
    stale cookie cannot be used to fake having changed the password.
    """
    from services.db_manager import (
        TENANT_STAFF_TABLE,
        _connect_as_superuser,
    )

    tid = _validate_tenant_id(tenant_id)
    sid = (payload.staff_id or "").strip()
    current = payload.current_password or ""
    new = payload.new_password or ""

    if not sid:
        raise HTTPException(status_code=400, detail="staff_id is required")
    if not current or not new:
        raise HTTPException(
            status_code=400,
            detail="current_password and new_password are required",
        )
    if len(new) < MIN_STAFF_PASSWORD:
        raise HTTPException(
            status_code=400,
            detail=f"New password must be at least {MIN_STAFF_PASSWORD} characters",
        )
    if len(new) > MAX_PASSWORD_LEN:
        raise HTTPException(status_code=400, detail="New password is too long")
    if current == new:
        raise HTTPException(
            status_code=400,
            detail="New password must differ from the current one",
        )

    _throttle_password_flow(request, tid, sid)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        # The current-password check IS the WHERE clause. One statement means
        # there is no read-then-write window where two concurrent requests could
        # both pass a check and the second silently overwrite the first.
        #
        # The OR lets the caller identify the row by either the human staff_id
        # (which may contain "/" and so cannot be trusted through a path segment)
        # or the UUID, matching every other lookup in this router.
        cur.execute(
            f"""
            UPDATE {TENANT_STAFF_TABLE}
            SET password_hash = crypt(%s, gen_salt('bf')),
                must_change_password = FALSE
            WHERE subdomain = %s
              AND (LOWER(staff_id) = LOWER(%s) OR id::text = %s)
              AND password_hash = crypt(%s, password_hash)
            RETURNING staff_id;
            """,
            (new, tid, sid, sid, current),
        )
        row = cur.fetchone()
        conn.commit()

        if row is None:
            # Wrong current password, or no such row. Same 401 for both so this
            # is not an existence oracle.
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        logger.info("[staff_auth] password changed for %s/%s", tid, sid)
        return {"success": True, "subdomain": tid, "staff_id": str(row[0])}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

