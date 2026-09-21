"""
Phase 2: Admin Authentication — per-tenant admin portal.
Prefix: /api/v1/tenant/{tenant_id}/admin
Protected by _verify_allocations_secret fallback (system-to-system),
mirroring routers/staff_auth.py.

Credential store: schools.admin_password_hash (pgcrypto bcrypt).
Pre-existing schools have NULL hash until they complete the one-time
setup flow — login surfaces code=PASSWORD_NOT_SET so the frontend can
show a friendly "set up your admin password" banner instead of a bare 401.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
import os
import logging

logger = logging.getLogger(__name__)


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


router = APIRouter(prefix="/api/v1/tenant/{tenant_id}/admin", tags=["admin-auth"], dependencies=[Depends(_verify_allocations_secret)])


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


# ---------------------------------------------------------------------------
# POST /login — Admin Email + Password
# ---------------------------------------------------------------------------

class AdminLoginRequest(BaseModel):
    identifier: str = Field(..., description="Admin email")
    password: str = Field(..., description="Admin password")


@router.post("/login", summary="Admin login via email + password")
def admin_login(tenant_id: str, payload: AdminLoginRequest):
    tid = _validate_tenant_id(tenant_id)
    identifier = (payload.identifier or "").strip().lower()
    password = payload.password or ""

    if not identifier or not password:
        raise HTTPException(status_code=400, detail="identifier and password are required")

    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Fetch registry row first so NULL-hash (legacy) schools get a
        # friendly PASSWORD_NOT_SET instead of a bare "invalid credentials".
        cur.execute(
            f"""
            SELECT subdomain, school_name, email, admin_password_hash
            FROM {SCHOOLS_REGISTRY_TABLE}
            WHERE subdomain = %s AND LOWER(email) = LOWER(%s)
            """,
            (tid, identifier),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        d = _row_to_dict(row, cur)

        if d.get("admin_password_hash") is None:
            raise HTTPException(
                status_code=403,
                detail="PASSWORD_NOT_SET: Please set up your admin password using the reset link.",
            )

        # Verify password via pgcrypto crypt (same pattern as staff_auth).
        cur.execute(
            f"""
            SELECT subdomain, school_name, email
            FROM {SCHOOLS_REGISTRY_TABLE}
            WHERE subdomain = %s AND LOWER(email) = LOWER(%s)
              AND admin_password_hash = crypt(%s, admin_password_hash)
            """,
            (tid, identifier, password),
        )
        ok_row = cur.fetchone()
        if ok_row is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        ok = _row_to_dict(ok_row, cur)
        logger.info(f"[admin_auth] login success {tid}/{identifier}")
        return {
            "admin": {"email": ok.get("email"), "school_name": ok.get("school_name")},
            "tenant_id": tid,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[admin_auth] login failed for {tid}/{identifier}: {e}")
        raise HTTPException(status_code=500, detail=f"Login failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# POST /set-password — one-time setup for legacy NULL-hash schools
# ---------------------------------------------------------------------------

class AdminSetPasswordRequest(BaseModel):
    email: str = Field(..., description="Admin email (must match registry)")
    new_password: str = Field(..., min_length=8, max_length=128)


@router.post("/set-password", summary="One-time admin password setup (legacy NULL-hash schools)")
def admin_set_password(tenant_id: str, payload: AdminSetPasswordRequest):
    """Bootstrap flow: allowed ONLY when no hash is set yet.

    Once a hash exists, this endpoint refuses (403) — further changes go
    through /change-password with the current password.
    """
    tid = _validate_tenant_id(tenant_id)
    email = (payload.email or "").strip().lower()
    new_password = payload.new_password or ""
    if not email or not new_password:
        raise HTTPException(status_code=400, detail="email and new_password are required")
    if len(new_password) < 8 or len(new_password) > 128:
        raise HTTPException(status_code=400, detail="Password must be 8-128 characters")

    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT email, admin_password_hash
            FROM {SCHOOLS_REGISTRY_TABLE}
            WHERE subdomain = %s AND LOWER(email) = LOWER(%s)
            """,
            (tid, email),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Admin email not found for this school")
        if row[1] is not None:
            raise HTTPException(
                status_code=403,
                detail="Password already set — sign in, or use change-password.",
            )
        cur.execute(
            f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET admin_password_hash = crypt(%s, gen_salt('bf')),
                updated_at = NOW()
            WHERE subdomain = %s AND LOWER(email) = LOWER(%s);
            """,
            (new_password, tid, email),
        )
        conn.commit()
        logger.info(f"[admin_auth] one-time password setup for {tid}/{email}")
        return {"success": True, "tenant_id": tid}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[admin_auth] set-password failed for {tid}/{email}: {e}")
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Could not set password: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# POST /change-password — rotation with current-password check
# ---------------------------------------------------------------------------

class AdminChangePasswordRequest(BaseModel):
    email: str = Field(...)
    current_password: str = Field(...)
    new_password: str = Field(..., min_length=8, max_length=128)


@router.post("/change-password", summary="Rotate admin password (requires current password)")
def admin_change_password(tenant_id: str, payload: AdminChangePasswordRequest):
    tid = _validate_tenant_id(tenant_id)
    email = (payload.email or "").strip().lower()
    if not email or not payload.current_password or not payload.new_password:
        raise HTTPException(status_code=400, detail="email, current_password and new_password are required")

    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT 1 FROM {SCHOOLS_REGISTRY_TABLE}
            WHERE subdomain = %s AND LOWER(email) = LOWER(%s)
              AND admin_password_hash IS NOT NULL
              AND admin_password_hash = crypt(%s, admin_password_hash)
            """,
            (tid, email, payload.current_password),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        cur.execute(
            f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET admin_password_hash = crypt(%s, gen_salt('bf')),
                updated_at = NOW()
            WHERE subdomain = %s AND LOWER(email) = LOWER(%s);
            """,
            (payload.new_password, tid, email),
        )
        conn.commit()
        logger.info(f"[admin_auth] password rotated for {tid}/{email}")
        return {"success": True, "tenant_id": tid}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[admin_auth] change-password failed for {tid}/{email}: {e}")
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Could not change password: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
