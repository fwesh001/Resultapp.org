"""
Student Authentication — login, password change, and published-result history.

This is the FIRST student identity concept in the platform. Staff have had
passwords since the roster shipped; students were identified only by a
sequential, server-guessable admission number (vhs/001, vhs/002, ...), and the
public report was open to anyone who could guess one.

SECURITY MODEL
--------------
The backend still only sees the shared X-API-SECRET-KEY — it has no notion of
"which student". All end-user authorization happens in the Next.js proxy
(app/api/student/*), which verifies a signed, tenant-bound session cookie and
injects the secret server-side. This router is the credential verifier, not
the authorizer.

HASHING
-------
pgcrypto `crypt(password, password_hash)`, computed inside Postgres. There is
no Python bcrypt/passlib/argon2 dependency and we deliberately do not add one:
the mechanism is already proven for staff and admin, and a second hashing
implementation would be a second thing to get wrong.

LOWERCASED ID MATCHING IS LOAD-BEARING
--------------------------------------
Every read path in this codebase matches student ids with
`LOWER(student_id) = LOWER(%s)`, because result_publications carries a
case-SENSITIVE UNIQUE constraint while ids are normalised to lowercase at the
edges (LEGAL_REMEDIATION.md records the drift this caused). vhs genuinely
stores BOTH "vhs/004" and the legacy compact "vhs004", so a case-sensitive
lookup would silently fail for real students.

RATE LIMITING
-------------
Two buckets, never the shared `report:` one:

  * per-account  — one child's bad guesses must not exhaust the family
  * per-IP       — stops a scripted sweep of the roster

The `report:` bucket is keyed `{ip}:{tenant}`, so reusing it would let one
student's failed attempts lock out every other child behind the same NAT.
"""

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

#: Per (tenant, admission number). Five attempts a minute: a student who
#: mistypes twice still gets in, a guesser does not get a usable oracle.
LOGIN_MAX_PER_ACCOUNT = 5
LOGIN_WINDOW_S = 60

#: Per client IP. Generous, because a school can sit behind one NAT and the
#: whole class should be able to check results in the same minute.
LOGIN_MAX_PER_IP = 20

#: Password change is a guessing vector too (the current password must be
#: supplied), so it shares the per-account bucket.
PASSWORD_MAX_PER_ACCOUNT = 5
PASSWORD_WINDOW_S = 60

#: Minimum new-password length. Six, NOT the eight the admin policy enforces:
#: every student's starting credential is the 6-character "123456", so an
#: 8-character minimum would make it impossible to choose a password that the
#: validator accepts without consciously lengthening past the default.
MIN_STUDENT_PASSWORD = 6
MAX_PASSWORD_LEN = 128


async def _verify_student_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    """Shared-secret auth, identical contract to the other tenant routers."""
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
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing request (dev mode)")
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
    prefix="/api/v1/tenant/{tenant_id}/student",
    tags=["student"],
    dependencies=[Depends(_verify_student_secret)],
)


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


def _normalize_student_id(raw: str) -> str:
    """Lowercase the prefix half only, matching every other read path."""
    value = (raw or "").strip()
    if not value:
        return ""
    idx = value.find("/")
    if idx > -1:
        return value[:idx].lower() + value[idx:]
    m = __import__("re").match(r"^([A-Za-z]+)(.*)$", value)
    return (m.group(1).lower() + m.group(2)) if m else value.lower()


def _client_ip(request: Request) -> str:
    if request is not None and getattr(request, "client", None):
        fwd = request.headers.get("x-forwarded-for") or ""
        if fwd:
            return fwd.split(",")[0].strip()
        return request.client.host or "unknown"
    return "unknown"


def _throttle(request: Request, tid: str, ident: str, *, password_flow: bool = False) -> None:
    """Two independent buckets, per account and per IP.

    Never throws on limiter failure: a throttle outage must not lock every
    student out of their results (the export endpoint makes the same
    fail-open choice, with the reasoning logged).
    """
    try:
        from services.rate_limit import check as _rl_check

        per_account = PASSWORD_MAX_PER_ACCOUNT if password_flow else LOGIN_MAX_PER_ACCOUNT
        window = PASSWORD_WINDOW_S if password_flow else LOGIN_WINDOW_S

        ok_acct, retry_a = _rl_check(
            f"student-login:{tid}:{ident.lower()}", max_hits=per_account, window_s=window
        )
        if not ok_acct:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Please wait a moment and try again.",
                headers={"Retry-After": str(retry_a)},
            )

        ok_ip, retry_ip = _rl_check(
            f"student-login-ip:{_client_ip(request)}", max_hits=LOGIN_MAX_PER_IP, window_s=window
        )
        if not ok_ip:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts from this network. Please wait a moment.",
                headers={"Retry-After": str(retry_ip)},
            )
    except HTTPException:
        raise
    except Exception:
        logger.warning("[student] rate limit unavailable; continuing unthrottled", exc_info=True)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class StudentLoginRequest(BaseModel):
    identifier: str = Field(..., description="Admission number, e.g. vhs/004")
    password: str = Field(...)


class StudentPasswordChange(BaseModel):
    current_password: str = Field(...)
    new_password: str = Field(...)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/login", summary="Student login (admission number + password)")
def student_login(
    tenant_id: str,
    payload: StudentLoginRequest,
    request: Request = None,  # type: ignore[assignment]
):
    """Verify credentials and return the claims the Next proxy signs.

    A failed match returns a single 401 regardless of whether the admission
    number exists, so this cannot be used to enumerate a roster.
    """
    from services.db_manager import TENANT_STUDENTS_TABLE, _connect_as_superuser, _row_to_dict

    tid = _validate_tenant_id(tenant_id)
    ident = _normalize_student_id(payload.identifier)
    password = payload.password or ""

    if not ident or not password:
        raise HTTPException(status_code=400, detail="identifier and password are required")

    _throttle(request, tid, ident)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT id, student_id, full_name, class_name,
                   COALESCE(must_change_password, TRUE) AS must_change_password
            FROM {TENANT_STUDENTS_TABLE}
            WHERE subdomain = %s
              AND LOWER(student_id) = LOWER(%s)
              AND password_hash = crypt(%s, password_hash)
            LIMIT 1
            """,
            (tid, ident, password),
        )
        row = cur.fetchone()
        if row is None:
            # Uniform failure: never distinguish "no such student" from
            # "wrong password", or this endpoint becomes a roster oracle.
            raise HTTPException(status_code=401, detail="Invalid admission number or password")

        d = _row_to_dict(row, cur)
        return {
            "student": {
                "id": str(d.get("id")),
                "student_id": d.get("student_id"),
                "full_name": d.get("full_name"),
                "class_name": d.get("class_name"),
                "must_change_password": bool(d.get("must_change_password")),
            },
            "tenant_id": tid,
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.get("/results", summary="Published result history for one student")
def student_results(tenant_id: str, student_id: str):
    """Every PUBLISHED result for this student, newest session first.

    PUBLISHED ONLY, deliberately. Surfacing in-progress terms would show a
    student (and their parents) an empty row and read as "the school hasn't
    marked us", which is confusing and leaks in-progress grading state.

    This deliberately does NOT filter on academic_session: every other
    result_publications read in the codebase pins a single session
    (credits.py, report.py), which is correct for "is this term released?"
    but useless for "what has this child ever been given?".

    Ordering is lexicographic on the session string, which is safe because
    sessions are zero-padded YYYY/YYYY.
    """
    from services.db_manager import TENANT_STUDENTS_TABLE, RESULT_PUBLICATIONS_TABLE, _connect_as_superuser, _row_to_dict

    tid = _validate_tenant_id(tenant_id)
    sid = _normalize_student_id(student_id)
    if not sid:
        raise HTTPException(status_code=400, detail="student_id is required")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        # Confirm the student exists in THIS tenant first, so a cross-tenant or
        # guessed id returns an empty list rather than another school's data.
        cur.execute(
            f"SELECT 1 FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND LOWER(student_id) = LOWER(%s) LIMIT 1",
            (tid, sid),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Student not found")

        cur.execute(
            f"""
            SELECT term, academic_session, published_at
            FROM {RESULT_PUBLICATIONS_TABLE}
            WHERE subdomain = %s AND LOWER(student_id) = LOWER(%s)
            ORDER BY academic_session DESC, term DESC
            """,
            (tid, sid),
        )
        results: List[dict] = []
        for row in cur.fetchall():
            d = _row_to_dict(row, cur)
            if d.get("published_at") is not None:
                try:
                    d["published_at"] = d["published_at"].isoformat()
                except Exception:
                    d["published_at"] = str(d["published_at"])
            results.append(d)

        return {
            "subdomain": tid,
            "student_id": sid,
            "count": len(results),
            "results": results,
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/password", summary="Change this student's password")
def change_student_password(
    tenant_id: str,
    student_id: str,
    payload: StudentPasswordChange,
    request: Request = None,  # type: ignore[assignment]
):
    """Verify the current password, then set the new one.

    The current password is required so a borrowed/left-open session cannot
    silently reassign someone else's credentials. Shares the per-account
    throttle bucket with login, because "guess the current password" is the
    same attack.
    """
    from services.db_manager import TENANT_STUDENTS_TABLE, _connect_as_superuser

    tid = _validate_tenant_id(tenant_id)
    sid = _normalize_student_id(student_id)
    current = payload.current_password or ""
    new = payload.new_password or ""

    if not sid:
        raise HTTPException(status_code=400, detail="student_id is required")
    if not current or not new:
        raise HTTPException(status_code=400, detail="current_password and new_password are required")
    if len(new) < MIN_STUDENT_PASSWORD:
        raise HTTPException(
            status_code=400,
            detail=f"New password must be at least {MIN_STUDENT_PASSWORD} characters",
        )
    if len(new) > MAX_PASSWORD_LEN:
        raise HTTPException(status_code=400, detail="New password is too long")
    if current == new:
        raise HTTPException(status_code=400, detail="New password must differ from the current one")

    _throttle(request, tid, sid, password_flow=True)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE {TENANT_STUDENTS_TABLE}
            SET password_hash = crypt(%s, gen_salt('bf')),
                must_change_password = FALSE
            WHERE subdomain = %s
              AND LOWER(student_id) = LOWER(%s)
              AND password_hash = crypt(%s, password_hash)
            RETURNING student_id;
            """,
            (new, tid, sid, current),
        )
        row = cur.fetchone()
        conn.commit()
        if row is None:
            # Current password wrong, or the student does not exist. Same 401
            # for both, so this is not an existence oracle either.
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        return {"success": True, "subdomain": tid, "student_id": sid}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass