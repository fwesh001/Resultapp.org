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

@router.get("", summary="List students, staff, allocations, subjects for tenant")
def list_roster(tenant_id: str):
    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    from services.db_manager import (
        TENANT_STUDENTS_TABLE,
        TENANT_STAFF_TABLE,
        TENANT_ALLOCATIONS_TABLE,
        TENANT_SUBJECTS_TABLE,
        _connect_as_superuser,
    )

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
    type: Literal["student", "staff", "allocation", "subject", "bulk_subjects"] = Field(..., description='Record type')
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
        _connect_as_superuser,
        _row_to_dict,
    )
    from datetime import datetime

    typ = payload.type

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()

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
            student_id = (payload.student_id or "").strip()
            full_name = (payload.full_name or "").strip()
            class_name = (payload.class_name or "").strip()
            gender = (payload.gender or "").strip() or None

            if not student_id or not full_name or not class_name:
                raise HTTPException(status_code=400, detail="student requires student_id, full_name, class_name")
            if gender and gender.lower() not in ("male", "female"):
                raise HTTPException(status_code=400, detail="gender must be Male or Female")

            cur.execute(
                f"""
                INSERT INTO {TENANT_STUDENTS_TABLE} (subdomain, student_id, full_name, class_name, gender)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, subdomain, student_id, full_name, class_name, gender, created_at;
                """,
                (tid, student_id, full_name, class_name, gender),
            )
            row = cur.fetchone()
            conn.commit()
            d = _row_to_dict(row, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            d["id"] = str(d["id"])
            return {"type": "student", "record": d}

        if typ == "staff":
            staff_id = (payload.staff_id or "").strip()
            full_name = (payload.full_name or "").strip()
            email = (payload.email or "").strip() or None
            phone = (payload.phone or "").strip() or None
            role = (payload.role or "").strip()

            if not staff_id or not full_name or not role:
                raise HTTPException(status_code=400, detail="staff requires staff_id, full_name, role")
            allowed_roles = {"Teacher", "Form Master", "Vice Principal", "Principal", "Admin"}
            if role not in allowed_roles:
                raise HTTPException(status_code=400, detail=f"role must be one of {', '.join(sorted(allowed_roles))}")

            cur.execute(
                f"""
                INSERT INTO {TENANT_STAFF_TABLE} (subdomain, staff_id, full_name, email, phone, role)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, subdomain, staff_id, full_name, email, phone, role, created_at;
                """,
                (tid, staff_id, full_name, email, phone, role),
            )
            row = cur.fetchone()
            conn.commit()
            d = _row_to_dict(row, cur)
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            d["id"] = str(d["id"])
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
    }
    table = mapping.get(record_type)
    if not table:
        raise HTTPException(status_code=400, detail="record_type must be student|staff|allocation|subject")

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
        # Use f-string for table (whitelisted) + %s for values
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
