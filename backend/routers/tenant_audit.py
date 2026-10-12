"""
Tenant audit trail — the admin-facing read surface for `audit_logs`.

Prefix: /api/v1/tenant/{tenant_id}/audit-logs

Read-only. Writes happen inside the mutation routes themselves (publish, delete,
patch, clearance, profile) because the write must be in the same logical moment
as the action it records — a separate "log this" call would let a crash between
the two leave a mutation with no trail.

WHY THIS IS A SEPARATE ROUTER FROM admin.py's /audit-logs
--------------------------------------------------------
admin.py's version is the SUPERADMIN view: it reads every tenant's rows. This
one is scoped to a single tenant and is what the school's own admin sees. Same
table, same helper, different span — keeping them apart is what stops a tenant
admin from reading another school's activity by changing a path segment.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/tenant/{tenant_id}", tags=["tenant-audit"])


async def _verify_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    """Same shared-secret contract as the other tenant routers."""
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac
        from fastapi import HTTPException as HTTPExc, status as S

        import os

        API_SECRET = os.getenv("API_SECRET_KEY", "")
        ENV = os.getenv("ENV", "production")
        if not API_SECRET:
            if ENV != "production":
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing request (dev mode)")
                return True
            raise HTTPExc(
                status_code=S.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfigured: API_SECRET_KEY not set",
            )
        if not x_api_secret_key:
            raise HTTPExc(status_code=S.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, API_SECRET):
            raise HTTPExc(status_code=S.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


def _validate_tenant_id(tenant_id: str) -> str:
    tid = (tenant_id or "").lower().strip()
    try:
        from main import SUBDOMAIN_RE, RESERVED_SUBDOMAINS
    except Exception:
        import re

        SUBDOMAIN_RE = re.compile(r"^[a-z0-9-]{3,30}$")
        RESERVED_SUBDOMAINS = set()

    if not SUBDOMAIN_RE.match(tid) or tid.startswith("-") or tid.endswith("-"):
        raise HTTPException(status_code=400, detail="Invalid tenant_id")
    if tid in RESERVED_SUBDOMAINS:
        raise HTTPException(status_code=400, detail=f"Tenant '{tid}' is reserved")
    return tid


@router.get(
    "/audit-logs",
    summary="Tenant audit trail, newest first",
    dependencies=[Depends(_verify_secret)],
)
def list_tenant_audit_logs(
    tenant_id: str,
    limit: int = 25,
    offset: int = 0,
    action_prefix: Optional[str] = None,
    actor_type: Optional[str] = None,
):
    """Audit rows for ONE tenant.

    Scoped by subdomain, which is the whole point: the Next proxy already
    verified the caller's session is bound to this tenant, and re-scoping here
    means a bug or a forged proxy call still cannot widen the span.

    `details` is returned verbatim. Every writer puts field NAMES there, never
    values — an audit row that copied the new email address or a pupil's grade
    would turn the log into a shadow copy of the data it is meant to observe.
    """
    from services.db_manager import get_audit_logs

    tid = _validate_tenant_id(tenant_id)

    entries, total = get_audit_logs(
        subdomain=tid,
        limit=limit,
        offset=offset,
        action_prefix=action_prefix,
        actor_type=actor_type,
    )

    return {
        "subdomain": tid,
        "entries": entries,
        "total": total,
        "limit": max(1, min(int(limit or 25), 200)),
        "offset": max(0, int(offset or 0)),
    }