"""
Shared active-template lookup (H3 perf fix).

Single owner for "newest active template bound to the class, else newest
global template" semantics previously copy-pasted in
routers/staff_grading.py and routers/report.py.

Primary path: one Postgres row fetch — class matching happens in SQL via
JSONB array inspection with match-quality ordering, LIMIT 1. Preserves the
legacy fallback exactly: when a class is given but nothing matches, the
newest active template overall is returned (not None).

Fallback path: the original Python filter over .all(). Used when the SQL
path raises (e.g. SQLite in tests, where jsonb_* functions don't exist),
so JSON-vs-JSONB dialect differences never matter.
"""

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def get_active_template(db, tid: str, class_name: Optional[str] = None):
    """Newest active template bound to the class, else newest global template.

    Binding lives in `applies_to_classes` (empty = all classes). Inactive
    (soft-deleted) templates are never returned.
    """
    cls = (class_name or "").strip()
    try:
        return _get_active_template_sql(db, tid, cls or None)
    except Exception as e:
        logger.debug(f"[grading-templates] SQL path failed, using Python fallback: {e}")
        return _get_active_template_python(db, tid, cls or None)


def _get_active_template_sql(db, tid: str, class_name: Optional[str]):
    from sqlalchemy import text as _text

    import models

    if not class_name:
        return (
            db.query(models.GradingTemplate)
            .filter(
                models.GradingTemplate.tenant_id == tid,
                models.GradingTemplate.is_active == True,  # noqa: E712
            )
            .order_by(models.GradingTemplate.created_at.desc())
            .limit(1)
            .first()
        )

    # Match-quality ordering reproduces the Python loop exactly: newest
    # template whose binding is empty or contains the class (case-insensitive,
    # trimmed) wins; if none matches, the newest template overall wins.
    row = db.execute(
        _text(
            """
            SELECT id FROM grading_templates
            WHERE tenant_id = :tid AND is_active = TRUE
            ORDER BY CASE
                       WHEN jsonb_array_length(applies_to_classes) = 0 THEN 0
                       WHEN EXISTS (
                         SELECT 1 FROM jsonb_array_elements_text(applies_to_classes) c
                         WHERE LOWER(TRIM(c)) = LOWER(TRIM(CAST(:cls AS TEXT)))
                       ) THEN 0
                       ELSE 1
                     END,
                     created_at DESC
            LIMIT 1;
            """
        ),
        {"tid": tid, "cls": class_name},
    ).fetchone()
    if row is None:
        return None
    return db.get(models.GradingTemplate, int(row[0]))


def _get_active_template_python(db, tid: str, class_name: Optional[str]):
    import models

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


def template_payload(template) -> dict:
    from datetime import datetime as _dt

    created: Any = getattr(template, "created_at", None)
    if isinstance(created, _dt):
        created_s = created.isoformat()
    else:
        created_s = str(created or "")
    return {
        "id": getattr(template, "id", None),
        "name": getattr(template, "name", ""),
        "academic_structure": getattr(template, "academic_structure", None) or {},
        "behavioral_structure": getattr(template, "behavioral_structure", None),
        "created_at": created_s,
    }
