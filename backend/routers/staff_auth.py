"""
Staff Authentication & Dashboard — per-tenant staff portal
Prefix: /api/v1/tenant/{tenant_id}/staff
Protected by _verify_allocations_secret fallback (system-to-system)
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
        # Dual-login: staff_id OR email, password validated via pgcrypto crypt
        cur.execute(
            f"""
            SELECT id, staff_id, full_name, email, role
            FROM {TENANT_STAFF_TABLE}
            WHERE subdomain = %s
              AND (staff_id = %s OR email = %s)
              AND password_hash = crypt(%s, password_hash)
            """,
            (tid, identifier, identifier, password),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        d = _row_to_dict(row, cur)
        d["id"] = str(d["id"])
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
# GET /{staff_id}/dashboard — allocations for this staff
# ---------------------------------------------------------------------------

@router.get("/{staff_id}/dashboard", summary="Get staff dashboard allocations")
def staff_dashboard(tenant_id: str, staff_id: str):
    tid = _validate_tenant_id(tenant_id)
    sid = (staff_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="staff_id is required")

    from services.db_manager import TENANT_ALLOCATIONS_TABLE, TENANT_STAFF_TABLE, _connect_as_superuser, _row_to_dict
    from datetime import datetime

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        # Resolve staff full_name via OR query (staff_id string OR UUID)
        # Cast id to text for comparison to allow both
        cur.execute(
            f"""
            SELECT full_name, staff_id, id FROM {TENANT_STAFF_TABLE}
            WHERE subdomain = %s AND (staff_id = %s OR id::text = %s OR email = %s)
            LIMIT 1
            """,
            (tid, sid, sid, sid),
        )
        staff_row = cur.fetchone()
        if staff_row is None:
            raise HTTPException(status_code=404, detail="Staff not found")
        staff = _row_to_dict(staff_row, cur)
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

        # Also return staff profile
        return {
            "staff": {"id": str(staff.get("id")), "staff_id": staff.get("staff_id"), "full_name": staff_name, "role": staff.get("role") if "role" in staff else None},
            "allocations": allocs,
            "count": len(allocs),
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
