"""
End of Session — cohort close (Phase 3).

Prefix: /api/v1/tenant/{tenant_id}/end-of-session
Guarded by the shared secret, exactly like the roster router.

WHAT THIS DOES
--------------
Closes an academic session for one school. Every active student is resolved to
exactly one of four outcomes:

    promote    stays active, moves to the next class   (slot-neutral)
    repeat     stays active, keeps the current class   (slot-neutral)
    graduate   becomes terminal                        (slot released NOW)
    withdraw   becomes terminal                        (slot released at the
                                                          START of to_session)

WHY THE WITHDRAWAL REFUND IS DEFERRED
-------------------------------------
A child who transfers out in January and returns in September is one pupil,
not two. Refunding at once lets a single student consume two paid slots in one
academic year. So the release is written to billing_ledger against the session
it matures in and slots_balance is left alone until then — settled by
db_manager.settle_deferred_slot_releases(), which needs no worker because
"has this matured" is a pure function of which session the school is in.

Graduates refund immediately: they are gone for good and their slot is
genuinely free.

WHY EVERYTHING IS ONE TRANSACTION
---------------------------------
A half-applied cohort is worse than a failed one. A school whose students were
promoted but whose slots were not refunded is silently over-charged; one whose
slots moved but whose students did not has lost money. There is no state in
which either half is true, because the lock, the reclassification, the ledger
writes and the audit entry all commit or none do.

The UNIQUE(subdomain, from_session) on the run table is the idempotency key: a
retry after a timeout finds the run already 'applied' and returns it untouched
rather than promoting the cohort twice.

Slot lock ordering matches every other slot mutation in the codebase (student
create, batch import, delete refund): the schools row is taken FOR UPDATE first,
then dependent rows. Taking the reverse order would deadlock against a signup
holding that same row.
"""

import hmac
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from psycopg2.extensions import ISOLATION_LEVEL_READ_COMMITTED

logger = logging.getLogger(__name__)

#: The four outcomes. 'promote' and 'repeat' both leave the student active, so
#: they are distinguished by the class they end in rather than by status.
OUTCOMES = ("promote", "repeat", "graduate", "withdraw")


async def _verify_end_of_session_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    """Same shared-secret contract as the roster router."""
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
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
    prefix="/api/v1/tenant/{tenant_id}/end-of-session",
    tags=["end-of-session"],
    dependencies=[Depends(_verify_end_of_session_secret)],
)


def _validate_tenant_id(tenant_id: str) -> str:
    from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS

    tid = (tenant_id or "").lower().strip()
    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


# ---------------------------------------------------------------------------
# Class progression is per-tenant DATA, not code.
#
# Hardcoding "Nursery 1 -> Primary 1" in this module would be wrong twice over:
# schools reorder and rename classes, and the terminal class differs (JSS 3 for
# a secondary-only school). A class with a null target is how graduation is
# DETECTED, which keeps "who is graduating" derived from the roster rather than
# typed — so it cannot disagree with the map.
#
# For now the map is derived from the classes actually in use, advancing each
# by its position in a natural-ordering of the school's own roster. Schools
# with a bespoke progression override it via POST /run's `class_map`.
# ---------------------------------------------------------------------------


def _class_sort_key(name: str):
    """Order 'SS 1', 'SS 2', 'SS 3' naturally and 'JSS 1' before 'SS 1'."""
    import re

    tokens = re.findall(r"\d+|[A-Za-z]+", name or "")
    stage = 0
    num = 0
    for tok in tokens:
        if tok.isdigit():
            if num == 0:
                num = int(tok)
        else:
            up = tok.upper()
            if up in ("N", "NURSERY", "P", "PRIMARY", "J", "JSS", "SS"):
                stage = {"N": 1, "NURSERY": 1, "P": 2, "PRIMARY": 2, "J": 3, "JSS": 3, "SS": 4}[up]
    return (stage, num, name or "")


