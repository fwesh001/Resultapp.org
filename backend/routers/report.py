"""
Report Card — Digital Paper.
GET /api/v1/tenant/{tenant_id}/report/{student_id}?term=Term 1

Queries tenant_students (bio), active grading_templates, tenant_grades (primary)
with graceful fallback to legacy student_academic_records / student_behavioral_records.
Always returns 200 even if student is null so frontend can show admission-number banner.
Computes totalScore / average / overallGrade via Nigerian thresholds.
"""

from typing import Any, Dict, List, Optional
import logging
import os
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

import models
from database import get_db

logger = logging.getLogger(__name__)

VALID_TERMS = ("Term 1", "Term 2", "Term 3")


async def _verify_report_secret(
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
    prefix="/api/v1/tenant/{tenant_id}/report",
    tags=["report"],
    dependencies=[Depends(_verify_report_secret)],
)


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


def _get_active_template(db: Session, tid: str):
    return (
        db.query(models.GradingTemplate)
        .filter(models.GradingTemplate.tenant_id == tid)
        .order_by(models.GradingTemplate.created_at.desc())
        .first()
    )


def _template_payload(template) -> Optional[Dict[str, Any]]:
    if template is None:
        return None
    created = getattr(template, "created_at", None)
    return {
        "id": getattr(template, "id", None),
        "name": getattr(template, "name", ""),
        "academic_structure": getattr(template, "academic_structure", None) or {},
        "behavioral_structure": getattr(template, "behavioral_structure", None),
        "created_at": created.isoformat() if hasattr(created, "isoformat") else str(created or ""),
    }


def _grade_from_total(total: float) -> str:
    if total >= 70:
        return "A"
    if total >= 60:
        return "B"
    if total >= 50:
        return "C"
    if total >= 45:
        return "D"
    if total >= 40:
        return "E"
    return "F"


def _remark_from_grade(grade: str) -> str:
    return {"A": "Excellent", "B": "Very Good", "C": "Good", "D": "Pass", "E": "Pass", "F": "Fail"}.get(grade, "")


def _compute_total(academic_structure: Optional[Dict[str, Any]], scores: Dict[str, Any]) -> float:
    # Reuse weighted helper if template available, else simple sum capped at 100
    try:
        from routers.grading import compute_weighted_total

        if academic_structure:
            return float(compute_weighted_total(academic_structure, scores))
    except Exception:
        pass
    # Fallback simple sum
    try:
        s = 0.0
        for v in scores.values():
            try:
                s += float(v)
            except Exception:
                continue
        return round(min(s, 100.0), 2)
    except Exception:
        return 0.0


def _academic_session() -> str:
    now = datetime.now()
    y = now.year
    m = now.month
    # Sept (9) is academic year rollover for NG schools
    if m >= 9:
        return f"{y}/{y+1}"
    return f"{y-1}/{y}"


