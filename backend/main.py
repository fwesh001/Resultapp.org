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
from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict

# Services
#
# The per-tenant PHP/RosarioSIS stack is gone. A tenant is now nothing more than
# a row in the central `schools` registry: the Next.js app on Vercel serves
# every subdomain (middleware rewrites the Host to /[subdomain]/...) and reads
# its data from this API. So provisioning creates no database, no site files
# and no nginx vhost — it only writes the registry row and sends the email.
from services.db_manager import (
    test_connection,
    init_schools_registry,
    register_school,
    get_school_by_subdomain,
    tenant_exists,
)
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
    try:
        from services.db_manager import init_notification_tables, seed_default_notification_templates

        init_notification_tables()
        try:
            seed_default_notification_templates()
        except Exception as e:
            logger.warning(f"Notification templates seed warning: {e}")
    except Exception as e:
        logger.warning(f"Notification tables init warning (may be DB unreachable in dev): {e}")
    try:
        from services.db_manager import init_support_tables

        init_support_tables()
    except Exception as e:
        logger.warning(f"Support tables init warning (may be DB unreachable in dev): {e}")
    try:
        from services.db_manager import init_consent_tables

        init_consent_tables()
    except Exception as e:
        # Loud, unlike the others: registration now hard-requires this table.
        logger.error(f"Consent tables init FAILED: {e}")
    try:
        from services.db_manager import init_email_otp_table, purge_expired_email_otps

        init_email_otp_table()
        # Opportunistic sweep; a public endpoint's table must not grow forever.
        purge_expired_email_otps()
    except Exception as e:
        # Loud: the registration wizard gates payment on a working OTP, so a
        # missing table here means every "Send code" click fails with a 500.
        logger.error(f"Email OTP table init FAILED: {e}")
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


def _server_commit() -> str:
    """Short git SHA of the serving checkout (best-effort, never raises)."""
    try:
        import subprocess

        here = os.path.dirname(os.path.abspath(__file__))
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=here,
            capture_output=True,
            text=True,
            timeout=5,
        )
        sha = (out.stdout or "").strip()
        return sha if out.returncode == 0 and sha else "unknown"
    except Exception:
        return "unknown"


_SERVER_COMMIT = _server_commit()


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
    credit_balance: int = 0
    slots_balance: int = 0
    id_prefix: Optional[str] = None
    staff_id_prefix: Optional[str] = None
    principal_remark_scheme: Optional[list] = None
    principal_signature_url: Optional[str] = None
    deleted_at: Optional[str] = None
    current_term: Optional[str] = None
    current_session: Optional[str] = None
    new_term_begins: Optional[str] = None
    location: Optional[str] = None
    status: str = "inactive"
    created_at: str
    updated_at: str


class TenantResponse(BaseModel):
    school: TenantMetadata


SUBDOMAIN_RE = re.compile(r"^[a-z0-9-]{3,30}$")
RESERVED_SUBDOMAINS = {"www", "api", "admin", "app", "dashboard", "resultapp", "mail", "support", "help", "billing", "ops", "status"}