def _derive_class_map(cur, tid: str) -> Dict[str, Optional[str]]:
    """Default progression: each class advances to the next in roster order.

    The highest class maps to None (terminal) — which is what makes its students
    graduates. Deliberately conservative: a school with an unusual structure
    sends its own map and this never runs.
    """
    cur.execute(
        "SELECT DISTINCT class_name FROM tenant_students "
        "WHERE subdomain = %s AND status = 'active' ORDER BY class_name;",
        (tid,),
    )
    classes = [r[0] for r in cur.fetchall() if (r[0] or "").strip()]
    ordered = sorted(classes, key=_class_sort_key)
    return {
        cls: (ordered[i + 1] if i + 1 < len(ordered) else None)
        for i, cls in enumerate(ordered)
    }


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class Decision(BaseModel):
    """One student's resolved outcome."""

    outcome: str = Field(..., description=f"One of {', '.join(OUTCOMES)}")
    student_id: str = Field(..., min_length=1, max_length=60)
    from_class: Optional[str] = Field(None, max_length=60)
    to_class: Optional[str] = Field(None, max_length=60)
    reason: Optional[str] = Field(None, max_length=200)


class RunCreate(BaseModel):
    from_session: str = Field(..., min_length=1, max_length=50)
    to_session: str = Field(..., min_length=1, max_length=50)
    decisions: List[Decision] = Field(default_factory=list)
    #: Overrides the derived progression. {"SS 1": "SS 2", "SS 3": null}
    class_map: Optional[Dict[str, Optional[str]]] = None
    actor: str = Field(..., min_length=1, max_length=120)
    actor_id: Optional[str] = None
    x_viewer_role: Optional[str] = Header(None, alias="X-Viewer-Role")
    x_viewer_id: Optional[str] = Header(None, alias="X-Viewer-Id")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_active_students(cur, tid: str) -> Dict[str, str]:
    """student_id (lowercased) -> class_name, for every ACTIVE student.

    Status filter is load-bearing: a graduate from a previous close is not in
    this cohort and must never be re-promoted by a second run.
    """
    cur.execute(
        "SELECT LOWER(student_id), class_name FROM tenant_students "
        "WHERE subdomain = %s AND status = 'active';",
        (tid,),
    )
    return {(r[0] or ""): (r[1] or "") for r in cur.fetchall() if (r[0] or "").strip()}


def _normalise_decisions(raw: List[Decision]) -> Dict[str, Dict[str, Any]]:
    """Index decisions by lowercased student_id, rejecting duplicates.

    A duplicate is a client bug that would otherwise silently apply whichever
    entry happened to be processed last — and the two could disagree about
    whether the student graduated.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for d in raw:
        if d.outcome not in OUTCOMES:
            raise HTTPException(
                status_code=400, detail=f"outcome must be one of {', '.join(OUTCOMES)}"
            )
        key = d.student_id.strip().lower()
        if key in out:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate decision for '{d.student_id}' — each student appears once",
            )
        out[key] = {
            "outcome": d.outcome,
            "student_id": d.student_id.strip(),
            "from_class": (d.from_class or "").strip() or None,
            "to_class": (d.to_class or "").strip() or None,
            "reason": (d.reason or "").strip() or None,
        }
    return out


def _resolve_outcome(
    sid: str,
    current_class: str,
    decisions: Dict[str, Dict[str, Any]],
    class_map: Dict[str, Optional[str]],
) -> Dict[str, Any]:
    """Decide one student's outcome, defaulting to the class map.

    A student with no explicit decision still needs one — every active student
    must be accounted for, which is what stops a cohort close from silently
    dropping whoever the admin forgot to tick.
    """
    explicit = decisions.get(sid)
    if explicit is not None:
        outcome = explicit["outcome"]
        if outcome in ("promote", "repeat"):
            target = explicit["to_class"] or (
                class_map.get(current_class) if outcome == "promote" else current_class
            )
        elif outcome == "graduate":
            target = explicit["to_class"] or current_class
        else:  # withdraw
            target = explicit["to_class"] or current_class
        return {
            "outcome": outcome,
            "student_id": explicit["student_id"],
            "from_class": current_class,
            "to_class": target,
            "reason": explicit["reason"],
            "source": "explicit",
        }

    target = class_map.get(current_class)
    outcome = "graduate" if target is None else "promote"
    return {
        "outcome": outcome,
        "student_id": sid,
        "from_class": current_class,
        "to_class": target or current_class,
        "reason": None,
        "source": "derived",
    }


def _summarise(resolved: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {o: 0 for o in OUTCOMES}
    for r in resolved:
        counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
    return counts


def _write_slot_release(
    cur,
    tid: str,
    amount: int,
    reference_id: str,
    description: str,
    transaction_type: str,
    available_from_session: Optional[str],
) -> None:
    """Append a ledger row. The caller owns the transaction and the balance.

    ON CONFLICT DO NOTHING on reference_id makes a replayed apply a no-op here
    even if some future caller reaches this before the run-status check does.
    """
    from services.db_manager import BILLING_LEDGER_TABLE

    cur.execute(
        f"""
        INSERT INTO {BILLING_LEDGER_TABLE}
            (subdomain, token_type, amount, transaction_type, reference_id,
             description, available_from_session)
        VALUES (%s, 'SLOT', %s, %s, %s, %s, %s)
        ON CONFLICT (reference_id) DO NOTHING;
        """,
        (tid, amount, transaction_type, reference_id, description, available_from_session),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/preview", summary="Classify the cohort. Reads only, writes nothing.")
def preview_close(
    tenant_id: str,
    from_session: Optional[str] = Query(None),
    to_session: Optional[str] = Query(None),
    x_viewer_role: Optional[str] = Header(None, alias="X-Viewer-Role"),
):
    """What would happen, per class, before anything is committed.

    Safe to call repeatedly and safe to call against a live roster: no locks are
    taken and no row is written. The admin screen renders this before letting
    anyone confirm.
    """
    from services.db_manager import _connect_as_superuser, resolve_tenant_session

    tid = _validate_tenant_id(tenant_id)

    conn = None
    try:
        conn = _connect_as_superuser()
        conn.set_isolation_level(ISOLATION_LEVEL_READ_COMMITTED)
        cur = conn.cursor()

        frm = (from_session or "").strip() or resolve_tenant_session(tid, None)
        to = (to_session or "").strip()
        if not to:
            # "Next session" from the from-session label: 2026/2027 -> 2027/2028.
            try:
                start = int(str(frm).split("/")[0])
                to = f"{start + 1}/{start + 2}"
            except Exception:
                to = frm
        if frm == to:
            raise HTTPException(
                status_code=400, detail="from_session and to_session must differ"
            )

        students = _load_active_students(cur, tid)
        class_map = _derive_class_map(cur, tid)

        resolved = [
            _resolve_outcome(sid, cls, {}, class_map) for sid, cls in students.items()
        ]
        by_class: Dict[str, Dict[str, Any]] = {}
        for r in resolved:
            slot = by_class.setdefault(
                r["from_class"],
                {"class_name": r["from_class"], "count": 0, "graduates": 0, "next_class": None},
            )
            slot["count"] += 1
            if r["outcome"] == "graduate":
                slot["graduates"] += 1
            if slot["next_class"] is None and r["to_class"] != r["from_class"]:
                slot["next_class"] = r["to_class"]

        conn.rollback()
        return {
            "success": True,
            "subdomain": tid,
            "from_session": frm,
            "to_session": to,
            "class_map": class_map,
            "totals": _summarise(resolved),
            "by_class": sorted(by_class.values(), key=lambda c: _class_sort_key(c["class_name"])),
            "active_students": len(students),
            "slots_released_now": sum(1 for r in resolved if r["outcome"] == "graduate"),
            "slots_released_deferred": sum(1 for r in resolved if r["outcome"] == "withdraw"),
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/run", status_code=201, summary="Create or replace the draft run")
def create_run(tenant_id: str, payload: RunCreate):
    """Store the operator's confirmed plan. Writes nothing to the roster."""
    from services.db_manager import (
        _connect_as_superuser,
        END_OF_SESSION_RUNS_TABLE,
        log_admin_action,
    )

    tid = _validate_tenant_id(tenant_id)

    if payload.from_session.strip() == payload.to_session.strip():
        raise HTTPException(
            status_code=400, detail="from_session and to_session must differ"
        )

    decisions = _normalise_decisions(payload.decisions)

    conn = None
    try:
        conn = _connect_as_superuser()
        conn.set_isolation_level(ISOLATION_LEVEL_READ_COMMITTED)
        cur = conn.cursor()

        students = _load_active_students(cur, tid)
        if not students:
            raise HTTPException(
                status_code=400,
                detail="This school has no active students to close a session for",
            )

        unknown = sorted(set(decisions) - set(students))
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=(
                    "decisions reference students who are not active in this cohort: "
                    + ", ".join(unknown[:10])
                ),
            )

        class_map = payload.class_map or _derive_class_map(cur, tid)
        resolved = [
            _resolve_outcome(sid, cls, decisions, class_map)
            for sid, cls in students.items()
        ]

        actor = payload.actor.strip()
        actor_uuid = None
        if payload.actor_id:
            import uuid as _uuid

            try:
                actor_uuid = _uuid.UUID(str(payload.actor_id).strip())
            except Exception:
                actor_uuid = None

        cur.execute(
            f"""
            INSERT INTO {END_OF_SESSION_RUNS_TABLE}
                (subdomain, from_session, to_session, status, decisions, preview,
                 actor, actor_id)
            VALUES (%s, %s, %s, 'draft', %s::jsonb, %s::jsonb, %s, %s)
            ON CONFLICT (subdomain, from_session) DO UPDATE
                SET to_session = EXCLUDED.to_session,
                    decisions = EXCLUDED.decisions,
                    preview = EXCLUDED.preview,
                    actor = EXCLUDED.actor,
                    actor_id = EXCLUDED.actor_id,
                    status = 'draft',
                    applied_at = NULL,
                    updated_at = NOW()
            RETURNING id;
            """,
            (
                tid,
                payload.from_session.strip(),
                payload.to_session.strip(),
                _json(decisions),
                _json(
                    {
                        "class_map": class_map,
                        "totals": _summarise(resolved),
                        "active_students": len(students),
                    }
                ),
                actor,
                actor_uuid,
            ),
        )
        run_id = cur.fetchone()[0]
        conn.commit()

        try:
            log_admin_action(
                "endofsession.run_drafted",
                subdomain=tid,
                details={
                    "run_id": str(run_id),
                    "from_session": payload.from_session,
                    "to_session": payload.to_session,
                    "totals": _summarise(resolved),
                },
                actor=actor,
                actor_id=actor_uuid,
                actor_type=(payload.x_viewer_role or "admin"),
            )
        except Exception as audit_err:
            logger.warning("[end-of-session] draft audit failed: %s", audit_err)

        return {
            "success": True,
            "run_id": str(run_id),
            "subdomain": tid,
            "from_session": payload.from_session,
            "to_session": payload.to_session,
            "status": "draft",
            "totals": _summarise(resolved),
            "active_students": len(students),
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.get("/run/{run_id}", summary="Inspect a run")
def get_run(tenant_id: str, run_id: str):
    from services.db_manager import _connect_as_superuser, END_OF_SESSION_RUNS_TABLE, _row_to_dict

    tid = _validate_tenant_id(tenant_id)
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"SELECT * FROM {END_OF_SESSION_RUNS_TABLE} "
            f"WHERE id = %s AND subdomain = %s;",
            (run_id, tid),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Run not found for this school")
        d = _row_to_dict(row, cur)
        d["id"] = str(d.get("id"))
        if d.get("actor_id"):
            d["actor_id"] = str(d["actor_id"])
        return {"success": True, "run": d}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/run/{run_id}/apply", summary="Apply the cohort close. Atomic.")
def apply_run(
    tenant_id: str,
    run_id: str,
    x_viewer_role: Optional[str] = Header(None, alias="X-Viewer-Role"),
    x_viewer_id: Optional[str] = Header(None, alias="X-Viewer-Id"),
    x_viewer_label: Optional[str] = Header(None, alias="X-Viewer-Label"),
):
    """Close the cohort. Everything below commits together or not at all.

    Re-applying an already-applied run returns the stored result untouched
    rather than promoting the cohort a second time.
    """
    from services.db_manager import (
        _connect_as_superuser,
        END_OF_SESSION_RUNS_TABLE,
        SCHOOLS_REGISTRY_TABLE,
        settle_deferred_slot_releases,
        log_admin_action,
    )

    tid = _validate_tenant_id(tenant_id)

    conn = None
    try:
        conn = _connect_as_superuser()
        conn.set_isolation_level(ISOLATION_LEVEL_READ_COMMITTED)
        cur = conn.cursor()

        # --- Phase A: read the run WITHOUT a lock -------------------------
        # Only to learn `to`, so the deferred-release settle can run first.
        # No lock is taken here and nothing is written: committing mid-function
        # would release the run's FOR UPDATE and reopen exactly the race that
        # lock exists to close.
        cur.execute(
            f"SELECT status, from_session, to_session, decisions, actor "
            f"FROM {END_OF_SESSION_RUNS_TABLE} WHERE id = %s AND subdomain = %s;",
            (run_id, tid),
        )
        probe = cur.fetchone()
        if probe is None:
            raise HTTPException(status_code=404, detail="Run not found for this school")
        if probe[0] == "applied":
            conn.rollback()
            return {
                "success": True,
                "already_applied": True,
                "run_id": str(run_id),
                "from_session": probe[1],
                "to_session": probe[2],
                "message": "This session close was already applied. Nothing was changed.",
            }
        if probe[0] == "cancelled":
            raise HTTPException(
                status_code=409, detail="This run was cancelled and cannot be applied"
            )
        conn.commit()

        # Any withdrawal refund that matured before this close lands first, so
        # the balance reported below reflects everything already owed. It runs
        # on its own connection and its own lock order (schools row first).
        settle_deferred_slot_releases(tid, probe[2])

        # --- Phase B: the single atomic transaction ----------------------
        cur.execute(
            f"SELECT status, from_session, to_session, decisions, actor "
            f"FROM {END_OF_SESSION_RUNS_TABLE} WHERE id = %s AND subdomain = %s FOR UPDATE;",
            (run_id, tid),
        )
        run = cur.fetchone()
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found for this school")

        status, frm, to, decisions_json, actor = run
        # Re-checked under the lock. Two admins can legitimately press Apply
        # at the same moment; the second one waits here, then finds 'applied'.
        if status == "applied":
            conn.rollback()
            return {
                "success": True,
                "already_applied": True,
                "run_id": str(run_id),
                "from_session": frm,
                "to_session": to,
                "message": "This session close was already applied. Nothing was changed.",
            }
        if status == "cancelled":
            raise HTTPException(
                status_code=409, detail="This run was cancelled and cannot be applied"
            )

        # Slot lock, matching every other slot mutation in the codebase
        # (student create, batch import, delete refund): schools row FIRST,
        # then dependent rows. The reverse order would deadlock against a
        # signup holding that same row.
        cur.execute(
            f"SELECT slots_balance FROM {SCHOOLS_REGISTRY_TABLE} "
            f"WHERE subdomain = %s FOR UPDATE;",
            (tid,),
        )
        slots_row = cur.fetchone()
        if slots_row is None:
            raise HTTPException(status_code=404, detail=f"Unknown tenant '{tid}'")
        slots_before = int(slots_row[0] or 0)

        # --- Cohort lock ---------------------------------------------------
        # Re-read under the schools lock. Students may have been added since
        # the run was drafted, and promoting a cohort that no longer matches
        # the roster is how someone gets silently left behind: the status
        # filter means an unlisted newcomer simply stays active and untouched.
        cur.execute(
            "SELECT LOWER(student_id), class_name FROM tenant_students "
            "WHERE subdomain = %s AND status = 'active' FOR UPDATE;",
            (tid,),
        )
        students = {(r[0] or ""): (r[1] or "") for r in cur.fetchall() if (r[0] or "").strip()}

        decisions = _normalise_decisions(
            [
                Decision(
                    outcome=v.get("outcome", "promote"),
                    student_id=v.get("student_id", k),
                    from_class=v.get("from_class"),
                    to_class=v.get("to_class"),
                    reason=v.get("reason"),
                )
                for k, v in (decisions_json or {}).items()
            ]
        )

        class_map = _derive_class_map(cur, tid)

        resolved = [
            _resolve_outcome(sid, cls, decisions, class_map)
            for sid, cls in students.items()
        ]
        totals = _summarise(resolved)

        # --- Reclassify ----------------------------------------------------
        promoted = repeated = graduated = withdrawn = 0
        for r in resolved:
            outcome = r["outcome"]
            if outcome == "promote":
                cur.execute(
                    "UPDATE tenant_students SET class_name = %s, promoted_at = NOW() "
                    "WHERE subdomain = %s AND LOWER(student_id) = %s AND status = 'active';",
                    (r["to_class"], tid, r["student_id"].lower()),
                )
                promoted += cur.rowcount
            elif outcome == "repeat":
                # promoted_at is deliberately NOT touched. It means "when this
                # student was last promoted", and a student repeating SS 1 WAS
                # promoted into SS 1 in a previous session — clearing it here
                # would erase real history to express "not this time". A
                # student who has genuinely never advanced keeps their NULL.
                repeated += 1
            elif outcome == "graduate":
                cur.execute(
                    "UPDATE tenant_students SET status = 'graduated', "
                    "terminal_outcome = 'graduated', promoted_at = NOW() "
                    "WHERE subdomain = %s AND LOWER(student_id) = %s AND status = 'active';",
                    (tid, r["student_id"].lower()),
                )
                graduated += cur.rowcount
                # Immediate. A graduate is gone for good.
                _write_slot_release(
                    cur,
                    tid,
                    1,
                    f"eos:{run_id}:grad:{r['student_id'].lower()}",
                    f"Slot released on graduation of {r['student_id']}",
                    "SLOT_RELEASE",
                    None,
                )
            elif outcome == "withdraw":
                cur.execute(
                    "UPDATE tenant_students SET status = 'withdrawn', "
                    "terminal_outcome = 'withdrawn' "
                    "WHERE subdomain = %s AND LOWER(student_id) = %s AND status = 'active';",
                    (tid, r["student_id"].lower()),
                )
                withdrawn += cur.rowcount
                # Deferred. The slot is NOT returned to the balance yet — see
                # the module docstring. Recording it against to_session means a
                # January transfer-out who returns in September costs one slot,
                # not two.
                _write_slot_release(
                    cur,
                    tid,
                    1,
                    f"eos:{run_id}:withdraw:{r['student_id'].lower()}",
                    f"Slot released on withdrawal of {r['student_id']}, available {to}",
                    "SLOT_RELEASE_DEFERRED",
                    to,
                )

        if graduated:
            cur.execute(
                f"""
                UPDATE {SCHOOLS_REGISTRY_TABLE}
                   SET slots_balance = COALESCE(slots_balance, 0) + %s,
                       updated_at = NOW()
                 WHERE subdomain = %s;
                """,
                (graduated, tid),
            )
        cur.execute(
            f"SELECT COALESCE(slots_balance, 0) FROM {SCHOOLS_REGISTRY_TABLE} "
            f"WHERE subdomain = %s;",
            (tid,),
        )
        slots_after = int(cur.fetchone()[0] or 0)

        # --- Seal the run --------------------------------------------------
        cur.execute(
            f"""
            UPDATE {END_OF_SESSION_RUNS_TABLE}
               SET status = 'applied',
                   applied_at = NOW(),
                   updated_at = NOW(),
                   preview = COALESCE(preview, '{{}}'::jsonb) || %s::jsonb
             WHERE id = %s AND subdomain = %s;
            """,
            (
                _json(
                    {
                        "applied": {
                            "promoted": promoted,
                            "repeated": repeated,
                            "graduated": graduated,
                            "withdrawn": withdrawn,
                            "slots_before": slots_before,
                            "slots_after": slots_after,
                        }
                    }
                ),
                run_id,
                tid,
            ),
        )

        conn.commit()
    except HTTPException:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception("[end-of-session] apply failed for %s run %s: %s", tid, run_id, e)
        raise HTTPException(status_code=500, detail=f"Could not apply the session close: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    # Audit AFTER commit, best-effort — exactly like the moderator grant path.
    # Rolling back a successful close because the audit sink is down would be
    # the wrong trade.
    try:
        log_admin_action(
            "endofsession.applied",
            subdomain=tid,
            details={
                "run_id": str(run_id),
                "from_session": frm,
                "to_session": to,
                "promoted": promoted,
                "repeated": repeated,
                "graduated": graduated,
                "withdrawn": withdrawn,
                "slots_before": slots_before,
                "slots_after": slots_after,
                "withdrawal_refunds_deferred_to": to,
            },
            actor=(x_viewer_id or x_viewer_label or actor or "tenant_admin"),
            actor_id=x_viewer_id or None,
            actor_type=(x_viewer_role or "admin"),
        )
    except Exception as audit_err:
        logger.warning("[end-of-session] applied audit failed: %s", audit_err)

    return {
        "success": True,
        "run_id": str(run_id),
        "subdomain": tid,
        "from_session": frm,
        "to_session": to,
        "promoted": promoted,
        "repeated": repeated,
        "graduated": graduated,
        "withdrawn": withdrawn,
        "slots_released_now": graduated,
        "slots_released_deferred": withdrawn,
        "withdrawal_refunds_available_from": to,
        "slots_before": slots_before,
        "slots_after": slots_after,
    }


def _json(obj: Any) -> str:
    import json as _json_mod

    return _json_mod.dumps(obj)