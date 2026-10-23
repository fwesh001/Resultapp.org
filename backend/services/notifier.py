"""
Brevo (ex-Sendinblue) notifier for ResultApp Droplet.
Transactional sends: welcome/provisioning, email verification, password
reset, the registration OTP, and the moderator-access announcements.

Google Email Markup (schema.org JSON-LD plus a hidden Microdata copy) is
embedded from one source of truth so Gmail can offer native Inbox actions
once the sender is registered, and the structured data is already in place.
The OTP "Copy code" affordance is Gmail-side heuristic detection and needs
no schema type — it is satisfied by layout rules (code in subject, first
labeled line, unbroken digit run).

API Docs: https://developers.brevo.com/docs/send-a-transactional-email
Endpoint: POST https://api.brevo.com/v3/smtp/email
Header: api-key: <BREVO_API_KEY>
"""

import logging
import os
from typing import Dict, Optional

import requests

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"

def _brevo_config():
    return {
        "api_key": os.getenv("BREVO_API_KEY", ""),
        "sender_email": os.getenv("BREVO_SENDER_EMAIL", "support@resultapp.org"),
        "sender_name": os.getenv("BREVO_SENDER_NAME", "ResultApp"),
    }

def _build_welcome_html(
    school_name: str,
    subdomain: str,
    domain: str,
    admin_name: str,
    admin_email: str,
    student_count: int,
    temp_username: str,
    temp_password: str,
    login_url: str,
    ld_html: str = "",
    preheader: str = "",
) -> str:
    """
    Returns HTML for welcome email. Keep inline CSS for email client compatibility.

    `ld_html` carries the Google Email Markup (script + hidden microdata) from
    markup_block(); `preheader` is the hidden preview text. Both default to
    empty so ad-hoc/dev renders stay plain.
    """
    total = student_count * 100
    # Use en-NG formatting
    total_fmt = f"₦{total:,}"

    # The credentials card is conditional. Since password-at-signup the
    # payload carries no generated password, and rendering an empty
    # "Temporary Password:" row taught users to look for a credential that
    # does not exist.
    if temp_username and temp_password:
        cred_rows = (
            '<p style="margin:6px 0;font-size:14px;"><strong>Username:</strong> '
            '<span style="font-family:monospace;background:#fff;border:1px solid #e4e4e7;padding:2px 6px;border-radius:4px;">'
            f"{temp_username}</span></p>"
            '<p style="margin:6px 0;font-size:14px;"><strong>Temporary Password:</strong> '
            '<span style="font-family:monospace;background:#fff;border:1px solid #e4e4e7;padding:2px 6px;border-radius:4px;">'
            f"{temp_password}</span></p>"
            '<p style="margin:10px 0 0;font-size:12px;color:#71717a;">You will be prompted to change your password on first login. Keep this email safe.</p>'
        )
        cred_title = "Your temporary credentials"
        first_step = "Log in and change your temporary password"
    else:
        cred_rows = (
            '<p style="margin:0;font-size:14px;">Sign in with the admin password you chose at signup — '
            "this email is the receipt for your purchase and the link to your first login.</p>"
        )
        cred_title = "Your login details"
        first_step = "Log in with your admin password"

    cred_card = f"""
        <div style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 10px;font-weight:600;font-size:14px;">{cred_title}</p>
          <p style="margin:6px 0;font-size:14px;"><strong>Login URL:</strong> <a href="{login_url}" style="color:#2563eb;word-break:break-all;">{login_url}</a></p>
          {cred_rows}
        </div>"""

    return f"""
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Welcome to ResultApp, {school_name}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f6f9;font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1a1a1a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
    {ld_html}
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:24px;border:1px solid #e5e5e5;">
      <div style="background:#000000;color:#ffffff;padding:24px;">
        <h1 style="margin:0;font-size:22px;">Welcome to ResultApp, {school_name}!</h1>
        <p style="margin:8px 0 0;color:#a1a1aa;font-size:14px;">Your school portal is live at <strong style="color:#fff;">{domain}</strong></p>
      </div>
      <div style="padding:24px;">
        <p style="font-size:15px;line-height:22px;">Hi {admin_name},</p>
        <p style="font-size:15px;line-height:22px;color:#3f3f46;">
          Your payment for <strong>{student_count} students</strong> ({total_fmt} at ₦100/student) has been confirmed.
          Your school portal is ready.
        </p>

        {cred_card}

        <a href="{login_url}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:14px;">Go to your portal →</a>

        <div style="margin-top:24px;padding:16px;background:#eff6ff;border-radius:8px;">
          <p style="margin:0;font-size:13px;color:#1e40af;"><strong>What’s next?</strong></p>
          <ol style="margin:8px 0 0;padding-left:18px;color:#334155;font-size:13px;line-height:20px;">
            <li>{first_step}</li>
            <li>Upload student list (CSV) — you have credits for {student_count} students</li>
            <li>Generate broadsheets & report cards — credits never expire</li>
          </ol>
        </div>

        <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
        <p style="font-size:12px;color:#71717a;line-height:18px;">
          Subdomain: <span style="font-family:monospace;">{subdomain}.resultapp.org</span> • School: {school_name} • Admin: {admin_email}<br/>
          Need help? Reply to this email or WhatsApp +234 800 RESULTAPP. This is an automated message from ResultApp provisioning service.
        </p>
      </div>
      <div style="text-align:center;padding:16px;background:#fafafa;border-top:1px solid #e5e5e5;color:#71717a;font-size:12px;">
        ResultApp • Lagos, Nigeria • <a href="https://resultapp.org" style="color:#71717a;">resultapp.org</a>
      </div>
    </div>
  </body>
</html>
""".strip()

