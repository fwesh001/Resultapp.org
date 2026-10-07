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
  * Adding the domain only asks Vercel to route the hostname. TLS is not
    necessarily ready when this call returns.
  * Under Cloudflare "Full", the readiness probe must see a completed HTTPS
    handshake and a successful response before the wizard redirects.
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
import socket
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

#: Thread-local switch used to pin Cloudflare requests to IPv4. The process may
#: serve concurrent readiness checks and unrelated requests, so the DNS policy
#: must never be a process-wide setting that leaks from one thread to another.
_ipv4_state = threading.local()
_real_getaddrinfo = socket.getaddrinfo


def _maybe_ipv4_getaddrinfo(host, port, *args, **kwargs):
    results = _real_getaddrinfo(host, port, *args, **kwargs)
    if getattr(_ipv4_state, "force_ipv4", False):
        ipv4 = [result for result in results if result[0] == socket.AF_INET]
        return ipv4 or results
    return results


socket.getaddrinfo = _maybe_ipv4_getaddrinfo
requests.packages.urllib3.util.connection.socket.getaddrinfo = _maybe_ipv4_getaddrinfo

VERCEL_API = "https://api.vercel.com"
CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"

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

    # 409 = the domain is already attached to the project. Attachment alone is
    # success, but it says nothing about verification, so check Vercel's actual
    # status instead of assuming that an existing domain is already verified.
    if resp.status_code == 409:
        result["success"] = True
        status = get_domain_status(slug) or {}
        result["verified"] = bool(status.get("verified"))
        logger.info(
            "[Vercel] Domain '%s' already attached (verified=%s)",
            result["domain"],
            result["verified"],
        )
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


def _cf_config() -> Dict[str, str]:
    return {
        "token": (os.getenv("CLOUDFLARE_API_TOKEN") or "").strip(),
        "zone_id": (os.getenv("CLOUDFLARE_ZONE_ID") or "").strip(),
    }


@contextmanager
def _ipv4_only():
    """Pin Cloudflare name resolution to IPv4 for the current thread only.

    The droplet has working IPv6 egress, but the Cloudflare API token is
    allowlisted by IPv4 address. Cloudflare matches the allowlist against the
    connecting address, so an IPv6 call is rejected with error 9109
    ("Cannot use the access token from location") even though the token is
    perfectly valid. The thread-local policy keeps one provisioning request
    from changing DNS behaviour for concurrent readiness checks.
    """
    depth = int(getattr(_ipv4_state, "force_ipv4_depth", 0) or 0) + 1
    _ipv4_state.force_ipv4_depth = depth
    _ipv4_state.force_ipv4 = True
    try:
        yield
    finally:
        remaining = int(getattr(_ipv4_state, "force_ipv4_depth", 1) or 1) - 1
        _ipv4_state.force_ipv4_depth = max(0, remaining)
        _ipv4_state.force_ipv4 = remaining > 0


def _cf_api(method: str, url: str, **kwargs) -> requests.Response:
    """Call the Cloudflare API over IPv4.

    The token is allowlisted by the droplet's IPv4 address, but Cloudflare can
    reject the same token over IPv6 either as 9109 or as a generic 10000
    authentication error. Always presenting the allowlisted IPv4 address is what
    makes DNS automation work unattended. Fall back to normal resolution only if
    IPv4 itself cannot be used.
    """
    try:
        with _ipv4_only():
            return requests.request(method, url, **kwargs)
    except requests.RequestException as exc:
        logger.warning("[Cloudflare] IPv4 request failed (%s); retrying with normal resolution", exc.__class__.__name__)
        return requests.request(method, url, **kwargs)


