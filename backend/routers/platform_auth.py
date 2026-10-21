"""
Multi-user superadmin authentication — platform admins (not tenants).
Prefix: /api/v1/platform
Protected by the same system-to-system X-API-SECRET-KEY gate as other
routers. Returns opaque JSON (no JWT) so Next.js cookie handling matches
the tenant login flows exactly. Tenant isolation: this router never reads
tenant tables, and its session cookie name never overlaps tenant cookies.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
import os
import logging

logger = logging.getLogger(__name__)


async def _verify_platform_secret(
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


router = APIRouter(prefix="/api/v1/platform", tags=["platform-auth"], dependencies=[Depends(_verify_platform_secret)])


class PlatformLoginRequest(BaseModel):
    email: str = Field(..., description="Platform admin email")
    password: str = Field(..., description="Platform admin password")


@router.post("/login", summary="Platform admin login via email + password")
def platform_login(payload: PlatformLoginRequest):
    from services.db_manager import verify_platform_admin

    email = (payload.email or "").strip().lower()
    if not email or not payload.password:
        raise HTTPException(status_code=400, detail="email and password are required")
    admin = verify_platform_admin(email, payload.password)
    if admin is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Returned so the frontend can decide whether to show the verification
    # interstitial. Disclosed only after valid credentials, which is why there
    # is no public "is this address registered?" endpoint to probe.
    from services.db_manager import is_email_verified

    verified = bool(is_email_verified(email, table="platform_admins"))
    admin = {**admin, "email_verified": verified}
    logger.info(f"[platform_auth] login success {email} ({admin.get('role')}, email_verified={verified})")
    return {"admin": admin, "email_verified": verified}


@router.get("/me", summary="Validate a platform admin session")
def platform_me(email: Optional[str] = None):
    """Lightweight existence/active check used by layout guards via proxy."""
    if not email or not email.strip():
        raise HTTPException(status_code=400, detail="email is required")
    from services.db_manager import _connect_as_superuser, _row_to_dict

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, email, role
            FROM platform_admins
            WHERE LOWER(email) = LOWER(%s) AND is_active = TRUE
            LIMIT 1;
            """,
            (email.strip(),),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Unknown or disabled platform admin")
        d = _row_to_dict(row, cur)
        d["id"] = str(d["id"])
        return {"admin": d}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[platform_auth] me failed for {email}: {e}")
        raise HTTPException(status_code=500, detail="Lookup failed")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


class PlatformChangePasswordRequest(BaseModel):
    """Change OWN password from the Command Center (Settings → Security).

    Replaces the SSH rotation script (scripts/set-platform-admin-password.py)
    for the normal case; the script stays as break-glass tooling.
    """

    current_password: str = Field(..., description="Existing password")
    new_password: str = Field(..., description="Replacement password (min 12 chars)")


@router.post("/change-password", summary="Change a platform admin's own password")
def platform_change_password(
    payload: PlatformChangePasswordRequest,
    x_admin_id: Optional[str] = Header(None, alias="X-Admin-Id"),
    x_admin_email: Optional[str] = Header(None, alias="X-Admin-Email"),
):
    """Verifies the CURRENT password server-side, applies the same strength
    rules the CLI enforces, and stores only the pgcrypto bcrypt hash.

    Stateless sessions are NOT revoked by a password change — a live 12-hour
    cookie keeps verifying until expiry (ToS §5.5 documents this residual).
    The acting member's email comes from the verified session via the proxy's
    X-Admin-Email header (audit attribution only — the credential check is
    `current_password`, so a hijacked header changes nothing of substance:
    they must already know the current password to rotate it).
    """
    from services.db_manager import change_platform_admin_password, log_admin_action

    email = (x_admin_email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(
            status_code=400,
            detail="Missing acting member identity — sign in with the per-user superadmin form",
        )
    current = payload.current_password or ""
    new_password = payload.new_password or ""
    if not current or not new_password:
        raise HTTPException(status_code=400, detail="current_password and new_password are required")

    try:
        updated = change_platform_admin_password(email, current, new_password)
    except ValueError as e:
        # Strength rules — surfaced verbatim so the UI message matches the CLI.
        raise HTTPException(status_code=400, detail=str(e))
    if not updated:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    log_admin_action(
        "platform_admin.password_changed",
        None,
        {"email": email},
        actor=email,
        actor_id=x_admin_id,
    )
    logger.info(f"[platform_auth] password changed {email}")
    return {"success": True}
