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
    logger.info(f"[platform_auth] login success {email} ({admin.get('role')})")
    return {"admin": admin}


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
