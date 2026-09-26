"""
Allocations & Roster — per-tenant directory (Phase: Allocations)
Prefix: /api/v1/tenant/{tenant_id}/roster
Uses raw psycopg2 (mirrors db_manager / admin router), indexed by subdomain.
"""

from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Header
import os
import logging

logger = logging.getLogger(__name__)

async def _verify_allocations_secret(
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


router = APIRouter(prefix="/api/v1/tenant/{tenant_id}/roster", tags=["roster"], dependencies=[Depends(_verify_allocations_secret)])


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


def _list_form_assignments(tid: str, page: int = 1, limit: int = 20):
    """Paginated form-teacher assignments with staff names resolved."""
    from services.db_manager import TENANT_FORM_ASSIGNMENTS_TABLE, TENANT_STAFF_TABLE, _connect_as_superuser

    try:
        page = max(1, int(page or 1))
    except Exception:
        page = 1
    try:
        limit = max(1, min(int(limit or 20), 100))
    except Exception:
        limit = 20
    offset = (page - 1) * limit

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"SELECT COUNT(*) FROM {TENANT_FORM_ASSIGNMENTS_TABLE} WHERE subdomain = %s",
            (tid,),
        )
        total = int(cur.fetchone()[0] or 0)
        cur.execute(
            f"""
            SELECT f.id, f.subdomain, f.class_name, f.staff_id, s.full_name, f.created_at
            FROM {TENANT_FORM_ASSIGNMENTS_TABLE} f
            LEFT JOIN {TENANT_STAFF_TABLE} s
              ON s.subdomain = f.subdomain AND LOWER(s.staff_id) = LOWER(f.staff_id)
            WHERE f.subdomain = %s
            ORDER BY f.created_at DESC LIMIT %s OFFSET %s
            """,
            (tid, limit, offset),
        )
        data = _serialize_rows(cur, cur.fetchall())
        return {
            "subdomain": tid,
            "entity_type": "form_assignments",
            "data": data,
            "total": total,
            "page": page,
            "limit": limit,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[roster] paginated list failed for {tid}/form_assignments: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list form_assignments: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Helpers — serialize rows like _row_to_dict + iso timestamps
# ---------------------------------------------------------------------------

def _serialize_rows(cursor, rows):
    from services.db_manager import _row_to_dict
    from datetime import datetime

    out = []
    for r in rows:
        d = _row_to_dict(r, cursor)
        # created_at -> iso
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        elif d.get("created_at") is not None:
            d["created_at"] = str(d["created_at"])
        # id -> str
        if "id" in d and d["id"] is not None:
            d["id"] = str(d["id"])
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# GET — fetch all lists for tenant (now 4: students, staff, allocations, subjects)
# ---------------------------------------------------------------------------

@router.get("", summary="List roster for tenant (paginated per entity; legacy full blob when entity_type omitted)")
def list_roster(tenant_id: str, entity_type: Optional[str] = None, page: int = 1, limit: int = 20):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    from services.db_manager import (
        TENANT_STUDENTS_TABLE,
        TENANT_STAFF_TABLE,
        TENANT_ALLOCATIONS_TABLE,
        TENANT_SUBJECTS_TABLE,
        TENANT_FORM_ASSIGNMENTS_TABLE,
        _connect_as_superuser,
    )

    # Paginated path — one entity per request: COUNT(*) + LIMIT/OFFSET.
    # Shape: { subdomain, entity_type, data, total, page, limit }.
    if entity_type is not None:
        entity = (entity_type or "").strip().lower()
        if entity == "form_assignments":
            return _list_form_assignments(tid, page, limit)
        entity_map = {
            "students": (
                TENANT_STUDENTS_TABLE,
                "id, subdomain, student_id, full_name, class_name, gender, created_at",
            ),
            "staff": (
                TENANT_STAFF_TABLE,
                "id, subdomain, staff_id, full_name, email, phone, role, created_at",
            ),
            "allocations": (
                TENANT_ALLOCATIONS_TABLE,
                "id, subdomain, subject_name, staff_name, class_name, created_at",
            ),
            "subjects": (
                TENANT_SUBJECTS_TABLE,
                "id, subdomain, subject_name, created_at",
            ),
        }
        if entity not in entity_map:
            raise HTTPException(
                status_code=400,
                detail="entity_type must be one of students, staff, allocations, subjects, form_assignments",
            )
        table, columns = entity_map[entity]
        try:
            page = max(1, int(page or 1))
        except Exception:
            page = 1
        try:
            limit = max(1, min(int(limit or 20), 100))
        except Exception:
            limit = 20
        offset = (page - 1) * limit

        conn = None
        try:
            conn = _connect_as_superuser()
            cur = conn.cursor()
            cur.execute(
                f"SELECT COUNT(*) FROM {table} WHERE subdomain = %s",
                (tid,),
            )
            total = int(cur.fetchone()[0] or 0)
            cur.execute(
                f"SELECT {columns} FROM {table} WHERE subdomain = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
                (tid, limit, offset),
            )
            data = _serialize_rows(cur, cur.fetchall())
            return {
                "subdomain": tid,
                "entity_type": entity,
                "data": data,
                "total": total,
                "page": page,
                "limit": limit,
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"[roster] paginated list failed for {tid}/{entity}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to list {entity}: {e}")
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

    # Backward-compatibility branch — legacy callers with no entity_type get
    # the full four-entity blob (unbounded; deprecated, prefer paginated path).
    logger.warning(f"[roster] legacy un-paginated list used for '{tid}' — migrate to entity_type+page+limit")
    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        cur.execute(
            f"SELECT id, subdomain, student_id, full_name, class_name, gender, created_at FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s ORDER BY created_at DESC",
            (tid,),
        )
        students = _serialize_rows(cur, cur.fetchall())

        cur.execute(
            f"SELECT id, subdomain, staff_id, full_name, email, phone, role, created_at FROM {TENANT_STAFF_TABLE} WHERE subdomain = %s ORDER BY created_at DESC",
            (tid,),
        )
        staff = _serialize_rows(cur, cur.fetchall())

        cur.execute(
            f"SELECT id, subdomain, subject_name, staff_name, class_name, created_at FROM {TENANT_ALLOCATIONS_TABLE} WHERE subdomain = %s ORDER BY created_at DESC",
            (tid,),
        )
        allocations = _serialize_rows(cur, cur.fetchall())

        cur.execute(
            f"SELECT id, subdomain, subject_name, created_at FROM {TENANT_SUBJECTS_TABLE} WHERE subdomain = %s ORDER BY created_at DESC",
            (tid,),
        )
        subjects = _serialize_rows(cur, cur.fetchall())

        return {"subdomain": tid, "students": students, "staff": staff, "allocations": allocations, "subjects": subjects}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[roster] list failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list roster: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# POST — insert one record, type = student|staff|allocation
# ---------------------------------------------------------------------------

from pydantic import BaseModel, Field
from typing import Optional as Opt, List

class RosterCreate(BaseModel):
    type: Literal["student", "staff", "allocation", "subject", "bulk_subjects", "form_assignment"] = Field(..., description='Record type')
    # student
    student_id: Opt[str] = None
    full_name: Opt[str] = None
    class_name: Opt[str] = None
    gender: Opt[str] = None
    # staff
    staff_id: Opt[str] = None
    email: Opt[str] = None
    phone: Opt[str] = None
    role: Opt[str] = None
    # allocation / subject
    subject_name: Opt[str] = None
    staff_name: Opt[str] = None
    subjects: Opt[List[str]] = None
    subject_names: Opt[List[str]] = None


@router.post("", status_code=201, summary="Create one roster record")
def create_roster_record(tenant_id: str, payload: RosterCreate):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    from services.db_manager import (
        TENANT_STUDENTS_TABLE,
        TENANT_STAFF_TABLE,
        TENANT_ALLOCATIONS_TABLE,
        TENANT_SUBJECTS_TABLE,
        TENANT_FORM_ASSIGNMENTS_TABLE,
        _connect_as_superuser,
        _row_to_dict,
    )
    from datetime import datetime

    typ = payload.type

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

        if typ == "form_assignment":
            # Admin-only upstream (proxy enforces admin_session). Exactly one
            # form teacher per class: re-assigning overwrites via upsert.
            class_name = (payload.class_name or "").strip()
            staff_id = (payload.staff_id or "").strip()
            if not class_name or not staff_id:
                raise HTTPException(status_code=400, detail="form_assignment requires class_name and staff_id")
            cur.execute(
                f"SELECT 1 FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s AND class_name = %s LIMIT 1;",
                (tid, class_name),
            )
            if cur.fetchone() is None:
                raise HTTPException(status_code=422, detail=f"Unknown class '{class_name}' — no students registered in it")
            cur.execute(
                f"SELECT staff_id, full_name FROM {TENANT_STAFF_TABLE} WHERE subdomain = %s AND LOWER(staff_id) = LOWER(%s) LIMIT 1;",
                (tid, staff_id),
            )
            _srow = cur.fetchone()
            if _srow is None:
                raise HTTPException(status_code=422, detail=f"Unknown staff_id '{staff_id}'")
            staff_id = str(_srow[0])
            cur.execute(
                f"""
                INSERT INTO {TENANT_FORM_ASSIGNMENTS_TABLE} (subdomain, class_name, staff_id, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (subdomain, class_name)
                DO UPDATE SET staff_id = EXCLUDED.staff_id, updated_at = NOW()
                RETURNING id, subdomain, class_name, staff_id, created_at;
                """,
                (tid, class_name, staff_id),
            )
            row = cur.fetchone()
            conn.commit()
            d = _row_to_dict(row, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            d["id"] = str(d["id"])
            d["staff_name"] = str(_srow[1])
            return {"type": "form_assignment", "record": d}

        if typ == "subject":
            subject_name = (payload.subject_name or "").strip()
            if not subject_name:
                raise HTTPException(status_code=400, detail="subject requires subject_name")
            cur.execute(
                f"""
                INSERT INTO {TENANT_SUBJECTS_TABLE} (subdomain, subject_name)
                VALUES (%s, %s)
                RETURNING id, subdomain, subject_name, created_at;
                """,
                (tid, subject_name),
            )
            row = cur.fetchone()
            conn.commit()
            d = _row_to_dict(row, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            d["id"] = str(d["id"])
            return {"type": "subject", "record": d}

        if typ == "bulk_subjects":
            raw_list = payload.subjects if payload.subjects is not None else payload.subject_names
            if raw_list is None:
                raise HTTPException(status_code=400, detail="bulk_subjects requires subjects array")
            names = [str(n).strip() for n in raw_list if str(n).strip()]
            if not names:
                raise HTTPException(status_code=400, detail="bulk_subjects requires at least one subject")
            # dedupe case-insensitive, preserve first case
            seen: dict[str, str] = {}
            for n in names:
                k = n.lower()
                if k not in seen:
                    seen[k] = n
            uniq = list(seen.values())
            # Bulk insert with ON CONFLICT DO NOTHING
            placeholders = ", ".join(["(%s, %s)"] * len(uniq))
            flat: list[str] = []
            for n in uniq:
                flat.extend([tid, n])
            cur.execute(
                f"""
                INSERT INTO {TENANT_SUBJECTS_TABLE} (subdomain, subject_name)
                VALUES {placeholders}
                ON CONFLICT (subdomain, subject_name) DO NOTHING
                RETURNING id, subdomain, subject_name, created_at;
                """,
                tuple(flat),
            )
            rows = cur.fetchall()
            conn.commit()
            records = []
            for r in rows:
                d = _row_to_dict(r, cur)
                if isinstance(d.get("created_at"), datetime):
                    d["created_at"] = d["created_at"].isoformat()
                d["id"] = str(d["id"])
                records.append(d)
            return {"type": "bulk_subjects", "records": records, "count": len(records), "requested": len(uniq)}

        if typ == "student":
            _raw_sid = (payload.student_id or "").strip()
            # Lowercase prefix before slash (vhs/005 not VHS/005)
            if "/" in _raw_sid:
                _pfx, _rest = _raw_sid.split("/", 1)
                student_id = _pfx.lower() + "/" + _rest
            else:
                # no slash: lower leading letters
                import re as _re
                _m = _re.match(r"^([A-Za-z]+)(.*)$", _raw_sid)
                student_id = (_m.group(1).lower() + _m.group(2)) if _m else _raw_sid.lower()
            full_name = (payload.full_name or "").strip()
            class_name = (payload.class_name or "").strip()
            gender = (payload.gender or "").strip() or None

            if not full_name or not class_name:
                raise HTTPException(status_code=400, detail="student requires full_name, class_name (student_id auto-assigned when blank)")
            if gender and gender.lower() not in ("male", "female"):
                raise HTTPException(status_code=400, detail="gender must be Male or Female")

            # --- Dual-ledger slot guard (atomic, all-or-nothing) ---
            try:
                cur.execute("BEGIN;")
            except Exception:
                pass
            from services.db_manager import SCHOOLS_REGISTRY_TABLE, BILLING_LEDGER_TABLE

            cur.execute(
                f"SELECT slots_balance, COALESCE(id_prefix, %s) FROM {SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s FOR UPDATE;",
                (tid, tid),
            )
            srow = cur.fetchone()
            if srow is None:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail=f"Unknown tenant '{tid}'")
            slots = int(srow[0] or 0)
            id_prefix = (srow[1] or tid).strip().lower() or tid
            # Blank ID → next sequential from the school's configured prefix
            if not student_id:
                student_id = _next_prefixed_ids(cur, id_prefix, TENANT_STUDENTS_TABLE, "student_id", 1, tid)[0]
            if slots < 1:
                cur.execute("ROLLBACK;")
                # Count used for helpful error
                cur2 = None
                try:
                    from services.db_manager import _connect_as_superuser as _conn2

                    cur2_conn = _conn2()
                    cur2 = cur2_conn.cursor()
                    cur2.execute(f"SELECT COUNT(*) FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s;", (tid,))
                    used = int(cur2.fetchone()[0] or 0)
                    cur2_conn.close()
                except Exception:
                    used = 0
                raise HTTPException(
                    status_code=402,
                    detail=f"Insufficient slots. Need 1, balance is {slots} ({used} slots used). Top up slots to add more students.",
                )
            # Insert student
            cur.execute(
                f"""
                INSERT INTO {TENANT_STUDENTS_TABLE} (subdomain, student_id, full_name, class_name, gender)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, subdomain, student_id, full_name, class_name, gender, created_at;
                """,
                (tid, student_id, full_name, class_name, gender),
            )
            row = cur.fetchone()
            # Serialize IMMEDIATELY: subsequent statements below (slot UPDATE,
            # ledger INSERT without RETURNING) invalidate cur.description, so
            # serializing after COMMIT raised "'NoneType' object is not
            # iterable" (500 post-commit while the row persisted).
            d = _row_to_dict(row, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            d["id"] = str(d["id"])
            # Decrement slot and log
            cur.execute(
                f"""
                UPDATE {SCHOOLS_REGISTRY_TABLE}
                SET slots_balance = slots_balance - 1, updated_at = NOW()
                WHERE subdomain = %s
                RETURNING slots_balance;
                """,
                (tid,),
            )
            new_slots = cur.fetchone()
            # Unified ledger (also keep dual-write idempotent)
            ref = f"slot:{tid}:{student_id}:{int(datetime.now().timestamp())}"
            cur.execute(
                f"""
                INSERT INTO {BILLING_LEDGER_TABLE}
                    (subdomain, token_type, amount, transaction_type, reference_id, description)
                VALUES (%s, 'SLOT', -1, 'SLOT_CONSUMPTION', %s, %s)
                ON CONFLICT (reference_id) DO NOTHING;
                """,
                (tid, ref, f"Allocated slot for student {student_id}"),
            )
            cur.execute("COMMIT;")
            # Include remaining slots in response for UI feedback
            d["slots_remaining"] = int(new_slots[0] or 0) if new_slots else slots - 1
            return {"type": "student", "record": d}

        if typ == "staff":
            staff_id = (payload.staff_id or "").strip()
            full_name = (payload.full_name or "").strip()
            email = (payload.email or "").strip() or None
            phone = (payload.phone or "").strip() or None
            role = (payload.role or "").strip()

            if not full_name or not role:
                raise HTTPException(status_code=400, detail="staff requires full_name, role (staff_id auto-assigned when blank)")
            allowed_roles = {"Teacher", "Form Master", "Vice Principal", "Principal", "Admin"}
            if role not in allowed_roles:
                raise HTTPException(status_code=400, detail=f"role must be one of {', '.join(sorted(allowed_roles))}")

            # Lock the schools row (symmetry with students path) + read prefix.
            try:
                cur.execute("BEGIN;")
            except Exception:
                pass
            from services.db_manager import SCHOOLS_REGISTRY_TABLE as _schools_tbl

            cur.execute(
                f"SELECT COALESCE(staff_id_prefix, 'STAFF/') FROM {_schools_tbl} WHERE subdomain = %s FOR UPDATE;",
                (tid,),
            )
            _prow = cur.fetchone()
            if _prow is None:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail=f"Unknown tenant '{tid}'")
            # Effective prefix is always lowercase (staff/001 not STAFF/001).
            _prefix = ((_prow[0] if _prow else None) or "STAFF/").strip().lower() or "staff/"
            if not staff_id:
                # Blank ID → next sequential from the school's configured prefix.
                staff_id = _next_prefixed_ids(cur, _prefix, TENANT_STAFF_TABLE, "staff_id", 1, tid)[0]
            else:
                # Defensive de-duplication: strip a pasted full prefix once so
                # the stored ID never becomes "staff//001".
                if staff_id.lower().startswith(_prefix.lower()):
                    _suffix = staff_id[len(_prefix):].strip()
                    if _suffix:
                        staff_id = f"{_prefix}{_suffix}"
                # Lowercase prefix before slash (staff/001 not STAFF/001).
                if "/" in staff_id:
                    _pfx, _rest = staff_id.split("/", 1)
                    staff_id = _pfx.lower() + "/" + _rest
                else:
                    import re as _re_sid

                    _m_sid = _re_sid.match(r"^([A-Za-z]+)(.*)$", staff_id)
                    staff_id = (_m_sid.group(1).lower() + _m_sid.group(2)) if _m_sid else staff_id.lower()

            cur.execute(
                f"""
                INSERT INTO {TENANT_STAFF_TABLE} (subdomain, staff_id, full_name, email, phone, role, password_hash)
                VALUES (%s, %s, %s, %s, %s, %s, crypt('123456', gen_salt('bf')))
                RETURNING id, subdomain, staff_id, full_name, email, phone, role, created_at;
                """,
                (tid, staff_id, full_name, email, phone, role),
            )
            row = cur.fetchone()
            # Serialize FIRST: any statement executed after this (including the
            # forensic SELECT below) replaces cur.description, which would map
            # the row onto the wrong columns (KeyError 'id' incident).
            d = _row_to_dict(row, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            d["id"] = str(d["id"])
            # Forensic capture (silent-ghost incident): writer txn/pid BEFORE
            # commit, so a future guard trip can be correlated at the Postgres
            # layer (same xid visible elsewhere? different backend pid?).
            _w_txid = _w_pid = None
            try:
                cur.execute("SELECT txid_current(), pg_backend_pid();")
                _w_txid, _w_pid = cur.fetchone()
            except Exception:
                pass
            conn.commit()
            # Write-verification guard on a FRESH connection: re-reading on the
            # writer's own connection would see uncommitted rows and prove
            # nothing. A missing row here means the commit did not stick, so
            # fail loudly (500) instead of returning a false 201.
            _vconn = None
            _verified = False
            _v_txid = _v_pid = _v_total = None
            try:
                _vconn = _connect_as_superuser()
                _vcur = _vconn.cursor()
                _vcur.execute(
                    f"SELECT id FROM {TENANT_STAFF_TABLE} WHERE id = %s AND subdomain = %s;",
                    (d["id"], tid),
                )
                _verified = _vcur.fetchone() is not None
                _vcur.execute("SELECT txid_current(), pg_backend_pid();")
                _v_txid, _v_pid = _vcur.fetchone()
                _vcur.execute(
                    f"SELECT COUNT(*) FROM {TENANT_STAFF_TABLE} WHERE subdomain = %s;",
                    (tid,),
                )
                _v_total = int((_vcur.fetchone() or [0])[0] or 0)
            finally:
                if _vconn:
                    try:
                        _vconn.close()
                    except Exception:
                        pass
            if not _verified:
                logger.error(
                    f"[roster] staff write vanished post-commit for {tid}/{staff_id} "
                    f"writer_txid={_w_txid} writer_pid={_w_pid} "
                    f"verify_txid={_v_txid} verify_pid={_v_pid} verify_total={_v_total}"
                )
                raise HTTPException(status_code=500, detail="Staff save failed verification — please retry")
            return {"type": "staff", "record": d}

        if typ == "allocation":
            subject_name = (payload.subject_name or "").strip()
            staff_name = (payload.staff_name or "").strip()
            class_name = (payload.class_name or "").strip()

            if not subject_name or not staff_name or not class_name:
                raise HTTPException(status_code=400, detail="allocation requires subject_name, staff_name, class_name")

            cur.execute(
                f"""
                INSERT INTO {TENANT_ALLOCATIONS_TABLE} (subdomain, subject_name, staff_name, class_name)
                VALUES (%s, %s, %s, %s)
                RETURNING id, subdomain, subject_name, staff_name, class_name, created_at;
                """,
                (tid, subject_name, staff_name, class_name),
            )
            row = cur.fetchone()
            conn.commit()
            d = _row_to_dict(row, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            d["id"] = str(d["id"])
            return {"type": "allocation", "record": d}

        raise HTTPException(status_code=400, detail="Invalid type")

    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        # Unique violation -> friendly 409
        msg = str(e)
        if "duplicate key" in msg.lower() or "unique" in msg.lower():
            raise HTTPException(status_code=409, detail=msg)
        logger.exception(f"[roster] create failed for {tid} type {typ}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create {typ}: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# BATCH — bulk ingestion from parsed spreadsheets (JSON rows)
# ---------------------------------------------------------------------------

class BatchStudentRow(BaseModel):
    student_id: Opt[str] = None
    full_name: Opt[str] = None
    class_name: Opt[str] = None
    gender: Opt[str] = None


class BatchStaffRow(BaseModel):
    staff_id: Opt[str] = None
    full_name: Opt[str] = None
    email: Opt[str] = None
    phone: Opt[str] = None
    role: Opt[str] = None


class BatchSubjectRow(BaseModel):
    subject_name: Opt[str] = None


class BatchStudentsPayload(BaseModel):
    rows: List[BatchStudentRow] = Field(..., min_length=1, max_length=2000)


class BatchStaffPayload(BaseModel):
    rows: List[BatchStaffRow] = Field(..., min_length=1, max_length=2000)


class BatchSubjectsPayload(BaseModel):
    rows: List[BatchSubjectRow] = Field(..., min_length=1, max_length=2000)


def _next_prefixed_ids(cur, prefix: str, table: str, id_col: str, count: int, subdomain: str = "") -> list[str]:
    """Generate `count` sequential IDs (`PREFIX/001`, …) in ONE scan.

    Reads existing IDs with a LIKE scan, resumes from max(trailing_int)+1,
    and skips taken numbers. O(1) round-trips regardless of batch size.
    Matching is case-insensitive on the prefix; generated IDs preserve the
    configured prefix casing (e.g. STAFF/001).

    The prefix is normalized (trailing slashes stripped) so a configured
    `STAFF/` prefix mints `staff/001`, never `staff//001`. The scan is scoped
    to `subdomain` when given so other tenants' IDs can't shift sequencing.
    """
    import re as _re_seq

    prefix = (prefix or "").strip().rstrip("/")
    like_pattern = f"{prefix}/%"
    if subdomain:
        cur.execute(
            f"SELECT {id_col} FROM {table} WHERE subdomain = %s AND {id_col} ILIKE %s;",
            (subdomain, like_pattern),
        )
    else:
        cur.execute(
            f"SELECT {id_col} FROM {table} WHERE {id_col} ILIKE %s;",
            (like_pattern,),
        )
    taken: set[int] = set()
    prefix_lc = prefix.lower()
    for (existing_id,) in cur.fetchall():
        eid = str(existing_id or "")
        m = _re_seq.match(r"^(.+)/(\d+)$", eid)
        if m and m.group(1).lower() == prefix_lc:
            try:
                taken.add(int(m.group(2)))
            except ValueError:
                pass
    out: list[str] = []
    n = (max(taken) + 1) if taken else 1
    while len(out) < count:
        if n not in taken:
            out.append(f"{prefix}/{n:03d}")
            taken.add(n)
        n += 1
    return out


@router.post("/students/batch", status_code=201, summary="Bulk import students (atomic slot-checked)")
def batch_create_students(tenant_id: str, payload: BatchStudentsPayload):
    """All-or-nothing student import with server-side sequential IDs.

    Client-supplied IDs are ignored entirely — every row gets the next
    `{id_prefix}/NNN` from the tenant's configured prefix. Validates every
    row first (422 with per-row errors, nothing written), then runs ONE
    transaction: SELECT slots_balance FOR UPDATE, reject with 402 if
    used + new_count > balance, else insert + decrement + ledger.
    """
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    from services.db_manager import (
        TENANT_STUDENTS_TABLE,
        SCHOOLS_REGISTRY_TABLE,
        BILLING_LEDGER_TABLE,
        _connect_as_superuser,
    )
    from datetime import datetime

    # --- Phase 1: validate all rows (no DB writes) ---
    cleaned: list[dict] = []
    row_errors: list[dict] = []
    for idx, r in enumerate(payload.rows):
        name = (r.full_name or "").strip()
        cls = (r.class_name or "").strip()
        gender = (r.gender or "").strip() or None
        errs: list[str] = []
        if not name:
            errs.append("full_name is required")
        if not cls:
            errs.append("class_name is required")
        if gender and gender.lower() not in ("male", "female"):
            errs.append("gender must be Male or Female")
        if errs:
            row_errors.append({"row": idx + 2, "errors": errs})  # +2 = header + 1-index
            continue
        cleaned.append({"full_name": name, "class_name": cls, "gender": gender})
    if row_errors:
        raise HTTPException(status_code=422, detail={"message": f"{len(row_errors)} invalid row(s)", "row_errors": row_errors})

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        try:
            cur.execute("BEGIN;")
        except Exception:
            pass

        # --- Phase 2: atomic slot guard + prefix read (one locked row) ---
        cur.execute(
            f"SELECT slots_balance, COALESCE(id_prefix, %s) FROM {SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s FOR UPDATE;",
            (tid, tid),
        )
        srow = cur.fetchone()
        if srow is None:
            cur.execute("ROLLBACK;")
            raise HTTPException(status_code=404, detail=f"Unknown tenant '{tid}'")
        slots = int(srow[0] or 0)
        id_prefix = (srow[1] or tid).strip().lower() or tid

        # --- Phase 3: assign sequential IDs (O(1) scan) ---
        new_ids = _next_prefixed_ids(cur, id_prefix, TENANT_STUDENTS_TABLE, "student_id", len(cleaned), tid)
        fresh = [
            {
                "student_id": nid,
                "full_name": c["full_name"],
                "class_name": c["class_name"],
                "gender": c["gender"],
            }
            for c, nid in zip(cleaned, new_ids)
        ]

        cur.execute(f"SELECT COUNT(*) FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s;", (tid,))
        used = int(cur.fetchone()[0] or 0)
        need = len(fresh)
        if used + need > slots:
            cur.execute("ROLLBACK;")
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient slots. Need {need} for this batch, "
                    f"balance is {slots} ({used} slots used). "
                    f"Top up slots or reduce the batch — nothing was imported."
                ),
            )

        placeholders = ", ".join(["(%s, %s, %s, %s, %s)"] * len(fresh))
        flat: list = []
        for c in fresh:
            flat.extend([tid, c["student_id"], c["full_name"], c["class_name"], c["gender"]])
        cur.execute(
            f"""
            INSERT INTO {TENANT_STUDENTS_TABLE} (subdomain, student_id, full_name, class_name, gender)
            VALUES {placeholders}
            ON CONFLICT (subdomain, student_id) DO NOTHING
            RETURNING id;
            """,
            tuple(flat),
        )
        inserted = len(cur.fetchall())
        cur.execute(
            f"""
            UPDATE {SCHOOLS_REGISTRY_TABLE}
            SET slots_balance = slots_balance - %s, updated_at = NOW()
            WHERE subdomain = %s
            RETURNING slots_balance;
            """,
            (inserted, tid),
        )
        bal_row = cur.fetchone()
        ref = f"slot_batch:{tid}:{int(datetime.now().timestamp())}:{inserted}"
        cur.execute(
            f"""
            INSERT INTO {BILLING_LEDGER_TABLE}
                (subdomain, token_type, amount, transaction_type, reference_id, description)
            VALUES (%s, 'SLOT', %s, 'SLOT_CONSUMPTION', %s, %s)
            ON CONFLICT (reference_id) DO NOTHING;
            """,
            (tid, -inserted, ref, f"Bulk import: {inserted} student slot(s)"),
        )
        cur.execute("COMMIT;")
        return {
            "type": "students_batch",
            "inserted": inserted,
            "skipped": need - inserted,
            "requested": len(payload.rows),
            "slots_remaining": int(bal_row[0] or 0) if bal_row else slots - inserted,
            "id_prefix": id_prefix,
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        msg = str(e)
        if "duplicate key" in msg.lower() or "unique" in msg.lower():
            raise HTTPException(status_code=409, detail=msg)
        logger.exception(f"[roster] students batch failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Bulk student import failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/staff/batch", status_code=201, summary="Bulk import staff (server-assigned IDs)")
def batch_create_staff(tenant_id: str, payload: BatchStaffPayload):
    """Bulk staff import with server-side sequential IDs.

    Client-supplied staff_ids are ignored entirely — every row gets the next
    `{staff_id_prefix}/NNN` from the tenant's configured prefix (default
    STAFF/). Runs in one transaction with a schools-row lock so concurrent
    batches cannot mint duplicate IDs.
    """
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    from services.db_manager import TENANT_STAFF_TABLE, SCHOOLS_REGISTRY_TABLE, _connect_as_superuser

    allowed_roles = {"Teacher", "Form Master", "Vice Principal", "Principal", "Admin"}
    cleaned: list[dict] = []
    row_errors: list[dict] = []
    for idx, r in enumerate(payload.rows):
        name = (r.full_name or "").strip()
        role = (r.role or "").strip()
        errs: list[str] = []
        if not name:
            errs.append("full_name is required")
        if role not in allowed_roles:
            errs.append(f"role must be one of {', '.join(sorted(allowed_roles))}")
        if errs:
            row_errors.append({"row": idx + 2, "errors": errs})
            continue
        cleaned.append({
            "full_name": name,
            "email": (r.email or "").strip() or None,
            "phone": (r.phone or "").strip() or None,
            "role": role,
        })
    if row_errors:
        raise HTTPException(status_code=422, detail={"message": f"{len(row_errors)} invalid row(s)", "row_errors": row_errors})

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        try:
            cur.execute("BEGIN;")
        except Exception:
            pass

        # Lock the schools row (symmetry with students path) + read prefix
        cur.execute(
            f"SELECT COALESCE(staff_id_prefix, 'STAFF/') FROM {SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s FOR UPDATE;",
            (tid,),
        )
        srow = cur.fetchone()
        if srow is None:
            cur.execute("ROLLBACK;")
            raise HTTPException(status_code=404, detail=f"Unknown tenant '{tid}'")
        # Effective prefix is always lowercase (staff/001 not STAFF/001).
        staff_prefix = ((srow[0] or "STAFF/").strip().lower()) or "staff/"

        new_ids = _next_prefixed_ids(cur, staff_prefix, TENANT_STAFF_TABLE, "staff_id", len(cleaned), tid)
        placeholders = ", ".join(["(%s, %s, %s, %s, %s, %s, crypt('123456', gen_salt('bf')))"] * len(cleaned))
        flat: list = []
        for c, nid in zip(cleaned, new_ids):
            flat.extend([tid, nid, c["full_name"], c["email"], c["phone"], c["role"]])
        cur.execute(
            f"""
            INSERT INTO {TENANT_STAFF_TABLE} (subdomain, staff_id, full_name, email, phone, role, password_hash)
            VALUES {placeholders}
            ON CONFLICT (subdomain, staff_id) DO NOTHING
            RETURNING id;
            """,
            tuple(flat),
        )
        inserted = len(cur.fetchall())
        cur.execute("COMMIT;")
        return {
            "type": "staff_batch",
            "inserted": inserted,
            "skipped": len(cleaned) - inserted,
            "requested": len(payload.rows),
            "staff_id_prefix": staff_prefix,
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[roster] staff batch failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Bulk staff import failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


@router.post("/subjects/batch", status_code=201, summary="Bulk import subjects")
def batch_create_subjects(tenant_id: str, payload: BatchSubjectsPayload):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    from services.db_manager import TENANT_SUBJECTS_TABLE, _connect_as_superuser

    seen: dict[str, str] = {}
    for r in payload.rows:
        n = (r.subject_name or "").strip()
        if n and n.lower() not in seen:
            seen[n.lower()] = n
    uniq = list(seen.values())
    if not uniq:
        raise HTTPException(status_code=422, detail="No valid subject_name rows")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        placeholders = ", ".join(["(%s, %s)"] * len(uniq))
        flat: list[str] = []
        for n in uniq:
            flat.extend([tid, n])
        cur.execute(
            f"""
            INSERT INTO {TENANT_SUBJECTS_TABLE} (subdomain, subject_name)
            VALUES {placeholders}
            ON CONFLICT (subdomain, subject_name) DO NOTHING
            RETURNING id;
            """,
            tuple(flat),
        )
        inserted = len(cur.fetchall())
        conn.commit()
        return {
            "type": "subjects_batch",
            "inserted": inserted,
            "skipped": len(uniq) - inserted,
            "requested": len(payload.rows),
        }
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[roster] subjects batch failed for {tid}: {e}")
        raise HTTPException(status_code=500, detail=f"Bulk subject import failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# PATCH — update student/staff (partial, ID immutable)
# ---------------------------------------------------------------------------

class RosterPatch(BaseModel):
    full_name: Opt[str] = None
    class_name: Opt[str] = None
    gender: Opt[str] = None
    email: Opt[str] = None
    phone: Opt[str] = None
    role: Opt[str] = None


@router.patch("/{record_type}/{record_id}", summary="Update a roster record (partial)")
def update_roster_record(tenant_id: str, record_type: str, record_id: str, payload: RosterPatch):
    tid = _validate_tenant_id(tenant_id)

    if record_type not in ("student", "staff"):
        raise HTTPException(status_code=400, detail="record_type must be student or staff for PATCH")

    # Validate UUID
    import uuid

    try:
        uuid.UUID(record_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid record id (must be UUID)")

    # Build dynamic SET clause — sparse updates only provided fields
    updates: dict[str, object] = {}
    if record_type == "student":
        if payload.full_name is not None:
            v = payload.full_name.strip()
            if not v:
                raise HTTPException(status_code=400, detail="full_name cannot be empty")
            updates["full_name"] = v
        if payload.class_name is not None:
            v = payload.class_name.strip()
            if not v:
                raise HTTPException(status_code=400, detail="class_name cannot be empty")
            updates["class_name"] = v
        if payload.gender is not None:
            v = payload.gender.strip()
            if v and v.lower() not in ("male", "female"):
                raise HTTPException(status_code=400, detail="gender must be Male or Female")
            updates["gender"] = v or None
        if not updates:
            raise HTTPException(status_code=400, detail="No updatable fields provided (full_name, class_name, gender)")

        table = "tenant_students"
        returning = "id, subdomain, student_id, full_name, class_name, gender, created_at"

    else:  # staff
        if payload.full_name is not None:
            v = payload.full_name.strip()
            if not v:
                raise HTTPException(status_code=400, detail="full_name cannot be empty")
            updates["full_name"] = v
        if payload.email is not None:
            v = payload.email.strip()
            updates["email"] = v or None
        if payload.phone is not None:
            v = payload.phone.strip()
            updates["phone"] = v or None
        if payload.role is not None:
            v = payload.role.strip()
            allowed_roles = {"Teacher", "Form Master", "Vice Principal", "Principal", "Admin"}
            if v not in allowed_roles:
                raise HTTPException(status_code=400, detail=f"role must be one of {', '.join(sorted(allowed_roles))}")
            updates["role"] = v
        if not updates:
            raise HTTPException(status_code=400, detail="No updatable fields provided (full_name, email, phone, role)")

        table = "tenant_staff"
        returning = "id, subdomain, staff_id, full_name, email, phone, role, created_at"

    # Do NOT allow updating student_id / staff_id per spec (ID immutable)
    set_clause = ", ".join(f"{col} = %s" for col in updates)
    values = list(updates.values()) + [record_id, tid]

    from services.db_manager import _connect_as_superuser, _row_to_dict
    from datetime import datetime

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE {table} SET {set_clause} WHERE id = %s AND subdomain = %s RETURNING {returning};",
            tuple(values),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"{record_type} not found")
        row = cur.fetchone()
        conn.commit()
        d = _row_to_dict(row, cur)
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        d["id"] = str(d["id"])
        return {"type": record_type, "record": d}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[roster] patch failed {record_type} {record_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# DELETE — remove by type and id
# ---------------------------------------------------------------------------

@router.delete("/{record_type}/{record_id}", summary="Delete a roster record")
def delete_roster_record(tenant_id: str, record_type: str, record_id: str):
    tid = _validate_tenant_id(tenant_id)

    mapping = {
        "student": "tenant_students",
        "staff": "tenant_staff",
        "allocation": "tenant_allocations",
        "subject": "tenant_subjects",
        "form_assignment": "tenant_form_assignments",
    }
    table = mapping.get(record_type)
    if not table:
        raise HTTPException(status_code=400, detail="record_type must be student|staff|allocation|subject|form_assignment")

    # Validate UUID
    import uuid

    try:
        uuid.UUID(record_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid record id (must be UUID)")

    from services.db_manager import _connect_as_superuser

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        # For student deletes, refund the slot (capacity returned)
        if record_type == "student":
            cur.execute("BEGIN;")
            # Fetch student_id for ledger description before deleting
            cur.execute(
                f"SELECT student_id FROM {table} WHERE id = %s AND subdomain = %s;",
                (record_id, tid),
            )
            srow = cur.fetchone()
            if srow is None:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail=f"{record_type} not found")
            sid = str(srow[0])
            cur.execute(
                f"DELETE FROM {table} WHERE id = %s AND subdomain = %s RETURNING id;",
                (record_id, tid),
            )
            if cur.rowcount == 0:
                cur.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail=f"{record_type} not found")
            # Refund slot
            from services.db_manager import SCHOOLS_REGISTRY_TABLE, BILLING_LEDGER_TABLE

            cur.execute(
                f"""
                UPDATE {SCHOOLS_REGISTRY_TABLE}
                SET slots_balance = COALESCE(slots_balance, 0) + 1, updated_at = NOW()
                WHERE subdomain = %s
                RETURNING slots_balance;
                """,
                (tid,),
            )
            new_slots_row = cur.fetchone()
            ref = f"slot_refund:{tid}:{sid}:{record_id}"
            cur.execute(
                f"""
                INSERT INTO {BILLING_LEDGER_TABLE}
                    (subdomain, token_type, amount, transaction_type, reference_id, description)
                VALUES (%s, 'SLOT', 1, 'SLOT_REFUND', %s, %s)
                ON CONFLICT (reference_id) DO NOTHING;
                """,
                (tid, ref, f"Slot refund for deleted student {sid}"),
            )
            cur.execute("COMMIT;")
            return {
                "success": True,
                "deleted": record_id,
                "type": record_type,
                "slots_refunded": 1,
                "slots_balance": int(new_slots_row[0] or 0) if new_slots_row else None,
            }
        # Non-student deletes (no slot refund)
        cur.execute(
            f"DELETE FROM {table} WHERE id = %s AND subdomain = %s RETURNING id;",
            (record_id, tid),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"{record_type} not found")
        conn.commit()
        return {"success": True, "deleted": record_id, "type": record_type}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception(f"[roster] delete failed {record_type} {record_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