class ProvisionRequest(BaseModel):
    # Unknown fields are IGNORED, not rejected. This is stated explicitly
    # rather than left to the Pydantic default so the intent survives: the
    # Next.js proxy is free to add fields (adminName was one) without risking
    # a 422 that would strand a school that has ALREADY PAID. Prefer
    # `extra="ignore"` over `extra="forbid"` here — provision runs post-payment,
    # so a strict schema would turn a typo into a paid-but-unprovisioned tenant.
    model_config = ConfigDict(extra="ignore")

    school_name: str = Field(..., min_length=3, max_length=120, examples=["Victory High School"])
    subdomain: str = Field(..., min_length=3, max_length=30, examples=["vhs"], description="Desired slug, e.g. vhs -> vhs.resultapp.org")
    admin_email: EmailStr = Field(..., examples=["admin@victoryhigh.edu.ng"])
    # Collected in wizard Step 2. Used for the welcome email greeting and the
    # Flutterwave customer name; persisted to schools.admin_name.
    #
    # BOUNDS ARE A CONTRACT: min 3 / max 80 here must match validateSecurity()
    # in components/forms/RegisterSchoolForm.tsx and the parity check in
    # app/api/register-school/route.ts. Provisioning runs AFTER payment, so a
    # mismatch (e.g. the client accepting 2 characters) rejects with a 422 the
    # user only sees once they have been charged.
    admin_name: Optional[str] = Field(None, min_length=3, max_length=80, examples=["Mrs. Adaeze Okafor"], description="Optional — defaults to local part of email")
    admin_password: Optional[str] = Field(None, min_length=8, max_length=128, description="Phase 2 — admin portal password chosen at registration (stored as pgcrypto bcrypt hash)")
    transaction_id: Optional[str] = Field(None, min_length=1, max_length=100, description="Verified Flutterwave transaction_id (anti-replay: rejected if already redeemed)")
    amount_ngn: Optional[int] = Field(None, ge=0, description="Verified NGN paid (recorded immutably on the provision ledger row)")
    phone_number: Optional[str] = Field(None, max_length=20, examples=["+2348012345678"])
    student_count: int = Field(..., gt=0, le=10000, examples=[150], description="Estimated students, used for pricing (100 NGN each). Also gates the free-credit grant at >= 500 (inclusive).")
    # DEPRECATED and IGNORED. Retained only so older clients keep validating.
    # The backend is strictly authoritative: the free-credit grant is decided by
    # the superadmin toggle AND the >= FREE_CREDITS_MIN_STUDENTS threshold, never
    # by anything a caller sends. See resolve_initial_credit_grant().
    initial_credits: Optional[int] = Field(None, ge=0, le=10000, examples=[30], description="DEPRECATED/IGNORED — the server decides the free-credit grant from the superadmin toggle and the >= 500 student threshold.")
    # Consent record — REQUIRED. Stored in tenant_consents in the same
    # transaction as the schools INSERT; registration fails without it.
    terms_version: str = Field(..., min_length=1, max_length=16, examples=["1.0"], description="Version of the Terms of Service the registrant accepted")
    privacy_version: str = Field(..., min_length=1, max_length=16, examples=["1.0"], description="Version of the Privacy Policy the registrant accepted")
    accepted_terms: bool = Field(..., description="Must be true — the registrant ticked the acceptance box")
    consent_ip: Optional[str] = Field(None, max_length=64, description="Registrant IP, retained as evidence of acceptance under NDPR s.41(3)")

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
    #: Set when the schools/consent registry write failed. Non-null means the
    #: school is NOT servable — its subdomain will not resolve to a portal —
    #: so an operator must reconcile it before the customer is told anything.
    registry_error: Optional[str] = None
    #: Outcome of registering the tenant subdomain on Vercel. The school exists
    #: in the registry either way; success=false means the portal is not
    #: routable yet and must be reconciled before it is advertised to the buyer.
    vercel_domain: Dict[str, Any] = {}

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

