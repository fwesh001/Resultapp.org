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
    # new_term_begins is VARCHAR date string, keep as is or empty
    if "new_term_begins" in row and row["new_term_begins"] is not None:
        row["new_term_begins"] = str(row["new_term_begins"]).strip()
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
                   logo_url, hero_bg_url, motto, proprietor_name, registration_number,
                    is_verified, is_active, subscription_plan, subscription_status, student_count,
                    credit_balance, slots_balance, id_prefix, current_term, current_session, new_term_begins, created_at, updated_at
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


# ---------------------------------------------------------------------------
# Tenant profile & branding — PATCH /api/v1/tenant/{tenant_id}/profile
# ---------------------------------------------------------------------------

# Separate router (no /api/v1/admin prefix) so the route lives at
# /api/v1/tenant/{tenant_id}/profile. Protected by the same API secret.
profile_router = APIRouter(tags=["tenancy"], dependencies=[Depends(_verify_superadmin_secret)])


class TenantProfileUpdate(BaseModel):
    school_name: Optional[str] = None
    motto: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    logo_url: Optional[str] = None
    hero_bg_url: Optional[str] = None
    new_term_begins: Optional[str] = None
    id_prefix: Optional[str] = None
    staff_id_prefix: Optional[str] = None
    current_term: Optional[str] = None
    current_session: Optional[str] = None


@profile_router.patch("/api/v1/tenant/{tenant_id}/profile", summary="Update school profile & branding")
def update_tenant_profile(tenant_id: str, payload: TenantProfileUpdate):
    """
    Update a tenant's public profile (school_name, motto, phone, email,
    address, logo_url, hero_bg_url) via raw psycopg2
    UPDATE schools SET ... WHERE subdomain = %s.
    Returns the updated tenant. Protected by verify_api_secret.
    """
    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS, TenantMetadata

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")

    data = payload.model_dump(exclude_none=True)
    if "school_name" in data:
        name = (data["school_name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="school_name cannot be empty")
        if len(name) > 120:
            raise HTTPException(status_code=400, detail="school_name too long (max 120 chars)")
        data["school_name"] = name
    # Normalize term/session enums
    if "current_term" in data:
        ct = (data["current_term"] or "").strip()
        if ct and ct not in ("Term 1", "Term 2", "Term 3"):
            raise HTTPException(status_code=400, detail="current_term must be Term 1, Term 2 or Term 3")
        data["current_term"] = ct or None
    if "current_session" in data:
        cs = (data["current_session"] or "").strip()
        if cs and not __import__("re").match(r"^\d{4}/\d{4}$", cs):
            raise HTTPException(status_code=400, detail="current_session must be YYYY/YYYY (e.g. 2026/2027)")
        data["current_session"] = cs or None
    if "id_prefix" in data:
        raw_prefix = (data["id_prefix"] or "").strip().lower()
        if not raw_prefix:
            data["id_prefix"] = None
        elif not __import__("re").match(r"^[a-z0-9/-]{2,20}$", raw_prefix):
            raise HTTPException(status_code=400, detail="id_prefix must be 2-20 chars (a-z, 0-9, /, -)")
        else:
            data["id_prefix"] = raw_prefix
    if "staff_id_prefix" in data:
        # Uppercase preserved (e.g. STAFF/) — mirrors student prefix format rules.
        raw_sprefix = (data["staff_id_prefix"] or "").strip()
        if not raw_sprefix:
            data["staff_id_prefix"] = None
        elif not __import__("re").match(r"^[A-Za-z0-9/-]{2,20}$", raw_sprefix):
            raise HTTPException(status_code=400, detail="staff_id_prefix must be 2-20 chars (A-Z, 0-9, /, -)")
        else:
            data["staff_id_prefix"] = raw_sprefix
    # Normalize blank optional strings to NULL so cleared fields don't store ""
    for key in ("motto", "phone", "email", "address", "logo_url", "hero_bg_url", "new_term_begins"):
        if key in data and isinstance(data[key], str) and not data[key].strip():
            data[key] = None

    allowed = ("school_name", "motto", "phone", "email", "address", "logo_url", "hero_bg_url", "new_term_begins", "id_prefix", "staff_id_prefix", "current_term", "current_session")
    updates = {k: data[k] for k in allowed if k in data}
    if not updates:
        raise HTTPException(status_code=400, detail="No profile fields provided")

    set_clause = ", ".join(f"{col} = %s" for col in updates)
    values = list(updates.values()) + [tid]

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET {set_clause}, updated_at = NOW()
            WHERE subdomain = %s
            RETURNING id, subdomain, school_name, email, phone, address, city, state, country,
                      logo_url, hero_bg_url, motto, proprietor_name, registration_number,
                      is_verified, is_active, subscription_plan, subscription_status, student_count,
                      credit_balance, slots_balance, id_prefix, current_term, current_session, new_term_begins, created_at, updated_at;
            """,
            tuple(values),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
        row = cur.fetchone()
        conn.commit()
        school = _normalize_school_row(_row_to_dict(row, cur))
        _logger.info(f"[admin] Tenant {tid} profile updated ({', '.join(updates)})")
        return {
            "success": True,
            "message": f"Tenant {tid} profile updated",
            "school": TenantMetadata(**school).model_dump(),
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        _logger.exception(f"[admin] update_tenant_profile failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Profile update failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.get("/config/credit-price", summary="Get flat credit price (superadmin)")
def get_credit_price_config():
    from services.db_manager import get_credit_price

    return {"credit_price": get_credit_price()}


@router.put("/config/credit-price", summary="Set flat credit price (superadmin)")
def set_credit_price_config(payload: dict):
    price = payload.get("credit_price") if isinstance(payload, dict) else None
    if price is None:
        raise HTTPException(status_code=400, detail="credit_price is required")
    from services.db_manager import set_credit_price

    try:
        new_price = set_credit_price(int(price))
        return {"success": True, "credit_price": new_price}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
