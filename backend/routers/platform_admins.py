"""
Platform admin management — the data behind the superadmin Team screen.

Prefix: /api/v1/platform/admins

AUTH MODEL — read this before "fixing" it:
    The backend cannot see cookies, so it cannot tell WHICH platform admin a
    request came from. Owner enforcement therefore lives in the Next.js proxy
    (app/api/superadmin/platform-admins/*), which verifies the signed
    superadmin session and refuses non-owners BEFORE speaking to this router.
    What this router does enforce is the shared X-API-SECRET-KEY gate (same
    trust boundary as every other router) and the DATA-level invariants
    (self-demotion, last-owner protection, owner-only page ids), which live in
    services.db_manager.

The Next.js proxy forwards the viewing member's identity in X-Admin-Id /
X-Admin-Email headers purely for audit attribution — never for access
decisions.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


async def _verify_platform_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    """Same shared-secret check as routers/platform_auth.py (lazy import)."""
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        import os

        from fastapi import HTTPException as HTTPExc
        from fastapi import status as Status

        API_SECRET = os.getenv("API_SECRET_KEY", "")
        ENV = os.getenv("ENV", "production")
        if not API_SECRET:
            if ENV != "production":
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
                return True
            raise HTTPExc(
                status_code=Status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfigured: API_SECRET_KEY not set",
            )
        if not x_api_secret_key:
            raise HTTPExc(status_code=Status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, API_SECRET):
            raise HTTPExc(status_code=Status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(
    prefix="/api/v1/platform/admins",
    tags=["platform-admins"],
    dependencies=[Depends(_verify_platform_secret)],
)


class PlatformAdminCreateRequest(BaseModel):
    email: str = Field(..., description="Unique platform admin email")
    password: str = Field(..., description="Initial password (min 12 chars)")
    role: str = Field("support", description="admin | support (owner is bootstrapped by SQL)")
    pages: Optional[List[str]] = Field(None, description="Explicit page allocation; omit for role defaults")


class PlatformAdminUpdateRequest(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    pages: Optional[List[str]] = None


class PlatformAdminPasswordRequest(BaseModel):
    password: str = Field(..., description="New password (min 12 chars)")


@router.get("", summary="List platform admins (superadmin Team screen)")
def list_admins():
    from services.db_manager import list_platform_admins

    try:
        admins = list_platform_admins()
        active_owners = sum(1 for a in admins if a.get("role") == "owner" and a.get("is_active"))
        return {"admins": admins, "total": len(admins), "active_owners": active_owners}
    except Exception as e:
        logger.exception(f"[platform_admins] list failed: {e}")
        raise HTTPException(status_code=500, detail="Lookup failed")


@router.post("", summary="Create a platform admin (owner via Team screen)")
def create_admin(
    payload: PlatformAdminCreateRequest,
    x_admin_id: Optional[str] = Header(None, alias="X-Admin-Id"),
    x_admin_email: Optional[str] = Header(None, alias="X-Admin-Email"),
):
    from services.db_manager import (
        PLATFORM_ADMIN_EMAIL_RE,
        PLATFORM_PAGES,
        create_platform_admin,
        log_admin_action,
        update_platform_admin,
    )

    email = (payload.email or "").strip().lower()
    if not email or not PLATFORM_ADMIN_EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="A valid email is required")
    role = (payload.role or "support").strip().lower()
    if role not in ("admin", "support"):
        # 'owner' cannot be minted from the UI: account promotion is a
        # one-time SQL bootstrap, decided before the first owner signs in.
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'support'")
    if len(payload.password or "") < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")

    scope: Optional[List[str]] = None
    if payload.pages is not None:
        unknown = sorted({p for p in payload.pages if str(p or "").strip() not in PLATFORM_PAGES})
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown page id(s): {', '.join(unknown)}")
        scope = [p for p in payload.pages]

    try:
        admin = create_platform_admin(email, payload.password, role)
    except ValueError as e:
        # Duplicate email / bad input from create_platform_admin.
        raise HTTPException(status_code=400, detail=str(e))
    if scope is not None:
        admin = update_platform_admin(str(admin["id"]), actor_id=None, pages=scope)
    log_admin_action(
        "platform_admin.create",
        None,
        {"email": email, "role": role, "pages": scope},
        actor=x_admin_email or "superadmin",
        actor_id=x_admin_id,
    )
    return {"success": True, "admin": admin}


@router.get("/{admin_id}", summary="One platform admin + effective pages (enforcement lookup)")
def get_admin(
    admin_id: str,
    x_admin_id: Optional[str] = Header(None, alias="X-Admin-Id"),
    x_admin_email: Optional[str] = Header(None, alias="X-Admin-Email"),
):
    from services.db_manager import get_platform_admin_detail

    admin = get_platform_admin_detail((admin_id or "").strip())
    if admin is None:
        raise HTTPException(status_code=404, detail="Unknown platform admin")
    return {"admin": admin}


@router.patch("/{admin_id}", summary="Update a platform admin's role/active/pages (owner)")
def update_admin(
    admin_id: str,
    payload: PlatformAdminUpdateRequest,
    x_admin_id: Optional[str] = Header(None, alias="X-Admin-Id"),
    x_admin_email: Optional[str] = Header(None, alias="X-Admin-Email"),
):
    from services.db_manager import log_admin_action, update_platform_admin

    try:
        admin = update_platform_admin(
            (admin_id or "").strip(),
            actor_id=x_admin_id,
            role=payload.role,
            is_active=payload.is_active,
            pages=payload.pages,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log_admin_action(
        "platform_admin.update",
        None,
        {
            "target": admin.get("email"),
            "role": payload.role,
            "is_active": payload.is_active,
            "pages": payload.pages,
        },
        actor=x_admin_email or "superadmin",
        actor_id=x_admin_id,
    )
    return {"success": True, "admin": admin}


@router.post("/{admin_id}/password", summary="Set a platform admin's password (owner)")
def set_password(
    admin_id: str,
    payload: PlatformAdminPasswordRequest,
    x_admin_id: Optional[str] = Header(None, alias="X-Admin-Id"),
    x_admin_email: Optional[str] = Header(None, alias="X-Admin-Email"),
):
    from services.db_manager import get_platform_admin_detail, log_admin_action, set_platform_admin_password_by_id

    try:
        ok = set_platform_admin_password_by_id((admin_id or "").strip(), payload.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Unknown platform admin")
    admin = get_platform_admin_detail((admin_id or "").strip())
    log_admin_action(
        "platform_admin.password_set",
        None,
        {"target": (admin or {}).get("email")},
        actor=x_admin_email or "superadmin",
        actor_id=x_admin_id,
    )
    return {"success": True}
