"""
Vercel domain provisioning for tenant subdomains.

Why this exists
---------------
The Next.js app on Vercel serves every tenant subdomain: middleware.ts reads
the Host header and rewrites to app/[subdomain]/... A tenant subdomain only
becomes routable once Vercel has a domain for it, because Vercel will not
answer a hostname it has never been told about.

We do NOT use a wildcard certificate. Vercel can only issue `*.resultapp.org`
via a DNS-01 challenge that requires Vercel's nameservers to be authoritative,
and moving nameservers off Cloudflare would break Cloudflare Email Routing and
the Brevo DKIM/SPF records. So instead every tenant subdomain is added
individually, and Vercel issues it an ordinary certificate.

Operational consequences, stated plainly:
  * The subdomain becomes routable as soon as this call returns.
  * TLS may take up to ~a minute after that while Vercel provisions the cert.
  * A failure here does NOT fail provisioning. The school row is already
    committed and the customer can be served once an operator reconciles the
    domain, so we surface the error rather than pretending it worked.

Env:
  VERCEL_TOKEN        API token with access to the project (deployment scope
                      is enough; it must be allowed to add domains)
  VERCEL_PROJECT_ID   e.g. prj_...
  VERCEL_TEAM_ID      team_... (scoped account; omit for personal accounts)
"""

import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

VERCEL_API = "https://api.vercel.com"

#: A domain add is a single small POST. Keep it short so a Vercel outage can
#: never hold up a customer's provisioning.
_TIMEOUT_CONNECT = 10
_TIMEOUT_READ = 25


def _config() -> Dict[str, str]:
    return {
        "token": (os.getenv("VERCEL_TOKEN") or "").strip(),
        "project_id": (os.getenv("VERCEL_PROJECT_ID") or "").strip(),
        "team_id": (os.getenv("VERCEL_TEAM_ID") or "").strip(),
    }


def is_configured() -> bool:
    cfg = _config()
    return bool(cfg["token"] and cfg["project_id"])


def _auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def add_tenant_domain(subdomain: str) -> Dict[str, Any]:
    """Add `<subdomain>.resultapp.org` to the Vercel project.

    Idempotent: re-adding an existing domain is reported as success rather than
    an error, so a retried provision never fails on a duplicate.

    Returns a dict that is always safe to put in an API response:
        {configured, success, domain, verified, error}
    """
    cfg = _config()
    slug = (subdomain or "").strip().lower()
    result: Dict[str, Any] = {
        "configured": False,
        "success": False,
        "domain": f"{slug}.resultapp.org" if slug else None,
        "verified": False,
        "error": None,
    }

    if not slug or not slug.replace("-", "").isalnum():
        result["error"] = "invalid subdomain"
        return result

    if not is_configured():
        # Not an error condition in development or in a test harness — just means
        # the domain will have to be added by hand.
        result["error"] = "Vercel API not configured"
        logger.info("[Vercel] Skipping domain add for '%s' — VERCEL_TOKEN/PROJECT_ID unset", slug)
        return result

    result["configured"] = True

    params = {}
    if cfg["team_id"]:
        params["teamId"] = cfg["team_id"]
    url = f"{VERCEL_API}/v10/projects/{cfg['project_id']}/domains"
    payload = {"name": result["domain"]}

    try:
        resp = requests.post(
            url,
            params=params,
            json=payload,
            headers=_auth_headers(cfg["token"]),
            timeout=(_TIMEOUT_CONNECT, _TIMEOUT_READ),
        )
    except requests.RequestException as exc:
        # Deliberately does not log the token or the full URL with auth.
        result["error"] = f"Vercel API unreachable: {exc.__class__.__name__}"
        logger.error("[Vercel] Domain add failed for '%s': %s", slug, exc.__class__.__name__)
        return result

    if resp.status_code in (200, 201):
        data = resp.json() if resp.content else {}
        result["success"] = True
        result["verified"] = bool(data.get("verified"))
        logger.info(
            "[Vercel] Added domain '%s' (verified=%s)",
            result["domain"],
            result["verified"],
        )
        return result

    # 409 = the domain is already attached to the project. That is the state we
    # were trying to reach, so it counts as success.
    if resp.status_code == 409:
        result["success"] = True
        result["verified"] = True
        logger.info("[Vercel] Domain '%s' already attached", result["domain"])
        return result

    detail = ""
    try:
        body = resp.json()
        err = body.get("error") or {}
        detail = err.get("message") or body.get("message") or ""
    except Exception:  # noqa: BLE001
        detail = resp.text[:200] if resp.text else ""

    result["error"] = f"Vercel HTTP {resp.status_code}: {detail}" if detail else f"Vercel HTTP {resp.status_code}"
    logger.error("[Vercel] Domain add for '%s' failed: %s", slug, result["error"])
    return result


def get_domain_status(subdomain: str) -> Optional[Dict[str, Any]]:
    """Return Vercel's view of a tenant domain, or None if unknown/unconfigured.

    Useful for an operator (or a support endpoint) to confirm a pending
    certificate without exposing the token.
    """
    cfg = _config()
    slug = (subdomain or "").strip().lower()
    if not slug or not is_configured():
        return None

    domain = f"{slug}.resultapp.org"
    params = {}
    if cfg["team_id"]:
        params["teamId"] = cfg["team_id"]
    url = f"{VERCEL_API}/v9/projects/{cfg['project_id']}/domains/{domain}"

    try:
        resp = requests.get(
            url,
            params=params,
            headers=_auth_headers(cfg["token"]),
            timeout=(_TIMEOUT_CONNECT, _TIMEOUT_READ),
        )
    except requests.RequestException as exc:
        logger.error("[Vercel] Status check failed for '%s': %s", domain, exc.__class__.__name__)
        return None

    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except Exception:  # noqa: BLE001
        return None