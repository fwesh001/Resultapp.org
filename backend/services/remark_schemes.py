"""
Smart Remarks — shared scheme validation & evaluation (single semantics owner).

A scheme is a JSONB array of bands: [{min: number, max: number, text: str}].
Used by form-teacher auto-fill, teacher/principal scheme editors, and the
bulk principal-remark applier. Averages use the canonical report definition
(total/subjects, 1-decimal rounding) supplied by callers.
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_BANDS = 20
MAX_TEXT_LEN = 500


def validate_scheme(bands: Any) -> List[Dict[str, Any]]:
    """Validate + normalize a scheme. Returns bands sorted by min ASC.

    Rules: list of 0..20 bands; each needs finite min/max with min <= max
    (bounds need not lie in 0..100 — out-of-range bands simply never match);
    non-empty text (max 500 chars); overlapping bands are rejected with
    ValueError (gaps are allowed and evaluate to None).
    """
    if bands is None:
        return []
    if not isinstance(bands, list):
        raise ValueError("Scheme must be an array of {min, max, text} bands")
    if len(bands) > MAX_BANDS:
        raise ValueError(f"Scheme allows at most {MAX_BANDS} bands")
    cleaned: List[Dict[str, Any]] = []
    for idx, b in enumerate(bands):
        if not isinstance(b, dict):
            raise ValueError(f"Band {idx + 1} must be an object")
        try:
            lo = float(b.get("min"))
            hi = float(b.get("max"))
        except (TypeError, ValueError):
            raise ValueError(f"Band {idx + 1} needs numeric min and max")
        if lo != lo or hi != hi:  # NaN guard
            raise ValueError(f"Band {idx + 1} min/max must be finite numbers")
        if lo > hi:
            raise ValueError(f"Band {idx + 1} requires min <= max")
        text = str(b.get("text") or "").strip()
        if not text:
            raise ValueError(f"Band {idx + 1} needs non-empty text")
        if len(text) > MAX_TEXT_LEN:
            raise ValueError(f"Band {idx + 1} text exceeds {MAX_TEXT_LEN} characters")
        cleaned.append({"min": lo, "max": hi, "text": text})
    cleaned.sort(key=lambda b: (b["min"], b["max"]))
    for prev, cur in zip(cleaned, cleaned[1:]):
        # Inclusive bounds on both sides: overlap iff cur.min <= prev.max.
        if cur["min"] <= prev["max"]:
            raise ValueError(
                f"Overlapping bands [{prev['min']}, {prev['max']}] and "
                f"[{cur['min']}, {cur['max']}]"
            )
    return cleaned


def evaluate_scheme(average: Optional[float], bands: Any) -> Optional[str]:
    """Return the matching band text for an average, or None.

    First band (min-ASC order) with min <= avg <= max wins. None average
    (no grades) or empty/gappy schemes evaluate to None (manual entry).
    """
    if average is None:
        return None
    try:
        avg = round(float(average), 1)
    except (TypeError, ValueError):
        return None
    if not isinstance(bands, list):
        return None
    ordered = sorted(
        (b for b in bands if isinstance(b, dict)),
        key=lambda b: (float(b.get("min", 0)), float(b.get("max", 0))),
    )
    for b in ordered:
        try:
            lo, hi = float(b.get("min")), float(b.get("max"))
        except (TypeError, ValueError):
            continue
        if lo <= avg <= hi:
            text = str(b.get("text") or "").strip()
            return text or None
    return None