def publish_verification_txt(domain: str, value: str) -> Dict[str, Any]:
    """Write the `_vercel` TXT record Vercel needs to verify a domain.

    Without this the subdomain is added to Vercel but stays unverified, so
    Cloudflare has no certificate to present and every visitor gets a 525
    SSL-handshake error until a human edits DNS by hand. Doing it here is what
    makes tenant provisioning genuinely hands-off.

    Cloudflare stays authoritative for the zone — we only add a TXT record, we
    never move nameservers, so Email Routing and the Brevo DKIM/SPF records are
    untouched.
    """
    cfg = _cf_config()
    if not cfg["token"] or not cfg["zone_id"]:
        return {"written": False, "reason": "Cloudflare API not configured"}
    if not domain or not value:
        return {"written": False, "reason": "missing domain or value"}

    headers = {"Authorization": f"Bearer {cfg['token']}", "Content-Type": "application/json"}
    name = "_vercel"

    try:
        # Reuse the existing record when there is one, so repeated provisions do
        # not pile up duplicate TXT entries.
        listed = _cf_api(
            "GET",
            f"{CLOUDFLARE_API}/zones/{cfg['zone_id']}/dns_records",
            params={"type": "TXT", "name": name},
            headers=headers,
            timeout=(_TIMEOUT_CONNECT, _TIMEOUT_READ),
        )
        if listed.ok:
            existing = listed.json().get("result", [])
            if any(rec.get("content") == value for rec in existing):
                return {"written": True, "reason": "already present"}
            # Append alongside the other tenants' records. Never delete: `_vercel`
            # holds one TXT per verified domain and removing the wrong one
            # un-verifies a school that is already live.
            created = _cf_api(
                "POST",
                f"{CLOUDFLARE_API}/zones/{cfg['zone_id']}/dns_records",
                json={"type": "TXT", "name": name, "content": value, "ttl": 300},
                headers=headers,
                timeout=(_TIMEOUT_CONNECT, _TIMEOUT_READ),
            )
            if created.ok:
                return {"written": True, "reason": "appended"}
            return {"written": False, "reason": f"append failed HTTP {created.status_code}: {created.text[:200]}"}

        resp = _cf_api(
            "POST",
            f"{CLOUDFLARE_API}/zones/{cfg['zone_id']}/dns_records",
            json={"type": "TXT", "name": name, "content": value, "ttl": 300},
            headers=headers,
            timeout=(_TIMEOUT_CONNECT, _TIMEOUT_READ),
        )
        if resp.ok:
            return {"written": True, "reason": "created"}
        return {"written": False, "reason": f"HTTP {resp.status_code}: {resp.text[:200]}"}
    except requests.RequestException as exc:
        logger.error("[Cloudflare] TXT publish failed for %s: %s: %s", domain, exc.__class__.__name__, exc)
        return {"written": False, "reason": f"{exc.__class__.__name__}: {exc}"}


def _verification_value(payload: Dict[str, Any]) -> Optional[str]:
    """Pull the required TXT value out of a Vercel domain response."""
    verification = payload.get("verification")
    if isinstance(verification, dict):
        value = verification.get("value")
        return str(value) if value else None
    if isinstance(verification, list):
        for item in verification:
            if isinstance(item, dict) and item.get("value"):
                return str(item["value"])
    return None


def start_domain_verification(subdomain: str) -> Dict[str, Any]:
    """Add the tenant domain and immediately publish the verification TXT.

    This intentionally does not wait for Vercel to finish. The registration
    response must return promptly so the wizard can show live progress; the
    separate readiness endpoint reports completion when the certificate is
    actually being served. Returns {verified, added, txt, domain}.
    """
    slug = (subdomain or "").strip().lower()
    domain = f"{slug}.resultapp.org"
    out: Dict[str, Any] = {
        "verified": False,
        "added": False,
        "txt": None,
        "domain": domain,
    }
    if not slug:
        return out

    added = add_tenant_domain(slug)
    out["added"] = bool(added.get("success"))
    out["verified"] = bool(added.get("verified"))
    if not is_configured():
        return out

    if not out["verified"]:
        status = get_domain_status(slug) or {}
        needed = _verification_value(status)
        if needed:
            txt = publish_verification_txt(domain, needed)
            out["txt"] = txt
            logger.info("[Vercel] Published verification TXT for '%s': %s", domain, txt.get("reason"))
    return out


