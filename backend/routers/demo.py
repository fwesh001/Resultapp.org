"""
Ephemeral demo tenants — path-routed under demo.resultapp.org/<id>.

Prefix: /api/v1/demo
Protected by the same system-to-system X-API-SECRET-KEY gate as other
routers. The public entrypoint is the Next.js proxy (which rate-limits by
real client IP); this router additionally enforces the global capacity cap
and per-minute brake so no caller can exhaust the database.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
import os
import logging

logger = logging.getLogger(__name__)


async def _verify_demo_secret(
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


router = APIRouter(prefix="/api/v1/demo", tags=["demo"], dependencies=[Depends(_verify_demo_secret)])


class SweepRequest(BaseModel):
    max_age_seconds: int = 3600
    limit: int = 50


@router.post("/provision", summary="Create one ephemeral demo tenant")
def demo_provision():
    from services.demo import DEMO_TTL_SECONDS, provision_demo_tenant

    try:
        result = provision_demo_tenant()
    except ValueError as exc:
        # Capacity/brake rejections are 429s, never 500s — the UI renders a
        # friendly "demo at capacity" state from these.
        raise HTTPException(status_code=429, detail=str(exc))
    result["expires_in_seconds"] = DEMO_TTL_SECONDS
    return result


@router.post("/sweep", summary="Hard-delete demo tenants older than the TTL")
def demo_sweep(payload: SweepRequest):
    from services.demo import sweep_expired_demos

    max_age = max(300, min(int(payload.max_age_seconds or 3600), 86400))
    limit = max(1, min(int(payload.limit or 50), 200))
    return sweep_expired_demos(max_age_seconds=max_age, limit=limit)
