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
    total: int = 0
    page: int = 1
    limit: int = 20
    # Using generic list to avoid circular import at module load; response will be TenantMetadata[]
    # FastAPI will serialize via _normalize helper below


# NOTE (ghost-bug bypass): this detail endpoint reads the registry directly and
# intentionally does NOT filter deleted_at — the public tenant_lookup 404s
# deleted schools, but superadmin CRM must still open them to restore.
@router.get("/tenants/{subdomain}", summary="Single tenant detail (superadmin)")
def get_tenant_detail(subdomain: str):
    from services.db_manager import get_school_by_subdomain
    from main import TenantMetadata
    tid = (subdomain or "").lower().strip()
    school = get_school_by_subdomain(tid)
    if school is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
    school = _normalize_school_row(school)
    return {"school": TenantMetadata(**school).model_dump()}


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
    for ts_field in ("created_at", "updated_at", "deleted_at"):
        if ts_field not in row:
            continue
        value = row.get(ts_field)
        if value is None:
            row[ts_field] = None
        elif isinstance(value, datetime):
            row[ts_field] = value.isoformat()
        else:
            row[ts_field] = str(value)
    return row


@router.get("/tenants", summary="List all tenants ordered by created_at DESC (Super Admin)")
def list_tenants(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = None,
    status: Optional[str] = None,
):
    """
    Paginated tenant directory. `search` matches subdomain/school_name/email
    (ILIKE). `status`: active | unpaid | suspended | all (default all).
    Returns {tenants, total, page, limit}.
    """
    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict
    from main import TenantMetadata

    page = max(1, int(page or 1))
    limit = max(1, min(int(limit or 20), 100))
    offset = (page - 1) * limit
    q = (search or "").strip()
    status_f = (status or "all").strip().lower()

    if status_f == "deleted":
        # Superadmin recycle view: ONLY deleted rows.
        where = ["deleted_at IS NOT NULL"]
    else:
        where = ["deleted_at IS NULL"]
    params: list = []
    if q:
        where.append("(subdomain ILIKE %s OR school_name ILIKE %s OR email ILIKE %s)")
        like = f"%{q}%"
        params.extend([like, like, like])
    if status_f == "active":
        where.append("subscription_status = 'active' AND is_active = TRUE")
    elif status_f == "unpaid":
        where.append("(subscription_status IS NULL OR subscription_status = '' OR subscription_status = 'unpaid')")
    elif status_f == "suspended":
        where.append("is_active = FALSE")
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Explicit columns (avoid SELECT * fragility) — same order as get_school_by_subdomain
        cur.execute(
            f"""
            SELECT COUNT(*) FROM {SCHOOLS_REGISTRY_TABLE} {where_sql};
            """,
            tuple(params),
        )
        total = int(cur.fetchone()[0] or 0)
        cur.execute(
            f"""
            SELECT id, subdomain, school_name, email, phone, address, city, state, country,
                   logo_url, hero_bg_url, motto, proprietor_name, registration_number,
                    is_verified, is_active, subscription_plan, subscription_status, student_count,
                    credit_balance, slots_balance, id_prefix, staff_id_prefix, current_term, current_session, new_term_begins, deleted_at, created_at, updated_at
            FROM {SCHOOLS_REGISTRY_TABLE}
            {where_sql}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s;
            """,
            tuple(params) + (limit, offset),
        )
        rows = cur.fetchall()
        tenants = []
        for r in rows:
            d = _row_to_dict(r, cur)
            d = _normalize_school_row(d)
            # Validate via Pydantic (ensures shape parity)
            tenants.append(TenantMetadata(**d).model_dump())
        return {"tenants": tenants, "total": total, "page": page, "limit": limit}
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
                      credit_balance, slots_balance, id_prefix, staff_id_prefix, current_term, current_session, new_term_begins, created_at, updated_at;
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
    from services.db_manager import set_credit_price, log_admin_action

    try:
        new_price = set_credit_price(int(price))
        log_admin_action("credit_price.set", None, {"credit_price": new_price})
        return {"success": True, "credit_price": new_price}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Command Center CRM — status, grants, password reset, ledger, stats, audit
# ---------------------------------------------------------------------------

class TenantStatusUpdate(BaseModel):
    is_active: Optional[bool] = None
    subscription_status: Optional[str] = None
    reason: Optional[str] = None


@router.patch("/tenants/{subdomain}/status", summary="Suspend / reactivate a tenant (superadmin)")
def set_tenant_status(subdomain: str, payload: TenantStatusUpdate):
    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict, log_admin_action
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS, TenantMetadata

    tid = (subdomain or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail="Invalid subdomain")
    updates: dict = {}
    if payload.is_active is not None:
        updates["is_active"] = bool(payload.is_active)
    if payload.subscription_status is not None:
        s = payload.subscription_status.strip().lower()
        if s not in ("active", "unpaid", "suspended"):
            raise HTTPException(status_code=400, detail="subscription_status must be active, unpaid or suspended")
        updates["subscription_status"] = s
        if s == "suspended":
            updates["is_active"] = False
        if s == "active":
            updates["is_active"] = True
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update (is_active, subscription_status)")
    reason = (payload.reason or "").strip() or None
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        set_clause = ", ".join(f"{c} = %s" for c in updates)
        cur.execute(
            f"UPDATE {SCHOOLS_REGISTRY_TABLE} SET {set_clause}, updated_at = NOW() WHERE subdomain = %s RETURNING subdomain;",
            tuple(updates.values()) + (tid,),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
        conn.commit()
        details = dict(updates)
        if reason:
            details["reason"] = reason
        log_admin_action("tenant.status", tid, details)
        _logger.info(f"[admin] Tenant {tid} status -> {updates}")
        return {"success": True, "subdomain": tid, "updates": updates}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        _logger.exception(f"[admin] status update failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Status update failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


class TenantGrantRequest(BaseModel):
    token_type: str = "CREDIT"
    amount: int = 0


@router.post("/tenants/{subdomain}/grant", summary="Grant free credits/slots (superadmin)")
def grant_tenant_tokens(subdomain: str, payload: TenantGrantRequest):
    """Free manual grant — amount_ngn stays 0 (excluded from MRR). Audited."""
    from services.db_manager import (
        SCHOOLS_REGISTRY_TABLE,
        BILLING_LEDGER_TABLE,
        _connect_as_superuser,
        log_admin_action,
    )
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (subdomain or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail="Invalid subdomain")
    ttype = (payload.token_type or "").strip().upper()
    amount = int(payload.amount or 0)
    if ttype not in ("CREDIT", "SLOT"):
        raise HTTPException(status_code=400, detail="token_type must be CREDIT or SLOT")
    if amount <= 0 or amount > 10000:
        raise HTTPException(status_code=400, detail="amount must be 1-10000")
    import time as _time

    ref = f"grant:{tid}:{ttype}:{amount}:{int(_time.time())}"
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        balance_col = "credit_balance" if ttype == "CREDIT" else "slots_balance"
        txn = "GRANT_CREDITS" if ttype == "CREDIT" else "GRANT_SLOTS"
        cur.execute(
            f"""
            INSERT INTO {BILLING_LEDGER_TABLE}
                (subdomain, token_type, amount, transaction_type, reference_id, description, amount_ngn)
            VALUES (%s, %s, %s, %s, %s, %s, 0)
            ON CONFLICT (reference_id) DO NOTHING
            RETURNING id;
            """,
            (tid, ttype, amount, txn, ref, f"Superadmin grant: {amount} {ttype.lower()}"),
        )
        cur.execute(
            f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET {balance_col} = COALESCE({balance_col}, 0) + %s, updated_at = NOW()
            WHERE subdomain = %s
            RETURNING {balance_col};
            """,
            (amount, tid),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute("ROLLBACK;")
            raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")
        cur.execute("COMMIT;")
        new_balance = int(row[0] or 0)
        log_admin_action("tenant.grant", tid, {"token_type": ttype, "amount": amount, "new_balance": new_balance})
        _logger.info(f"[admin] Granted {amount} {ttype} to '{tid}' (balance {new_balance})")
        return {"success": True, "subdomain": tid, "token_type": ttype, "granted": amount, "new_balance": new_balance}
    except HTTPException:
        raise
    except Exception as e:
        try:
            if conn:
                with conn.cursor() as rb:
                    rb.execute("ROLLBACK;")
        except Exception:
            pass
        _logger.exception(f"[admin] grant failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Grant failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/tenants/{subdomain}/reset-password", summary="One-time admin password reset (superadmin)")
def reset_tenant_password(subdomain: str):
    """Generates a temp password, hashes it in, returns plaintext ONCE. Audited (hash only)."""
    from services.db_manager import set_admin_password_hash, log_admin_action
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS
    import secrets as _secrets
    import string as _string

    tid = (subdomain or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail="Invalid subdomain")
    alphabet = _string.ascii_letters + _string.digits
    while True:
        temp = "".join(_secrets.choice(alphabet) for _ in range(12))
        if any(c.islower() for c in temp) and any(c.isupper() for c in temp) and any(c.isdigit() for c in temp):
            break
    try:
        set_admin_password_hash(tid, temp)
    except ValueError as e:
        raise HTTPException(status_code=404 if "Unknown tenant" in str(e) else 400, detail=str(e))
    log_admin_action("tenant.password_reset", tid, {})
    _logger.info(f"[admin] Password reset for '{tid}'")
    return {"success": True, "subdomain": tid, "temp_password": temp}


@router.get("/ledger", summary="Global platform ledger (superadmin)")
def global_ledger(
    token_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    subdomain: Optional[str] = None,
):
    """Cross-tenant billing_ledger with school names. Newest first."""
    from services.db_manager import BILLING_LEDGER_TABLE, SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict

    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    ttype = (token_type or "").strip().upper() or None
    if ttype and ttype not in ("SLOT", "CREDIT"):
        raise HTTPException(status_code=400, detail="token_type must be SLOT or CREDIT")
    where = []
    params: list = []
    if ttype:
        where.append("l.token_type = %s")
        params.append(ttype)
    if subdomain and subdomain.strip():
        where.append("l.subdomain = %s")
        params.append(subdomain.strip().lower())
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {BILLING_LEDGER_TABLE} l {where_sql};", tuple(params))
        total = int(cur.fetchone()[0] or 0)
        cur.execute(
            f"""
            SELECT l.id, l.subdomain, s.school_name, l.token_type, l.amount,
                   l.transaction_type, l.reference_id, l.description,
                   COALESCE(l.amount_ngn, 0) AS amount_ngn, l.created_at
            FROM {BILLING_LEDGER_TABLE} l
            LEFT JOIN {SCHOOLS_REGISTRY_TABLE} s ON s.subdomain = l.subdomain
            {where_sql}
            ORDER BY l.created_at DESC
            LIMIT %s OFFSET %s;
            """,
            tuple(params) + (limit, offset),
        )
        rows = cur.fetchall()
        entries = []
        for r in rows:
            d = _row_to_dict(r, cur)
            d["created_at"] = d["created_at"].isoformat() if hasattr(d.get("created_at"), "isoformat") else str(d.get("created_at") or "")
            entries.append(d)
        return {"entries": entries, "total": total, "limit": limit, "offset": offset}
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception(f"[admin] global ledger failed: {e}")
        raise HTTPException(status_code=500, detail=f"Ledger query failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.get("/ledger/export", summary="Stream full ledger as CSV (superadmin)")
def export_ledger_csv(token_type: Optional[str] = None, subdomain: Optional[str] = None):
    """Streams the (filtered) ledger as CSV using stdlib csv — no pagination bottleneck."""
    import csv as _csv
    import io as _io
    from fastapi.responses import StreamingResponse
    from services.db_manager import BILLING_LEDGER_TABLE, SCHOOLS_REGISTRY_TABLE, _connect_as_superuser

    ttype = (token_type or "").strip().upper() or None
    if ttype and ttype not in ("SLOT", "CREDIT"):
        raise HTTPException(status_code=400, detail="token_type must be SLOT or CREDIT")
    where = []
    params: list = []
    if ttype:
        where.append("l.token_type = %s")
        params.append(ttype)
    if subdomain and subdomain.strip():
        where.append("l.subdomain = %s")
        params.append(subdomain.strip().lower())
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    def row_iter():
        buf = _io.StringIO()
        writer = _csv.writer(buf)
        writer.writerow(["date", "subdomain", "school_name", "token_type", "amount", "amount_ngn", "transaction_type", "reference_id", "description"])
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        conn = None
        try:
            conn = _connect_as_superuser()
            cur = conn.cursor(name="ledger_export_cursor")
            cur.execute(
                f"""
                SELECT l.created_at, l.subdomain, s.school_name, l.token_type, l.amount,
                       COALESCE(l.amount_ngn, 0), l.transaction_type, l.reference_id, l.description
                FROM {BILLING_LEDGER_TABLE} l
                LEFT JOIN {SCHOOLS_REGISTRY_TABLE} s ON s.subdomain = l.subdomain
                {where_sql}
                ORDER BY l.created_at DESC;
                """,
                tuple(params),
            )
            while True:
                batch = cur.fetchmany(1000)
                if not batch:
                    break
                for r in batch:
                    writer.writerow([
                        r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0] or ""),
                        r[1] or "", r[2] or "", r[3] or "", r[4] or 0,
                        r[5] or 0, r[6] or "", r[7] or "", (r[8] or "").replace("\r", " ").replace("\n", " "),
                    ])
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate(0)
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

    return StreamingResponse(
        row_iter(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=resultapp-ledger.csv"},
    )


@router.get("/audit-logs", summary="Superadmin audit trail (superadmin)")
def get_audit_trail(subdomain: Optional[str] = None, limit: int = 50, offset: int = 0):
    from services.db_manager import get_audit_logs

    return {"entries": get_audit_logs(subdomain, limit, offset)}


@router.get("/stats", summary="Platform KPIs: MRR + consumption (superadmin)")
def platform_stats():
    """MRR from immutable amount_ngn PURCHASE rows (this vs last month);
    total credits consumed globally (negative CREDIT amounts)."""
    from services.db_manager import BILLING_LEDGER_TABLE, SCHOOLS_REGISTRY_TABLE, _connect_as_superuser

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT COALESCE(SUM(amount_ngn), 0) FROM {BILLING_LEDGER_TABLE}
            WHERE transaction_type IN ('CREDIT_PURCHASE', 'SLOT_PURCHASE')
              AND date_trunc('month', created_at) = date_trunc('month', NOW());
            """
        )
        mrr_this = int(cur.fetchone()[0] or 0)
        cur.execute(
            f"""
            SELECT COALESCE(SUM(amount_ngn), 0) FROM {BILLING_LEDGER_TABLE}
            WHERE transaction_type IN ('CREDIT_PURCHASE', 'SLOT_PURCHASE')
              AND date_trunc('month', created_at) = date_trunc('month', NOW() - INTERVAL '1 month');
            """
        )
        mrr_last = int(cur.fetchone()[0] or 0)
        cur.execute(
            f"""
            SELECT COALESCE(SUM(ABS(amount)), 0) FROM {BILLING_LEDGER_TABLE}
            WHERE token_type = 'CREDIT' AND amount < 0;
            """
        )
        credits_consumed = int(cur.fetchone()[0] or 0)
        cur.execute(f"SELECT COUNT(*) FROM {SCHOOLS_REGISTRY_TABLE};")
        schools = int(cur.fetchone()[0] or 0)
        cur.execute(
            f"SELECT COUNT(*) FROM {SCHOOLS_REGISTRY_TABLE} WHERE subscription_status = 'active' AND is_active = TRUE;"
        )
        active_schools = int(cur.fetchone()[0] or 0)
        return {
            "mrr_this_month_ngn": mrr_this,
            "mrr_last_month_ngn": mrr_last,
            "mrr_delta_ngn": mrr_this - mrr_last,
            "total_credits_consumed": credits_consumed,
            "total_schools": schools,
            "active_schools": active_schools,
        }
    except Exception as e:
        _logger.exception(f"[admin] stats failed: {e}")
        raise HTTPException(status_code=500, detail=f"Stats failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
