"""
Static + captured-send verification of the transactional email templates.

Covers the Google Email Markup work in services/notifier.py:

  1. Every production email (OTP, verify, reset, welcome) assembles a valid
     Brevo payload — nothing is sent (Brevo's `requests` layer is stubbed).
  2. Link emails + welcome embed ONE JSON-LD <script> that parses as a list
     of schema.org objects with @context https://schema.org, an EmailMessage
     + ViewAction whose https deep link carries the caller's own token/URL
     param, and the ResultApp publisher.
  3. The SAME action appears in the hidden Microdata div (script-stripping
     sanitizer backup) — itemtype, itemprop url href, all matching JSON-LD.
  4. Subject conventions from the module table hold, including the OTP code
     in the subject, and the text/plain part opens with the machine-readable
     line (code / link) — Gmail's code detection and Apple's autofill read it.
  5. The OTP HTML keeps one unbroken digit run (no per-digit spans) inside a
     <code> element, and the decorative copy glyph is aria-hidden.
  6. Welcome has no templateId/params keys (raw HTML is the single source of
     truth) and its action deep-links into /admin/login.
  7. routers/allocations.py composes its moderator subjects from the same
     notifier constants.

Exit 0 = all green. Usage: py backend/scripts/verify-email-markup.py
"""

import html as _html
import json
import os
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("BREVO_API_KEY", "guard-test-key")
os.environ.setdefault("PUBLIC_BASE_URL", "https://resultapp.org")

import services.notifier as notifier  # noqa: E402  (path set above)

FAILURES: list[str] = []
LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.DOTALL)


class _ShimResponse:
    status_code = 201
    text = "ok"
    content = b"{}"

    @staticmethod
    def json():
        return {"messageId": "guard"}


_SENT: list[dict] = []


class _ShimRequests:
    # notifier catches requests.Timeout / requests.RequestException — the shim
    # replaces the whole module, so it must carry the same attributes.
    Timeout = Exception
    RequestException = Exception

    @staticmethod
    def post(url, json=None, headers=None, timeout=None):  # noqa: A002
        _SENT.append(json)
        return _ShimResponse()


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        FAILURES.append(name)
        print(f"  FAIL  {name}  {detail}")


def parse_ld(payload: dict) -> list:
    html = payload["htmlContent"]
    scripts = LD_RE.findall(html)
    assert len(scripts) == 1, f"expected exactly one JSON-LD script, got {len(scripts)}"
    data = json.loads(scripts[0])
    assert isinstance(data, list)
    return data


def assert_markup(payload: dict, *, name_label: str, url: str) -> None:
    html = payload["htmlContent"]
    blocks = parse_ld(payload)
    check(
        f"{name_label}: JSON-LD parses with @context",
        all(b.get("@context") == "https://schema.org" for b in blocks),
    )
    msg = blocks[0]
    check(f"{name_label}: EmailMessage", msg.get("@type") == "EmailMessage")
    action = msg.get("potentialAction", {})
    check(
        f"{name_label}: ViewAction name + url",
        action.get("@type") == "ViewAction"
        and action.get("name") == name_label
        and action.get("url") == url,
        f"got {action}",
    )
    check(f"{name_label}: action url is https", url.startswith("https://"))
    check(
        f"{name_label}: action label not ALL-CAPS",
        name_label != name_label.upper(),
    )
    check(
        f"{name_label}: action label has no sentence punctuation",
        not any(c in name_label for c in ".,!?;:"),
    )
    publisher = msg.get("publisher", {})
    check(
        f"{name_label}: publisher = ResultApp",
        publisher.get("@type") == "Organization" and publisher.get("name") == "ResultApp",
    )
    # Microdata backup: the same type and the same URL must be findable
    # without any <script> tag. Attribute values are HTML-escaped by the
    # emitter, so compare against the escaped form.
    micro_start = html.find(
        'style="display:none;max-height:0;overflow:hidden;opacity:0;"><div itemscope'
    )
    check(f"{name_label}: hidden microdata div present", micro_start > 0)
    escaped_url = _html.escape(url, quote=True)
    link_at = html.find(f'itemprop="url" href="{escaped_url}"')
    check(f"{name_label}: microdata carries the action url", link_at > micro_start)
    scope_from = html.find('itemtype="https://schema.org/EmailMessage"')
    check(
        f"{name_label}: microdata EmailMessage itemtype",
        0 < scope_from < link_at,
    )
    # Placement: markup sits inside <body>, after the preheader.
    pre = html.find("display:none")
    script_at = html.find('<script type="application/ld+json">')
    check(f"{name_label}: markup after preheader, inside body", 0 < pre < script_at)


def main() -> int:
    notifier.requests = _ShimRequests()  # capture, never send

    # --- OTP --------------------------------------------------------------
    print("OTP code email")
    code = "042918"
    ok = notifier.send_otp_email("Student@Example.com", code, 10)
    check("otp: send returned True under shim", ok)
    p = _SENT[-1]
    check(
        "otp: subject carries the code",
        p["subject"] == f"{code} is your ResultApp verification code",
        p["subject"],
    )
    check("otp: no JSON-LD (no schema type exists for codes)", LD_RE.search(p["htmlContent"]) is None)
    check("otp: unbroken digit run inside <code>", f"<code>{code}</code>" in p["htmlContent"])
    check("otp: copy glyph aria-hidden", 'aria-hidden="true"' in p["htmlContent"])
    check("otp: text part opens with the code", p["textContent"].startswith(f"Code: {code}\n"))

    # --- Verification link ----------------------------------------------
    print("Email verification link")
    v_link = "https://resultapp.org/verify-email?token=tok-verify-1&email=staff@example.com"
    ok = notifier.send_verification_email("Staff@Example.com", "Amara", "tok-verify-1", tenant="Demo Academy")
    check("verify: send returned True under shim", ok)
    p = _SENT[-1]
    check("verify: standardized subject", p["subject"] == notifier.SUBJECT_VERIFY, p["subject"])
    check("verify: text part opens with the link", p["textContent"].startswith(f"Verify: {v_link}\n"))
    check("verify: shell has semantic h1", "<h1" in p["htmlContent"])
    assert_markup(p, name_label="Verify email", url=v_link)

    # --- Password reset ----------------------------------------------------
    print("Password reset link")
    r_link = "https://resultapp.org/reset-password?token=tok-reset-1&email=admin@example.com"
    ok = notifier.send_password_reset_email("Admin@Example.com", "Bola", "tok-reset-1", tenant="Demo Academy")
    check("reset: send returned True under shim", ok)
    p = _SENT[-1]
    check("reset: standardized subject", p["subject"] == notifier.SUBJECT_RESET, p["subject"])
    check("reset: text part opens with the link", p["textContent"].startswith(f"Reset: {r_link}\n"))
    assert_markup(p, name_label="Reset password", url=r_link)

    # --- Welcome -----------------------------------------------------------
    print("Welcome / provisioning")
    login_url = "https://wuse-school.resultapp.org"
    ok = notifier.send_welcome_email(
        admin_email="head@wuse-school.example.org",
        admin_name="Mrs. Bola",
        school_name="Wuse School",
        subdomain="wuse-school",
        student_count=120,
        temp_credentials=None,
        domain="wuse-school.resultapp.org",
        login_url=login_url,
    )
    check("welcome: send returned True under shim", ok)
    p = _SENT[-1]
    check(
        "welcome: standardized subject",
        p["subject"] == notifier.SUBJECT_WELCOME.format(domain="wuse-school.resultapp.org"),
        p["subject"],
    )
    check(
        "welcome: raw HTML single source of truth (no Brevo template)",
        "templateId" not in p and "params" not in p,
    )
    check(
        "welcome: no empty Temporary Password checkbox row",
        "Temporary Password:" not in p["htmlContent"],
    )
    check(
        "welcome: text part opens with the portal link",
        p["textContent"].startswith(f"Portal: {login_url}\n"),
    )
    assert_markup(
        p,
        name_label="Open your portal",
        url=login_url + "/admin/login",  # deep-link rule
    )

    # --- Moderator pair share the constants -------------------------------
    print("Moderator announcements (composition)")
    alloc_src = (BACKEND_DIR / "routers" / "allocations.py").read_text(encoding="utf-8")
    check(
        "moderator: subjects composed from notifier constants",
        "notifier.SUBJECT_MODERATOR_GRANTED.format" in alloc_src
        and "notifier.SUBJECT_MODERATOR_REVOKED.format" in alloc_src,
    )
    check(
        "moderator: markup helper used",
        "markup_action(" in alloc_src,
    )
    check(
        "moderator: constants are the registered strings",
        notifier.SUBJECT_MODERATOR_GRANTED.format(school="X") == "You now have Moderator access in X"
        and notifier.SUBJECT_MODERATOR_REVOKED.format(school="X") == "Your Moderator access in X has ended",
    )
    # Render the exact structure allocations passes through the shared shell.
    ld = [
        notifier.markup_action(
            "Open the Moderator Console",
            "https://resultapp.org/demo-school/moderator",
            "Moderator access to Demo School has been granted.",
        )
    ]
    shell_html = notifier._auth_email_shell("You have Moderator access", "<p>x</p>", "pre", ld)
    assert_markup({"htmlContent": shell_html}, name_label="Open the Moderator Console", url="https://resultapp.org/demo-school/moderator")

    # --- markup_block unit invariants --------------------------------------
    print("markup_block unit")
    block = notifier.markup_block([notifier.markup_action("View report cards", "https://demo.resultapp.org/x", "d")])
    check("block: JSON-LD round-trips", isinstance(json.loads(LD_RE.search(block).group(1)), list))
    check("block: microdata link escape", 'itemprop="url" href="https://demo.resultapp.org/x"' in block)
    weird = notifier.markup_block([notifier.markup_action('Bad "name" & label', "https://x.test/y", "d")])
    check("block: quotes escaped in microdata", '&quot;' in weird and "&amp;" in weird)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failure(s): {FAILURES}")
        return 1
    print("All email markup guards green.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
