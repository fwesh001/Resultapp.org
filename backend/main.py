"""
ResultApp Droplet — FastAPI Provisioning Service
Runs on DigitalOcean Ubuntu Droplet to provision isolated RosarioSIS instances.

Pipeline (POST /api/v1/provision):
  1. Validate X-API-SECRET-KEY
  2. Validate payload (school_name, subdomain, admin_email, student_count)
  3. DB: CREATE DATABASE <subdomain>_db + user (services.db_manager)
  4. FS: copy RosarioSIS template -> /var/www/vhosts/<subdomain>.resultapp.org + write config.inc.php
  5. Nginx: server block -> /etc/nginx/sites-available -> symlink sites-enabled -> nginx -t && reload
  6. Email: Brevo welcome with temp credentials (services.notifier)
  7. Return {deployed_url, timestamp} or rollback with detailed logs

Run:
  uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2

Systemd example: /etc/systemd/system/resultapp-provision.service
Nginx: provisioning service itself behind reverse proxy or direct port
"""

import logging
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Header, HTTPException, Depends, Request, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, field_validator

# Services
from services.db_manager import (
    create_school_database,
    rollback_database,
    database_exists,
    test_connection,
    init_schools_registry,
    register_school,
    get_school_by_subdomain,
)
from services.site_generator import deploy_site, rollback_site, site_exists, generate_temp_credentials, get_domain
from services.notifier import send_welcome_email, send_failure_alert

# Phase 2: Grading router is included after app/lifespan definition to avoid circular import
# (import done near the bottom after verify_api_secret is defined)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_LEVEL = os.getenv("LOG_LEVEL", "info").upper()
LOG_FILE = os.getenv("LOG_FILE", "logs/provisioning.log")
os.makedirs(os.path.dirname(LOG_FILE) if os.path.dirname(LOG_FILE) else ".", exist_ok=True)

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger("provisioning")

# ---------------------------------------------------------------------------
# Lifespan (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure central registry + grading engine + roster tables exist
    try:
        init_schools_registry()
    except Exception as e:
        logger.warning(f"Schools registry init warning: {e}")
    try:
        from services.db_manager import init_roster_registry

        init_roster_registry()
    except Exception as e:
        logger.warning(f"Roster registry init warning: {e}")
    try:
        from database import init_grading_tables

        init_grading_tables()
    except Exception as e:
        logger.warning(f"Grading tables init warning (may be DB unreachable in dev): {e}")
    yield
    # Shutdown: no-op


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ResultApp Provisioning Service",
    description="Automates isolated RosarioSIS instances on DigitalOcean Droplet for resultapp.org",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — restrict to known origins (Next.js / Vercel)
_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

API_SECRET = os.getenv("API_SECRET_KEY", "")
ENV = os.getenv("ENV", "production")
if not API_SECRET and ENV == "production":
    logger.warning("API_SECRET_KEY not set! All provision requests will be rejected in production.")


# ---------------------------------------------------------------------------
# Security dependency
# ---------------------------------------------------------------------------

async def verify_api_secret(x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY")):
    """
    Validate X-API-SECRET-KEY header. Must match API_SECRET_KEY env.
    In non-production without secret configured, allow (with warning) for local dev.
    """
    if not API_SECRET:
        if ENV != "production":
            logger.warning("API_SECRET_KEY missing but ENV!=production — allowing request (dev mode)")
            return True
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server misconfigured: API_SECRET_KEY not set"
        )
    if not x_api_secret_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
    # Constant-time compare not strictly needed here but good practice
    import hmac
    if not hmac.compare_digest(x_api_secret_key, API_SECRET):
        logger.warning(f"Invalid API secret attempt from header: {x_api_secret_key[:8]}...")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
    return True

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class TenantMetadata(BaseModel):
    """Public, snake_case school metadata returned to the Next.js tenant layout.

    Mirrors the schools registry columns plus two computed fields so
    lib/tenant.ts can normalize them into the frontend School type:
      - location: derived from city + state
      - status:   derived from is_active ("active"/"inactive")
    """
    id: str
    subdomain: str
    school_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = "NG"
    logo_url: Optional[str] = None
    hero_bg_url: Optional[str] = None
    motto: Optional[str] = None
    proprietor_name: Optional[str] = None
    registration_number: Optional[str] = None
    is_verified: bool = False
    is_active: bool = True
    subscription_plan: Optional[str] = None
    subscription_status: Optional[str] = None
    student_count: int = 0
    location: Optional[str] = None
    status: str = "inactive"
    created_at: str
    updated_at: str


class TenantResponse(BaseModel):
    school: TenantMetadata


SUBDOMAIN_RE = re.compile(r"^[a-z0-9-]{3,30}$")
RESERVED_SUBDOMAINS = {"www", "api", "admin", "app", "dashboard", "resultapp", "mail", "support", "help", "billing", "ops", "status"}

class ProvisionRequest(BaseModel):
    school_name: str = Field(..., min_length=3, max_length=120, examples=["Victory High School"])
    subdomain: str = Field(..., min_length=3, max_length=30, examples=["vhs"], description="Desired slug, e.g. vhs -> vhs.resultapp.org")
    admin_email: EmailStr = Field(..., examples=["admin@victoryhigh.edu.ng"])
    admin_name: Optional[str] = Field(None, min_length=3, max_length=80, examples=["Mrs. Adaeze Okafor"], description="Optional — defaults to local part of email")
    phone_number: Optional[str] = Field(None, max_length=20, examples=["+2348012345678"])
    student_count: int = Field(..., gt=0, le=10000, examples=[150], description="Estimated students, used for pricing (100 NGN each)")

    @field_validator("subdomain")
    @classmethod
    def validate_subdomain(cls, v: str) -> str:
        v = v.lower().strip()
        # sanitize: allow only validated pattern, but also give clear errors
        if not SUBDOMAIN_RE.match(v):
            raise ValueError("Subdomain must be 3-30 chars, lowercase letters, numbers, hyphens only")
        if v.startswith("-") or v.endswith("-"):
            raise ValueError("Subdomain cannot start or end with hyphen")
        if "--" in v:
            # discourage double hyphen (optional)
            pass
        if v in RESERVED_SUBDOMAINS:
            raise ValueError(f"Subdomain '{v}' is reserved")
        return v

    @field_validator("school_name")
    @classmethod
    def validate_school_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("School name too short")
        return v

class ProvisionResponse(BaseModel):
    success: bool
    message: str
    deployed_url: str
    domain: str
    subdomain: str
    school_name: str
    student_count: int
    total_amount_ngn: int
    timestamp: str
    provisioning_ms: int
    database: Dict[str, str]  # without password

# ---------------------------------------------------------------------------
# Health / root
# ---------------------------------------------------------------------------

@app.get("/", tags=["health"])
async def root():
    return {
        "service": "resultapp provisioning",
        "status": "ok",
        "version": app.version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "docs": "/docs",
        "health": "/health",
        "provision": "POST /api/v1/provision (requires X-API-SECRET-KEY)",
    }

@app.get("/health", tags=["health"])
async def health():
    db_ok = test_connection()
    # Also check template exists
    from pathlib import Path
    template_ok = Path(os.getenv("ROSARIOSIS_TEMPLATE_DIR", "/opt/rosariosis-template")).exists()
    vhost_ok = Path(os.getenv("VHOST_BASE_DIR", "/var/www/vhosts")).exists()

    status_code = 200 if db_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ok" if db_ok else "degraded",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": {
                "postgres": "ok" if db_ok else "fail",
                "rosariosis_template": "ok" if template_ok else "missing",
                "vhost_base": "ok" if vhost_ok else "missing",
            }
        }
    )


@app.get("/api/v1/tenant/{subdomain}", response_model=TenantResponse, tags=["tenancy"])
async def tenant_lookup(subdomain: str):
    """
    Public tenant metadata lookup.

    Queries the schools registry table in PostgreSQL for the given subdomain
    and returns its snake_case columns (school_name, subscription_plan,
    student_count, motto, location, status, etc.) plus computed fields so
    lib/tenant.ts can normalize them. Clean 404 if the subdomain is unknown.
    """
    subdomain = subdomain.lower().strip()
    school = get_school_by_subdomain(subdomain)
    if school is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No school found for subdomain '{subdomain}'",
        )

    # --- Computed convenience fields ---
    city = school.get("city") or None
    state = school.get("state") or None
    school["location"] = ", ".join(filter(None, [city, state])) or None
    school["status"] = "active" if school.get("is_active") else "inactive"

    # --- Normalize DB types (UUID / timestamps) to JSON-safe strings ---
    school["id"] = str(school.get("id", ""))
    for ts_field in ("created_at", "updated_at"):
        value = school.get(ts_field)
        school[ts_field] = value.isoformat() if isinstance(value, datetime) else str(value)

    return TenantResponse(school=TenantMetadata(**school))


# ---------------------------------------------------------------------------
# Phase 3: Tenant Upgrade (monetization) — raw psycopg2, minimal scope
# ---------------------------------------------------------------------------

class TenantUpgradeRequest(BaseModel):
    student_count: int = Field(..., gt=0, le=10000, examples=[150])
    transaction_id: str = Field(..., min_length=1, examples=["FLW123456789"], description="Flutterwave transaction_id verified via Next.js proxy")

class TenantUpgradeResponse(BaseModel):
    success: bool
    message: str
    school: TenantMetadata


@app.post("/api/v1/tenant/{tenant_id}/upgrade", response_model=TenantUpgradeResponse, tags=["tenancy"], dependencies=[Depends(verify_api_secret)])
def upgrade_tenant(tenant_id: str, payload: TenantUpgradeRequest):
    """
    Phase 3 upgrade: mark tenant as 'active' and set student_count.
    Uses raw psycopg2 (like tenant_lookup) — minimal scope: only subscription_status + student_count.
    Allows re-upgrade to scale (overwrites count). Verified via Flutterwave in Next.js proxy.
    """
    # Validate subdomain format (reuse existing regex)
    tid = tenant_id.lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")

    # Ensure tenant exists
    existing = get_school_by_subdomain(tid)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")

    # Raw psycopg2 UPDATE — minimal scope per decision 2
    from services.db_manager import SCHOOLS_REGISTRY_TABLE, _connect_as_superuser, _row_to_dict

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET subscription_status = 'active',
                student_count = %s,
                updated_at = NOW()
            WHERE subdomain = %s
            RETURNING id, subdomain, school_name, email, phone, address, city, state, country,
                      logo_url, hero_bg_url, motto, proprietor_name, registration_number,
                      is_verified, is_active, subscription_plan, subscription_status, student_count,
                      created_at, updated_at;
            """,
            (int(payload.student_count), tid),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Tenant '{tid}' not found during upgrade")
        row = cur.fetchone()
        conn.commit()
        school = _row_to_dict(row, cur)
        logger.info(f"[UPGRADE] Tenant {tid} upgraded to active with {payload.student_count} students via tx {payload.transaction_id}")

        # Normalize like tenant_lookup
        city = school.get("city") or None
        state = school.get("state") or None
        school["location"] = ", ".join(filter(None, [city, state])) or None
        school["status"] = "active" if school.get("is_active") else "inactive"
        school["id"] = str(school.get("id", ""))
        for ts_field in ("created_at", "updated_at"):
            value = school.get(ts_field)
            school[ts_field] = value.isoformat() if isinstance(value, datetime) else str(value)

        return TenantUpgradeResponse(
            success=True,
            message=f"Tenant {tid} upgraded to active ({payload.student_count} students)",
            school=TenantMetadata(**school),
        )
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[UPGRADE] Failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Upgrade failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Provision endpoint
# ---------------------------------------------------------------------------

@app.post("/api/v1/provision", response_model=ProvisionResponse, tags=["provisioning"],
          dependencies=[Depends(verify_api_secret)],
          summary="Provision isolated RosarioSIS instance for a paid school")
async def provision_school(payload: ProvisionRequest, request: Request):
    """
    Runs the full pipeline synchronously with granular rollback.
    Only Next.js with valid X-API-SECRET-KEY (set after Flutterwave payment) may call.

    Steps & rollback:
    - DB succeeds → site fails → drop DB
    - Site succeeds → nginx fails → rollback site + drop DB
    - Email is best-effort (does not trigger rollback)
    """
    start = time.monotonic()
    subdomain = payload.subdomain.lower().strip()
    school_name = payload.school_name.strip()
    admin_email = str(payload.admin_email).lower().strip()
    admin_name = (payload.admin_name or admin_email.split("@")[0]).strip()
    student_count = int(payload.student_count)
    total_amount = student_count * 100  # NGN, per spec

    # Normalize phone for Brevo
    phone = payload.phone_number.strip() if payload.phone_number else None

    logger.info(
        f"[PROVISION] Request: school='{school_name}' subdomain='{subdomain}' "
        f"admin='{admin_email}' students={student_count} ({total_amount} NGN) "
        f"from {request.client.host if request.client else 'unknown'}"
    )

    # Quick idempotency checks before expensive work
    if database_exists(subdomain):
        logger.warning(f"[PROVISION] Rejected — database for '{subdomain}' already exists")
        raise HTTPException(status_code=409, detail=f"Subdomain '{subdomain}' already provisioned (database exists)")

    if site_exists(subdomain):
        logger.warning(f"[PROVISION] Rejected — site for '{subdomain}' already exists")
        raise HTTPException(status_code=409, detail=f"Subdomain '{subdomain}' already provisioned (site exists)")

    # Track provisioning artefacts for rollback
    db_info: Optional[Dict[str, str]] = None
    site_info: Optional[Dict[str, str]] = None
    temp_creds: Optional[Dict[str, str]] = None

    try:
        # --- Step 1: Database ---
        try:
            db_info = create_school_database(subdomain=subdomain, student_count=student_count)
            logger.info(f"[PROVISION] DB step OK: {db_info['db_name']} / {db_info['db_user']}")
        except Exception as e:
            logger.exception(f"[PROVISION] DB step failed for '{subdomain}': {e}")
            raise HTTPException(status_code=500, detail=f"Database provisioning failed: {e}")

        # --- Step 2 & 3: File deployment + Nginx (combined via deploy_site) ---
        try:
            site_info = deploy_site(
                subdomain=subdomain,
                db_creds=db_info,
                school_name=school_name,
                admin_email=admin_email,
            )
            logger.info(f"[PROVISION] FS+Nginx step OK: {site_info['domain']} -> {site_info['site_path']}")
        except Exception as e:
            logger.exception(f"[PROVISION] Site deployment failed for '{subdomain}': {e}")
            # Rollback DB because site failed (requirement: no orphaned DB)
            try:
                logger.warning(f"[PROVISION] Rolling back DB for '{subdomain}' after site failure")
                rollback_database(db_info["db_name"], db_info["db_user"])
            except Exception as rb_e:
                logger.error(f"[PROVISION] DB rollback also failed for '{subdomain}': {rb_e}")
            raise HTTPException(status_code=500, detail=f"Site deployment failed: {e}. Database rolled back.")

        # --- Step 4: Notify (best-effort) ---
        temp_creds = generate_temp_credentials(admin_email)
        domain = site_info["domain"]
        login_url = site_info["url"]

        # Store temp credentials somewhere? In real flow you would INSERT into RosarioSIS DB.
        # For now we just email them; the droplet's deploy created DB but not yet seeded admin user.
        # Brevo failure does not trigger rollback — we log and continue.
        try:
            email_ok = send_welcome_email(
                admin_email=admin_email,
                admin_name=admin_name,
                school_name=school_name,
                subdomain=subdomain,
                student_count=student_count,
                temp_credentials=temp_creds,
                domain=domain,
                login_url=login_url,
            )
            if not email_ok:
                logger.warning(f"[PROVISION] Email send returned False for '{subdomain}' -> {admin_email} (non-fatal)")
        except Exception as e:
            logger.exception(f"[PROVISION] Email step failed for '{subdomain}': {e} (non-fatal)")

        elapsed_ms = int((time.monotonic() - start) * 1000)
        timestamp = datetime.now(timezone.utc).isoformat()

        logger.info(f"[PROVISION] SUCCESS for '{subdomain}' in {elapsed_ms}ms -> {login_url}")

        try:
            register_school(
                subdomain=subdomain,
                school_name=school_name,
                email=admin_email,
                phone=phone,
                student_count=student_count,
            )
            logger.info(f"[PROVISION] School registered in registry for '{subdomain}'")
        except Exception as e:
            logger.warning(f"[PROVISION] Failed to register school '{subdomain}' in registry: {e}")

        return ProvisionResponse(
            success=True,
            message=f"Successfully provisioned {domain} for {school_name}",
            deployed_url=login_url,
            domain=domain,
            subdomain=subdomain,
            school_name=school_name,
            student_count=student_count,
            total_amount_ngn=total_amount,
            timestamp=timestamp,
            provisioning_ms=elapsed_ms,
            database={
                "db_name": db_info["db_name"],
                "db_user": db_info["db_user"],
                "db_host": db_info["db_host"],
                # Never return password in response — admin gets it via email
                "db_port": db_info["db_port"],
            },
        )

    except HTTPException:
        # Re-raise correctly mapped errors (already logged)
        raise
    except Exception as e:
        logger.exception(f"[PROVISION] Unexpected error for '{subdomain}': {e}")
        # Generic rollback: if db_info exists but site_info does not, we may have orphan DB
        if db_info and not site_info:
            try:
                rollback_database(db_info["db_name"], db_info["db_user"])
            except Exception as rb_e:
                logger.error(f"[PROVISION] Unexpected rollback failed: {rb_e}")
        elif db_info and site_info:
            # Both created but we are in unexpected post-site error (e.g. email crash)
            # We do NOT rollback on email failure — site is still valid
            # But for unknown errors we attempt to keep system consistent by not auto-deleting
            logger.warning(f"[PROVISION] Unexpected error after site creation — keeping deployed site for '{subdomain}' for manual inspection")
        raise HTTPException(status_code=500, detail=f"Provisioning failed: {e}")

# ---------------------------------------------------------------------------
# Optional: async background variant (fire-and-forget) — for large batches
# ---------------------------------------------------------------------------

class ProvisionBackgroundRequest(ProvisionRequest):
    callback_url: Optional[str] = Field(None, description="If provided, POST result to this URL when done")

provision_jobs: Dict[str, Dict[str, Any]] = {}

def _background_provision_task(subdomain: str, payload: ProvisionRequest, callback_url: Optional[str]):
    """
    Runs in background thread via BackgroundTasks.
    Stores result in memory `provision_jobs` and optionally POSTs to callback_url.
    """
    import requests
    job_key = subdomain
    provision_jobs[job_key] = {"status": "running", "subdomain": subdomain, "started_at": datetime.now(timezone.utc).isoformat()}
    try:
        # Reuse synchronous logic by calling service layers directly (without HTTPException mapping)
        db_info = create_school_database(subdomain, payload.student_count)
        site_info = deploy_site(subdomain, db_info, payload.school_name, str(payload.admin_email))
        temp_creds = generate_temp_credentials(str(payload.admin_email))
        send_welcome_email(
            admin_email=str(payload.admin_email),
            admin_name=payload.admin_name or str(payload.admin_email).split("@")[0],
            school_name=payload.school_name,
            subdomain=subdomain,
            student_count=payload.student_count,
            temp_credentials=temp_creds,
            domain=site_info["domain"],
            login_url=site_info["url"],
        )
        result = {"success": True, "domain": site_info["domain"], "url": site_info["url"], "timestamp": datetime.now(timezone.utc).isoformat()}
        provision_jobs[job_key].update({"status": "success", "result": result})
        if callback_url:
            try:
                requests.post(callback_url, json=result, timeout=10)
            except Exception as cb_e:
                logger.error(f"[BG] Callback POST failed for {subdomain}: {cb_e}")
    except Exception as e:
        logger.exception(f"[BG] Background provision failed for {subdomain}: {e}")
        provision_jobs[job_key].update({"status": "failed", "error": str(e)})
        send_failure_alert(str(payload.admin_email), subdomain, str(e))

@app.post("/api/v1/provision/async", tags=["provisioning"], dependencies=[Depends(verify_api_secret)])
async def provision_async(payload: ProvisionBackgroundRequest, background_tasks: BackgroundTasks):
    if database_exists(payload.subdomain) or site_exists(payload.subdomain):
        raise HTTPException(status_code=409, detail=f"Subdomain '{payload.subdomain}' already provisioned")
    subdomain = payload.subdomain.lower().strip()
    background_tasks.add_task(_background_provision_task, subdomain, payload, payload.callback_url)
    return {"success": True, "message": f"Provisioning started for {subdomain}.resultapp.org", "subdomain": subdomain, "status": "queued", "check": f"/api/v1/provision/status/{subdomain}"}

@app.get("/api/v1/provision/status/{subdomain}", tags=["provisioning"])
async def provision_status(subdomain: str):
    subdomain = subdomain.lower().strip()
    job = provision_jobs.get(subdomain)
    if not job:
        # Fallback: check if site already exists synchronously
        if site_exists(subdomain) and database_exists(subdomain):
            return {"subdomain": subdomain, "status": "success", "domain": get_domain(subdomain), "url": f"https://{get_domain(subdomain)}"}
        raise HTTPException(status_code=404, detail=f"No job found for '{subdomain}'")
    return job

# ---------------------------------------------------------------------------
# Global exception handler (JSON)
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception for {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"success": False, "detail": "Internal server error", "path": str(request.url.path)})


# ---------------------------------------------------------------------------
# Phase 2: Dynamic Grading Engine — mount router (keeps provisioner intact)
# ---------------------------------------------------------------------------

try:
    from routers.grading import router as grading_router

    app.include_router(grading_router)
    logger.info("[App] Grading engine router mounted (/api/v1/templates, /api/v1/records/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Grading router not mounted: {e}")

# ---------------------------------------------------------------------------
# Phase 4: Super Admin — mount router (keeps provisioner intact)
# ---------------------------------------------------------------------------

try:
    from routers.admin import router as admin_router, profile_router as admin_profile_router

    app.include_router(admin_router)
    app.include_router(admin_profile_router)
    logger.info("[App] Admin router mounted (/api/v1/admin/tenants, PATCH /api/v1/tenant/{tenant_id}/profile)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Admin router not mounted: {e}")

# ---------------------------------------------------------------------------
# Allocations & Roster — per-tenant directory
# ---------------------------------------------------------------------------

try:
    from routers.allocations import router as allocations_router

    app.include_router(allocations_router)
    logger.info("[App] Allocations router mounted (/api/v1/tenant/{tenant_id}/roster)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Allocations router not mounted: {e}")

# ---------------------------------------------------------------------------
# Staff Authentication & Dashboard — per-tenant staff portal
# ---------------------------------------------------------------------------

try:
    from routers.staff_auth import router as staff_auth_router

    app.include_router(staff_auth_router)
    logger.info("[App] Staff auth router mounted (/api/v1/tenant/{tenant_id}/staff/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Staff auth router not mounted: {e}")

# ---------------------------------------------------------------------------
# Staff Focused Grading — per-tenant score entry
# ---------------------------------------------------------------------------

try:
    from routers.staff_grading import router as staff_grading_router

    app.include_router(staff_grading_router)
    logger.info("[App] Staff grading router mounted (/api/v1/tenant/{tenant_id}/staff/grading)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Staff grading router not mounted: {e}")

# ---------------------------------------------------------------------------
# Report Card — professional Digital Paper
# ---------------------------------------------------------------------------

try:
    from routers.report import router as report_router

    app.include_router(report_router)
    logger.info("[App] Report router mounted (/api/v1/tenant/{tenant_id}/report/{student_id})")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Report router not mounted: {e}")

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=False, log_level=os.getenv("LOG_LEVEL", "info"))