def send_welcome_email(
    admin_email: str,
    admin_name: str,
    school_name: str,
    subdomain: str,
    student_count: int,
    temp_credentials: Optional[Dict[str, str]] = None,
    domain: Optional[str] = None,
    login_url: Optional[str] = None,
) -> bool:
    """
    Send welcome email via Brevo.

    Returns True on success, False on failure (logs details).
    If BREVO_API_KEY is missing, logs and returns True (dev mode - no-op).

    `temp_credentials` is optional: the customer now chooses their own admin
    password during signup, so there is no generated credential to hand out.
    It is still accepted for older callers and for dev-mode logging.

    The body is always raw HTML from _build_welcome_html — one source of
    truth in version control. The old BREVO_WELCOME_TEMPLATE_ID path is
    gone: Brevo renders hosted templates itself, which bypassed exactly the
    markup/subject/copy this file now owns and let them silently desync.
    """
    cfg = _brevo_config()
    domain = domain or f"{subdomain.lower().strip()}.resultapp.org"
    login_url = login_url or f"https://{domain}"
    creds = temp_credentials or {}

    # Dev/CI mode without key: log only
    if not cfg["api_key"]:
        logger.warning(
            f"[EMAIL] BREVO_API_KEY not set — skipping real send for {admin_email} "
            f"(domain={domain}, user={creds.get('username')}). "
            f"In production set BREVO_API_KEY to enable email."
        )
        # For Droplet dev without Brevo, we still want to log the credentials
        logger.info(
            f"[EMAIL-DEV] Would send to {admin_email}: "
            f"login={login_url} user={creds.get('username')} pass={creds.get('password')}"
        )
        return True

    # The Inbox action must deep-link to where the action completes (sign-in),
    # not the marketing/portal root — a Google registration guideline.
    ld = [
        markup_action(
            "Open your portal",
            _deep_link(login_url, "/admin/login"),
            f"Your ResultApp portal for {school_name} is live at {domain}.",
        )
    ]
    html = _build_welcome_html(
        school_name=school_name,
        subdomain=subdomain.lower().strip(),
        domain=domain,
        admin_name=admin_name,
        admin_email=admin_email,
        student_count=student_count,
        temp_username=creds.get("username") or admin_email,
        temp_password=creds.get("password", ""),
        login_url=login_url,
        ld_html=markup_block(ld),
        preheader=f"Payment confirmed — your school portal at {domain} is ready.",
    )

    payload: Dict = {
        "sender": {"email": cfg["sender_email"], "name": cfg["sender_name"]},
        "to": [{"email": admin_email, "name": admin_name}],
        "subject": SUBJECT_WELCOME.format(domain=domain),
        "tags": ["provisioning", "welcome", f"subdomain:{subdomain}"],
        "headers": {"X-ResultApp-Subdomain": subdomain},
        "htmlContent": html,
        "textContent": (
            f"Portal: {login_url}\n\n"
            f"Welcome to ResultApp, {school_name}!\n"
            f"Username: {creds.get('username') or admin_email}\n"
            + (
                f"Temporary Password: {creds.get('password', '')}\n"
                if creds.get("password")
                else "Sign in with the password you chose at signup.\n"
            )
            + f"Student slots: {student_count} (NGN {student_count*100} paid)\n"
            f"Please change your password on first login.\n"
        ),
    }

    headers = {
        "accept": "application/json",
        "api-key": cfg["api_key"],
        "content-type": "application/json",
    }

    try:
        logger.info(f"[EMAIL] Sending welcome email to {admin_email} for {domain}")
        resp = requests.post(BREVO_API_URL, json=payload, headers=headers, timeout=15)

        if resp.status_code in (200, 201):
            data = resp.json() if resp.content else {}
            msg_id = data.get("messageId") or data.get("messageIds") or "unknown"
            logger.info(f"[EMAIL] Sent successfully to {admin_email} (msgId={msg_id})")
            return True
        else:
            logger.error(
                f"[EMAIL] Brevo API error {resp.status_code}: {resp.text[:1000]} "
                f"(payload subdomain={subdomain})"
            )
            return False

    except requests.Timeout:
        logger.error(f"[EMAIL] Timeout sending to {admin_email} for {domain}")
        return False
    except Exception as e:
        logger.exception(f"[EMAIL] Unexpected error sending to {admin_email}: {e}")
        return False

