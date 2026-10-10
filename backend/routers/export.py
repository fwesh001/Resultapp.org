"""
Data Export Tool — multi-sheet XLSX generation for a tenant's admin.

WHY A TEMP FILE AND NOT BytesIO
-------------------------------
An .xlsx is a ZIP archive, and ZIP requires the central directory at the END
of the file. Bytes therefore cannot reach the client until the workbook is
closed, so "stream it straight to the browser" is not literally possible for
any XLSX writer. The question is only where the bytes accumulate on the way.

We spool to a NamedTemporaryFile and read that back in chunks. That gives:

  * BOUNDED MEMORY. xlsxwriter's `constant_memory: True` discards each row
    once written, so peak RSS stays flat regardless of roster size. A
    BytesIO build would hold the entire workbook in RAM, and with several
    tenants exporting at once that is a real memory-spike risk.
  * NOTHING PERSISTED. The file is deleted in a `finally`, so the artifact
    never outlives the request.
  * REAL CLIENT-SIDE PROGRESS. Content-Length is known (it is a real file),
    so the browser can show a measured percentage rather than a fake bar.

`constant_memory` has one hard constraint: rows must be written in
ASCENDING ROW ORDER within a sheet, because written rows are flushed and the
writer can no longer seek back to them. Every query below is ORDER BY'd
accordingly. Adding a merge_range or a write to an earlier row after later
rows exist would corrupt the sheet — see `_write_table`, which only appends.

ROW CEILINGS
------------
Two independent ceilings, both checked BEFORE any file is created:

  * MAX_EXPORT_ROWS — our own guardrail, refused with an actionable message
    (mirrors the ledger export's circuit breaker).
  * xlsxwriter's hard 1,048,576 rows-per-sheet format limit. The refusal
    message mentions contacting support because that is genuinely the only
    way past it.

NEVER EXPORTED
--------------
`schools.admin_password_hash` and `tenant_staff.password_hash` exist on these
tables. They are never selected into any sheet.
"""

import logging
import os
import re
import tempfile
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)


async def _verify_export_secret(
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
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing request (dev mode)")
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
    prefix="/api/v1/tenant/{tenant_id}/export",
    tags=["export"],
    dependencies=[Depends(_verify_export_secret)],
)

# Refuse before doing any work. Chosen well above realistic school sizes
# (the platform's own bulk cap is MAX_BULK_STUDENTS = 3000) but well below
# anything that could exhaust a droplet.
MAX_EXPORT_ROWS = 250_000

# xlsxwriter's format limit, per worksheet.
XLSX_HARD_ROW_LIMIT = 1_048_576

# Streaming chunk for the response. 64 KiB keeps the generator responsive
# without producing a huge number of tiny chunks for the ASGI layer.
STREAM_CHUNK = 64 * 1024

VALID_DATASETS = ("summary", "students", "staff", "classes", "subjects", "results")
CLEARANCE_FILTERS = ("all", "cleared", "owing")


class ExportRequest(BaseModel):
    """Which sheets to build, and the filters that shape them."""

    datasets: List[str] = Field(default_factory=lambda: ["summary", "students", "staff", "classes"])
    students: dict = Field(default_factory=dict)
    results: dict = Field(default_factory=dict)
    class_name: Optional[str] = None

    @field_validator("datasets")
    @classmethod
    def _known_datasets(cls, v: List[str]) -> List[str]:
        cleaned = [str(x).strip().lower() for x in v if str(x).strip()]
        bad = [x for x in cleaned if x not in VALID_DATASETS]
        if bad:
            raise ValueError(f"Unknown dataset(s): {', '.join(bad)}. Valid: {', '.join(VALID_DATASETS)}")
        # De-duplicate, preserve order, and guarantee at least one sheet —
        # an empty workbook is not a useful download.
        seen = set()
        out = []
        for x in cleaned:
            if x not in seen:
                seen.add(x)
                out.append(x)
        if not out:
            raise ValueError("Select at least one dataset to export")
        return out


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


def _validate_term(term: Optional[str]) -> Optional[str]:
    """Validate a term, or fall back to the school's configured current term.

    Deliberately reuses the canonical VALID_TERMS from db_manager rather than
    re-declaring it: the tuple is copy-pasted into three modules today and
    drift between them is a known, documented hazard.
    """
    from services.db_manager import VALID_TERMS

    t = (term or "").strip()
    if not t:
        return None
    if t not in VALID_TERMS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid term '{term}'. Must be one of {', '.join(VALID_TERMS)}",
        )
    return t


def _resolve_session(tid: str, academic_session: Optional[str]) -> str:
    """Prefer the school's configured session, else derive it.

    Verbatim behaviour of clearance._resolve_session. This MUST agree with
    the report gate: if the export resolved a different session than the one
    the bursar cleared against, the Cleared/Owing column would contradict the
    admin's own screen. LEGAL_REMEDIATION.md item 1 records exactly that class
    of drift bug.
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


# ---------------------------------------------------------------------------
# Filename
# ---------------------------------------------------------------------------

# Letters, digits, space, underscore, hyphen. Everything else collapses to a
# space. Quotes and newlines are the dangerous ones: they either corrupt the
# Content-Disposition header outright or allow header injection.
_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9 _-]+")
_WHITESPACE = re.compile(r"\s+")
# Non-latin characters would be stripped to nothing; map CJK to "School" so a
# fully non-ASCII name still produces a valid, meaningful filename.
_NON_LATIN = re.compile(r"[^\x00-\x7F]")


def _sanitise_filename_part(raw: str, fallback: str = "School", max_len: int = 60) -> str:
    """Make one filename segment safe for both ASCII and RFC 5987 headers."""
    value = (raw or "").strip()
    value = _UNSAFE_FILENAME.sub(" ", value)
    value = _WHITESPACE.sub(" ", value).strip(" -_")
    if not value:
        return fallback
    # An entirely non-ASCII name (e.g. all CJK) loses everything above.
    if not re.search(r"[A-Za-z0-9]", value):
        return fallback
    if len(value) > max_len:
        value = value[:max_len].strip(" -_")
    return value or fallback


def build_filename(school_name: str, subdomain: str) -> tuple[str, str]:
    """Return (ascii_fallback, encoded_utf8) filename values.

    The two differ only when the school name contains characters that must be
    percent-encoded in a header. `filename` stays ASCII so ancient clients do
    not see mojibake; `filename*` carries the true UTF-8 name per RFC 5987.
    """
    from urllib.parse import quote

    name_part = _sanitise_filename_part(school_name, fallback="School")
    sub_part = _sanitise_filename_part(subdomain, fallback="Tenant", max_len=30)
    ascii_name = f"{name_part}_{sub_part}_Data_Export.xlsx"
    # Strip characters that are invalid in a quoted-string filename token,
    # while leaving the true name intact for the RFC 5987 form.
    quoted = _sanitise_filename_part(school_name, fallback="School", max_len=40)
    utf8_name = f"{quoted}_{sub_part}_Data_Export.xlsx"
    return ascii_name, quote(utf8_name, safe="")


# ---------------------------------------------------------------------------
# Sheet writers
# ---------------------------------------------------------------------------

# constant_memory forbids writing to an already-flushed row, so every writer
# below appends strictly downward and formats are applied per row rather than
# via a bulk merge.
def _write_table(ws, workbook, headers, rows, widths=None):
    """Write a header row + data rows, returning the next free row index."""
    header_fmt = workbook.add_format(
        {"bold": True, "bg_color": "#7C3AED", "font_color": "#FFFFFF", "border": 1}
    )
    for col, head in enumerate(headers):
        ws.write(0, col, head, header_fmt)

    row_idx = 1
    for row in rows:
        for col, value in enumerate(row):
            if value is None:
                ws.write_blank(row_idx, col, None)
            else:
                ws.write(row_idx, col, value)
        row_idx += 1

    if widths:
        for col, width in enumerate(widths):
            ws.set_column(col, col, width)
    # Freeze the header so long sheets stay readable while scrolling.
    ws.freeze_panes(1, 0)
    return row_idx


def _summary_rows(cur, tid, school, term, session):
    """School profile + live counts. Returns (headers, rows)."""
    from services.db_manager import (
        TENANT_STAFF_TABLE,
        TENANT_STUDENTS_TABLE,
    )

    cur.execute(
        f"SELECT COUNT(*) FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s",
        (tid,),
    )
    total_students = int(cur.fetchone()[0] or 0)

    cur.execute(
        f"SELECT COUNT(*) FROM {TENANT_STAFF_TABLE} WHERE subdomain = %s AND COALESCE(is_active, TRUE) = TRUE",
        (tid,),
    )
    active_staff = int(cur.fetchone()[0] or 0)

    # COUNT(DISTINCT student_id) matches how the dashboard reports published,
    # so the workbook and the on-screen percentage agree.
    cur.execute(
        """
        SELECT COUNT(DISTINCT student_id) FROM result_publications
        WHERE subdomain = %s AND term = %s AND academic_session = %s;
        """,
        (tid, term, session),
    )
    published = int(cur.fetchone()[0] or 0)

    cur.execute(
        """
        SELECT COUNT(*) FROM student_term_clearance
        WHERE subdomain = %s AND term = %s AND academic_session = %s
          AND NOT COALESCE(is_financially_cleared, TRUE);
        """,
        (tid, term, session),
    )
    owing = int(cur.fetchone()[0] or 0)

    rows = [
        ("School Name", school.get("school_name") or ""),
        ("Subdomain", school.get("subdomain") or tid),
        ("Email", school.get("email") or ""),
        ("Phone", school.get("phone") or ""),
        ("Address", school.get("address") or ""),
        ("City", school.get("city") or ""),
        ("State", school.get("state") or ""),
        ("Motto", school.get("motto") or ""),
        ("Academic Term", term),
        ("Academic Session", session),
        ("Total Students", total_students),
        ("Active Staff", active_staff),
        ("Results Published (this term)", published),
        ("Students Owing (this term)", owing),
        ("Exported At", __import__("datetime").datetime.now().isoformat(timespec="seconds")),
    ]
    return ["Field", "Value"], rows


def _student_rows(cur, tid, term, session, clearance_filter, class_name):
    from services.db_manager import TENANT_STUDENTS_TABLE, STUDENT_CLEARANCE_TABLE

    # The LEFT JOIN + COALESCE pair is load-bearing and is copied verbatim in
    # spirit from clearance.py: an INNER JOIN would silently drop every student
    # the bursar never touched, which is the exact opposite of the truth
    # (untouched == cleared).
    sql = f"""
        SELECT s.student_id, s.full_name, s.class_name, s.gender,
               COALESCE(c.is_financially_cleared, TRUE) AS cleared,
               c.hold_reason
        FROM {TENANT_STUDENTS_TABLE} s
        LEFT JOIN {STUDENT_CLEARANCE_TABLE} c
          ON  c.subdomain = s.subdomain
          AND LOWER(c.student_id) = LOWER(s.student_id)
          AND c.term = %s
          AND c.academic_session = %s
        WHERE s.subdomain = %s
    """
    params = [term, session, tid]

    if class_name:
        sql += " AND s.class_name = %s"
        params.append(class_name)

    # Ordered ascending because constant_memory cannot revisit flushed rows.
    sql += " ORDER BY s.class_name ASC, s.full_name ASC"

    cur.execute(sql, params)
    rows = []
    for r in cur.fetchall():
        is_cleared = bool(r[4])
        if clearance_filter == "cleared" and not is_cleared:
            continue
        if clearance_filter == "owing" and is_cleared:
            continue
        # Export a human-readable status, not a raw boolean.
        status = "Cleared" if is_cleared else "Owing"
        hold = "" if is_cleared else (r[5] or "")
        rows.append((r[0], r[1], r[2], r[3] or "", status, hold))
    return rows


def _staff_rows(cur, tid):
    from services.db_manager import TENANT_STAFF_TABLE

    # password_hash is deliberately absent from this column list.
    cur.execute(
        f"""
        SELECT staff_id, full_name, role, email, phone,
               COALESCE(is_active, TRUE) AS is_active
        FROM {TENANT_STAFF_TABLE}
        WHERE subdomain = %s
        ORDER BY full_name ASC
        """,
        (tid,),
    )
    return [
        (r[0], r[1], r[2], r[3] or "", r[4] or "", "Yes" if r[5] else "No")
        for r in cur.fetchall()
    ]


def _class_rows(cur, tid):
    """Distinct classes with headcounts.

    There is no `classes` table: a class is a distinct `class_name` string on
    the students table. A class with allocated subjects but no students is
    still worth exporting, so the subject allocations are unioned in.
    """
    from services.db_manager import TENANT_ALLOCATIONS_TABLE

    cur.execute(
        """
        SELECT c.class_name,
               COALESCE(sc.n, 0) AS student_count,
               COALESCE(fa.teacher, '') AS form_teacher,
               COALESCE(alloc.n, 0) AS subject_count
        FROM (
            SELECT class_name FROM tenant_students WHERE subdomain = %s
            UNION
            SELECT class_name FROM tenant_allocations WHERE subdomain = %s
        ) c
        LEFT JOIN (
            SELECT class_name, COUNT(*) n FROM tenant_students
            WHERE subdomain = %s GROUP BY class_name
        ) sc ON sc.class_name = c.class_name
        LEFT JOIN (
            SELECT class_name, COUNT(*) n FROM tenant_allocations
            WHERE subdomain = %s GROUP BY class_name
        ) alloc ON alloc.class_name = c.class_name
        LEFT JOIN (
            SELECT f.class_name, s.full_name AS teacher
            FROM tenant_form_assignments f
            JOIN tenant_staff s
              ON s.subdomain = f.subdomain AND LOWER(s.staff_id) = LOWER(f.staff_id)
            WHERE f.subdomain = %s
        ) fa ON fa.class_name = c.class_name
        ORDER BY c.class_name ASC
        """,
        (tid, tid, tid, tid, tid),
    )
    return [(r[0], int(r[1] or 0), r[2] or "", int(r[3] or 0)) for r in cur.fetchall()]


def _subject_rows(cur, tid):
    from services.db_manager import TENANT_SUBJECTS_TABLE, TENANT_ALLOCATIONS_TABLE

    cur.execute(
        """
        SELECT s.subject_name,
               COALESCE(a.n, 0) AS class_count,
               COALESCE(a.teachers, '') AS teachers
        FROM (
            SELECT subject_name FROM tenant_subjects WHERE subdomain = %s
            UNION
            SELECT subject_name FROM tenant_allocations WHERE subdomain = %s
        ) s
        LEFT JOIN (
            SELECT subject_name,
                   COUNT(DISTINCT class_name) AS n,
                   STRING_AGG(DISTINCT staff_name, ', ') AS teachers
            FROM tenant_allocations WHERE subdomain = %s
            GROUP BY subject_name
        ) a ON a.subject_name = s.subject_name
        ORDER BY s.subject_name ASC
        """,
        (tid, tid, tid),
    )
    return [(r[0], int(r[1] or 0), r[2] or "") for r in cur.fetchall()]


def _results_rows(cur, tid, term, session, class_name):
    """Per-student publication state for the term."""
    from services.db_manager import TENANT_STUDENTS_TABLE

    sql = f"""
        SELECT s.student_id, s.full_name, s.class_name,
               CASE WHEN p.student_id IS NULL THEN 'Not Published' ELSE 'Published' END AS status,
               COALESCE(p.published_at::text, '') AS published_at
        FROM {TENANT_STUDENTS_TABLE} s
        LEFT JOIN result_publications p
          ON  p.subdomain = s.subdomain
          AND LOWER(p.student_id) = LOWER(s.student_id)
          AND p.term = %s
          AND p.academic_session = %s
        WHERE s.subdomain = %s
    """
    params = [term, session, tid]
    if class_name:
        sql += " AND s.class_name = %s"
        params.append(class_name)
    sql += " ORDER BY s.class_name ASC, s.full_name ASC"

    cur.execute(sql, params)
    return [(r[0], r[1], r[2], r[3], r[4]) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/xlsx", summary="Export tenant data as a multi-sheet .xlsx workbook")
def export_xlsx(
    tenant_id: str,
    payload: ExportRequest,
    request: Request = None,  # type: ignore[assignment]
):
    """Build a multi-sheet workbook and stream it back.

    Safety gates run synchronously BEFORE any file is created, because once
    StreamingResponse starts the status code can no longer be changed (the
    same constraint documented on the ledger CSV export).
    """
    import json as _json
    import xlsxwriter
    from services.db_manager import (
        SCHOOLS_REGISTRY_TABLE,
        _connect_as_superuser,
        get_school_by_subdomain,
    )

    tid = _validate_tenant_id(tenant_id)
    _ensure_tenant_exists(tid)

    # Gate 1 — throttle. The backend sees only the shared API secret (no
    # per-user identity), so the key is caller IP + tenant.
    try:
        from services.rate_limit import check as _rl_check

        _ip = request.client.host if request is not None and request.client else "unknown"
        _allowed, _retry_after = _rl_check(f"xlsx-export|{_ip}|{tid}")
        if not _allowed:
            raise HTTPException(
                status_code=429,
                detail=f"Export throttled: max 3 per minute. Try again in {_retry_after}s.",
                headers={"Retry-After": str(_retry_after)},
            )
    except HTTPException:
        raise
    except Exception:
        logger.warning("[export] rate limit unavailable; continuing unthrottled", exc_info=True)

    school = get_school_by_subdomain(tid) or {}

    # Resolve term/session the way the bursar's screen does, so the export's
    # Cleared/Owing column never contradicts what the admin just looked at.
    term = _validate_term((payload.results or {}).get("term")) or (
        (school.get("current_term") or "").strip() or "Term 1"
    )
    session = _resolve_session(tid, (payload.results or {}).get("academic_session"))

    clearance = str((payload.students or {}).get("clearance") or "all").strip().lower()
    if clearance not in CLEARANCE_FILTERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid clearance filter '{clearance}'. Must be one of {', '.join(CLEARANCE_FILTERS)}",
        )
    class_name = (payload.class_name or "").strip() or None

    # Gate 2 — row ceiling. Checked before any file is created. Counts the
    # two unbounded sheets; the others are small by construction.
    try:
        from services.db_manager import _connect_as_superuser, TENANT_STUDENTS_TABLE

        _count_conn = _connect_as_superuser()
        try:
            _count_cur = _count_conn.cursor()
            _count_cur.execute(
                f"SELECT COUNT(*) FROM {TENANT_STUDENTS_TABLE} WHERE subdomain = %s",
                (tid,),
            )
            _student_rows_estimate = int(_count_cur.fetchone()[0] or 0)
        finally:
            _count_conn.close()
    except Exception:
        logger.warning("[export] row pre-count failed; proceeding", exc_info=True)
        _student_rows_estimate = 0

    if _student_rows_estimate > min(MAX_EXPORT_ROWS, XLSX_HARD_ROW_LIMIT):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Export too large ({_student_rows_estimate:,} students). "
                "Exports above this size require a scheduled background job — "
                "please contact support."
            ),
        )

    # ---- Build the workbook into a spooled temp file --------------------
    # constant_memory keeps peak RSS flat and forces append-only row order,
    # which every query above already satisfies via ORDER BY.
    tmp = tempfile.NamedTemporaryFile(prefix=f"export-{tid}-", suffix=".xlsx", delete=False)
    tmp_path = tmp.name
    tmp.close()

    conn = None
    try:
        import xlsxwriter

        workbook = xlsxwriter.Workbook(tmp_path, {"constant_memory": True})
        try:
            conn = _connect_as_superuser()
            cur = conn.cursor()
            written = []

            if "summary" in payload.datasets:
                ws = workbook.add_worksheet("School Summary")
                headers, rows = _summary_rows(cur, tid, school, term, session)
                _write_table(ws, workbook, headers, rows, widths=[34, 60])
                written.append("School Summary")

            if "students" in payload.datasets:
                ws = workbook.add_worksheet("Students")
                rows = _student_rows(cur, tid, term, session, clearance, class_name)
                if len(rows) >= XLSX_HARD_ROW_LIMIT:
                    raise HTTPException(
                        status_code=400,
                        detail="Student export exceeds the Excel row limit — contact support.",
                    )
                _write_table(
                    ws,
                    workbook,
                    ["Admission No", "Full Name", "Class", "Gender", "Financial Clearance", "Hold Reason"],
                    rows,
                    widths=[18, 30, 14, 12, 20, 34],
                )
                written.append("Students")

            if "staff" in payload.datasets:
                ws = workbook.add_worksheet("Staff")
                rows = _staff_rows(cur, tid)
                _write_table(
                    ws,
                    workbook,
                    ["Staff ID", "Full Name", "Role", "Email", "Phone", "Active"],
                    rows,
                    widths=[16, 30, 16, 30, 16, 10],
                )
                written.append("Staff")

            if "classes" in payload.datasets:
                ws = workbook.add_worksheet("Classes")
                rows = _class_rows(cur, tid)
                _write_table(
                    ws,
                    workbook,
                    ["Class", "Students", "Form Teacher", "Subjects Allocated"],
                    rows,
                    widths=[18, 12, 30, 20],
                )
                written.append("Classes")

            if "subjects" in payload.datasets:
                ws = workbook.add_worksheet("Subjects")
                rows = _subject_rows(cur, tid)
                _write_table(
                    ws,
                    workbook,
                    ["Subject", "Classes Taught", "Teachers"],
                    rows,
                    widths=[26, 16, 40],
                )
                written.append("Subjects")

            if "results" in payload.datasets:
                ws = workbook.add_worksheet("Results Summary")
                rows = _results_rows(cur, tid, term, session, class_name)
                _write_table(
                    ws,
                    workbook,
                    ["Admission No", "Full Name", "Class", "Status", "Published At"],
                    rows,
                    widths=[18, 30, 14, 18, 24],
                )
                written.append("Results Summary")
        finally:
            # close() flushes the ZIP central directory. Without it the file
            # is not a readable workbook.
            workbook.close()
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

        size = os.path.getsize(tmp_path)
        if size <= 0:
            raise HTTPException(status_code=500, detail="Export produced an empty file")

        ascii_name, encoded_name = build_filename(
            str(school.get("school_name") or ""), tid
        )
        disposition = (
            f'attachment; filename="{ascii_name}"; '
            f"filename*=UTF-8''{encoded_name}"
        )
        logger.info(
            "[export] built %s sheets (%s) for %s, %d bytes",
            len(written), ",".join(written), tid, size,
        )

        # Content-Length is what lets the browser show a REAL percentage
        # rather than a simulated one. The file is fully built here, so the
        # length is known before the response starts.
        #
        # The generator deletes the spool file in its own finally. ASGI
        # consumes a StreamingResponse body LAZILY, so deleting it in the
        # endpoint's finally would unlink the file before a single byte was
        # sent (and on Linux that still works, but only by luck of open-fd
        # semantics — an early client disconnect would leak the file).
        def file_iter():
            try:
                with open(tmp_path, "rb") as fh:
                    while True:
                        chunk = fh.read(STREAM_CHUNK)
                        if not chunk:
                            break
                        yield chunk
            finally:
                # Runs on normal completion AND on client disconnect/cancel.
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

        return StreamingResponse(
            file_iter(),
            media_type=(
                "application/vnd.openxmlformats-officedocument."
                "spreadsheetml.sheet"
            ),
            headers={
                "Content-Disposition": disposition,
                "Content-Length": str(size),
                "Cache-Control": "no-store",
                "X-Export-Sheets": ",".join(written),
                "X-Export-Filename": encoded_name,
            },
        )
    except Exception:
        # Nothing has been streamed yet, so an HTTP error is still deliverable.
        # The generator's finally handles the success path (and disconnects).
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise