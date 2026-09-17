"""
Phase 4 — Super Admin router (platform owner).
Modular router per decision 1 (mirrors backend/routers/grading.py).
Prefix: /api/v1/admin
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

# Lazy verify to avoid circular import at module load (same pattern as grading.py)
from typing import Optional as _Optional
from fastapi import Header as _Header
import os as _os
import logging as _logging

_logger = _logging.getLogger(__name__)

async def _verify_superadmin_secret(
    x_api_secret_key: _Optional[str] = _Header(None, alias="X-API-SECRET-KEY"),
):
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        from fastapi import HTTPException as _HTTPException, status as _status

        API_SECRET = _os.getenv("API_SECRET_KEY", "")
        ENV = _os.getenv("ENV", "production")
        if not API_SECRET:
            if ENV != "production":
                _logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
                return True
            raise _HTTPException(status_code=_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Server misconfigured: API_SECRET_KEY not set")
        if not x_api_secret_key:
            raise _HTTPException(status_code=_status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, API_SECRET):
            raise _HTTPException(status_code=_status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(_verify_superadmin_secret)])


# Reuse TenantMetadata shape from main (import at request time to avoid circular)
def _tenant_metadata_model():
    from main import TenantMetadata

    return TenantMetadata


class TenantsListResponse(BaseModel):
    tenants: list
    # Using generic list to avoid circular import at module load; response will be TenantMetadata[]
    # FastAPI will serialize via _normalize helper below


def _normalize_school_row(row: dict):
    """Mirror tenant_lookup normalization (main.py:292)."""
    city = row.get("city") or None
    state = row.get("state") or None
    row["location"] = ", ".join(filter(None, [city, state])) or None
    row["status"] = "active" if row.get("is_active") else "inactive"
    row["id"] = str(row.get("id", ""))
    for ts_field in ("created_at", "updated_at"):
        value = row.get(ts_field)
        if isinstance(value, datetime):
            row[ts_field] = value.isoformat()
        else:
            row[ts_field] = str(value or "")
    return row


@router.get("/tenants", summary="List all tenants ordered by created_at DESC (Super Admin)")
def list_tenants():
    """
    Raw psycopg2 SELECT * FROM schools ORDER BY created_at DESC.
    Returns list[ TenantMetadata ] serialized like tenant_lookup.
    Protected by verify_api_secret (secret-proxied via Next.js).
    """
    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict
    from main import TenantMetadata

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Explicit columns (avoid SELECT * fragility) — same order as get_school_by_subdomain
        cur.execute(
            f"""
            SELECT id, subdomain, school_name, email, phone, address, city, state, country,
                   logo_url, motto, proprietor_name, registration_number,
                   is_verified, is_active, subscription_plan, subscription_status, student_count,
                   created_at, updated_at
            FROM {SCHOOLS_REGISTRY_TABLE}
            ORDER BY created_at DESC
            """
        )
        rows = cur.fetchall()
        tenants = []
        for r in rows:
            d = _row_to_dict(r, cur)
            d = _normalize_school_row(d)
            # Validate via Pydantic (ensures shape parity)
            tenants.append(TenantMetadata(**d).model_dump())
        return {"tenants": tenants}
    except Exception as e:
        _logger.exception(f"[admin] list_tenants failed: {e}")
        from fastapi import HTTPException as _HTTPException

        raise _HTTPException(status_code=500, detail=f"Failed to list tenants: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