def send_failure_alert(admin_email: str, subdomain: str, error_detail: str) -> None:
    """
    Optional: notify ops or admin of provisioning failure (best-effort).
    Uses same Brevo sender if configured, otherwise just logs.
    """
    cfg = _brevo_config()
    if not cfg["api_key"]:
        logger.warning(f"[EMAIL-ALERT] Provisioning failed for {subdomain}: {error_detail} (admin={admin_email}) — no Brevo key, logged only")
        return
    # For brevity we reuse welcome sender but could add ops recipient via env
    ops_email = os.getenv("OPS_ALERT_EMAIL", cfg["sender_email"])
    try:
        requests.post(
            BREVO_API_URL,
            json={
                "sender": {"email": cfg["sender_email"], "name": cfg["sender_name"]},
                "to": [{"email": ops_email}],
                "subject": f"[ALERT] Provisioning failed for {subdomain}.resultapp.org",
                "htmlContent": f"<p>Provisioning failed for <strong>{subdomain}</strong> (admin {admin_email})</p><pre>{error_detail}</pre>",
            },
            headers={"accept": "application/json", "api-key": cfg["api_key"], "content-type": "application/json"},
            timeout=10,
        )
    except Exception as e:
        logger.error(f"[EMAIL-ALERT] Failed to send alert: {e}")


# ---------------------------------------------------------------------------
# Transactional auth email (verification + password reset)
#
# Reuses the same Brevo v3 endpoint/sender as the welcome mail. Deliberately
# NOT using a Brevo template id anywhere: hosted templates are rendered by
# Brevo with the sender identity baked in and would bypass the in-repo
# builders (subjects, markup, shells) this file owns. Links are built at
# call time from PUBLIC_BASE_URL because the host varies by deployment.
# ---------------------------------------------------------------------------


def public_base_url() -> str:
    """Public origin used to build emailed links.

    resultapp.org now resolves via Cloudflare, so PUBLIC_BASE_URL is the source
    of truth. NEXT_PUBLIC_BASE_DOMAIN is kept as a secondary for older .env
    files; a bare domain is upgraded to https:// because the value is pasted
    straight into an href. Falls back to the production origin so a link is
    never built against a dead host.
    """
    raw = os.getenv("PUBLIC_BASE_URL", "").strip() or os.getenv(
        "NEXT_PUBLIC_BASE_DOMAIN", ""
    ).strip()
    if not raw:
        return "https://resultapp.org"
    if "://" not in raw:
        raw = f"https://{raw}"
    return raw.rstrip("/")


# ---------------------------------------------------------------------------
# Structured email markup — Google Email Markup (schema.org) for Gmail.
#
# Why: Gmail renders Inbox action chips only for senders registered with
# Google (developers.google.com/workspace/gmail/markup/registering-with-
# google). The markup ships with every send anyway — it is inert for
# unregistered senders, immediately live once approved, and self-sends render
# it for development. Gmail's OTP "Copy code" chip is separate: it is
# heuristic detection with NO schema type, satisfied by layout rules
# (code in the subject, first labeled line in the text part, one unbroken
# digit run in the HTML).
#
# Robustness: every action is emitted TWICE from one source of truth — as a
# JSON-LD <script> block (Google's preferred format) and as a hidden
# Microdata <div>. Email pipelines strip <script> tags opportunistically;
# meta/link tags survive essentially every sanitizer, so the microdata copy
# guarantees Gmail still finds the structured data even if the script copy is
# dropped. The live post-deploy self-send (Gmail "Show original") is the
# ground-truth confirmation.
#
# Rules encoded here (Google registration guidelines):
#   * action URLs are https and deep links (the page where the action
#     completes — not a marketing root);
#   * action names are short verb phrases without punctuation or ALL-CAPS;
#   * every EmailMessage carries the sender Organization as publisher.
#
# Client contract (routers/allocations.py uses this too):
#   ld = [notifier.markup_action("Open the Moderator Console", link, desc)]
#   html = notifier._auth_email_shell(..., ld=ld)
# ---------------------------------------------------------------------------

#: URL-valued schema properties render as <link href> in Microdata (the
#: Microdata rule for URL props); everything else becomes <meta content>.
_MARKUP_URL_PROPS = frozenset({"url", "target", "trackingUrl", "image", "logo", "sameAs"})

#: Sender identity merged into every EmailMessage.
_MARKUP_PUBLISHER = {"@type": "Organization", "name": "ResultApp", "url": "https://resultapp.org"}


def markup_action(name: str, url: str, description: str = "") -> Dict:
    """EmailMessage fields for one Go-To action (schema.org ViewAction).

    `name` becomes the Gmail chip label — keep it a short verb phrase with no
    punctuation or ALL-CAPS ("Verify email", "Reset password"), or the
    registration review rejects it. `url` must be the https deep link of the
    page where the action completes.
    """
    return {
        "description": description,
        "potentialAction": {"@type": "ViewAction", "name": name, "url": url},
    }


def _deep_link(base_url: str, default_path: str) -> str:
    """base_url with default_path appended unless it already targets a page.

    Callers pass a portal root ("https://school.resultapp.org"); the action
    must deep-link to where the action completes, so the bare root gains
    default_path. A caller-supplied path (login_url already pointing at
    /admin/login, say) is kept untouched.
    """
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(base_url)
    if parts.path not in ("", "/"):
        return base_url.rstrip("/")
    return urlunsplit((parts.scheme, parts.netloc, default_path, parts.query, parts.fragment))


def _microdata_nodes(prop: Optional[str], value) -> list:
    """Render one schema value as Microdata element strings (see markup_block).

    `prop` is the itemprop of THIS node (None for a top-level object). Handles
    exactly the shape we emit: dicts declaring @type, lists of such dicts, and
    scalars — anything else raises so a malformed fragment fails a guard run
    instead of shipping broken markup silently.
    """
    import html as _html

    if isinstance(value, list):
        return [part for item in value for part in _microdata_nodes(prop, item)]
    if isinstance(value, dict):
        if prop in _MARKUP_URL_PROPS:
            raise ValueError(f"URL prop {prop} cannot carry an object")
        t = value.get("@type")
        if not isinstance(t, str) or not t:
            raise ValueError("nested schema objects must declare @type")
        head = f'itemscope itemtype="https://schema.org/{t}"'
        if prop:
            head = f'itemprop="{prop}" ' + head
        inner = "".join(
            part
            for k, v in value.items()
            if k not in ("@type", "@context")
            for part in _microdata_nodes(k, v)
        )
        return [f'<div {head}>{inner}</div>']
    if prop is None:
        raise ValueError("top-level scalars are not meaningful schema")
    if prop in _MARKUP_URL_PROPS:
        return [f'<link itemprop="{prop}" href="{_html.escape(str(value), quote=True)}"/>']
    return [f'<meta itemprop="{prop}" content="{_html.escape(str(value), quote=True)}"/>']


def markup_block(sections: list) -> str:
    """One carrier string for both markup encodings of `sections`.

    The result interpolates straight into the email <body> (never the <head>:
    Gmail reads structured data from the body). Output = the JSON-LD <script>
    followed by the hidden Microdata <div>, from the same objects, so the two
    encodings cannot drift apart.
    """
    import json as _json

    enriched = []
    for section in sections:
        item = dict(section)
        item.setdefault("@context", "https://schema.org")
        item.setdefault("@type", "EmailMessage")
        if item["@type"] == "EmailMessage":
            item.setdefault("publisher", dict(_MARKUP_PUBLISHER))
        enriched.append(item)

    script = (
        '<script type="application/ld+json">'
        + _json.dumps(enriched, separators=(",", ":"), ensure_ascii=False)
        + "</script>"
    )
    fragments: list = []
    for item in enriched:
        fragments.extend(_microdata_nodes(None, item))
    microdata = (
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        + "".join(fragments)
        + "</div>"
    ) if fragments else ""
    return script + microdata


# ---------------------------------------------------------------------------
# Subject conventions — one table, applied verbatim and asserted by
# backend/scripts/verify-email-markup.py. Keep them structural (no marketing
# suffixes): Gmail's code detection and caching-by-subject both key off them.
# The OTP subject is code-dependent and built inside send_otp_email.
# ---------------------------------------------------------------------------

SUBJECT_VERIFY = "Verify your ResultApp email address"
SUBJECT_RESET = "Reset your ResultApp password"
SUBJECT_MODERATOR_GRANTED = "You now have Moderator access in {school}"
SUBJECT_MODERATOR_REVOKED = "Your Moderator access in {school} has ended"
SUBJECT_WELCOME = "Your ResultApp portal for {domain} is ready"


# ---------------------------------------------------------------------------
# Email brand theme
#
# Mirrors the deep-purple neon aesthetic of resultapp.org (the hero section and
# globals.css). Values are duplicated here rather than imported because email
# rendering is a separate surface with its own constraints:
#
# * Everything is INLINE. Gmail strips <style> blocks from the <head> of some
#   accounts and Outlook (Word engine) never honours them at all, so a
#   stylesheet-only template arrives unstyled.
# * Layout is <table>-based. Flexbox/grid are stripped by both.
# * rgba() borders degrade to nothing in Outlook, so every translucent border
#   has a solid hex fallback plus an <!--[if mso]> override.
# * The grid and clipboard icons are SVG data URIs on table cells — inline
#   <svg> is stripped by Gmail and Outlook alike.
# ---------------------------------------------------------------------------

_EMAIL_BG = "#090514"
_EMAIL_CARD_BG = "#130926"
_EMAIL_PILL_BG = "#1e113b"
#: rgba(147, 51, 234, 0.3) — the requested glow border.
_EMAIL_BORDER_RGBA = "rgba(147, 51, 234, 0.3)"
#: Solid equivalent for clients with no rgba() support (Outlook).
_EMAIL_BORDER_HEX = "#3b1d78"
_EMAIL_HEADING = "#ffffff"
_EMAIL_BODY = "#cbd5e1"
_EMAIL_MUTED = "#94a3b8"
_EMAIL_ACCENT = "#a78bfa"
_EMAIL_FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)
_EMAIL_MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace"

def _svg_data_uri(svg: str) -> str:
    """Percent-encode an SVG fragment into a CSS-safe data URI.

    This function exists because of a bug it replaces. The grid and clipboard
    URIs were previously hand-written with raw single quotes (xmlns='...')
    inside an UNQUOTED url(). Per CSS tokenisation an unquoted url() may not
    contain quotes, so the declaration is invalid and every client drops it
    silently: the markup looked perfect and the grid never painted. Verified
    in Chrome — raw quotes fail, encoded quotes render.

    Encoding is generated rather than hand-written so it cannot drift again.
    safe="" does the work: it percent-encodes quotes to %27 along with #, <,
    > and /. An earlier version also chained .replace("'", "%27"), which was
    dead code — quote() had already emitted %27 — and it wrongly implied the
    quotes were handled by an explicit rule rather than by safe="".

    The URI is emitted UNQUOTED (url(...)) because Outlook and Gmail both drop
    a quoted url() inside inline styles.
    """
    from urllib.parse import quote

    return "data:image/svg+xml;charset=utf-8," + quote(svg, safe="")


#: Blueprint grid — a 44px tile with a single hairline top+left rule.
_EMAIL_GRID_URI = _svg_data_uri(
    "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>"
    "<path d='M44 0H0v44' fill='none' stroke='#a78bfa' "
    "stroke-opacity='0.09' stroke-width='1'/></svg>"
)

#: Clipboard cue for the copy affordance beside the OTP digits.
#:
#: This was an <img> with a data:image/svg+xml source. It rendered correctly in
#: Chrome and then arrived as a TOFU SQUARE in a real mailbox — the client did
#: not decode the data URI. That is the lesson: a data-URI SVG proves nothing
#: about inbox rendering, because email sanitisers strip exactly that.
#:
#: Replaced with a TEXT glyph, which is a font lookup rather than an image
#: decode, so it cannot fail to render. U+29C9 "two joined squares" reads as a
#: copy/duplicate mark in monospace and system fonts; if a client lacks the
#: codepoint it degrades to a narrow space and the caption beneath carries the
#: meaning on its own.
_EMAIL_COPY_GLYPH = "⧉"


def _auth_email_shell(heading: str, body_html: str, footer_note: str, ld: Optional[list] = None) -> str:
    """Shared dark-theme shell for every auth email.

    Table layout, inline styles only, and an Outlook fallback for the
    translucent borders. The blueprinted grid sits on the outer wrapper so it
    reads as page texture behind the card, and disappears silently where SVG
    data URIs are unsupported.

    `footer_note` doubles as the hidden preheader (preview text clients show
    after the subject). `ld`, when given, is a list of schema.org objects
    (see markup_action) rendered as Google Email Markup right after the
    preheader — structured data lives in the <body>, never the <head>.
    """
    ld_html = markup_block(ld) if ld else ""
    return f"""<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>{heading}</title>
<!--[if mso]>
<style>body,table,td,div,p,a,h1{{color:#ffffff !important;}}</style>
<![endif]-->
</head>
<body bgcolor="{_EMAIL_BG}" style="margin:0;padding:0;background-color:{_EMAIL_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{footer_note}</div>
{ld_html}
<!-- Grid lives on this cell, NOT on <body>: a body background is painted
     beneath a full-width wrapper table, and that table's bgcolor is opaque, so
     the grid would never be visible. Putting it on the padding cell leaves the
     surrounding gutter as the only uncovered area, which is where the
     blueprint texture is actually meant to read. The URL is unquoted because
     Chrome, Outlook and Gmail all drop a quoted url() in inline styles. -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="{_EMAIL_BG}" style="background-color:{_EMAIL_BG};">
  <tr>
    <td align="center" style="padding:36px 14px;background-image:url({_EMAIL_GRID_URI});background-repeat:repeat;">
      <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;">
        <tr>
          <td bgcolor="{_EMAIL_CARD_BG}" style="background-color:{_EMAIL_CARD_BG};border:1px solid {_EMAIL_BORDER_RGBA};border-radius:20px;mso-line-height-rule:exactly;">
            <!--[if mso]>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border:1px solid {_EMAIL_BORDER_HEX};">
            <![endif]-->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <!-- Brand bar -->
              <tr>
                <td style="padding:22px 28px 0 28px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td align="left" style="font-family:{_EMAIL_FONT};font-size:15px;font-weight:700;letter-spacing:-0.01em;color:{_EMAIL_HEADING};">
                        <span style="color:{_EMAIL_ACCENT};">&#9679;</span>&nbsp;resultapp.org
                      </td>
                      <td align="right" style="font-family:{_EMAIL_FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:{_EMAIL_MUTED};">
                        Secure verification
                      </td>
                    </tr>
                  </table>
                  <div style="height:1px;line-height:1px;font-size:0;margin:18px 0 0 0;background-color:{_EMAIL_BORDER_HEX};">&nbsp;</div>
                </td>
              </tr>
              <!-- Heading -->
              <tr>
                <td style="padding:24px 28px 0 28px;">
                  <h1 style="margin:0;font-family:{_EMAIL_FONT};font-size:23px;line-height:30px;font-weight:700;letter-spacing:-0.02em;color:{_EMAIL_HEADING};">
                    {heading}
                  </h1>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:14px 28px 26px 28px;font-family:{_EMAIL_FONT};font-size:15px;line-height:23px;color:{_EMAIL_BODY};">
                  {body_html}
                </td>
              </tr>
            </table>
            <!-- Footer -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#0d0620" style="background-color:#0d0620;border-top:1px solid {_EMAIL_BORDER_HEX};border-radius:0 0 20px 20px;">
              <tr>
                <td style="padding:18px 28px;font-family:{_EMAIL_FONT};font-size:12px;line-height:19px;color:{_EMAIL_MUTED};">
                  Secured by ResultApp &bull; Automated school portal verification
                  <br />
                  If you did not request this email, you can safely ignore it.
                </td>
              </tr>
            </table>
            <!--[if mso]></td></tr></table><![endif]-->
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>""".strip()


def _cta_button(label: str, href: str, tint: str = "#7c3aed") -> str:
    """VML bulletproof button. A styled <a> is unreliable in Outlook."""
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
<tr>
<td align="center" bgcolor="{tint}" style="background-color:{tint};border-radius:999px;mso-line-height-rule:exactly;">
<a href="{href}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:{_EMAIL_FONT};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:999px;mso-padding-alt:14px 30px;">{label}</a>
</td>
</tr>
</table>
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="50%" strokecolor="{tint}" fillcolor="{tint}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">{label}</center>
</v:roundrect>
<![endif]-->""".strip()


def _fallback_link(link: str) -> str:
    """Plain-text link for clients that drop the button."""
    return f"""<p style="margin:18px 0 0 0;font-family:{_EMAIL_FONT};font-size:12px;line-height:19px;color:{_EMAIL_MUTED};word-break:break-all;">
