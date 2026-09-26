"""
Credit & Command — Result Command Center (completion tracking + nudges).

Prefix: /api/v1/tenant/{tenant_id}/command-center
Auth:   shared X-API-SECRET-KEY (same trust boundary as admin router).

Reads existing roster tables (tenant_students, tenant_grades,
tenant_allocations, tenant_staff) — no schema changes required.
"""

import logging
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from typing import Optional as _Optional
from fastapi import Header as _Header
import os as _os
import logging as _logging

_logger = _logging.getLogger(__name__)


async def _verify_secret(
    x_api_secret_key: _Optional[str] = _Header(None, alias="X-API-SECRET-KEY"),
):
    """Same shared-secret check as main.verify_api_secret (lazy, no cycle)."""
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        from fastapi import HTTPException as _HTTPException, status as _status

        api_secret = _os.getenv("API_SECRET_KEY", "")
        env = _os.getenv("ENV", "production")
        if not api_secret:
            if env != "production":
                _logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
                return True
            raise _HTTPException(
                status_code=_status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfigured: API_SECRET_KEY not set",
            )
        if not x_api_secret_key:
            raise _HTTPException(status_code=_status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, api_secret):
            raise _HTTPException(status_code=_status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(
    prefix="/api/v1/tenant/{tenant_id}/command-center",
    tags=["command-center"],
    dependencies=[Depends(_verify_secret)],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


def _ensure_tenant(tid: str) -> None:
    from services.db_manager import get_school_by_subdomain

    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")


def _resolve_term_session(term: Optional[str], academic_session: Optional[str]):
    from services.db_manager import VALID_TERMS, current_academic_session

    t = (term or "").strip()
    if t and t not in VALID_TERMS:
        raise HTTPException(status_code=400, detail=f"Invalid term '{term}'. Expected one of {list(VALID_TERMS)}")
    session = (academic_session or "").strip() or current_academic_session()
    return t or None, session


def _close(conn) -> None:
    try:
        if conn:
            conn.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/summary", summary="Tenant-wide completion + balance snapshot")
def get_summary(term: Optional[str] = None, academic_session: Optional[str] = None, tenant_id: str = ""):
    from services.db_manager import _connect_as_superuser, get_credit_balance, get_slots_balance

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    # Prefer persisted current_term/session when caller omits term (dashboard)
    if not term:
        try:
            from services.db_manager import get_school_by_subdomain

            row = get_school_by_subdomain(tid)
            if row and row.get("current_term"):
                term = row.get("current_term")
                if row.get("current_session"):
                    academic_session = row.get("current_session")
        except Exception:
            pass
    t, session = _resolve_term_session(term, academic_session)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM tenant_students WHERE subdomain = %s;",
            (tid,),
        )
        total_students = int(cur.fetchone()[0] or 0)
        cur.execute(
            "SELECT COUNT(*) FROM tenant_staff WHERE subdomain = %s AND COALESCE(is_active, TRUE) = TRUE;",
            (tid,),
        )
        active_staff = int(cur.fetchone()[0] or 0)
        if t:
            cur.execute(
                """
                SELECT COUNT(DISTINCT student_id) FROM result_publications
                WHERE subdomain = %s AND term = %s AND academic_session = %s;
                """,
                (tid, t, session),
            )
            published = int(cur.fetchone()[0] or 0)
        else:
            published = 0
        completion = round((published / total_students) * 100, 1) if total_students else 0.0
        return {
            "subdomain": tid,
            "term": t,
            "academic_session": session,
            "total_students": total_students,
            "published_count": published,
            "completion_pct": completion,
            "credit_balance": get_credit_balance(tid),
            "slots_balance": get_slots_balance(tid),
            "active_staff": active_staff,
        }
    finally:
        _close(conn)


@router.get("/classes", summary="Per-class completion roster")
def get_classes(term: Optional[str] = None, academic_session: Optional[str] = None, tenant_id: str = ""):
    from services.db_manager import _connect_as_superuser, get_credit_balance

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    t, session = _resolve_term_session(term, academic_session)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Distinct classes + headcounts.
        cur.execute(
            """
            SELECT class_name, COUNT(*)
            FROM tenant_students
            WHERE subdomain = %s
            GROUP BY class_name
            ORDER BY class_name;
            """,
            (tid,),
        )
        classes = [{"class_name": r[0], "student_count": int(r[1] or 0)} for r in cur.fetchall()]
        # Published counts per class (join back to roster for class_name).
        pub_by_class: dict = {}
        if t:
            cur.execute(
                """
                SELECT s.class_name, COUNT(DISTINCT p.student_id)
                FROM result_publications p
                JOIN tenant_students s
                  ON s.subdomain = p.subdomain AND s.student_id = p.student_id
                WHERE p.subdomain = %s AND p.term = %s AND p.academic_session = %s
                GROUP BY s.class_name;
                """,
                (tid, t, session),
            )
            pub_by_class = {r[0]: int(r[1] or 0) for r in cur.fetchall()}
        # Grade coverage per class: students with >=1 grade row for the term.
        graded_by_class: dict = {}
        if t:
            cur.execute(
                """
                SELECT s.class_name, COUNT(DISTINCT g.student_id)
                FROM tenant_grades g
                JOIN tenant_students s
                  ON s.subdomain = g.subdomain AND s.student_id = g.student_id
                WHERE g.subdomain = %s AND g.term = %s
                GROUP BY s.class_name;
                """,
                (tid, t),
            )
            graded_by_class = {r[0]: int(r[1] or 0) for r in cur.fetchall()}
        out = []
        for c in classes:
            name = c["class_name"]
            total = c["student_count"]
            published = pub_by_class.get(name, 0)
            graded = graded_by_class.get(name, 0)
            pct = round((published / total) * 100, 1) if total else 0.0
            out.append(
                {
                    "class_name": name,
                    "student_count": total,
                    "graded_count": graded,
                    "published_count": published,
                    "completion_pct": pct,
                    "status": "Ready to Publish" if total and graded >= total else "Incomplete",
                }
            )
        return {
            "subdomain": tid,
            "term": t,
            "academic_session": session,
            "credit_balance": get_credit_balance(tid),
            "classes": out,
        }
    finally:
        _close(conn)


def _missing_for_class(cur, tid: str, t: str, cls: str) -> dict:
    """Per-class missing-grades payload on an already-open cursor.

    Shared core for GET /missing (single class) and GET /missing-batch
    (many classes, one connection). Cross-references roster × allocations ×
    grades: expected subjects come from tenant_allocations; a student is
    pending for a subject when no tenant_grades row exists for
    (subdomain, student_id, subject, term). pending_students previews are
    capped at 50 per subject (counts stay exact); graded_students is
    deliberately uncapped — publish depends on the full list.
    """
    # Roster for the class.
    cur.execute(
        """
        SELECT student_id, full_name
        FROM tenant_students
        WHERE subdomain = %s AND class_name = %s
        ORDER BY full_name;
        """,
        (tid, cls),
    )
    roster = [{"student_id": r[0], "full_name": r[1]} for r in cur.fetchall()]
    if not roster:
        return {
            "subdomain": tid,
            "class_name": cls,
            "term": t,
            "subjects": [],
            "total_pending": 0,
        }
    # Expected subjects + assigned staff.
    cur.execute(
        """
        SELECT subject_name, staff_name
        FROM tenant_allocations
        WHERE subdomain = %s AND class_name = %s
        ORDER BY subject_name;
        """,
        (tid, cls),
    )
    allocations = [{"subject_name": r[0], "staff_name": r[1]} for r in cur.fetchall()]
    # Staff contact lookup.
    cur.execute(
        "SELECT full_name, email, phone FROM tenant_staff WHERE subdomain = %s;",
        (tid,),
    )
    contacts = {r[0]: {"email": r[1], "phone": r[2]} for r in cur.fetchall()}
    # Existing grade coverage for the term.
    student_ids = [s["student_id"] for s in roster]
    cur.execute(
        """
        SELECT student_id, subject_name
        FROM tenant_grades
        WHERE subdomain = %s AND term = %s AND student_id = ANY(%s);
        """,
        (tid, t, student_ids),
    )
    covered = {(r[0], r[1]) for r in cur.fetchall()}
    graded_ids = {sid for (sid, _subj) in covered}
    graded_students = [s for s in roster if s["student_id"] in graded_ids]

    subjects = []
    total_pending = 0
    for a in allocations:
        subj = a["subject_name"]
        pending = [s for s in roster if (s["student_id"], subj) not in covered]
        pending_count = len(pending)
        total_pending += pending_count
        contact = contacts.get(a["staff_name"] or "", {})
        subjects.append(
            {
                "subject_name": subj,
                "staff_name": a["staff_name"],
                "staff_email": contact.get("email"),
                "staff_phone": contact.get("phone"),
                # Full count stays accurate; preview array capped (H4)
                # to bound payload growth. graded_students below is
                # deliberately uncapped — publish depends on it.
                "pending_count": pending_count,
                "pending_students": pending[:50],
                "pending_preview_capped": pending_count > 50,
            }
        )
    return {
        "subdomain": tid,
        "class_name": cls,
        "term": t,
        "subjects": subjects,
        "total_pending": total_pending,
        "graded_students": graded_students,
    }


@router.get("/missing", summary="Missing grades grouped by subject + staff")
def get_missing(class_name: str, term: str, tenant_id: str = ""):
    """Cross-reference roster × allocations × grades (single class).

    Thin wrapper over _missing_for_class — behavior unchanged.
    """
    from services.db_manager import _connect_as_superuser

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    t, _session = _resolve_term_session(term, None)
    if not t:
        raise HTTPException(status_code=400, detail="term is required")
    cls = (class_name or "").strip()
    if not cls:
        raise HTTPException(status_code=400, detail="class_name is required")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        return _missing_for_class(cur, tid, t, cls)
    finally:
        _close(conn)


#: Max classes per /missing-batch request (H2) — bounds the single request.
MISSING_BATCH_MAX_CLASSES = 20


@router.get("/missing-batch", summary="Missing grades for several classes (one round-trip)")
def get_missing_batch(class_names: str, term: str, tenant_id: str = ""):
    """Batch variant of /missing for the publish flow (H2).

    `class_names` is a comma-separated list (class names contain no commas).
    Resolves each class on ONE connection and returns
    { subdomain, term, classes: { "<class>": <get_missing payload> } }.
    """
    from services.db_manager import _connect_as_superuser

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    t, _session = _resolve_term_session(term, None)
    if not t:
        raise HTTPException(status_code=400, detail="term is required")
    seen: dict = {}
    for raw in (class_names or "").split(","):
        cls = (raw or "").strip()
        if cls and cls not in seen:
            seen[cls] = True
    classes = list(seen.keys())
    if not classes:
        raise HTTPException(status_code=400, detail="class_names is required")
    if len(classes) > MISSING_BATCH_MAX_CLASSES:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MISSING_BATCH_MAX_CLASSES} classes per batch",
        )

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        out: dict = {}
        for cls in classes:
            out[cls] = _missing_for_class(cur, tid, t, cls)
        return {"subdomain": tid, "term": t, "classes": out}
    finally:
        _close(conn)


@router.get("/nudge-link", summary="One-click WhatsApp/Email nudge link generator")
def get_nudge_link(
    staff_name: str,
    class_name: str,
    term: str,
    subject_name: Optional[str] = None,
    pending_count: int = 0,
    tenant_id: str = "",
):
    """Returns wa.me + mailto links — no WhatsApp API key required."""
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    t, _session = _resolve_term_session(term, None)
    if not t:
        raise HTTPException(status_code=400, detail="term is required")
    staff = (staff_name or "").strip()
    cls = (class_name or "").strip()
    if not staff or not cls:
        raise HTTPException(status_code=400, detail="staff_name and class_name are required")

    scope = f"{subject_name} for " if (subject_name or "").strip() else ""
    count_part = f" ({pending_count} student(s) pending)" if pending_count else ""
    message = (
        f"Hello {staff}, this is a reminder from ResultApp: grades for {scope}{cls} "
        f"{t}{count_part} are still pending. Please enter them so results can be published on time. Thank you!"
    )
    wa_link = f"https://wa.me/?text={quote(message)}"

    # Staff contact for direct links (best-effort).
    email = phone = None
    try:
        from services.db_manager import _connect_as_superuser

        conn = _connect_as_superuser()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT email, phone FROM tenant_staff WHERE subdomain = %s AND full_name = %s LIMIT 1;",
                (tid, staff),
            )
            row = cur.fetchone()
            if row:
                email, phone = row[0], row[1]
        finally:
            _close(conn)
    except Exception:
        pass

    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    direct_wa = f"https://wa.me/{digits}?text={quote(message)}" if digits else None
    mailto = f"mailto:{email}?subject={quote(f'Grades pending: {cls} {t}')}&body={quote(message)}" if email else None
    return {
        "subdomain": tid,
        "staff_name": staff,
        "class_name": cls,
        "term": t,
        "subject_name": subject_name,
        "message": message,
        "whatsapp_link": wa_link,
        "whatsapp_direct": direct_wa,
        "email_link": mailto,
    }