@router.get("/{student_id}", summary="Report card bundle: student bio + template + grades + behavioural + summary")
def get_report_bundle(
    tenant_id: str,
    student_id: str,
    term: str = Query("Term 1"),
    db: Session = Depends(get_db),
):
    tid = _validate_tenant_id(tenant_id)
    sid = (student_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="student_id is required")
    term = (term or "").strip()
    if term not in VALID_TERMS:
        raise HTTPException(status_code=400, detail="term must be one of Term 1, Term 2, Term 3")

    # Ensure tenant exists — 404 if school unknown (distinct from student null case)
    from services.db_manager import get_school_by_subdomain

    if get_school_by_subdomain(tid) is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")

    # Fetch template (may be null)
    template = _get_active_template(db, tid)
    template_payload = _template_payload(template)
    academic_structure = getattr(template, "academic_structure", None) if template else None

    # Fetch student bio from tenant_students
    student = None
    from services.db_manager import TENANT_STUDENTS_TABLE, TENANT_GRADES_TABLE, _connect_as_superuser, _row_to_dict

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"SELECT student_id, full_name, class_name, gender FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND student_id = %s LIMIT 1",
            (tid, sid),
        )
        row = cur.fetchone()
        if row is not None:
            d = _row_to_dict(row, cur)
            student = {
                "student_id": d.get("student_id"),
                "full_name": d.get("full_name"),
                "class_name": d.get("class_name"),
                "gender": d.get("gender"),
            }
        else:
            student = None

        # If student missing, still return 200 with student:null for frontend banner
        grades_out: List[Dict[str, Any]] = []
        behavioural_merged: Dict[str, str] = {}

        if student is not None:
            # Primary source: tenant_grades
            cur.execute(
                f"SELECT subject_name, academic_scores, behavioural_traits FROM {TENANT_GRADES_TABLE} WHERE subdomain = %s AND student_id = %s AND term = %s ORDER BY subject_name",
                (tid, sid, term),
            )
            rows = cur.fetchall()
            if rows:
                for r in rows:
                    subject_name = r[0]
                    academic_scores = r[1] or {}
                    behavioural_traits = r[2] or {}
                    if not isinstance(academic_scores, dict):
                        academic_scores = {}
                    if not isinstance(behavioural_traits, dict):
                        behavioural_traits = {}
                    # Merge behavioural traits (last wins, normalized upper)
                    for k, v in behavioural_traits.items():
                        kk = str(k).strip()
                        vv = str(v).strip().upper()
                        if kk and vv:
                            behavioural_merged[kk] = vv
                    total = _compute_total(academic_structure, academic_scores)
                    grade = _grade_from_total(total)
                    remark = _remark_from_grade(grade)
                    grades_out.append(
                        {
                            "subject_name": subject_name,
                            "academic_scores": academic_scores,
                            "total": total,
                            "grade": grade,
                            "remark": remark,
                        }
                    )

        # Fallback to legacy if tenant_grades yielded nothing but student exists
        if student is not None and not grades_out:
            legacy_academic = (
                db.query(models.StudentAcademicRecord)
                .filter(
                    models.StudentAcademicRecord.tenant_id == tid,
                    models.StudentAcademicRecord.student_id == sid,
                    models.StudentAcademicRecord.term == term,
                )
                .order_by(models.StudentAcademicRecord.subject)
                .all()
            )
            for rec in legacy_academic:
                scores = getattr(rec, "scores", {}) or {}
                total = getattr(rec, "total_score", None)
                if total is None:
                    total = _compute_total(academic_structure, scores)
                try:
                    total_f = float(total)
                except Exception:
                    total_f = 0.0
                grade = _grade_from_total(total_f)
                remark = _remark_from_grade(grade)
                grades_out.append(
                    {
                        "subject_name": getattr(rec, "subject", ""),
                        "academic_scores": scores,
                        "total": round(total_f, 2),
                        "grade": grade,
                        "remark": remark,
                    }
                )
            # Legacy behavioural fallback
            if not behavioural_merged:
                legacy_be = (
                    db.query(models.StudentBehavioralRecord)
                    .filter(
                        models.StudentBehavioralRecord.tenant_id == tid,
                        models.StudentBehavioralRecord.student_id == sid,
                        models.StudentBehavioralRecord.term == term,
                    )
                    .order_by(models.StudentBehavioralRecord.created_at.desc())
                    .first()
                )
                if legacy_be is not None and getattr(legacy_be, "ratings", None):
                    for k, v in (legacy_be.ratings or {}).items():
                        kk = str(k).strip()
                        vv = str(v).strip().upper()
                        if kk and vv:
                            behavioural_merged[kk] = vv

        # Compute summary
        subjects_count = len(grades_out)
        if subjects_count > 0:
            total_score = round(sum(g["total"] for g in grades_out), 2)
            avg_raw = total_score / subjects_count
            average = round(avg_raw, 1)
            overall_grade = _grade_from_total(average)
            overall_remark = _remark_from_grade(overall_grade)
        else:
            total_score = 0.0
            average = 0.0
            overall_grade = "F"
            overall_remark = _remark_from_grade(overall_grade)

        return {
            "student": student,
            "template": template_payload,
            "grades": grades_out,
            "behavioural": behavioural_merged,
            "summary": {
                "totalScore": total_score,
                "average": average,
                "overallGrade": overall_grade,
                "overallRemark": overall_remark,
                "subjectsCount": subjects_count,
            },
            "term": term,
            "academic_session": _academic_session(),
            "tenant_id": tid,
            "student_id": sid,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[report] failed for {tid}/{sid}/{term}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load report: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
