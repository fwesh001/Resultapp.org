"""
Template-Driven Notification Engine — compilation & trigger service (Phase 2).

- `render_template` replaces {{var}} placeholders from a context dict.
- `dispatch_event(event_type, tenant_id, context)` compiles a template from
  `notification_templates` and fans out inbox rows into `notification_reads`.
- `dispatch_manual(...)` compiles no template (Phase 3 broadcast authoring).
- `fire_credit_threshold_alerts(...)` maps a post-publish balance to
  LOW_CREDITS (1-10) / ZERO_CREDITS (0). Best-effort, never raises.

Fan-out contract (Global Broadcast):
- tenant dispatch (tenant_id="vhs"): recipients = schools admin email +
  all active tenant_staff rows for that subdomain.
- platform broadcast (tenant_id=None): recipients = admin email of EVERY
  non-deleted school + EVERY active staff row platform-wide. The
  `notifications` row stores tenant_id=NULL, but each `notification_reads`
  row stores that user's OWN subdomain so frontend inbox queries stay
  scoped (`WHERE tenant_id = %s AND user_id = %s`) and index-friendly.

Identity:
- staff user_id = tenant_staff.id::text (UUID). Inbox GET resolves any
  staff identifier (id | staff_id | email) to this canonical id first,
  mirroring routers/staff_auth.py dashboard resolution.
- admin user_id = LOWER(schools.email), user_type='admin'.
"""

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

#: Balance at or below which LOW_CREDITS fires (above zero).
LOW_CREDITS_THRESHOLD = 10


# ---------------------------------------------------------------------------
# Template rendering
# ---------------------------------------------------------------------------

def render_template(template: str, context: Dict[str, Any]) -> str:
    """Replace {{var}} placeholders using context. Missing keys → "".

    Never raises on bad input — returns the template unchanged if empty.
    """
    if not template:
        return ""
    ctx = context or {}

    def _replace(match: "re.Match") -> str:
        key = match.group(1)
        value = ctx.get(key, "")
        if value is None:
            return ""
        return str(value)

    return PLACEHOLDER_RE.sub(_replace, template)


# ---------------------------------------------------------------------------
# Recipient collection (raw psycopg2 cursor, caller owns the transaction)
# ---------------------------------------------------------------------------

VALID_TARGET_ROLES = ("all", "admin_only")


def _collect_recipients(
    cur,
    tenant_id: Optional[str],
    target_role: str = "all",
) -> List[Tuple[str, str, str]]:
    """Return [(tenant_subdomain, user_id, user_type)] for dispatch.

    tenant_id=None → platform-wide broadcast (all non-deleted schools).
    target_role='admin_only' → Tenant Admin emails ONLY (schools table);
    the tenant_staff query is skipped entirely.
    """
    from services.db_manager import (
        SCHOOLS_REGISTRY_TABLE,
        TENANT_STAFF_TABLE,
        _sanitize_subdomain,
    )

    role = (target_role or "all").strip().lower()
    if role not in VALID_TARGET_ROLES:
        raise ValueError(f"target_role must be one of {list(VALID_TARGET_ROLES)}")

    recipients: List[Tuple[str, str, str]] = []
    if tenant_id is None:
        # Broadcast: every admin email (+ every active staff unless admin_only).
        cur.execute(
            f"""
            SELECT subdomain, email FROM {SCHOOLS_REGISTRY_TABLE}
            WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> '';
            """
        )
        for subdomain, email in cur.fetchall():
            recipients.append((subdomain, str(email).strip().lower(), "admin"))
        if role == "admin_only":
            return recipients
        cur.execute(
            f"""
            SELECT subdomain, id::text FROM {TENANT_STAFF_TABLE} s
            WHERE COALESCE(s.is_active, TRUE) = TRUE
              AND EXISTS (
                SELECT 1 FROM {SCHOOLS_REGISTRY_TABLE} sch
                WHERE sch.subdomain = s.subdomain AND sch.deleted_at IS NULL
              );
            """
        )
        for subdomain, uid in cur.fetchall():
            recipients.append((subdomain, str(uid), "staff"))
        return recipients

    tid = _sanitize_subdomain(tenant_id)
    cur.execute(
        f"SELECT email FROM {SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s;",
        (tid,),
    )
    row = cur.fetchone()
    if row is None:
        raise ValueError(f"Unknown tenant '{tid}'")
    if row[0]:
        recipients.append((tid, str(row[0]).strip().lower(), "admin"))
    if role == "admin_only":
        return recipients
    cur.execute(
        f"""
        SELECT id::text FROM {TENANT_STAFF_TABLE}
        WHERE subdomain = %s AND COALESCE(is_active, TRUE) = TRUE;
        """,
        (tid,),
    )
    for (uid,) in cur.fetchall():
        recipients.append((tid, str(uid), "staff"))
    return recipients


# ---------------------------------------------------------------------------
# Core dispatch
# ---------------------------------------------------------------------------

def resolve_staff_user_id(cur, tenant_id: str, identifier: str) -> str:
    """Resolve any staff identifier to canonical tenant_staff.id::text.

    Accepts id | staff_id | email within the tenant. Raises ValueError
    when no active staff row matches (service-level equivalent of the
    inbox router's _resolve_user_id, without HTTP semantics).
    """
    from services.db_manager import TENANT_STAFF_TABLE, _sanitize_subdomain

    tid = _sanitize_subdomain(tenant_id)
    ident = (identifier or "").strip()
    if not ident:
        raise ValueError("target staff identifier is required")
    cur.execute(
        f"""
        SELECT id::text FROM {TENANT_STAFF_TABLE}
        WHERE subdomain = %s AND COALESCE(is_active, TRUE) = TRUE
          AND (id::text = %s OR staff_id = %s OR email = %s)
        LIMIT 1;
        """,
        (tid, ident, ident, ident),
    )
    row = cur.fetchone()
    if row is None:
        raise ValueError(f"Unknown staff user '{ident}' in tenant '{tid}'")
    return str(row[0])


def dispatch_event(
    event_type: str,
    tenant_id: Optional[str],
    context: Optional[Dict[str, Any]] = None,
    cta_link: Optional[str] = None,
    target_user_id: Optional[str] = None,
    target_user_type: str = "staff",
) -> Dict[str, Any]:
    """Compile a template and fan out inbox rows. Returns summary dict.

    - event_type: e.g. 'ONBOARDING_WELCOME' (must exist + is_active=TRUE,
      else returns {skipped: True} without writing).
    - tenant_id: subdomain string, or None for platform broadcast.
    - context: placeholder values for {{var}} rendering.
    - cta_link: optional deep link stored on the notifications row.
    - target_user_id: optional single-user targeting (e.g. STAFF_GRADING_REMINDER).
      When provided, the fan-out query is bypassed and exactly one
      notification_reads row is written for that user. Staff identifiers
      (id | staff_id | email) resolve to the canonical id; use
      target_user_type='admin' with the admin email for admin targeting.

    Raises ValueError for unknown tenant / bad input; other DB errors
    propagate so callers can log them (callers must treat as best-effort).
    """
    from services.db_manager import (
        NOTIFICATION_TEMPLATES_TABLE,
        NOTIFICATIONS_TABLE,
        NOTIFICATION_READS_TABLE,
        _connect_as_superuser,
        _sanitize_subdomain,
    )

    event_type = (event_type or "").strip().upper()
    if not event_type:
        raise ValueError("event_type is required")
    tid: Optional[str] = None
    if tenant_id is not None:
        tid = _sanitize_subdomain(tenant_id)
    ctx = dict(context or {})

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        cur.execute(
            f"""
            SELECT category, title_template, body_template
            FROM {NOTIFICATION_TEMPLATES_TABLE}
            WHERE event_type = %s AND is_active = TRUE
            LIMIT 1;
            """,
            (event_type,),
        )
        tpl = cur.fetchone()
        if tpl is None:
            cur.execute("ROLLBACK;")
            logger.warning(f"[notifications] Skipped — unknown/inactive template '{event_type}'")
            return {"skipped": True, "event_type": event_type}
        category, title_tpl, body_tpl = tpl
        title = render_template(title_tpl, ctx)
        message = render_template(body_tpl, ctx)

        cur.execute(
            f"""
            INSERT INTO {NOTIFICATIONS_TABLE}
                (tenant_id, category, title, message, cta_link, event_type)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (tid, category, title, message, (cta_link or "").strip() or None, event_type),
        )
        notification_id = int(cur.fetchone()[0])

        # Single-user targeting: bypass fan-out, write exactly one inbox row.
        if target_user_id is not None and str(target_user_id).strip():
            tut = (target_user_type or "staff").strip().lower()
            if tut not in ("staff", "admin"):
                cur.execute("ROLLBACK;")
                raise ValueError("target_user_type must be staff or admin")
            if tid is None:
                cur.execute("ROLLBACK;")
                raise ValueError("target_user_id requires a tenant_id (no broadcast targeting)")
            canonical = (
                resolve_staff_user_id(cur, tid, str(target_user_id))
                if tut == "staff"
                else str(target_user_id).strip().lower()
            )
            if tut == "admin":
                from services.db_manager import SCHOOLS_REGISTRY_TABLE

                cur.execute(
                    f"SELECT 1 FROM {SCHOOLS_REGISTRY_TABLE} WHERE subdomain = %s AND LOWER(email) = %s;",
                    (tid, canonical),
                )
                if cur.fetchone() is None:
                    cur.execute("ROLLBACK;")
                    raise ValueError(f"Unknown admin '{canonical}' in tenant '{tid}'")
            cur.execute(
                f"""
                INSERT INTO {NOTIFICATION_READS_TABLE}
                    (notification_id, tenant_id, user_id, user_type)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (notification_id, tenant_id, user_id) DO NOTHING;
                """,
                (notification_id, tid, canonical, tut),
            )
            cur.execute("COMMIT;")
            logger.info(
                f"[notifications] Dispatched '{event_type}' #{notification_id} "
                f"to {tid}/{canonical} (targeted)"
            )
            return {
                "notification_id": notification_id,
                "event_type": event_type,
                "tenant_id": tid,
                "title": title,
                "recipient_count": 1,
                "targeted": True,
                "skipped": False,
            }

        recipients = _collect_recipients(cur, tid)
        # De-duplicate (same user reachable twice) while preserving order.
        seen = set()
        unique: List[Tuple[str, str, str]] = []
        for r in recipients:
            if r not in seen:
                seen.add(r)
                unique.append(r)
        if unique:
            args = [(notification_id, t, u, ut) for (t, u, ut) in unique]
            cur.executemany(
                f"""
                INSERT INTO {NOTIFICATION_READS_TABLE}
                    (notification_id, tenant_id, user_id, user_type)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (notification_id, tenant_id, user_id) DO NOTHING;
                """,
                args,
            )
        cur.execute("COMMIT;")
        scope = "broadcast" if tid is None else tid
        logger.info(
            f"[notifications] Dispatched '{event_type}' #{notification_id} "
            f"to {scope} ({len(unique)} recipients)"
        )
        return {
            "notification_id": notification_id,
            "event_type": event_type,
            "tenant_id": tid,
            "title": title,
            "recipient_count": len(unique),
            "targeted": False,
            "skipped": False,
        }
    except Exception:
        try:
            if conn:
                with conn.cursor() as rb:
                    rb.execute("ROLLBACK;")
        except Exception:
            pass
        raise
    finally:
        if conn:
            conn.close()


def dispatch_manual(
    category: str,
    title: str,
    message: str,
    tenant_id: Optional[str] = None,
    cta_link: Optional[str] = None,
    target_role: str = "all",
) -> Dict[str, Any]:
    """Author a custom message (Phase 3 broadcast) with the same fan-out.

    tenant_id=None → platform-wide broadcast. No template involved
    (event_type stored as NULL). Raises ValueError on bad input.
    target_role='admin_only' → Tenant Admin emails only (schools table);
    'all' (default) → Admins + all active Staff.
    """
    from services.db_manager import (
        NOTIFICATIONS_TABLE,
        NOTIFICATION_READS_TABLE,
        VALID_NOTIFICATION_CATEGORIES,
        _connect_as_superuser,
        _sanitize_subdomain,
    )

    cat = (category or "").strip().upper() or "SYSTEM"
    if cat not in VALID_NOTIFICATION_CATEGORIES:
        raise ValueError(f"category must be one of {list(VALID_NOTIFICATION_CATEGORIES)}")
    title = (title or "").strip()
    message = (message or "").strip()
    if not title:
        raise ValueError("title is required")
    if not message:
        raise ValueError("message is required")
    tid: Optional[str] = None
    if tenant_id is not None and str(tenant_id).strip():
        tid = _sanitize_subdomain(str(tenant_id))
    role = (target_role or "all").strip().lower()
    if role not in VALID_TARGET_ROLES:
        raise ValueError(f"target_role must be one of {list(VALID_TARGET_ROLES)}")

    conn = None
    try:
        conn = _connect_as_superuser()
        cur = conn.cursor()
        cur.execute("BEGIN;")
        cur.execute(
            f"""
            INSERT INTO {NOTIFICATIONS_TABLE}
                (tenant_id, category, title, message, cta_link, event_type)
            VALUES (%s, %s, %s, %s, %s, NULL)
            RETURNING id;
            """,
            (tid, cat, title, message, (cta_link or "").strip() or None),
        )
        notification_id = int(cur.fetchone()[0])
        recipients = _collect_recipients(cur, tid, role)
        seen = set()
        unique: List[Tuple[str, str, str]] = []
        for r in recipients:
            if r not in seen:
                seen.add(r)
                unique.append(r)
        if unique:
            cur.executemany(
                f"""
                INSERT INTO {NOTIFICATION_READS_TABLE}
                    (notification_id, tenant_id, user_id, user_type)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (notification_id, tenant_id, user_id) DO NOTHING;
                """,
                [(notification_id, t, u, ut) for (t, u, ut) in unique],
            )
        cur.execute("COMMIT;")
        logger.info(
            f"[notifications] Manual '{cat}' #{notification_id} "
            f"to {'broadcast' if tid is None else tid} ({len(unique)} recipients, role={role})"
        )
        return {
            "notification_id": notification_id,
            "tenant_id": tid,
            "category": cat,
            "target_role": role,
            "recipient_count": len(unique),
        }
    except Exception:
        try:
            if conn:
                with conn.cursor() as rb:
                    rb.execute("ROLLBACK;")
        except Exception:
            pass
        raise
    finally:
        if conn:
            conn.close()


def fire_credit_threshold_alerts(
    tenant_id: str,
    new_balance: int,
    extra_context: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Fire LOW_CREDITS (1..threshold) or ZERO_CREDITS (0). Best-effort.

    Never raises — returns the dispatch summary, or None when no alert
    applies / dispatch fails (failure is logged as a warning).
    """
    try:
        from services.db_manager import get_school_by_subdomain

        balance = int(new_balance)
        if balance < 0 or balance > LOW_CREDITS_THRESHOLD:
            return None
        event = "ZERO_CREDITS" if balance == 0 else "LOW_CREDITS"
        ctx: Dict[str, Any] = {"credits": balance, "subdomain": tenant_id}
        try:
            school = get_school_by_subdomain(tenant_id)
            if school and school.get("school_name"):
                ctx["school_name"] = school["school_name"]
        except Exception:
            pass
        if extra_context:
            ctx.update(extra_context)
        return dispatch_event(event, tenant_id, ctx)
    except Exception as e:
        logger.warning(f"[notifications] Threshold alert failed for '{tenant_id}': {e}")
        return None
