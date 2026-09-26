"""
Staff Focused Grading Workflow — per-tenant score entry.
Prefix: /api/v1/tenant/{tenant_id}/staff/grading

- GET  /{class_name}/{subject_name}?term=Term 1
       Combined bundle: active template + class students + existing grades.
- POST /batch
       Bulk upsert of one assessment (or behavioural traits) for many students.
       Uses PostgreSQL JSONB concatenation so re-saving one assessment never
       wipes the others:
         ON CONFLICT (...) DO UPDATE SET academic_scores = tenant_grades.academic_scores || EXCLUDED.academic_scores

Templates live in the grading-engine DB (SQLAlchemy, most recently created
wins); roster + grades use raw psycopg2 (mirrors allocations router).
"""

from typing import Any, Dict, List, Literal, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import json
import logging
import os

from database import get_db

logger = logging.getLogger(__name__)

VALID_TERMS = ("Term 1", "Term 2", "Term 3")


async def _verify_grading_secret(
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


router = APIRouter(
    prefix="/api/v1/tenant/{tenant_id}/staff/grading",
    tags=["staff-grading"],
    dependencies=[Depends(_verify_grading_secret)],
)


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


def _ensure_tenant_exists(tid: str):
    from services.db_manager import get_school_by_subdomain

    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")


def _serialize_rows(cursor, rows):
    from services.db_manager import _row_to_dict
    from datetime import datetime

    out = []
    for r in rows:
        d = _row_to_dict(r, cursor)
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        elif d.get("created_at") is not None:
            d["created_at"] = str(d["created_at"])
        if "id" in d and d["id"] is not None:
            d["id"] = str(d["id"])
        out.append(d)
    return out


def _get_active_template(db: Session, tid: str, class_name: Optional[str] = None):
    """Newest active template bound to the class, else newest global template.

    Delegates to the shared service (H3 perf fix): single SQL row fetch with
    match-quality ordering on Postgres, Python-filter fallback on other
    dialects (e.g. SQLite in tests). Semantics preserved exactly.
    """
    from services.grading_templates import get_active_template as _shared

    return _shared(db, tid, class_name)


def _template_payload(template) -> Dict[str, Any]:
    created = getattr(template, "created_at", None)
    return {
        "id": getattr(template, "id", None),
        "name": getattr(template, "name", ""),
        "academic_structure": getattr(template, "academic_structure", None) or {},
        "behavioral_structure": getattr(template, "behavioral_structure", None),
        "created_at": created.isoformat() if hasattr(created, "isoformat") else str(created or ""),
    }


def _template_max_map(academic_structure: Any) -> Dict[str, float]:
    """assessment key -> max score, from components/items (mirrors grading router)."""
    max_map: Dict[str, float] = {}
    try:
        if isinstance(academic_structure, dict) and "components" in academic_structure:
            for comp in academic_structure.get("components") or []:
                if not isinstance(comp, dict):
                    continue
                items = comp.get("items")
                if isinstance(items, list):
                    for it in items:
                        if isinstance(it, dict) and it.get("name"):
                            try:
                                max_map[str(it["name"]).strip()] = float(it.get("max_score") or it.get("max") or 0)
                            except Exception:
                                pass
                elif comp.get("name"):
                    try:
                        max_map[str(comp["name"]).strip()] = float(comp.get("max_score") or comp.get("max") or 0)
                    except Exception:
                        pass
    except Exception:
        max_map = {}
    return max_map


def _template_traits_and_scale(behavioral_structure: Any):
    traits: List[str] = []
    scale: List[str] = []
    try:
        if isinstance(behavioral_structure, dict):
            raw_traits = behavioral_structure.get("traits") or behavioral_structure.get("items") or []
            if isinstance(raw_traits, list):
                traits = [str(t).strip() for t in raw_traits if str(t).strip()]
            raw_scale = behavioral_structure.get("scale") or []
            if isinstance(raw_scale, list):
                scale = [str(s).strip().upper() for s in raw_scale if str(s).strip()]
    except Exception:
        pass
    return traits, scale


# ---------------------------------------------------------------------------
# GET — form-teacher grid for one class + term (traits + remarks, all subjects)
# NOTE: registered BEFORE /{class_name}/{subject_name} so "forms" never
# matches the class_name path param.
# ---------------------------------------------------------------------------

@router.get("/forms/{class_name}", summary="Form grid: roster + merged traits + remarks")
def get_form_grid(
    tenant_id: str,
    class_name: str,
    term: str = Query("Term 1"),
    staff_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Form-teacher workspace data (read-only).

    Merges behavioural_traits across all subjects for the term (latest write
    wins per trait) and surfaces the first non-empty remark per student.
    `subjects` provides the save-context subject for trait/remark writes
    (grade rows require a subject attachment). `is_form_teacher` lets the
    frontend refuse non-assigned viewers.
    """
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    term = (term or "").strip()
    if term not in VALID_TERMS:
        raise HTTPException(status_code=400, detail="term must be one of Term 1, Term 2, Term 3")
    class_name = (class_name or "").strip()
    if not class_name:
        raise HTTPException(status_code=400, detail="class_name is required")

    template = _get_active_template(db, tid, class_name)
    if template is None:
        raise HTTPException(status_code=404, detail=f"No grading template found for tenant '{tid}' — ask an admin to create one")
    traits_allowed, scale_allowed = _template_traits_and_scale(
        getattr(template, "behavioral_structure", None) or {}
    )

    from services.db_manager import (
        TENANT_STUDENTS_TABLE,
        TENANT_GRADES_TABLE,
        TENANT_ALLOCATIONS_TABLE,
        TENANT_FORM_ASSIGNMENTS_TABLE,
        TENANT_STAFF_TABLE,
        _connect_as_superuser,
    )

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        cur.execute(
            f"SELECT id, student_id, full_name, class_name, gender FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND class_name = %s ORDER BY full_name",
            (tid, class_name),
        )
        students = _serialize_rows(cur, cur.fetchall())
        student_ids = [s["student_id"] for s in students]

        traits: Dict[str, Dict[str, str]] = {}
        remarks: Dict[str, str] = {}
        if student_ids:
            cur.execute(
                f"""
                SELECT student_id, behavioural_traits, remarks
                FROM {TENANT_GRADES_TABLE}
                WHERE subdomain = %s AND term = %s AND student_id = ANY(%s)
                ORDER BY updated_at DESC
                """,
                (tid, term, student_ids),
            )
            for sid, b_traits, remark in cur.fetchall():
                if isinstance(b_traits, dict):
                    slot = traits.setdefault(sid, {})
                    for k, v in b_traits.items():
                        kk, vv = str(k).strip(), str(v).strip()
                        if kk and vv and kk not in slot:
                            slot[kk] = vv
                if sid not in remarks and isinstance(remark, str) and remark.strip():
                    remarks[sid] = remark.strip()

        cur.execute(
            f"""
            SELECT DISTINCT subject_name FROM {TENANT_ALLOCATIONS_TABLE}
            WHERE subdomain = %s AND class_name = %s ORDER BY subject_name
            """,
            (tid, class_name),
        )
        subjects = [r[0] for r in cur.fetchall() if r[0]]

        is_form_teacher = False
        _caller = (staff_id or "").strip()
        if _caller:
            cur.execute(
                f"""
                SELECT staff_id FROM {TENANT_STAFF_TABLE}
                WHERE subdomain = %s
                  AND (LOWER(staff_id) = LOWER(%s) OR id::text = %s OR LOWER(email) = LOWER(%s))
                LIMIT 1
                """,
                (tid, _caller, _caller, _caller),
            )
            _srow = cur.fetchone()
            if _srow is not None:
                cur.execute(
                    f"""
                    SELECT 1 FROM {TENANT_FORM_ASSIGNMENTS_TABLE}
                    WHERE subdomain = %s AND class_name = %s AND LOWER(staff_id) = LOWER(%s)
                    LIMIT 1
                    """,
                    (tid, class_name, str(_srow[0])),
                )
                is_form_teacher = cur.fetchone() is not None

        return {
            "students": students,
            "traits": traits,
            "remarks": remarks,
            "subjects": subjects,
            "allowed_traits": traits_allowed,
            "scale": scale_allowed,
            "term": term,
            "class_name": class_name,
            "is_form_teacher": is_form_teacher,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[staff-grading] form grid failed for {tid}/{class_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load form grid: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# GET — grading bundle for one class + subject + term
# ---------------------------------------------------------------------------

@router.get("/{class_name}/{subject_name}", summary="Grading bundle: template + students + existing grades")
def get_grading_bundle(
    tenant_id: str,
    class_name: str,
    subject_name: str,
    term: str = Query("Term 1"),
    staff_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    term = (term or "").strip()
    if term not in VALID_TERMS:
        raise HTTPException(status_code=400, detail="term must be one of Term 1, Term 2, Term 3")
    class_name = (class_name or "").strip()
    subject_name = (subject_name or "").strip()
    if not class_name or not subject_name:
        raise HTTPException(status_code=400, detail="class_name and subject_name are required")

    template = _get_active_template(db, tid, class_name)
    if template is None:
        raise HTTPException(status_code=404, detail=f"No grading template found for tenant '{tid}' — ask an admin to create one")

    from services.db_manager import (
        TENANT_STUDENTS_TABLE,
        TENANT_GRADES_TABLE,
        TENANT_STAFF_TABLE,
        TENANT_ALLOCATIONS_TABLE,
        TENANT_FORM_ASSIGNMENTS_TABLE,
        _connect_as_superuser,
    )

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        cur.execute(
            f"SELECT id, student_id, full_name, class_name, gender FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND class_name = %s ORDER BY full_name",
            (tid, class_name),
        )
        students = _serialize_rows(cur, cur.fetchall())
        student_ids = [s["student_id"] for s in students]

        academic: Dict[str, Any] = {}
        behavioural: Dict[str, Any] = {}
        if student_ids:
            cur.execute(
                f"SELECT student_id, academic_scores, behavioural_traits FROM {TENANT_GRADES_TABLE} WHERE subdomain = %s AND subject_name = %s AND term = %s AND student_id = ANY(%s)",
                (tid, subject_name, term, student_ids),
            )
            for row in cur.fetchall():
                sid = row[0]
                academic[sid] = row[1] or {}
                behavioural[sid] = row[2] or {}

        # Capability flags for the staff hub split. Absent staff_id preserves
        # the legacy permissive response; the proxy always sends staff_id.
        can_grade_academic: bool = True
        can_grade_traits: bool = True
        _caller = (staff_id or "").strip()
        if _caller:
            can_grade_academic = False
            can_grade_traits = False
            cur.execute(
                f"""
                SELECT staff_id, full_name FROM {TENANT_STAFF_TABLE}
                WHERE subdomain = %s
                  AND (LOWER(staff_id) = LOWER(%s) OR id::text = %s OR LOWER(email) = LOWER(%s))
                LIMIT 1
                """,
                (tid, _caller, _caller, _caller),
            )
            _srow = cur.fetchone()
            if _srow is not None:
                _csid, _cname = str(_srow[0]), str(_srow[1])
                cur.execute(
                    f"""
                    SELECT 1 FROM {TENANT_ALLOCATIONS_TABLE}
                    WHERE subdomain = %s AND class_name = %s AND subject_name = %s AND staff_name = %s
                    LIMIT 1
                    """,
                    (tid, class_name, subject_name, _cname),
                )
                if cur.fetchone() is not None:
                    can_grade_academic = True
                cur.execute(
                    f"""
                    SELECT 1 FROM {TENANT_FORM_ASSIGNMENTS_TABLE}
                    WHERE subdomain = %s AND class_name = %s AND LOWER(staff_id) = LOWER(%s)
                    LIMIT 1
                    """,
                    (tid, class_name, _csid),
                )
                if cur.fetchone() is not None:
                    can_grade_traits = True

        return {
            "template": _template_payload(template),
            "students": students,
            "grades": academic,
            "behavioural": behavioural,
            "term": term,
            "class_name": class_name,
            "subject_name": subject_name,
            "can_grade_academic": can_grade_academic,
            "can_grade_traits": can_grade_traits,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[staff-grading] bundle failed for {tid}/{class_name}/{subject_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load grading bundle: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# POST — batch save one assessment (or behavioural traits) for many students
# ---------------------------------------------------------------------------

class BatchScore(BaseModel):
    student_id: str
    score: Union[float, str]
    # Required only when assessment_key == "behavioural": which trait this grade is for.
    trait: Optional[str] = None


class BatchPayload(BaseModel):
    term: Literal["Term 1", "Term 2", "Term 3"]
    subject_name: str
    class_name: str
    assessment_key: str
    scores: List[BatchScore] = Field(..., min_length=1)
    # Caller identity — REQUIRED (contextual allocations). The Next.js proxy
    # injects this server-side from staff_session; client values are ignored.
    staff_id: str = Field(..., min_length=1)
    # Optional per-student remarks (student_id -> text). Form-teacher-only,
    # stored on tenant_grades.remarks. Absent key = preserve existing.
    remarks: Optional[Dict[str, str]] = None


@router.post("/batch", status_code=201, summary="Save batch scores for one assessment")
def post_grading_batch(
    tenant_id: str,
    payload: BatchPayload,
    db: Session = Depends(get_db),
):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    subject_name = (payload.subject_name or "").strip()
    class_name = (payload.class_name or "").strip()
    assessment_key = (payload.assessment_key or "").strip()
    if not subject_name or not class_name or not assessment_key:
        raise HTTPException(status_code=400, detail="subject_name, class_name and assessment_key are required")

    template = _get_active_template(db, tid, class_name)
    if template is None:
        raise HTTPException(status_code=404, detail=f"No grading template found for tenant '{tid}'")
    academic_structure = getattr(template, "academic_structure", None) or {}
    behavioral_structure = getattr(template, "behavioral_structure", None) or {}

    from services.db_manager import (
        TENANT_STUDENTS_TABLE,
        TENANT_GRADES_TABLE,
        TENANT_STAFF_TABLE,
        TENANT_ALLOCATIONS_TABLE,
        TENANT_FORM_ASSIGNMENTS_TABLE,
        _connect_as_superuser,
    )

    # Caller identity is mandatory — no legacy anonymous writes.
    caller_id = (payload.staff_id or "").strip()
    if not caller_id:
        raise HTTPException(status_code=422, detail="staff_id is required")

    is_behavioural = assessment_key == "behavioural"
    if not is_behavioural:
        max_map = _template_max_map(academic_structure)
        if assessment_key not in max_map or max_map[assessment_key] <= 0:
            raise HTTPException(status_code=422, detail=f"Assessment '{assessment_key}' is not defined in the active template")
        max_score = max_map[assessment_key]
    else:
        traits_allowed, scale_allowed = _template_traits_and_scale(behavioral_structure)

    academic_updates: Dict[str, Dict[str, float]] = {}
    trait_updates: Dict[str, Dict[str, str]] = {}

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        # Roster guard — only students of this class may receive scores.
        cur.execute(
            f"SELECT student_id FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND class_name = %s",
            (tid, class_name),
        )
        class_ids = {r[0] for r in cur.fetchall()}

        # --- Caller resolution (staff_id | UUID | email, case-insensitive) ---
        cur.execute(
            f"""
            SELECT staff_id, full_name FROM {TENANT_STAFF_TABLE}
            WHERE subdomain = %s
              AND (LOWER(staff_id) = LOWER(%s) OR id::text = %s OR LOWER(email) = LOWER(%s))
            LIMIT 1
            """,
            (tid, caller_id, caller_id, caller_id),
        )
        staff_row = cur.fetchone()
        if staff_row is None:
            raise HTTPException(status_code=403, detail=f"Unknown staff '{caller_id}' in tenant '{tid}'")
        caller_staff_id, caller_name = str(staff_row[0]), str(staff_row[1])

        # --- Normalize remarks up-front (form-teacher domain) ---
        remark_updates: Dict[str, str] = {}
        for _rk, _rv in (payload.remarks or {}).items():
            _raw_r = (_rk or "").strip()
            if "/" in _raw_r:
                _pfx_r, _rest_r = _raw_r.split("/", 1)
                _rsid = _pfx_r.lower() + "/" + _rest_r
            else:
                import re as _re_r
                _m_r = _re_r.match(r"^([A-Za-z]+)(.*)$", _raw_r)
                _rsid = (_m_r.group(1).lower() + _m_r.group(2)) if _m_r else _raw_r.lower()
            if not _rsid:
                raise HTTPException(status_code=422, detail="Every remark needs a student_id")
            if _rsid not in class_ids:
                raise HTTPException(status_code=422, detail=f"Student '{_rsid}' is not in class '{class_name}'")
            _text = str(_rv or "").strip()
            if len(_text) > 500:
                raise HTTPException(status_code=422, detail=f"Remark for '{_rsid}' exceeds 500 characters")
            if _text:
                remark_updates[_rsid] = _text

        # --- Atomic authorization (all-or-nothing: 403 writes NOTHING) ---
        # Academic side: caller must hold the subject allocation for this class.
        if not is_behavioural:
            cur.execute(
                f"""
                SELECT 1 FROM {TENANT_ALLOCATIONS_TABLE}
                WHERE subdomain = %s AND class_name = %s AND subject_name = %s AND staff_name = %s
                LIMIT 1
                """,
                (tid, class_name, subject_name, caller_name),
            )
            if cur.fetchone() is None:
                raise HTTPException(
                    status_code=403,
                    detail=f"Staff '{caller_staff_id}' has no subject allocation for '{subject_name}' in '{class_name}'",
                )
        # Form-teacher side: traits and/or remarks require the form assignment.
        if is_behavioural or remark_updates:
            cur.execute(
                f"""
                SELECT 1 FROM {TENANT_FORM_ASSIGNMENTS_TABLE}
                WHERE subdomain = %s AND class_name = %s AND LOWER(staff_id) = LOWER(%s)
                LIMIT 1
                """,
                (tid, class_name, caller_staff_id),
            )
            if cur.fetchone() is None:
                raise HTTPException(
                    status_code=403,
                    detail=f"Staff '{caller_staff_id}' is not the Form Teacher for '{class_name}'",
                )

        for entry in payload.scores:
            _raw = (entry.student_id or "").strip()
            # Lowercase prefix before slash (vhs/005)
            if "/" in _raw:
                _pfx, _rest = _raw.split("/", 1)
                sid = _pfx.lower() + "/" + _rest
            else:
                import re as _re2
                _m2 = _re2.match(r"^([A-Za-z]+)(.*)$", _raw)
                sid = (_m2.group(1).lower() + _m2.group(2)) if _m2 else _raw.lower()
            if not sid:
                raise HTTPException(status_code=422, detail="Every score needs a student_id")
            if sid not in class_ids:
                raise HTTPException(status_code=422, detail=f"Student '{sid}' is not in class '{class_name}'")

            if is_behavioural:
                trait = ((entry.trait or "").strip())
                if not trait:
                    raise HTTPException(status_code=422, detail="Every behavioural score needs a trait")
                if traits_allowed and trait not in traits_allowed:
                    raise HTTPException(status_code=422, detail=f"Trait '{trait}' is not defined in the active template")
                grade = str(entry.score).strip().upper()
                if not grade:
                    raise HTTPException(status_code=422, detail=f"Grade for '{trait}' cannot be empty")
                if scale_allowed and grade not in scale_allowed:
                    raise HTTPException(status_code=422, detail=f"Grade '{grade}' is not in the template scale ({', '.join(scale_allowed)})")
                trait_updates.setdefault(sid, {})[trait] = grade
            else:
                try:
                    val = float(entry.score)  # type: ignore[arg-type]
                except Exception:
                    raise HTTPException(status_code=422, detail=f"Score for '{sid}' must be numeric")
                if val < 0:
                    raise HTTPException(status_code=422, detail=f"Score for '{sid}' cannot be negative")
                if val > max_score:
                    raise HTTPException(status_code=422, detail=f"Score for '{sid}' ({val}) exceeds max {max_score} for '{assessment_key}'")
                academic_updates.setdefault(sid, {})[assessment_key] = val

        all_sids = set(academic_updates) | set(trait_updates) | set(remark_updates)
        if not all_sids:
            raise HTTPException(status_code=422, detail="No scores to save")
        rows = [
            (
                tid,
                sid,
                subject_name,
                payload.term,
                json.dumps(academic_updates.get(sid, {})),
                json.dumps(trait_updates.get(sid, {})),
                remark_updates.get(sid),
            )
            for sid in all_sids
        ]
        # Single round-trip batched upsert (Option B): one server round-trip
        # regardless of class size. Same JSONB-merge semantics as the former
        # per-student loop (single-assessment saves never wipe siblings).
        # remarks: NULL in EXCLUDED preserves the stored value; a provided
        # string overwrites it.
        from psycopg2.extras import execute_values

        upsert_sql = (
            f"INSERT INTO {TENANT_GRADES_TABLE} "
            "(subdomain, student_id, subject_name, term, academic_scores, behavioural_traits, remarks) "
            "VALUES %s "
            "ON CONFLICT (subdomain, student_id, subject_name, term) "
            f"DO UPDATE SET academic_scores = {TENANT_GRADES_TABLE}.academic_scores || EXCLUDED.academic_scores, "
            f"behavioural_traits = {TENANT_GRADES_TABLE}.behavioural_traits || EXCLUDED.behavioural_traits, "
            f"remarks = CASE WHEN EXCLUDED.remarks IS NULL THEN {TENANT_GRADES_TABLE}.remarks ELSE EXCLUDED.remarks END, "
            "updated_at = NOW()"
        )
        # Chunk to bound single-statement size for very large classes.
        for _i in range(0, len(rows), 500):
            execute_values(
                cur,
                upsert_sql,
                rows[_i : _i + 500],
                template="(%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)",
            )
        conn.commit()
        logger.info(f"[staff-grading] batch saved {tid}/{class_name}/{subject_name}/{assessment_key} for {len(all_sids)} students by {caller_staff_id}")
        return {
            "success": True,
            "saved": len(all_sids),
            "remarks_saved": len(remark_updates),
            "term": payload.term,
            "subject_name": subject_name,
            "class_name": class_name,
            "assessment_key": assessment_key,
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[staff-grading] batch failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save scores: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