@app.get("/api/version", tags=["health"])
async def version():
    """Report the exact code revision serving traffic.

    Answers "did the deploy actually take effect?" without guessing: compare
    `commit` here against `git rev-parse --short HEAD` in the checkout.
    Computed once at import; falls back to "unknown" (never fails startup).
    """
    return {"service": "resultapp backend", "commit": _SERVER_COMMIT, "status": "ok"}


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
    # Ghost-bug guard: soft-deleted schools look never-provisioned publicly.
    # (Superadmin detail endpoint reads the registry directly and bypasses this.)
    if school.get("deleted_at") is not None:
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
    # deleted_at never leaves the public lookup (already 404'd above if set)
    school.pop("deleted_at", None)

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
                      credit_balance, slots_balance, id_prefix, staff_id_prefix, new_term_begins, created_at, updated_at;
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

    # Idempotency: the registry row IS the tenant. No database or site exists
    # to check, so a duplicate subdomain must be detected here.
    if subdomain.startswith("demo-"):
        logger.warning(f"[PROVISION] Rejected — '{subdomain}' uses the reserved demo prefix")
        raise HTTPException(status_code=422, detail="Subdomains starting with 'demo-' are reserved for trial demos")
    if tenant_exists(subdomain):
        logger.warning(f"[PROVISION] Rejected — '{subdomain}' already registered")
        raise HTTPException(status_code=409, detail=f"Subdomain '{subdomain}' already provisioned")

    # Anti-replay: a verified transaction_id redeems exactly one school.
    # Checked BEFORE any write so replays cost zero resources.
    tx_id = (payload.transaction_id or "").strip() if payload.transaction_id else ""
    provision_ref = f"provision:{tx_id}" if tx_id else None
    if provision_ref:
        from services.db_manager import transaction_reference_used

        if transaction_reference_used(provision_ref):
            logger.warning(f"[PROVISION] Rejected — transaction '{tx_id}' already redeemed")
            raise HTTPException(status_code=400, detail="Transaction reference already used")

    domain = f"{subdomain}.resultapp.org"
    login_url = f"https://{domain}/admin/login"

    try:
        # --- Step 1: Registry + consent (the whole tenant) ---
        #
        # This single transactional write is what makes the school exist. The
        # Next.js app on Vercel resolves every subdomain through its middleware
        # to /[subdomain]/..., and reads the school from this row — so if this
        # write fails, nothing else can substitute for it.
        try:
            register_school(
                subdomain=subdomain,
                school_name=school_name,
                email=admin_email,
                phone=phone,
                student_count=student_count,
                admin_name=admin_name or None,
                admin_password_hash=str(payload.admin_password).strip()
                if payload.admin_password and str(payload.admin_password).strip()
                else None,
                terms_version=payload.terms_version,
                privacy_version=payload.privacy_version,
                accepted_by=admin_email,
                consent_ip=payload.consent_ip,
            )
            logger.info(f"[PROVISION] Registered '{subdomain}' in the central registry")
        except Exception as e:
            logger.exception(f"[PROVISION] Registry write failed for '{subdomain}': {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Registry provisioning failed: {e}",
            )

        # --- Step 2: Notify (best-effort) ---
        #
        # There are no temp credentials to mint any more: the admin password the
        # customer chose at signup is stored as a bcrypt hash in the registry,
        # and the portal is set up through the verification email below.
        # Brevo failure does NOT roll back — the school row is the source of
        # truth and the customer can request a new link from the sign-in page.
        try:
            email_ok = send_welcome_email(
                admin_email=admin_email,
                admin_name=admin_name,
                school_name=school_name,
                subdomain=subdomain,
                student_count=student_count,
                temp_credentials=None,
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

        registry_error = None

        # Email verification for the new admin. Placed AFTER register_school so
        # the row (and therefore the token column) actually exists.
        #
        # Non-fatal, same as the welcome mail: the school is already registered
        # and must not be rolled back over a mail hiccup. Because login is a
        # SOFT login the admin can still use the portal unverified, and can
        # request a new link from the sign-in page.
        try:
            from services.db_manager import issue_verification_token
            from services.notifier import send_verification_email

            _issued = issue_verification_token(admin_email, table="schools")
            if _issued is None:
                logger.warning(
                    f"[PROVISION] No registry row matched {admin_email} for verification (non-fatal)"
                )
            elif not send_verification_email(
                _issued["email"],
                _issued.get("name") or admin_name or "",
                _issued["raw_token"],
                tenant=school_name,
            ):
                logger.warning(
                    f"[PROVISION] Verification email not delivered to {admin_email} (non-fatal)"
                )
            else:
                logger.info(f"[PROVISION] Verification email queued for {admin_email}")
        except Exception as e:
            logger.warning(
                f"[PROVISION] Verification email step failed for '{admin_email}': {e} (non-fatal)"
            )

        # Credit & Command: conditional free-credit grant.
        #
        # The backend is strictly authoritative: `initial_credits` from the
        # request body is ignored entirely. The grant is TRIAL_CREDITS only when
        # the superadmin toggle is ON *and* the school's initial capacity is at
        # least FREE_CREDITS_MIN_STUDENTS (inclusive). Otherwise 0, which makes
        # grant_initial_credits a no-op that leaves `init:<subdomain>` unclaimed.
        _credit_grant = 0
        try:
            from services.db_manager import grant_initial_credits, resolve_initial_credit_grant

            _credit_grant = int(resolve_initial_credit_grant(student_count))
            grant_result = grant_initial_credits(subdomain, _credit_grant)
            if _credit_grant > 0:
                logger.info(
                    f"[PROVISION] Free-credit grant of {_credit_grant} credits for "
                    f"'{subdomain}' (capacity {student_count} >= threshold)"
                )
            else:
                logger.info(
                    f"[PROVISION] No free credits for '{subdomain}' "
                    f"(toggle off or capacity {student_count} below threshold); "
                    f"init idempotency key left unclaimed"
                )
        except Exception as e:
            logger.warning(f"[PROVISION] Failed to grant initial credits for '{subdomain}': {e}")

        # Vercel domain: register the tenant subdomain and immediately publish
        # the TXT Vercel needs. This starts verification; it does not wait for
        # certificate issuance because the response must return promptly and the
        # wizard's readiness check reports when TLS is genuinely being served.
        #
        # Best-effort by design: the school row is already committed, so a
        # Vercel outage must not fail a customer who has paid. The outcome is
        # returned in the response so the caller can be honest about the portal
        # not being live yet rather than redirecting into a dead subdomain.
        vercel_domain: Dict[str, Any] = {"configured": False, "success": False}
        try:
            from services.vercel_domains import start_domain_verification

            # Adds the domain and publishes the Cloudflare TXT that Vercel
            # needs. Without the TXT step the domain sits unverified and every
            # visitor gets a 525.
            vercel_domain = start_domain_verification(subdomain)
            vercel_domain["configured"] = True
            vercel_domain["success"] = bool(vercel_domain.get("added"))
            if vercel_domain.get("verified"):
                logger.info(
                    "[PROVISION] Vercel domain verified for '%s'",
                    subdomain,
                )
            else:
                logger.warning(
                    "[PROVISION] Vercel domain added but NOT verified for '%s' — "
                    "school is registered but not yet reachable; reconcile with "
                    "`vercel_domains.ensure_domain_verified`",
                    subdomain,
                )
        except Exception as e:
            vercel_domain = {"configured": True, "success": False, "error": str(e)}
            logger.warning(f"[PROVISION] Vercel domain step failed for '{subdomain}': {e}")

        # Notification Engine: onboarding welcome (best-effort — never blocks provision)
        try:
            from services.notifications import dispatch_event as _dispatch_onboarding

            # Report the credits actually granted (0 when the policy withheld them).
            _dispatch_onboarding(
                "ONBOARDING_WELCOME",
                subdomain,
                {"school_name": school_name, "subdomain": subdomain, "credits": _credit_grant},
            )
        except Exception as e:
            logger.warning(f"[PROVISION] Onboarding notification failed for '{subdomain}': {e}")

        # Dual-ledger: initial slot capacity = student_count (free trial capacity, no payment)
        try:
            from services.db_manager import _connect_as_superuser, BILLING_LEDGER_TABLE, SCHOOLS_REGISTRY_TABLE

            conn2 = _connect_as_superuser()
            cur2 = conn2.cursor()
            # Ensure slots_balance reflects initial capacity if not already set
            cur2.execute(
                f"""
                UPDATE {SCHOOLS_REGISTRY_TABLE}
                SET slots_balance = GREATEST(COALESCE(slots_balance,0), %s),
                    student_count = GREATEST(COALESCE(student_count,0), %s),
                    updated_at = NOW()
                WHERE subdomain = %s AND COALESCE(slots_balance,0) = 0
                RETURNING slots_balance;
                """,
                (int(student_count), int(student_count), subdomain),
            )
            row2 = cur2.fetchone()
            if row2 is not None:
                # Paid flows redeem under provision:{tx} (MRR-counted SLOT_PURCHASE);
                # free/trial flows keep the legacy init-slot row (₦0, excluded).
                paid_ngn = max(0, int(payload.amount_ngn or 0)) if payload.amount_ngn else 0
                if provision_ref and paid_ngn > 0:
                    slot_ref = provision_ref
                    slot_txn = "SLOT_PURCHASE"
                    slot_desc = f"Paid provision: {student_count} slots for {subdomain} (₦{paid_ngn})"
                else:
                    slot_ref = f"init-slot:{subdomain}"
                    slot_txn = "INITIAL_SLOTS"
                    slot_desc = f"Initial slot capacity {student_count} for {subdomain}"
                    paid_ngn = 0
                cur2.execute(
                    f"""
                    INSERT INTO {BILLING_LEDGER_TABLE}
                        (subdomain, token_type, amount, transaction_type, reference_id, description, amount_ngn)
                    VALUES (%s, 'SLOT', %s, %s, %s, %s, %s)
                    ON CONFLICT (reference_id) DO NOTHING;
                    """,
                    (subdomain, int(student_count), slot_txn, slot_ref, slot_desc, paid_ngn),
                )
                conn2.commit()
                logger.info(f"[PROVISION] Initial slots {student_count} for '{subdomain}' ({slot_txn})")
            else:
                conn2.commit()
            cur2.close()
            conn2.close()
        except Exception as e:
            logger.warning(f"[PROVISION] Failed to grant initial slots for '{subdomain}': {e}")
            try:
                if 'conn2' in locals() and conn2:
                    conn2.rollback()
                    conn2.close()
            except Exception:
                pass

        # `deployed_url` is the PORTAL ROOT, not the login page. The Next.js
        # wizard appends "/admin/login" itself, so returning the full login URL
        # here produced /admin/login/admin/login on the handoff redirect.
        # `portal_url` carries the deep link for callers that want it.
        return ProvisionResponse(
            success=True,
            message=f"Successfully provisioned {domain} for {school_name}",
            deployed_url=f"https://{domain}",
            domain=domain,
            subdomain=subdomain,
            school_name=school_name,
            student_count=student_count,
            total_amount_ngn=total_amount,
            timestamp=timestamp,
            provisioning_ms=elapsed_ms,
            registry_error=registry_error,
            # Whether the tenant subdomain is actually routable on Vercel yet.
            # success=false here means "registered but not yet reachable", which
            # the caller must not present to a customer as a live portal.
            vercel_domain=vercel_domain,
        )

    except HTTPException:
        # Re-raise correctly mapped errors (already logged)
        raise
    except Exception as e:
        logger.exception(f"[PROVISION] Unexpected error for '{subdomain}': {e}")
        # There is nothing to roll back: the only artefact a tenant has is its
        # registry row, and register_school() is atomic (row + consent or
        # neither). Anything that fails after it leaves a complete, servable
        # school — credits, notifications and mail are all best-effort.
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
        # Same two steps as the synchronous path: write the registry row (which
        # is the entire tenant), then notify. Mail failure is not fatal.
        register_school(
            subdomain=subdomain,
            school_name=payload.school_name,
            email=str(payload.admin_email),
            phone=payload.phone,
            student_count=payload.student_count,
            admin_name=payload.admin_name or None,
            admin_password_hash=str(payload.admin_password).strip()
            if payload.admin_password and str(payload.admin_password).strip()
            else None,
            terms_version=payload.terms_version,
            privacy_version=payload.privacy_version,
            accepted_by=str(payload.admin_email),
            consent_ip=payload.consent_ip,
        )
        domain = f"{subdomain}.resultapp.org"
        login_url = f"https://{domain}/admin/login"

        # Register the subdomain on Vercel and immediately publish the TXT used
        # for verification. Best-effort: a Vercel outage must not fail an
        # already-registered school.
        vercel_domain = {"configured": False, "success": False}
        try:
            from services.vercel_domains import start_domain_verification

            vercel_domain = start_domain_verification(subdomain)
        except Exception as e:
            vercel_domain = {"configured": True, "success": False, "error": str(e)}
            logger.warning(f"[BG] Vercel domain step failed for {subdomain}: {e}")

        try:
            send_welcome_email(
                admin_email=str(payload.admin_email),
                admin_name=payload.admin_name or str(payload.admin_email).split("@")[0],
                school_name=payload.school_name,
                subdomain=subdomain,
                student_count=payload.student_count,
                temp_credentials=None,
                domain=domain,
                login_url=login_url,
            )
        except Exception as e:
            logger.warning(f"[BG] Welcome email failed for {subdomain}: {e} (non-fatal)")

        result = {"success": True, "domain": domain, "url": f"https://{domain}", "login_url": login_url, "vercel_domain": vercel_domain, "timestamp": datetime.now(timezone.utc).isoformat()}
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
    subdomain = payload.subdomain.lower().strip()
    if tenant_exists(subdomain):
        raise HTTPException(status_code=409, detail=f"Subdomain '{subdomain}' already provisioned")
    background_tasks.add_task(_background_provision_task, subdomain, payload, payload.callback_url)
    return {"success": True, "message": f"Provisioning started for {subdomain}.resultapp.org", "subdomain": subdomain, "status": "queued", "check": f"/api/v1/provision/status/{subdomain}"}

@app.get("/api/v1/provision/status/{subdomain}", tags=["provisioning"])
async def provision_status(subdomain: str):
    subdomain = subdomain.lower().strip()
    job = provision_jobs.get(subdomain)
    if job:
        return job
    # No in-memory job (e.g. after a restart): the registry is authoritative.
    if tenant_exists(subdomain):
        domain = f"{subdomain}.resultapp.org"
        return {"subdomain": subdomain, "status": "success", "domain": domain, "url": f"https://{domain}/admin/login"}
    raise HTTPException(status_code=404, detail=f"No job found for '{subdomain}'")


@app.get("/api/v1/tenant/{subdomain}/readiness", tags=["provisioning"])
async def tenant_readiness(subdomain: str):
    """Is this tenant's public portal actually usable yet?

    The registration wizard polls this instead of firing a blind redirect. A
    subdomain becomes reachable only after Vercel verifies the domain and issues
    a certificate; until then Cloudflare serves a 525 SSL-handshake page. Without
    this the customer is dropped straight into that error seconds after paying,
    which reads as "your school was deleted" rather than "hold on".
    """
    subdomain = subdomain.lower().strip()
    try:
        from starlette.concurrency import run_in_threadpool

        from services.vercel_domains import get_portal_readiness

        # get_portal_readiness() makes blocking HTTP calls (Vercel API + a probe
        # of the tenant portal). Awaiting them directly would stall the whole
        # event loop for the length of the probe, freezing every other request
        # the app is serving. Offloaded to a worker thread instead.
        return await run_in_threadpool(get_portal_readiness, subdomain)
    except Exception as e:  # noqa: BLE001
        # Never turn the progress indicator into an error screen.
        logger.warning(f"[READINESS] failed for '{subdomain}': {e}")
        return {
            "subdomain": subdomain,
            "domain": f"{subdomain}.resultapp.org",
            "registered": False,
            "domain_verified": False,
            "reachable": False,
            "http_status": None,
            "error": "readiness check unavailable",
            "stage": "Creating your school",
            "percent": 25,
            "ready": False,
        }

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
# Ephemeral demos — path-routed under demo.resultapp.org/<id>
# ---------------------------------------------------------------------------

try:
    from routers.demo import router as demo_router

    app.include_router(demo_router)
    logger.info("[App] Demo router mounted (POST /api/v1/demo/provision, POST /api/v1/demo/sweep)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Demo router not mounted: {e}")

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
# Phase 2: Admin Authentication — per-tenant admin portal
# ---------------------------------------------------------------------------

try:
    from routers.admin_auth import router as admin_auth_router

    app.include_router(admin_auth_router)
    logger.info("[App] Admin auth router mounted (/api/v1/tenant/{tenant_id}/admin/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Admin auth router not mounted: {e}")

# ---------------------------------------------------------------------------
# Multi-user superadmin — platform admins (tenant-isolated auth domain)
# ---------------------------------------------------------------------------

try:
    from routers.platform_auth import router as platform_auth_router

    app.include_router(platform_auth_router)
    logger.info("[App] Platform auth router mounted (/api/v1/platform/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Platform auth router not mounted: {e}")

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
# Financial Clearance — per-term administrative hold on unpaid school fees
# ---------------------------------------------------------------------------

try:
    from routers.clearance import router as clearance_router

    app.include_router(clearance_router)
    logger.info("[App] Clearance router mounted (/api/v1/tenant/{tenant_id}/clearance)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Clearance router not mounted: {e}")

# ---------------------------------------------------------------------------
# Credit & Command — token ledger + command center
# ---------------------------------------------------------------------------

try:
    from routers.credits import router as credits_router

    app.include_router(credits_router)
    logger.info("[App] Credits router mounted (/api/v1/tenant/{tenant_id}/credits/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Credits router not mounted: {e}")

try:
    from routers.command_center import router as command_center_router

    app.include_router(command_center_router)
    logger.info("[App] Command center router mounted (/api/v1/tenant/{tenant_id}/command-center/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Command center router not mounted: {e}")

# ---------------------------------------------------------------------------
# Notification Inbox — template-driven inbox (Phase 2)
# ---------------------------------------------------------------------------

try:
    from routers.notifications import router as notifications_router, staff_router as notifications_staff_router

    app.include_router(notifications_router)
    app.include_router(notifications_staff_router)
    logger.info("[App] Notifications router mounted (/api/v1/tenant/{tenant_id}/notifications + staff/nudge)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Notifications router not mounted: {e}")

# ---------------------------------------------------------------------------
# Support Hub — public ticket intake + superadmin triage
# ---------------------------------------------------------------------------

try:
    from routers.support import router as support_router, admin_router as support_admin_router

    app.include_router(support_router)
    app.include_router(support_admin_router)
    logger.info("[App] Support router mounted (POST /api/v1/support/tickets + /api/v1/admin/support-tickets/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Support router not mounted: {e}")

# ---------------------------------------------------------------------------
# Platform Vitals — server telemetry for the superadmin Command Center.
# Secret-gated here; the browser only ever reaches it through the session-
# guarded Next.js proxy at app/api/admin/vitals/route.ts.
# ---------------------------------------------------------------------------

try:
    from routers.vitals import router as vitals_router

    app.include_router(vitals_router)
    logger.info("[App] Vitals router mounted (GET /api/v1/admin/vitals)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Vitals router not mounted: {e}")

# ---------------------------------------------------------------------------
# Auth flow — email verification + password recovery (Brevo transactional).
# Secret-gated; the browser reaches it only through app/api/auth/* proxies.
# ---------------------------------------------------------------------------

try:
    from routers.auth_flow import router as auth_flow_router

    app.include_router(auth_flow_router)
    logger.info("[App] Auth flow router mounted (POST /api/v1/auth/*)")
except Exception as e:  # pragma: no cover
    logger.warning(f"[App] Auth flow router not mounted: {e}")

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=False, log_level=os.getenv("LOG_LEVEL", "info"))
