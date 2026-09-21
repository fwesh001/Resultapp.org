"""
Phase 2 — Dynamic Grading Engine routers.

Endpoints (all protected via verify_api_secret):
  POST /api/v1/templates            — create grading template for a tenant
  GET  /api/v1/templates/{tenant_id}
  POST /api/v1/records/academic     — submit academic scores (weighted total out of 100)
  POST /api/v1/records/behavioral   — submit A-E behavioral ratings
  (plus GET helpers for records — included per Decision 3)

Weighted helper:
  Sums item scores against max_score, normalizes by category weight.

Example academic_structure 40/60:
  {"components":[
    {"name":"CA","weight":40,"items":[{"name":"Assignment 1","max_score":10},{"name":"Test 1","max_score":30}]},
    {"name":"Exam","weight":60,"max_score":60}
  ]}
  scores={"Assignment 1":8,"Test 1":25,"Exam":52}
  => CA = (8+25)/(10+30)*40 = 33.0, Exam = 52/60*60=52 => total 85.0
"""

from typing import Any, Dict, Optional
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

import models
import schemas
from database import get_db

logger = logging.getLogger(__name__)

# Local verify wrapper — avoids circular import at module load.
# Delegates to main.verify_api_secret at request time.


async def verify_grading_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    # Lazy import so grading router can be imported before main finishes loading
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        # Fallback self-contained check (mirrors main.verify_api_secret)
        import hmac

        API_SECRET = os.getenv("API_SECRET_KEY", "")
        ENV = os.getenv("ENV", "production")
        if not API_SECRET:
            if ENV != "production":
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing request (dev mode)")
                return True
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Server misconfigured: API_SECRET_KEY not set")
        if not x_api_secret_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, API_SECRET):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(prefix="/api/v1", tags=["grading"])


# ---------------------------------------------------------------------------
# Weighted total helper (core of Phase 2)
# ---------------------------------------------------------------------------

def compute_weighted_total(academic_structure: Dict[str, Any], scores: Dict[str, Any]) -> float:
    """
    Compute total out of 100 given a flexible academic_structure.

    Supported shapes:
    1) {"components":[{"name":"CA","weight":40,"items":[{"name":"A1","max_score":10}]}, {"name":"Exam","weight":60,"max_score":60}]}
    2) {"categories":{"CA":40,"Exam":60},"max_scores":{"A1":10,"Exam":60}} (legacy fallback)
    3) Nested dict {"CA":{"Assignment 1":10,"Test 1":30},"Exam":60}  (category -> {item: max} or max)

    Normalization: for each weighted component, (sum(scores for its items) / sum(max_scores)) * weight.
    If no structure can be parsed, fallback to raw sum(scores.values()) capped at 100.
    """
    try:
        # --- Shape 1: components array ---
        if isinstance(academic_structure, dict) and "components" in academic_structure:
            components = academic_structure.get("components") or []
            if isinstance(components, list) and components:
                total = 0.0
                weights_sum = 0.0
                for comp in components:
                    if not isinstance(comp, dict):
                        continue
                    weight = float(comp.get("weight") or 0)
                    weights_sum += weight
                    # Determine max sum and scored sum for this component
                    items = comp.get("items")
                    if isinstance(items, list) and items:
                        # Sum over items
                        max_sum = 0.0
                        score_sum = 0.0
                        for it in items:
                            if not isinstance(it, dict):
                                continue
                            name = str(it.get("name") or "").strip()
                            max_v = float(it.get("max_score") or it.get("max") or 0)
                            if not name or max_v <= 0:
                                continue
                            max_sum += max_v
                            # scores may be numeric or string numeric
                            raw = scores.get(name)
                            if raw is not None:
                                try:
                                    score_sum += float(raw)
                                except Exception:
                                    pass
                        if max_sum > 0:
                            # Normalize to weight
                            total += (score_sum / max_sum) * weight
                    else:
                        # Component with single max_score (e.g., Exam)
                        comp_name = str(comp.get("name") or "").strip()
                        max_v = float(comp.get("max_score") or comp.get("max") or 0)
                        if comp_name and max_v > 0:
                            raw = scores.get(comp_name)
                            if raw is not None:
                                try:
                                    total += (float(raw) / max_v) * weight
                                except Exception:
                                    pass
                        # Fallback if no max but weight: treat single item
                        elif comp_name and weight > 0 and comp_name in scores:
                            # treat max as weight if not specified? don't — just add raw
                            pass
                # If weights_sum is 0 (misconfigured), fallback
                if weights_sum == 0:
                    raw_sum = 0.0
                    for v in scores.values():
                        try:
                            raw_sum += float(v)
                        except Exception:
                            continue
                    return round(min(raw_sum, 100.0), 2)
                return round(total, 2)

        # --- Shape 3: nested dict like {"CA":{"A1":10},"Exam":60} ---
        # Detect nested dict structure with numeric leaves
        if isinstance(academic_structure, dict):
            # Heuristic: if values contain dicts with numeric leaves, treat as categories
            nested_cats = {}
            flat_weights: Dict[str, float] = {}
            for k, v in academic_structure.items():
                if k.lower() in {"categories", "weights", "components"}:
                    continue
                if isinstance(v, dict):
                    # e.g., "CA": {"Assignment 1":10}
                    inner_sum = 0.0
                    inner_scores = 0.0
                    for item_name, max_v in v.items():
                        try:
                            max_f = float(max_v)
                        except Exception:
                            continue
                        inner_sum += max_f
                        raw = scores.get(item_name)
                        if raw is not None:
                            try:
                                inner_scores += float(raw)
                            except Exception:
                                pass
                    if inner_sum > 0:
                        nested_cats[k] = (inner_scores, inner_sum)
                elif isinstance(v, (int, float)):
                    # Could be category weight or max
                    flat_weights[k] = float(v)

            if nested_cats:
                # Need weights for these nested categories — try to find weights dict
                weights_src = (
                    academic_structure.get("categories")
                    or academic_structure.get("weights")
                    or academic_structure.get("category_weights")
                )
                if isinstance(weights_src, dict) and weights_src:
                    total = 0.0
                    for cat, (scored, maxed) in nested_cats.items():
                        w = float(weights_src.get(cat) or 0)
                        if w and maxed:
                            total += (scored / maxed) * w
                    # Add any flat weights that are direct exam-style
                    for k, w in flat_weights.items():
                        if k not in nested_cats and k in scores:
                            # treat w as max? Ambiguous — assume w is max, normalize?
                            try:
                                total += (float(scores[k]) / w) * w if w else 0
                            except Exception:
                                pass
                    return round(total, 2)
                else:
                    # No weights — fallback: total scored / total max *100
                    all_scored = sum(s for s, _ in nested_cats.values())
                    all_max = sum(m for _, m in nested_cats.values())
                    if all_max:
                        # If also flat maxes exist, include
                        return round((all_scored / all_max) * 100, 2)

            # --- Shape 2: categories + max_scores fallback ---
            if "max_scores" in academic_structure or "maxScores" in academic_structure:
                max_scores = (
                    academic_structure.get("max_scores")
                    or academic_structure.get("maxScores")
                    or {}
                )
                weights = (
                    academic_structure.get("categories")
                    or academic_structure.get("weights")
                    or {}
                )
                if isinstance(max_scores, dict) and max_scores:
                    # If weights provided, weighted; else raw sum normalized
                    if isinstance(weights, dict) and weights:
                        total = 0.0
                        # Map items to categories if possible — assume item belongs to category by prefix?
                        # Simpler: if weights keys are component names that also appear in scores,
                        # treat directly. Otherwise sum all.
                        for comp_name, w in weights.items():
                            try:
                                w_f = float(w)
                            except Exception:
                                continue
                            # If comp is direct score (Exam)
                            if comp_name in scores and comp_name in max_scores:
                                try:
                                    total += (float(scores[comp_name]) / float(max_scores[comp_name])) * w_f
                                except Exception:
                                    pass
                            else:
                                # Sum items that belong to this comp? fallback
                                pass
                        if total:
                            return round(total, 2)
                    # No weights → scored/max *100
                    scored = 0.0
                    maxed = 0.0
                    for item, max_v in max_scores.items():
                        try:
                            max_f = float(max_v)
                        except Exception:
                            continue
                        maxed += max_f
                        if item in scores:
                            try:
                                scored += float(scores[item])
                            except Exception:
                                pass
                    if maxed:
                        return round((scored / maxed) * 100, 2)

        # --- Fallback: raw sum ---
        raw_sum = 0.0
        for v in scores.values():
            try:
                raw_sum += float(v)
            except Exception:
                continue
        return round(min(raw_sum, 100.0), 2)

    except Exception as e:
        logger.warning(f"compute_weighted_total fallback due to error: {e}")
        try:
            return round(min(sum(float(v) for v in scores.values()), 100.0), 2)
        except Exception:
            return 0.0