Button not working? Copy this link:<br />
<a href="{link}" target="_blank" style="color:{_EMAIL_ACCENT};text-decoration:underline;word-break:break-all;">{link}</a>
</p>""".strip()


def send_auth_email(to_email: str, subject: str, html: str, text: str) -> bool:
    """Low-level Brevo transactional send.

    Returns True only when Brevo accepted the message.

    DEV-MODE CONTRACT: with no BREVO_API_KEY this logs the rendered link and
    returns False. That is deliberately different from send_welcome_email
    (which returns True) — telling a user "check your email" when nothing was
    sent is the worst outcome for a verification flow. Returning False lets the
    caller surface a real "we couldn't send it" instead of a silent no-op.
    """
    cfg = _brevo_config()
    if not cfg["api_key"]:
        logger.warning(
            f"[EMAIL-AUTH] BREVO_API_KEY not set — NOT sending \"{subject}\" to {to_email}. "
            f"Configure BREVO_API_KEY to enable auth email."
        )
        return False

    payload = {
        "sender": {"email": cfg["sender_email"], "name": cfg["sender_name"]},
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    headers = {
        "accept": "application/json",
        "api-key": cfg["api_key"],
        "content-type": "application/json",
    }
    try:
        resp = requests.post(BREVO_API_URL, json=payload, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            data = resp.json() if resp.content else {}
            logger.info(
                f"[EMAIL-AUTH] Sent \"{subject}\" to {to_email} "
                f"(msgId={data.get('messageId') or 'unknown'})"
            )
            return True
        # 401/403 almost always means a wrong/expired API key — loud, because
        # it is a config bug that silently disables the whole auth flow.
        if resp.status_code in (401, 403):
            logger.error(
                f"[EMAIL-AUTH] Brevo rejected the API key ({resp.status_code}) — "
                f"verification/reset email is DISABLED until BREVO_API_KEY is fixed."
            )
        else:
            logger.error(f"[EMAIL-AUTH] Brevo error {resp.status_code} for {to_email}: {resp.text[:500]}")
        return False
    except requests.Timeout:
        logger.error(f"[EMAIL-AUTH] Timeout sending \"{subject}\" to {to_email}")
        return False
    except Exception as e:
        logger.exception(f"[EMAIL-AUTH] Unexpected error sending \"{subject}\": {e}")
        return False


def send_otp_email(to_email: str, raw_code: str, expires_minutes: int = 10) -> bool:
    """Email a short numeric code for the registration wizard.

    Unlike the link-based emails there is no public_base_url() involvement: the
    code is typed back into the same tab, so nothing is built from PUBLIC_BASE_URL
    and a misconfigured host cannot break inbox ownership.

    The code rides in three places, by design: the subject line (mobile lock
    screens and Gmail's notification previews show it, saving the app switch),
    the first labeled line of the text/plain part, and the big pill in the
    HTML. Gmail's "Copy code" chip and iOS Mail's autofill key off exactly
    that placement. There is no schema.org type for codes — this is layout,
    not markup. The raw code is never logged at INFO; the caller logs
    success/failure without echoing it.
    """
    code = str(raw_code or "").strip()
    if len(code) != 6 or not code.isdigit():
        logger.error("[EMAIL-AUTH] refusing to send a malformed OTP (expected 6 digits)")
        return False

    minutes = max(1, int(expires_minutes or 10))
    # The pill is a real <table> cell, not a styled <span>: Outlook ignores
    # letter-spacing padding on inline elements and would clip the last digit.
    # The trailing spacer cell balances the letter-spacing on the right.
    body = f"""
        <p style="margin:0 0 8px 0;font-family:{_EMAIL_FONT};font-size:15px;line-height:23px;color:{_EMAIL_BODY};">
          Confirm your email address to finish creating your ResultApp school portal.
        </p>
        <p style="margin:0 0 18px 0;font-family:{_EMAIL_FONT};font-size:15px;line-height:23px;color:{_EMAIL_BODY};">
          Enter this code on the registration page to continue.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 20px 0;">
          <tr>
            <td align="center" bgcolor="{_EMAIL_PILL_BG}" style="background-color:{_EMAIL_PILL_BG};border:1px solid {_EMAIL_BORDER_RGBA};border-radius:18px;padding:20px 26px;mso-line-height-rule:exactly;">
              <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td bgcolor="{_EMAIL_PILL_BG}" style="border:1px solid {_EMAIL_BORDER_HEX};"><![endif]-->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td align="center" style="font-family:{_EMAIL_MONO};font-size:38px;line-height:44px;font-weight:700;letter-spacing:12px;color:{_EMAIL_HEADING};text-shadow:0 0 22px rgba(147,51,234,0.55);mso-line-height-rule:exactly;"><code>{code}</code></td>
                </tr>
              </table>
              <!--[if mso]></td></tr></table><![endif]-->
            </td>
            <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
            <td aria-hidden="true" valign="middle" align="center" style="valign:middle;text-align:center;font-family:{_EMAIL_FONT};font-size:15px;line-height:20px;color:{_EMAIL_ACCENT};">{_EMAIL_COPY_GLYPH}</td>
          </tr>
        </table>
        <p style="margin:0 0 20px 0;font-family:{_EMAIL_FONT};font-size:13px;line-height:20px;color:{_EMAIL_MUTED};text-align:center;">
          Copy the six digits above and paste them into the registration page.
        </p>
        <p style="margin:0;font-family:{_EMAIL_FONT};font-size:12px;line-height:19px;color:{_EMAIL_MUTED};">
          This code expires in {minutes} minutes and can only be used once. If it expires, request a new one from the registration page.
        </p>
    """
    text = (
        f"Code: {code}\n\n"
        "Confirm your email address to finish creating your ResultApp school portal.\n\n"
        f"This code expires in {minutes} minutes and can only be used once."
    )
    ok = send_auth_email(
        to_email.strip().lower(),
        f"{code} is your ResultApp verification code",
        _auth_email_shell(
            "Confirm your email",
            body,
            f"Expires in {minutes} minutes — enter it on the registration page.",
            ld=None,
        ),
        text,
    )
    if not ok:
        logger.warning(f"[EMAIL-AUTH] OTP NOT delivered to {to_email} (code not logged)")
    return ok


def send_verification_email(to_email: str, to_name: str, raw_token: str, tenant: str = "") -> bool:
    """Email an inbox-ownership link. Never logs the raw token at INFO."""
    link = f"{public_base_url()}/verify-email?token={raw_token}&email={to_email.strip().lower()}"
    who = f" for {tenant}" if tenant else ""
    greeting = to_name.strip() or "there"
    ld = [
        markup_action(
            "Verify email",
            link,
            f"Confirm your email address to finish setting up your ResultApp account{who}.",
        )
    ]
    body = f"""
        <p style="margin:0 0 10px 0;font-family:{_EMAIL_FONT};font-size:15px;line-height:23px;color:{_EMAIL_BODY};">
          Hi {greeting},
        </p>
        <p style="margin:0;font-family:{_EMAIL_FONT};font-size:15px;line-height:23px;color:{_EMAIL_BODY};">
          Please confirm your email address to finish setting up your ResultApp account{who}.
        </p>
        {_cta_button("Verify my email", link)}
        {_fallback_link(link)}
        <p style="margin:20px 0 0 0;font-family:{_EMAIL_FONT};font-size:12px;line-height:19px;color:{_EMAIL_MUTED};">
          This link expires in 24 hours. If it expires, request a new one from the sign-in page.
        </p>
    """
    text = (
        f"Verify: {link}\n\n"
        f"Hi {greeting}, please confirm your email address to finish setting up "
        f"your ResultApp account{who}.\n\n"
        f"This link expires in 24 hours."
    )
    ok = send_auth_email(
        to_email.strip().lower(),
        SUBJECT_VERIFY,
        _auth_email_shell("Confirm your email", body, "Your verification link — expires in 24 hours.", ld),
        text,
    )
    if not ok:
        # Never print the token — a log line is not a secure channel.
        logger.warning(f"[EMAIL-AUTH] Verification email NOT delivered to {to_email} (link not logged)")
    return ok


def send_password_reset_email(to_email: str, to_name: str, raw_token: str, tenant: str = "") -> bool:
    """Email a password-reset link. Never logs the raw token at INFO."""
    link = f"{public_base_url()}/reset-password?token={raw_token}&email={to_email.strip().lower()}"
    who = f" for {tenant}" if tenant else ""
    greeting = to_name.strip() or "there"
    ld = [
        markup_action(
            "Reset password",
            link,
            f"Choose a new password for your ResultApp account{who}.",
        )
    ]
    body = f"""
        <p style="margin:0 0 10px 0;font-family:{_EMAIL_FONT};font-size:15px;line-height:23px;color:{_EMAIL_BODY};">
          Hi {greeting},
        </p>
        <p style="margin:0;font-family:{_EMAIL_FONT};font-size:15px;line-height:23px;color:{_EMAIL_BODY};">
          We received a request to reset the password for your ResultApp account{who}.
        </p>
        {_cta_button("Choose a new password", link)}
        {_fallback_link(link)}
        <p style="margin:20px 0 0 0;font-family:{_EMAIL_FONT};font-size:12px;line-height:19px;color:{_EMAIL_MUTED};">
          This link expires in 1 hour and can only be used once.
        </p>
        <p style="margin:16px 0 0 0;font-family:{_EMAIL_FONT};font-size:12px;line-height:19px;color:#fca5a5;">
          If you did not request this, no action is needed — your password stays unchanged.
        </p>
    """
    text = (
        f"Reset: {link}\n\n"
        f"Hi {greeting}, we received a request to reset the password for your "
        f"ResultApp account{who}.\n\n"
        f"This link expires in 1 hour and can only be used once.\n"
        f"If you did not request this, no action is needed."
    )
    ok = send_auth_email(
        to_email.strip().lower(),
        SUBJECT_RESET,
        _auth_email_shell("Reset your password", body, "Your reset link — expires in 1 hour.", ld),
        text,
    )
    if not ok:
        logger.warning(f"[EMAIL-AUTH] Reset email NOT delivered to {to_email} (link not logged)")
    return ok