def ensure_domain_verified(subdomain: str, timeout_s: float = 90.0) -> Dict[str, Any]:
    """Add the domain, publish its verification TXT, then poll until verified.

    Returns {verified, added, txt, domain}. Safe to call repeatedly. This is
    for reconciliation or one-off checks; paid provisioning uses
    start_domain_verification() so the HTTP response is not held open while a
    certificate is issued.
    """
    slug = (subdomain or "").strip().lower()
    out = start_domain_verification(slug)

    # Vercel re-checks on a timer; a short bounded poll turns a multi-minute
    # human wait into a couple of seconds inside the provision request.
    deadline = time.time() + max(0.0, timeout_s)
    while time.time() < deadline and not out["verified"]:
        time.sleep(5)
        st = get_domain_status(slug) or {}
        out["verified"] = bool(st.get("verified"))

    if out["verified"]:
        logger.info("[Vercel] '%s' verified", out["domain"])
    else:
        logger.warning("[Vercel] '%s' still unverified after %.0fs", out["domain"], timeout_s)
    return out


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


def probe_portal(subdomain: str, timeout: float = 8.0) -> Dict[str, Any]:
    """Check whether the tenant's public portal actually answers.

    This is the signal the wizard waits on. A freshly provisioned subdomain is
    not usable the moment the row is written: Vercel still has to verify the
    domain and issue a certificate, and until it does Cloudflare answers with a
    525 SSL-handshake error. Redirecting a paying customer into that window is
    what made the old flow look broken.

    Probed server-to-server because a browser cannot read a cross-origin status
    code: `fetch(..., {mode:'no-cors'})` resolves opaquely for both 200 and 525.
    """
    slug = (subdomain or "").strip().lower()
    domain = f"{slug}.resultapp.org"
    url = f"https://{domain}/"

    if not slug or not slug.replace("-", "").isalnum():
        return {"reachable": False, "status": None, "error": "invalid subdomain"}

    attempts = 2
    last_exc: Optional[Exception] = None
    for _ in range(attempts):
        try:
            resp = requests.get(url, timeout=timeout, allow_redirects=True)
            return {
                "reachable": resp.status_code < 400,
                "status": resp.status_code,
                "error": None,
                "detail": None,
            }
        except requests.RequestException as exc:
            # Keep the message. Returning only the class name here is what made a
            # real ConnectionError undiagnosable for hours: every failure looked
            # identically like "ConnectionError" with no cause attached.
            last_exc = exc
            logger.warning(f"[PROBE] {url} failed: {exc.__class__.__name__}: {exc}")

    exc = last_exc
    if exc is not None:
        return {
            "reachable": False,
            "status": None,
            "error": exc.__class__.__name__,
            "detail": str(exc)[:300],
        }
    return {"reachable": False, "status": None, "error": "unknown", "detail": None}


def get_portal_readiness(subdomain: str) -> Dict[str, Any]:
    """Combined view used by the registration wizard's progress bar.

    Returns a stage the UI can render verbatim plus a coarse percentage so the
    customer sees movement rather than an indefinite spinner.
    """
    slug = (subdomain or "").strip().lower()
    domain = f"{slug}.resultapp.org"

    from services.db_manager import tenant_exists

    registered = False
    try:
        registered = tenant_exists(slug)
    except Exception:  # noqa: BLE001
        registered = False

    probe = probe_portal(slug, timeout=6.0)
    vstatus = get_domain_status(slug) or {}
    verified = bool(vstatus.get("verified"))

    if probe["reachable"]:
        # Only a completed TLS handshake and successful HTTP response count as
        # ready. Vercel's verified flag is useful for stage reporting, but a
        # verified domain can still briefly 525, so it must never authorize
        # the redirect by itself.
        stage, percent, ready = "Your portal is live", 100, True
    elif verified:
        stage, percent, ready = "Finishing your SSL certificate", 85, False
    elif registered:
        stage, percent, ready = "Issuing your SSL certificate", 60, False
    else:
        stage, percent, ready = "Creating your school", 25, False

    return {
        "subdomain": slug,
        "domain": domain,
        "registered": registered,
        "domain_verified": verified,
        "reachable": probe["reachable"],
        "http_status": probe["status"],
        "error": probe["error"],
        "detail": probe.get("detail"),
        "stage": stage,
        "percent": percent,
        "ready": ready,
    }