def _validate_scores_against_template(academic_structure: Dict[str, Any], scores: Dict[str, Any]) -> None:
    """
    Validate that every score key exists in the template's max map and that
    the value does not exceed the defined max_score. Raises HTTPException(422) on violation.
    Supports flexible shapes — if template cannot be introspected, skips max check but ensures scores are numeric.
    """
    # Build max map from structure
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
        else:
            # Generic nested dict extraction
            for k, v in (academic_structure or {}).items():
                if isinstance(v, dict):
                    for ik, iv in v.items():
                        try:
                            max_map[str(ik).strip()] = float(iv)
                        except Exception:
                            pass
                elif isinstance(v, (int, float)) and k not in {"categories", "weights", "max_scores", "maxScores"}:
                    # Direct max
                    try:
                        max_map[str(k).strip()] = float(v)
                    except Exception:
                        pass
                # also check max_scores
            if "max_scores" in academic_structure:
                for ik, iv in (academic_structure.get("max_scores") or {}).items():
                    try:
                        max_map[str(ik).strip()] = float(iv)
                    except Exception:
                        pass
    except Exception:
        max_map = {}

    for key, raw_val in scores.items():
        # Numeric check
        try:
            val = float(raw_val)
        except Exception:
            raise HTTPException(status_code=422, detail=f"Score for '{key}' must be numeric")
        if val < 0:
            raise HTTPException(status_code=422, detail=f"Score for '{key}' cannot be negative")
        if key in max_map and max_map[key] > 0 and val > max_map[key]:
            raise HTTPException(
                status_code=422,
                detail=f"Score for '{key}' ({val}) exceeds max {max_map[key]} defined in template",
            )
    # Optionally ensure all required keys present? Not enforced — teacher may submit partial


def _validate_ratings_against_template(behavioral_structure: Dict[str, Any] | None, ratings: Dict[str, str]) -> None:
    allowed = {"A", "B", "C", "D", "E"}
    for trait, grade in ratings.items():
        if not isinstance(grade, str) or grade.strip().upper() not in allowed:
            raise HTTPException(
                status_code=422,
                detail=f"Rating for '{trait}' must be one of A, B, C, D, E",
            )
    if behavioral_structure:
        traits = behavioral_structure.get("traits") or behavioral_structure.get("items") or []
        if isinstance(traits, list) and traits:
            allowed_traits = {str(t).strip() for t in traits if str(t).strip()}
            for trait in ratings:
                if trait not in allowed_traits:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Trait '{trait}' not defined in template behavioral_structure",
                    )


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


