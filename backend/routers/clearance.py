"""
Financial Clearance / Administrative Hold (revenue recovery)
Prefix: /api/v1/tenant/{tenant_id}/clearance

Term-scoped "soft block" on school-fee non-payment. An admin/bursar can hold a
student for a given (term, academic_session); the public Result Checker then
withholds that student's grades while still acknowledging the result exists.

Design notes that matter:

  * SPARSE TABLE. A row exists only where a bursar has explicitly acted.
    "Cleared" == no row OR is_financially_cleared = TRUE. Reads therefore use a
    LEFT JOIN from tenant_students and COALESCE, never an INNER JOIN (which
    would silently drop every untouched student from the roster).

  * HOLDS SURVIVE REPUBLISHING, by construction. This module is the ONLY
    writer of student_term_clearance. publish_student_results() in db_manager
    does not touch the table, so a teacher fixing a grade and the admin
    clicking "Republish" can never silently release a student who still owes.

  * Raw psycopg2 throughout, matching allocations.py / credits.py. Tenant
    identity is a path param validated below; every statement still carries
    `subdomain = %s` in the WHERE clause.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field
import os
import logging

logger = logging.getLogger(__name__)


async def _verify_clearance_secret(
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
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
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
    prefix="/api/v1/tenant/{tenant_id}/clearance",
    tags=["clearance"],
    dependencies=[Depends(_verify_clearance_secret)],
)

# Matches publish_student_results' published_now cap (credits.py PublishRequest).
# A whole-school bulk operation must not be able to blow past the transaction.
MAX_BULK_STUDENTS = 3000


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


def _validate_term(term: str) -> str:
    from services.db_manager import VALID_TERMS

    t = (term or "").strip()
    if t not in VALID_TERMS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid term '{term}'. Must be one of {', '.join(VALID_TERMS)}",
        )
    return t


def _resolve_session(tid: str, academic_session: Optional[str]) -> str:
    """Prefer the school's configured session, else the derived one.

    This must agree with the report gate (report.py) or a hold written for one
    session would be invisible to the checker in another — which would be a
    silent revenue leak. LEGAL_REMEDIATION.md item 1 records a past drift bug
    between exactly these two resolvers.
    """
    session = (academic_session or "").strip()
    if session:
        return session

    from services.db_manager import get_school_by_subdomain

    school = get_school_by_subdomain(tid)
    configured = (school or {}).get("current_session")
    if configured:
        return str(configured).strip()

    from services.db_manager import current_academic_session

    return current_academic_session()


def _serialize(cursor, rows) -> List[dict]:
    """JSON-safe dicts. Mirrors allocations._serialize_rows."""
    from services.db_manager import _row_to_dict
    from datetime import datetime, date

    out = []
    for r in rows or []:
        d = _row_to_dict(r, cursor)
        for k, v in list(d.items()):
            if isinstance(v, (datetime, date)):
                d[k] = v.isoformat()
            elif isinstance(v, bool):
                d[k] = v
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Read: the bursary roster for a term
# ---------------------------------------------------------------------------


@router.get("", summary="List students with financial clearance status")
def list_clearance(
    tenant_id: str,
    term: str = Query(..., description="Term 1 | Term 2 | Term 3"),
    academic_session: Optional[str] = Query(None),
    class_name: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    """Roster + clearance status for one term.

    LEFT JOIN + COALESCE is load-bearing: an INNER JOIN would hide every
    student the bursar has never touched, which is the opposite of the truth
    (untouched == cleared).
    """
    from services.db_manager import (
        STUDENT_CLEARANCE_TABLE,
        TENANT_STUDENTS_TABLE,
        _connect_as_superuser,
    )

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)
    t = _validate_term(term)
    sess = _resolve_session(tid, academic_session)

    # `where_params` holds ONLY the optional filters. The three positional
    # keys (term, academic_session, subdomain) are supplied separately so the
    # binding order can never silently drift from the placeholder order.
    where_extra = ""
    where_params: list = []
    if class_name and class_name.strip():
        where_extra = " AND s.class_name = %s"
        where_params.append(class_name.strip())
    if search and search.strip():
        needle = f"%{search.strip().lower()}%"
        where_extra += " AND (LOWER(s.full_name) LIKE %s OR LOWER(s.student_id) LIKE %s)"
        where_params.extend([needle, needle])

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                s.student_id,
                s.full_name,
                s.class_name,
                s.gender,
                COALESCE(c.is_financially_cleared, TRUE) AS is_financially_cleared,
                c.hold_reason,
                c.held_by,
                c.held_at,
                c.cleared_at,
                CASE WHEN c.id IS NULL THEN FALSE ELSE TRUE END AS has_override
            FROM {TENANT_STUDENTS_TABLE} s
            LEFT JOIN {STUDENT_CLEARANCE_TABLE} c
                ON  c.subdomain = s.subdomain
                AND LOWER(c.student_id) = LOWER(s.student_id)
                AND c.term = %s
                AND c.academic_session = %s
            WHERE s.subdomain = %s{where_extra}
            ORDER BY s.class_name ASC, s.full_name ASC
            """,
            # Placeholder order: join term, join session, WHERE subdomain,
            # then the optional filters in the order they were appended.
            [t, sess, tid] + where_params,
        )
        rows = _serialize(cur, cur.fetchall())
        return {
            "success": True,
            "subdomain": tid,
            "term": t,
            "academic_session": sess,
            "total": len(rows),
            "owing": sum(1 for r in rows if not r.get("is_financially_cleared", True)),
            "cleared": sum(1 for r in rows if r.get("is_financially_cleared", True)),
            "students": rows,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[clearance] list failed for {tid}/{t}/{sess}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load clearance roster: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Read: counts, for the admin sidebar badge
# ---------------------------------------------------------------------------


@router.get("/summary", summary="Clearance counts for a term")
def clearance_summary(
    tenant_id: str,
    term: str = Query(...),
    academic_session: Optional[str] = Query(None),
):
    from services.db_manager import (
        STUDENT_CLEARANCE_TABLE,
        TENANT_STUDENTS_TABLE,
        _connect_as_superuser,
    )

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)
    t = _validate_term(term)
    sess = _resolve_session(tid, academic_session)

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE COALESCE(c.is_financially_cleared, TRUE)) AS cleared,
                COUNT(*) FILTER (WHERE NOT COALESCE(c.is_financially_cleared, TRUE)) AS owing
            FROM {TENANT_STUDENTS_TABLE} s
            LEFT JOIN {STUDENT_CLEARANCE_TABLE} c
                ON  c.subdomain = s.subdomain
                AND LOWER(c.student_id) = LOWER(s.student_id)
                AND c.term = %s
                AND c.academic_session = %s
            WHERE s.subdomain = %s
            """,
            (t, sess, tid),
        )
        row = cur.fetchone()
        total = int(row[0] or 0)
        cleared = int(row[1] or 0)
        owing = int(row[2] or 0)
        return {
            "success": True,
            "subdomain": tid,
            "term": t,
            "academic_session": sess,
            "total": total,
            "cleared": cleared,
            "owing": owing,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[clearance] summary failed for {tid}/{t}/{sess}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load clearance summary: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Write: bulk set clearance
# ---------------------------------------------------------------------------


class ClearanceUpdate(BaseModel):
    student_ids: List[str] = Field(..., min_length=1)
    term: str
    academic_session: Optional[str] = None
    is_financially_cleared: bool
    hold_reason: Optional[str] = None
    held_by: Optional[str] = None


@router.put("", summary="Bulk set financial clearance")
def set_clearance(tenant_id: str, body: ClearanceUpdate):
    """Upsert clearance rows for many students in one transaction.

    Deliberately the ONLY writer of this table. Because publishing never
    touches it, a hold cannot be cleared as a side effect of republishing.
    """
    from psycopg2.extras import execute_values
    from services.db_manager import (
        STUDENT_CLEARANCE_TABLE,
        TENANT_STUDENTS_TABLE,
        _connect_as_superuser,
        _row_to_dict,
    )

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)
    t = _validate_term(body.term)
    sess = _resolve_session(tid, body.academic_session)

    ids = [str(s).strip() for s in (body.student_ids or []) if str(s).strip()]
    # De-duplicate case-insensitively; the table key is on the raw string but
    # the join matches on LOWER(), so "VHS/001" and "vhs/001" are the same
    # student and must collapse to one row.
    seen = set()
    unique_ids = []
    for sid in ids:
        k = sid.lower()
        if k not in seen:
            seen.add(k)
            unique_ids.append(sid)

    if not unique_ids:
        raise HTTPException(status_code=400, detail="student_ids must contain at least one id")
    if len(unique_ids) > MAX_BULK_STUDENTS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many students in one request ({len(unique_ids)}); max is {MAX_BULK_STUDENTS}",
        )

    cleared = bool(body.is_financially_cleared)
    reason = (body.hold_reason or "").strip() or None
    actor = (body.held_by or "").strip() or None

    conn = None
    try:
        conn = _connect_as_superuser()

        # Reject ids that are not actually on this tenant's roster. Without
        # this, a caller with a valid admin session could write clearance rows
        # for arbitrary admission numbers and, more importantly, would get a
        # misleading "updated N" count back.
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT DISTINCT student_id FROM {TENANT_STUDENTS_TABLE}
            WHERE subdomain = %s AND LOWER(student_id) = ANY(%s)
            """,
            (tid, [i.lower() for i in unique_ids]),
        )
        known = {r[0] for r in cur.fetchall()}
        matched = [i for i in unique_ids if i in known or i.lower() in {k.lower() for k in known}]
        missing = [i for i in unique_ids if i not in matched]

        if not matched:
            raise HTTPException(
                status_code=400,
                detail="None of the supplied student_ids exist on this tenant's roster",
            )

        # ON CONFLICT keeps this idempotent and lets a re-apply correct itself.
        # cleared_at / held_at are stamped from the transition, so an
        # idempotent re-apply of the same value does not churn the timestamp.
        sql = f"""
            INSERT INTO {STUDENT_CLEARANCE_TABLE}
                (subdomain, student_id, term, academic_session,
                 is_financially_cleared, hold_reason, held_by, held_at, cleared_at)
            VALUES %s
            ON CONFLICT (subdomain, student_id, term, academic_session) DO UPDATE SET
                is_financially_cleared = EXCLUDED.is_financially_cleared,
                hold_reason = EXCLUDED.hold_reason,
                held_by = EXCLUDED.held_by,
                held_at = CASE WHEN EXCLUDED.is_financially_cleared THEN NULL ELSE EXCLUDED.held_at END,
                cleared_at = CASE WHEN EXCLUDED.is_financially_cleared THEN EXCLUDED.cleared_at ELSE NULL END,
                updated_at = NOW()
        """
        now_expr = "NOW()"
        template = (
            "(%s, %s, %s, %s, %s, %s, %s, "
            f"CASE WHEN %s THEN NULL ELSE {now_expr} END, "
            f"CASE WHEN %s THEN {now_expr} ELSE NULL END)"
        )
        rows = [
            (
                tid,
                sid,
                t,
                sess,
                cleared,
                reason,
                actor,
                cleared,
                cleared,
            )
            for sid in matched
        ]

        execute_values(cur, sql, rows, template=template, page_size=500)
        conn.commit()
        updated = cur.rowcount

        if missing:
            logger.warning(
                "[clearance] ignored %d student_id(s) not on tenant %s roster: %s",
                len(missing), tid, missing[:10],
            )

        return {
            "success": True,
            "subdomain": tid,
            "term": t,
            "academic_session": sess,
            "is_financially_cleared": cleared,
            "updated": updated,
            "requested": len(unique_ids),
            "skipped": len(missing),
        }
    except HTTPException:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    except Exception as e:
        logger.exception(f"[clearance] bulk update failed for {tid}/{t}/{sess}: {e}")
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to update clearance: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass