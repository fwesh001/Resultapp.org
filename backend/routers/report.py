"""
Report Card — Digital Paper (Granular CA Edition).
GET /api/v1/tenant/{tenant_id}/report/{student_id}?term=Term 1

Queries tenant_students (bio), active grading_templates, tenant_grades (primary)
with graceful fallback to legacy student_academic_records / student_behavioral_records.
Supports granular CA components A1/A2/T1/T2/Exam via exact + alias map.
Calculates per-subject totals, class averages, subject positions, overall ranking.
Always returns 200 even if student is null so frontend can show admission-number banner.
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

CANONICAL_KEYS = ["A1", "A2", "T1", "T2", "Exam"]
# Alias map: normalized lower key -> canonical
ALIAS_MAP: Dict[str, str] = {
    "a1": "A1",
    "a 1": "A1",
    "assignment 1": "A1",
    "assignment1": "A1",
    "ass 1": "A1",
    "a2": "A2",
    "a 2": "A2",
    "assignment 2": "A2",
    "assignment2": "A2",
    "ass 2": "A2",
    "t1": "T1",
    "t 1": "T1",
    "test 1": "T1",
    "test1": "T1",
    "ca1": "T1",
    "ca 1": "T1",
    "ca": "T1",
    "t2": "T2",
    "t 2": "T2",
    "test 2": "T2",
    "test2": "T2",
    "ca2": "T2",
    "ca 2": "T2",
    "exam": "Exam",
    "examination": "Exam",
    "final": "Exam",
    "final exam": "Exam",
    "finalexam": "Exam",
}


def _normalize_key(raw: str) -> Optional[str]:
    k = (raw or "").strip()
    if not k:
        return None
    low = k.lower()
    # direct canonical case-insensitive
    for cand in CANONICAL_KEYS:
        if low == cand.lower():
            return cand
    # alias lookup
    if low in ALIAS_MAP:
        return ALIAS_MAP[low]
    # try removing extra spaces/punct
    low2 = low.replace("-", " ").replace("_", " ").strip()
    # collapse multiple spaces
    low2 = " ".join(low2.split())
    if low2 in ALIAS_MAP:
        return ALIAS_MAP[low2]
    return None


def _extract_breakdown(academic_scores: Dict[str, Any]) -> Dict[str, Optional[float]]:
    """Map arbitrary stored keys to canonical A1/A2/T1/T2/Exam using alias fallback."""
    out: Dict[str, Optional[float]] = {k: None for k in CANONICAL_KEYS}
    if not isinstance(academic_scores, dict):
        return out
    for raw_key, raw_val in academic_scores.items():
        canon = _normalize_key(str(raw_key))
        if canon is None:
            continue
        # only take first occurrence wins, but allow overwrite if later? keep first
        if out[canon] is not None:
            continue
        try:
            v = float(raw_val)
            # keep as is; do not cap per component here
            out[canon] = round(v, 2) if v == v else None  # NaN guard
        except Exception:
            out[canon] = None
    return out


def _has_any_granular(breakdown: Dict[str, Optional[float]]) -> bool:
    return any(v is not None for v in breakdown.values())


def _ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        r = n % 10
        if r == 1:
            suffix = "st"
        elif r == 2:
            suffix = "nd"
        elif r == 3:
            suffix = "rd"
        else:
            suffix = "th"
    return f"{n}{suffix}"


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


def _get_active_template(db: Session, tid: str, class_name: Optional[str] = None):
    """Newest active template bound to the class, else newest global template."""
    rows = (
        db.query(models.GradingTemplate)
        .filter(
            models.GradingTemplate.tenant_id == tid,
            models.GradingTemplate.is_active == True,  # noqa: E712
        )
        .order_by(models.GradingTemplate.created_at.desc())
        .all()
    )
    if not rows:
        return None
    cls = (class_name or "").strip().lower()
    if cls:
        for t in rows:
            bound = getattr(t, "applies_to_classes", None) or []
            norm = {str(c).strip().lower() for c in bound if str(c).strip()}
            if not norm or cls in norm:
                return t
    return rows[0]


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


def _compute_simple_granular_total(breakdown: Dict[str, Optional[float]]) -> Optional[float]:
    """Simple sum A1+A2+T1+T2+Exam if any granular present, else None to signal fallback."""
    if not _has_any_granular(breakdown):
        return None
    s = 0.0
    has = False
    for k in CANONICAL_KEYS:
        v = breakdown.get(k)
        if v is not None:
            s += float(v)
            has = True
    if not has:
        return None
    return round(min(s, 100.0), 2)


# --- Smart Component Normalizer (Dynamic Grouped Headers) ---
GROUP_KEYWORDS = {
    "ASSIGNMENT": ["assignment", "a1", "a2", "ca"],
    "TESTS": ["test", "t1", "t2", "quiz"],
    "EXAM": ["exam", "examination", "terminal"],
}


def _group_for_item_name(raw_name: str) -> str:
    name = (raw_name or "").strip().lower()
    # collapse spaces/underscores/dashes for comparison
    norm = " ".join(name.replace("-", " ").replace("_", " ").split())
    # Check Exam first (most specific, to avoid "exam" containing "am")
    for kw in GROUP_KEYWORDS["EXAM"]:
        if kw in norm or norm == kw:
            return "EXAM"
    for kw in GROUP_KEYWORDS["TESTS"]:
        if kw == norm or kw in norm.split() or norm == kw or (kw in norm and kw in ["test", "quiz"]):
            # allow substring for test/quiz
            if kw in norm:
                return "TESTS"
    for kw in GROUP_KEYWORDS["ASSIGNMENT"]:
        if kw == norm or kw in norm.split() or norm in ["a1", "a2"] or kw in norm:
            if kw in norm:
                return "ASSIGNMENT"
    # fallback check for exact canonical after alias normalization
    canon = _normalize_key(raw_name)
    if canon in ("A1", "A2"):
        return "ASSIGNMENT"
    if canon in ("T1", "T2"):
        return "TESTS"
    if canon == "Exam":
        return "EXAM"
    return "OTHER"


def _collect_template_items(academic_structure: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if not isinstance(academic_structure, dict):
        return items
    comps = academic_structure.get("components")
    if isinstance(comps, list) and comps:
        for comp in comps:
            if not isinstance(comp, dict):
                continue
            comp_items = comp.get("items")
            if isinstance(comp_items, list) and comp_items:
                for it in comp_items:
                    if not isinstance(it, dict):
                        continue
                    name = str(it.get("name") or "").strip()
                    if not name:
                        continue
                    try:
                        max_s = float(it.get("max_score") if it.get("max_score") is not None else it.get("max") if it.get("max") is not None else 0)
                    except Exception:
                        max_s = 0
                    items.append({"name": name, "max": max_s, "raw": it})
            else:
                # component as single item (e.g., Exam weight 60 max 60)
                name = str(comp.get("name") or "").strip()
                if not name:
                    continue
                try:
                    max_s = float(comp.get("max_score") if comp.get("max_score") is not None else comp.get("max") if comp.get("max") is not None else comp.get("weight") or 0)
                except Exception:
                    max_s = 0
                # Avoid duplicating if already added via items
                if not any(i["name"].lower() == name.lower() for i in items):
                    items.append({"name": name, "max": max_s, "raw": comp})
        return items
    # Fallback legacy shapes: max_scores dict
    max_scores = academic_structure.get("max_scores") or academic_structure.get("maxScores")
    if isinstance(max_scores, dict) and max_scores:
        for k, v in max_scores.items():
            name = str(k).strip()
            if not name:
                continue
            try:
                max_s = float(v)
            except Exception:
                continue
            items.append({"name": name, "max": max_s, "raw": {}})
        return items
    # Fallback generic dict with numeric values (e.g., {"CA": {"A1":10}})
    for k, v in academic_structure.items():
        if k.lower() in {"components", "categories", "weights", "category_weights", "max_scores", "maxscores"}:
            continue
        if isinstance(v, dict):
            for ik, iv in v.items():
                try:
                    items.append({"name": str(ik).strip(), "max": float(iv), "raw": {}})
                except Exception:
                    continue
        elif isinstance(v, (int, float)):
            try:
                items.append({"name": str(k).strip(), "max": float(v), "raw": {}})
            except Exception:
                continue
    return items


def _build_grouped_template(academic_structure: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    raw_items = _collect_template_items(academic_structure)
    if not raw_items:
        return None
    total_max = sum(i["max"] for i in raw_items if i["max"] and i["max"] > 0)
    if total_max <= 0:
        total_max = sum(i["max"] for i in raw_items) or 100.0
        if total_max <= 0:
            total_max = 100.0

    groups: Dict[str, List[Dict[str, Any]]] = {"ASSIGNMENT": [], "TESTS": [], "EXAM": [], "OTHER": []}
    for it in raw_items:
        grp = _group_for_item_name(it["name"])
        # canonical display key: use normalized short if possible, else original trimmed
        canon = _normalize_key(it["name"])
        display_key = canon if canon else it["name"].strip()
        # Avoid duplicate display keys within same group
        max_v = float(it["max"] or 0)
        weight = round((max_v / total_max) * 100, 1) if total_max else 0.0
        entry = {
            "key": display_key,
            "originalName": it["name"],
            "max": round(max_v, 2),
            "weightPct": weight,
        }
        # dedupe by key case-insensitive within group
        if not any(e["key"].lower() == display_key.lower() for e in groups[grp]):
            groups[grp].append(entry)

    # Build ordered list, dynamic colSpan = len(items)
    ordered_labels = ["ASSIGNMENT", "TESTS", "EXAM", "OTHER"]
    groups_out: List[Dict[str, Any]] = []
    for label in ordered_labels:
        its = groups[label]
        if not its:
            continue
        # sort within group by original order preservation (already)
        groups_out.append(
            {
                "label": label,
                "keys": [e["key"] for e in its],
                "items": its,
                "maxSum": round(sum(e["max"] for e in its), 2),
                "weightSum": round(sum(e["weightPct"] for e in its), 1),
            }
        )
    if not groups_out:
        return None
    return {
        "groups": groups_out,
        "totalMax": round(total_max, 2),
        "totalWeight": round(sum(e["weightPct"] for g in groups_out for e in g["items"]), 1),
    }


@router.get("/{student_id:path}", summary="Report card bundle: student bio + template + grades + behavioural + summary + rankings")
def get_report_bundle(
    tenant_id: str,
    student_id: str,
    term: str = Query("Term 1"),
    db: Session = Depends(get_db),
):
    tid = _validate_tenant_id(tenant_id)
    _raw_sid = (student_id or "").strip()
    # Normalize prefix to lower case (vhs/005) — keep number as-is
    if "/" in _raw_sid:
        _pfx, _rest = _raw_sid.split("/", 1)
        sid = _pfx.lower() + "/" + _rest
    else:
        import re as _re_sid
        _m_sid = _re_sid.match(r"^([A-Za-z]+)(.*)$", _raw_sid)
        sid = (_m_sid.group(1).lower() + _m_sid.group(2)) if _m_sid else _raw_sid.lower()
    if not sid:
        raise HTTPException(status_code=400, detail="student_id is required")
    term = (term or "").strip()
    if term not in VALID_TERMS:
        raise HTTPException(status_code=400, detail="term must be one of Term 1, Term 2, Term 3")

    # Ensure tenant exists — 404 if school unknown (distinct from student null case)
    from services.db_manager import get_school_by_subdomain

    school_info = get_school_by_subdomain(tid)
    if school_info is None:
        raise HTTPException(status_code=404, detail=f"No school found for tenant '{tid}'")

    # Fetch template (may be null) — re-resolved with class below once known
    template = _get_active_template(db, tid)
    template_payload = _template_payload(template)
    academic_structure = getattr(template, "academic_structure", None) if template else None
    grouped_template = _build_grouped_template(academic_structure)

    # Fetch student bio from tenant_students
    student = None
    from services.db_manager import TENANT_STUDENTS_TABLE, TENANT_GRADES_TABLE, _connect_as_superuser, _row_to_dict

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"SELECT student_id, full_name, class_name, gender FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND LOWER(student_id) = LOWER(%s) LIMIT 1",
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

        class_student_ids: List[str] = []
        class_name: Optional[str] = None

        if student is not None:
            class_name = student.get("class_name")
            # Re-resolve template with class binding once the class is known
            template = _get_active_template(db, tid, class_name)
            template_payload = _template_payload(template)
            academic_structure = getattr(template, "academic_structure", None) if template else None
            grouped_template = _build_grouped_template(academic_structure)
            # Fetch classmates for ranking
            try:
                cur.execute(
                    f"SELECT student_id FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND class_name = %s",
                    (tid, class_name),
                )
                class_student_ids = [r[0] for r in cur.fetchall() if r[0]]
            except Exception:
                class_student_ids = [sid]

            # Primary source: tenant_grades — case-insensitive for pre-migration UPPER rows
            cur.execute(
                f"SELECT subject_name, academic_scores, behavioural_traits FROM {TENANT_GRADES_TABLE} WHERE subdomain = %s AND LOWER(student_id) = LOWER(%s) AND term = %s ORDER BY subject_name",
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

                    # Granular breakdown with alias fallback
                    breakdown = _extract_breakdown(academic_scores)
                    granular_total = _compute_simple_granular_total(breakdown)
                    if granular_total is not None:
                        total = granular_total
                    else:
                        total = _compute_total(academic_structure, academic_scores)

                    grade = _grade_from_total(total)
                    remark = _remark_from_grade(grade)
                    # Prepare display breakdown; keep dash for missing by converting None -> not included, frontend will render —
                    grades_out.append(
                        {
                            "subject_name": subject_name,
                            "academic_scores": academic_scores,
                            "breakdown": {k: (v if v is not None else None) for k, v in breakdown.items()},
                            "total": total,
                            "grade": grade,
                            "remark": remark,
                        }
                    )

        # Fallback to legacy if tenant_grades yielded nothing but student exists — case-insensitive during migration
        if student is not None and not grades_out:
            from sqlalchemy import func as _func
            legacy_academic = (
                db.query(models.StudentAcademicRecord)
                .filter(
                    models.StudentAcademicRecord.tenant_id == tid,
                    _func.lower(models.StudentAcademicRecord.student_id) == _func.lower(sid),
                    models.StudentAcademicRecord.term == term,
                )
                .order_by(models.StudentAcademicRecord.subject)
                .all()
            )
            for rec in legacy_academic:
                scores = getattr(rec, "scores", {}) or {}
                breakdown = _extract_breakdown(scores)
                granular_total = _compute_simple_granular_total(breakdown)
                total = getattr(rec, "total_score", None)
                if granular_total is not None:
                    total_f = float(granular_total)
                elif total is not None:
                    try:
                        total_f = float(total)
                    except Exception:
                        total_f = _compute_total(academic_structure, scores)
                else:
                    # try granular first if legacy has granular keys
                    if _has_any_granular(breakdown):
                        total_f = float(_compute_simple_granular_total(breakdown) or 0)
                    else:
                        total_f = _compute_total(academic_structure, scores)
                grade = _grade_from_total(float(total_f))
                remark = _remark_from_grade(grade)
                grades_out.append(
                    {
                        "subject_name": getattr(rec, "subject", ""),
                        "academic_scores": scores,
                        "breakdown": {k: (v if v is not None else None) for k, v in breakdown.items()},
                        "total": round(float(total_f), 2),
                        "grade": grade,
                        "remark": remark,
                    }
                )
            # Legacy behavioural fallback
            if not behavioural_merged:
                from sqlalchemy import func as _func2
                legacy_be = (
                    db.query(models.StudentBehavioralRecord)
                    .filter(
                        models.StudentBehavioralRecord.tenant_id == tid,
                        _func2.lower(models.StudentBehavioralRecord.student_id) == _func2.lower(sid),
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

        # --- Class statistics & overall ranking ---
        # Defaults
        no_in_class = len(class_student_ids) if student is not None else 0
        overall_position: Optional[int] = None
        overall_position_ordinal: Optional[str] = None

        # Data structures for stats
        # For each subject, we need list of peer totals
        # For overall ranking, grand totals per peer

        if student is not None and grades_out and class_name and class_student_ids:
            # Build subject list from this student's grades
            subject_names = [g["subject_name"] for g in grades_out]

            # Bulk fetch peers' grades for those subjects/term (tenant_grades primary)
            # Map: subject -> list of totals per peer
            subject_totals_map: Dict[str, List[float]] = {s: [] for s in subject_names}
            grand_totals_map: Dict[str, float] = {sid_peer: 0.0 for sid_peer in class_student_ids}

            try:
                # Fetch from tenant_grades bulk
                # Use psycopg2 ANY for arrays
                if subject_names:
                    cur.execute(
                        f"""
                        SELECT student_id, subject_name, academic_scores
                        FROM {TENANT_GRADES_TABLE}
                        WHERE subdomain = %s AND term = %s AND subject_name = ANY(%s) AND student_id = ANY(%s)
                        """,
                        (tid, term, subject_names, class_student_ids),
                    )
                    peer_rows = cur.fetchall()
                    # Group by peer and subject, compute granular total per row
                    # For accurate grand totals, need per peer per subject total
                    peer_subject_total: Dict[tuple, float] = {}
                    for pr_sid, pr_subj, pr_scores in peer_rows:
                        pr_scores = pr_scores or {}
                        if not isinstance(pr_scores, dict):
                            pr_scores = {}
                        br = _extract_breakdown(pr_scores)
                        gt = _compute_simple_granular_total(br)
                        if gt is None:
                            gt = _compute_total(academic_structure, pr_scores)
                        peer_subject_total[(pr_sid, pr_subj)] = float(gt)
                        # also store lower variant for case-insensitive lookup during migration
                        _low = pr_sid.lower() if isinstance(pr_sid, str) else str(pr_sid).lower()
                        if _low != pr_sid:
                            peer_subject_total[(_low, pr_subj)] = float(gt)

                    # Populate subject totals map and grand totals
                    for subj in subject_names:
                        for peer_sid in class_student_ids:
                            tot = peer_subject_total.get((peer_sid, subj))
                            if tot is None:
                                tot = peer_subject_total.get((peer_sid.lower() if isinstance(peer_sid, str) else str(peer_sid).lower(), subj))
                            if tot is None:
                                # No record for this peer/subject -> treat as 0 for average but still counts towards denominator
                                tot = 0.0
                            subject_totals_map[subj].append(float(tot))
                            grand_totals_map[peer_sid] += float(tot)

                    # Fallback supplement from legacy if tenant_grades gave sparse data and legacy exists
                    # Check if any subject has zero totals for all peers but legacy may have data
                    # Simple heuristic: if all totals for a subject are 0 and grades_out came from legacy, legacy already covered.
                    # But to handle mixed migration, we could also supplement legacy totals if peer_subject_total missing and legacy has record
                    # For brevity, only supplement if tenant_grades peer_rows empty
                    if not peer_rows:
                        # Try legacy bulk — case-insensitive for migration window
                        from sqlalchemy import func as _func3
                        legacy_rows = (
                            db.query(models.StudentAcademicRecord)
                            .filter(
                                models.StudentAcademicRecord.tenant_id == tid,
                                models.StudentAcademicRecord.term == term,
                                models.StudentAcademicRecord.subject.in_(subject_names),
                                _func3.lower(models.StudentAcademicRecord.student_id).in_([s.lower() for s in class_student_ids]),
                            )
                            .all()
                        )
                        # Reset maps
                        subject_totals_map = {s: [] for s in subject_names}
                        grand_totals_map = {sid_peer: 0.0 for sid_peer in class_student_ids}
                        leg_map: Dict[tuple, float] = {}
                        for rec in legacy_rows:
                            k = (rec.student_id.lower() if isinstance(rec.student_id, str) else str(rec.student_id).lower(), rec.subject)
                            sc = getattr(rec, "scores", {}) or {}
                            br = _extract_breakdown(sc)
                            gt = _compute_simple_granular_total(br)
                            if gt is None:
                                gt_val = getattr(rec, "total_score", None)
                                if gt_val is None:
                                    gt_val = _compute_total(academic_structure, sc)
                                try:
                                    gt = float(gt_val)
                                except Exception:
                                    gt = 0.0
                            leg_map[k] = float(gt)  # type: ignore
                        for subj in subject_names:
                            for peer_sid in class_student_ids:
                                tot = leg_map.get((peer_sid.lower() if isinstance(peer_sid, str) else str(peer_sid).lower(), subj), 0.0)
                                # fallback try original case
                                if tot == 0.0:
                                    tot = leg_map.get((peer_sid, subj), 0.0)
                                subject_totals_map[subj].append(float(tot))
                                grand_totals_map[peer_sid] += float(tot)
            except Exception as e:
                logger.warning(f"[report:classStats] bulk fetch failed for {tid}/{class_name}/{term}: {e}")
                # keep maps with zeros

            # Now enrich grades_out with classAverage and subjectPosition
            for g in grades_out:
                subj = g["subject_name"]
                totals_for_subj = subject_totals_map.get(subj, [])
                if totals_for_subj and no_in_class > 0:
                    avg = round(sum(totals_for_subj) / no_in_class, 1)
                else:
                    # fallback average of this subject alone (just my total) if no peers
                    avg = round(float(g["total"]), 1) if no_in_class else 0.0
                g["classAverage"] = avg

                # Standard competition ranking: 1 + count of strictly greater totals
                my_total = float(g["total"])
                greater = sum(1 for t in totals_for_subj if t > my_total)
                pos = greater + 1 if totals_for_subj else 1
                g["subjectPosition"] = pos
                g["subjectPositionOrdinal"] = _ordinal(pos)

                # Also expose A1..Exam breakdown already in g["breakdown"]

            # Overall ranking — case-insensitive lookup for pre-migration UPPER rows
            my_grand_total = grand_totals_map.get(sid, None)
            if my_grand_total is None:
                # try lower/upper variant
                for k, v in grand_totals_map.items():
                    if k.lower() == sid.lower():
                        my_grand_total = v
                        break
                if my_grand_total is None:
                    my_grand_total = 0.0
            # Count peers with greater grand total
            greater_overall = sum(1 for v in grand_totals_map.values() if v > my_grand_total)
            overall_position = (greater_overall + 1) if grand_totals_map else 1
            overall_position_ordinal = _ordinal(overall_position)
        else:
            # No student or no grades: keep subject stats null
            for g in grades_out:
                g["classAverage"] = None
                g["subjectPosition"] = None
                g["subjectPositionOrdinal"] = None

        # Compute summary (overall already via grades_out totals, but ensure consistent)
        subjects_count = len(grades_out)
        if subjects_count > 0:
            total_score = round(sum(float(g["total"]) for g in grades_out), 2)
            avg_raw = total_score / subjects_count
            average = round(avg_raw, 1)
            overall_grade = _grade_from_total(average)
            overall_remark = _remark_from_grade(overall_grade)
        else:
            total_score = 0.0
            average = 0.0
            overall_grade = "F"
            overall_remark = _remark_from_grade(overall_grade)

        # Build school payload for header / resumption
        school_address = (school_info.get("address") or "").strip() if school_info else ""
        raw_new_term = (school_info.get("new_term_begins") or "").strip() if school_info else ""
        school_payload = {
            "school_name": school_info.get("school_name") if school_info else None,
            "address": school_address or None,
            "new_term_begins": raw_new_term or None,
        }

        return {
            "student": student,
            "template": template_payload,
            "groupedTemplate": grouped_template,
            "grades": grades_out,
            "behavioural": behavioural_merged,
            "summary": {
                "totalScore": total_score,
                "average": average,
                "overallGrade": overall_grade,
                "overallRemark": overall_remark,
                "subjectsCount": subjects_count,
                "noInClass": no_in_class,
                "overallPosition": overall_position,
                "overallPositionOrdinal": overall_position_ordinal,
            },
            "term": term,
            "academic_session": _academic_session(),
            "tenant_id": tid,
            "student_id": sid,
            "school": school_payload,
            # Optional metadata for frontend Bio header
            "attendance": {"present": None, "outOf": None},
            "termMeta": {"termEnding": None, "newTermBegins": raw_new_term or None},
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