@router.post(
    "/templates",
    response_model=schemas.GradingTemplateRead,
    dependencies=[Depends(verify_grading_secret)],
    status_code=status.HTTP_201_CREATED,
    summary="Create a grading template for a tenant",
)
def create_template(payload: schemas.GradingTemplateCreate, db: Session = Depends(get_db)):
    # Optional tenant existence check (non-blocking — use raw registry)
    # We do not fail if tenant not yet in registry to allow template pre-seed in dev.
    try:
        from services.db_manager import get_school_by_subdomain

        if get_school_by_subdomain(payload.tenant_id) is None:
            logger.warning(f"Tenant '{payload.tenant_id}' not found in registry — allowing template creation (dev)")
    except Exception:
        pass

    existing = (
        db.query(models.GradingTemplate)
        .filter(models.GradingTemplate.tenant_id == payload.tenant_id, models.GradingTemplate.name == payload.name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"Template '{payload.name}' already exists for tenant '{payload.tenant_id}'")

    obj = models.GradingTemplate(
        tenant_id=payload.tenant_id.strip().lower(),
        name=payload.name.strip(),
        academic_structure=payload.academic_structure,
        behavioral_structure=payload.behavioral_structure,
        applies_to_classes=[c.strip() for c in (payload.applies_to_classes or []) if c.strip()],
        is_active=payload.is_active,
    )
    db.add(obj)
    try:
        db.commit()
        db.refresh(obj)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Template conflict: {e}") from e
    logger.info(f"Template {obj.id} '{obj.name}' created for tenant {obj.tenant_id}")
    return obj


@router.get(
    "/templates/{tenant_id}",
    response_model=list[schemas.GradingTemplateRead],
    dependencies=[Depends(verify_grading_secret)],
    summary="List grading templates for a tenant",
)
def list_templates(tenant_id: str, include_inactive: bool = False, db: Session = Depends(get_db)):
    tenant_id = tenant_id.strip().lower()
    q = db.query(models.GradingTemplate).filter(models.GradingTemplate.tenant_id == tenant_id)
    if not include_inactive:
        q = q.filter(models.GradingTemplate.is_active == True)  # noqa: E712
    rows = q.order_by(models.GradingTemplate.created_at.desc()).all()
    return rows


@router.get(
    "/templates/{tenant_id}/{template_id}",
    response_model=schemas.GradingTemplateRead,
    dependencies=[Depends(verify_grading_secret)],
)
def get_template(tenant_id: str, template_id: int, db: Session = Depends(get_db)):
    obj = db.get(models.GradingTemplate, template_id)
    if not obj or obj.tenant_id != tenant_id.strip().lower():
        raise HTTPException(status_code=404, detail="Template not found")
    return obj


@router.put(
    "/templates/{template_id}",
    response_model=schemas.GradingTemplateRead,
    dependencies=[Depends(verify_grading_secret)],
    summary="Update a grading template (sparse)",
)
def update_template(template_id: int, payload: schemas.GradingTemplateUpdate, db: Session = Depends(get_db)):
    obj = db.get(models.GradingTemplate, template_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Template not found")

    if payload.name is not None and payload.name.strip() and payload.name.strip() != obj.name:
        clash = (
            db.query(models.GradingTemplate)
            .filter(
                models.GradingTemplate.tenant_id == obj.tenant_id,
                models.GradingTemplate.name == payload.name.strip(),
                models.GradingTemplate.id != obj.id,
            )
            .first()
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"Template '{payload.name.strip()}' already exists for tenant '{obj.tenant_id}'")
        obj.name = payload.name.strip()
    if payload.academic_structure is not None:
        obj.academic_structure = payload.academic_structure
    if payload.behavioral_structure is not None:
        obj.behavioral_structure = payload.behavioral_structure
    if payload.applies_to_classes is not None:
        obj.applies_to_classes = [c.strip() for c in payload.applies_to_classes if c.strip()]
    if payload.is_active is not None:
        obj.is_active = payload.is_active

    try:
        db.commit()
        db.refresh(obj)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Template conflict: {e}") from e
    logger.info(f"Template {obj.id} '{obj.name}' updated for tenant {obj.tenant_id}")
    return obj


@router.delete(
    "/templates/{template_id}",
    dependencies=[Depends(verify_grading_secret)],
    summary="Soft-delete (disable) a grading template",
)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """Soft-delete: sets is_active=FALSE so historical records keep their FK."""
    obj = db.get(models.GradingTemplate, template_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Template not found")
    obj.is_active = False
    db.commit()
    logger.info(f"Template {obj.id} '{obj.name}' disabled for tenant {obj.tenant_id}")
    return {"success": True, "id": obj.id, "is_active": False}


# ---------------------------------------------------------------------------
# Academic records
# ---------------------------------------------------------------------------


@router.post(
    "/records/academic",
    response_model=schemas.StudentAcademicRecordRead,
    dependencies=[Depends(verify_grading_secret)],
    status_code=status.HTTP_201_CREATED,
    summary="Submit a student's academic scores based on a template",
)
def create_academic_record(payload: schemas.StudentAcademicRecordCreate, db: Session = Depends(get_db)):
    payload.tenant_id = payload.tenant_id.strip().lower()
    template = db.get(models.GradingTemplate, payload.template_id)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template {payload.template_id} not found")
    if template.tenant_id != payload.tenant_id:
        raise HTTPException(status_code=403, detail="Template does not belong to this tenant")

    # Validate scores against template max scores
    _validate_scores_against_template(template.academic_structure, payload.scores)
    total = compute_weighted_total(template.academic_structure, payload.scores)

    # Normalize student prefix to lower case (vhs/005)
    _raw_sid_ac = payload.student_id.strip()
    if "/" in _raw_sid_ac:
        _pfx_ac, _rest_ac = _raw_sid_ac.split("/", 1)
        _norm_ac = _pfx_ac.lower() + "/" + _rest_ac
    else:
        import re as _re_ac
        _m_ac = _re_ac.match(r"^([A-Za-z]+)(.*)$", _raw_sid_ac)
        _norm_ac = (_m_ac.group(1).lower() + _m_ac.group(2)) if _m_ac else _raw_sid_ac.lower()
    obj = models.StudentAcademicRecord(
        tenant_id=payload.tenant_id,
        student_id=_norm_ac,
        subject=payload.subject.strip(),
        term=payload.term.strip(),
        template_id=payload.template_id,
        scores=payload.scores,
        total_score=total,
    )
    db.add(obj)
    try:
        db.commit()
        db.refresh(obj)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Academic record already exists for {payload.student_id} / {payload.subject} / {payload.term}",
        ) from e
    return obj


@router.get(
    "/records/academic/{tenant_id}/{student_id}",
    response_model=list[schemas.StudentAcademicRecordRead],
    dependencies=[Depends(verify_grading_secret)],
)
def list_academic_records(tenant_id: str, student_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(models.StudentAcademicRecord)
        .filter(
            models.StudentAcademicRecord.tenant_id == tenant_id.strip().lower(),
            models.StudentAcademicRecord.student_id == student_id.strip(),
        )
        .order_by(models.StudentAcademicRecord.term, models.StudentAcademicRecord.subject)
        .all()
    )
    return rows


# ---------------------------------------------------------------------------
# Behavioral records
# ---------------------------------------------------------------------------


@router.post(
    "/records/behavioral",
    response_model=schemas.StudentBehavioralRecordRead,
    dependencies=[Depends(verify_grading_secret)],
    status_code=status.HTTP_201_CREATED,
    summary="Submit behavioral A-E ratings",
)
def create_behavioral_record(payload: schemas.StudentBehavioralRecordCreate, db: Session = Depends(get_db)):
    payload.tenant_id = payload.tenant_id.strip().lower()
    template = db.get(models.GradingTemplate, payload.template_id)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template {payload.template_id} not found")
    if template.tenant_id != payload.tenant_id:
        raise HTTPException(status_code=403, detail="Template does not belong to this tenant")

    _validate_ratings_against_template(template.behavioral_structure, payload.ratings)

    # Normalize student prefix to lower
    _raw_sid_be = payload.student_id.strip()
    if "/" in _raw_sid_be:
        _pfx_be, _rest_be = _raw_sid_be.split("/", 1)
        _norm_be = _pfx_be.lower() + "/" + _rest_be
    else:
        import re as _re_be
        _m_be = _re_be.match(r"^([A-Za-z]+)(.*)$", _raw_sid_be)
        _norm_be = (_m_be.group(1).lower() + _m_be.group(2)) if _m_be else _raw_sid_be.lower()
    obj = models.StudentBehavioralRecord(
        tenant_id=payload.tenant_id,
        student_id=_norm_be,
        term=payload.term.strip(),
        template_id=payload.template_id,
        ratings=payload.ratings,
    )
    db.add(obj)
    try:
        db.commit()
        db.refresh(obj)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Behavioral record already exists for {payload.student_id} / {payload.term}",
        ) from e
    return obj


@router.get(
    "/records/behavioral/{tenant_id}/{student_id}",
    response_model=list[schemas.StudentBehavioralRecordRead],
    dependencies=[Depends(verify_grading_secret)],
)
def list_behavioral_records(tenant_id: str, student_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(models.StudentBehavioralRecord)
        .filter(
            models.StudentBehavioralRecord.tenant_id == tenant_id.strip().lower(),
            models.StudentBehavioralRecord.student_id == student_id.strip(),
        )
        .order_by(models.StudentBehavioralRecord.term)
        .all()
    )
    return rows