# ---------------------------------------------------------------------------
# Bulk principal remarks (Smart Remarks) — admin-only via proxy admin_session
# ---------------------------------------------------------------------------

#: Max classes per bulk-apply request (mirrors missing-batch cap).
APPLY_REMARKS_MAX_CLASSES = 20


class ApplyPrincipalRemarksRequest(BaseModel):
    term: str = Field(..., min_length=1, max_length=64)
    academic_session: Optional[str] = Field(default=None, max_length=64)
    # Restricted to explicitly selected classes (no whole-tenant sweep).
    class_names: List[str] = Field(..., min_length=1, max_length=20)
    # Strictly False by default: never clobber manual/existing remarks.
    overwrite: bool = False


@router.post("/apply-principal-remarks", summary="Auto-apply principal remarks to unpublished students")
def apply_principal_remarks(tenant_id: str, payload: ApplyPrincipalRemarksRequest):
    """Evaluate the tenant's principal_remark_scheme against each unpublished
    student's canonical average and persist principal_remark on their grade
    rows. Skips published students, students without grades, students already
    carrying a remark (unless overwrite), and averages falling in scheme gaps.
    """
    from services.db_manager import _connect_as_superuser, get_school_by_subdomain
    from services.remark_schemes import evaluate_scheme

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant(tid)
    t, session = _resolve_term_session(payload.term, payload.academic_session)
    if not t:
        raise HTTPException(status_code=400, detail="term is required")
    classes = [c.strip() for c in (payload.class_names or []) if (c or "").strip()]
    if not classes:
        raise HTTPException(status_code=400, detail="class_names is required")
    if len(classes) > APPLY_REMARKS_MAX_CLASSES:
        raise HTTPException(status_code=400, detail=f"At most {APPLY_REMARKS_MAX_CLASSES} classes per batch")

    school = get_school_by_subdomain(tid)
    scheme = (school or {}).get("principal_remark_scheme") or []
    if not isinstance(scheme, list) or not scheme:
        raise HTTPException(status_code=422, detail="No principal remark scheme configured — set it in Settings first")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # Roster for the selected classes.
        cur.execute(
            """
            SELECT student_id FROM tenant_students
            WHERE subdomain = %s AND class_name = ANY(%s);
            """,
            (tid, classes),
        )
        roster_ids = [r[0] for r in cur.fetchall() if r[0]]
        if not roster_ids:
            return {"success": True, "subdomain": tid, "applied": 0,
                    "skipped_no_grades": 0, "skipped_has_remarks": 0,
                    "skipped_no_band": 0, "skipped_published": 0}
        # Published students are out of scope (report cards already issued).
        cur.execute(
            """
            SELECT DISTINCT student_id FROM result_publications
            WHERE subdomain = %s AND term = %s AND academic_session = %s;
            """,
            (tid, t, session),
        )
        published = {r[0] for r in cur.fetchall()}
        targets = [sid for sid in roster_ids if sid not in published]
        skipped_published = len(roster_ids) - len(targets)

        # Newest active template for canonical totals (raw SQL; psycopg2 path
        # has no SQLAlchemy session). Falls back to granular/raw-sum.
        academic_structure = None
        try:
            # NOTE: grading_templates.tenant_id mirrors the subdomain.
            cur.execute(
                """
                SELECT academic_structure FROM grading_templates
                WHERE tenant_id = %s AND is_active = TRUE
                ORDER BY created_at DESC LIMIT 1;
                """,
                (tid,),
            )
            tpl_row = cur.fetchone()
            if tpl_row and isinstance(tpl_row[0], dict):
                academic_structure = tpl_row[0]
        except Exception:
            academic_structure = None

        from routers.report import (
            _extract_breakdown as _rb_extract,
            _compute_simple_granular_total as _rb_granular,
            _compute_total as _rb_total,
        )

        # Bulk grades for targets (all subjects, this term).
        cur.execute(
            """
            SELECT student_id, subject_name, academic_scores, principal_remark
            FROM tenant_grades
            WHERE subdomain = %s AND term = %s AND student_id = ANY(%s);
            """,
            (tid, t, targets),
        )
        per_student: dict = {}
        for sid, subj, scores, existing in cur.fetchall():
            entry = per_student.setdefault(sid, {"totals": [], "has_remark": False})
            if isinstance(existing, str) and existing.strip():
                entry["has_remark"] = True
            if isinstance(scores, dict):
                br = _rb_extract(scores)
                gt = _rb_granular(br)
                if gt is None:
                    gt = _rb_total(academic_structure, scores)
                try:
                    entry["totals"].append(float(gt))
                except Exception:
                    pass

        applied = skipped_no_grades = skipped_has_remarks = skipped_no_band = 0
        writes: list = []
        for sid in targets:
            entry = per_student.get(sid, {"totals": [], "has_remark": False})
            if not entry["totals"]:
                skipped_no_grades += 1
                continue
            if entry["has_remark"] and not payload.overwrite:
                skipped_has_remarks += 1
                continue
            avg = round(sum(entry["totals"]) / len(entry["totals"]), 1)
            text = evaluate_scheme(avg, scheme)
            if not text:
                skipped_no_band += 1
                continue
            writes.append((text, tid, t, sid))
            applied += 1
        if writes:
            if payload.overwrite:
                cur.executemany(
                    """
                    UPDATE tenant_grades SET principal_remark = %s, updated_at = NOW()
                    WHERE subdomain = %s AND term = %s AND student_id = %s;
                    """,
                    writes,
                )
            else:
                cur.executemany(
                    """
                    UPDATE tenant_grades SET principal_remark = %s, updated_at = NOW()
                    WHERE subdomain = %s AND term = %s AND student_id = %s
                      AND (principal_remark IS NULL OR principal_remark = '');
                    """,
                    writes,
                )
            conn.commit()
        return {"success": True, "subdomain": tid, "term": t,
                "applied": applied, "skipped_no_grades": skipped_no_grades,
                "skipped_has_remarks": skipped_has_remarks,
                "skipped_no_band": skipped_no_band,
                "skipped_published": skipped_published}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        _logger.exception(f"[command-center] apply-principal-remarks failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Bulk remark apply failed: {e}")
    finally:
        _close(conn)
