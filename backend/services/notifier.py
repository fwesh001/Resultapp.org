"""
Brevo (ex-Sendinblue) notifier for ResultApp Droplet.
Sends welcome email with temporary credentials and login URL.

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
        "template_id": os.getenv("BREVO_WELCOME_TEMPLATE_ID", ""),
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
) -> str:
    """
    Returns HTML for welcome email. Keep inline CSS for email client compatibility.
    """
    total = student_count * 100
    # Use en-NG formatting
    total_fmt = f"₦{total:,}"

    return f"""
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f6f6f9;font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1a1a1a;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:24px;border:1px solid #e5e5e5;">
      <div style="background:#000000;color:#ffffff;padding:24px;">
        <h1 style="margin:0;font-size:22px;">Welcome to ResultApp, {school_name}!</h1>
        <p style="margin:8px 0 0;color:#a1a1aa;font-size:14px;">Your school portal is live at <strong style="color:#fff;">{domain}</strong></p>
      </div>
      <div style="padding:24px;">
        <p style="font-size:15px;line-height:22px;">Hi {admin_name},</p>
        <p style="font-size:15px;line-height:22px;color:#3f3f46;">
          Your payment for <strong>{student_count} students</strong> ({total_fmt} at ₦100/student) has been confirmed.
          Your isolated RosarioSIS instance is ready.
        </p>

        <div style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 10px;font-weight:600;font-size:14px;">Your temporary credentials</p>
          <p style="margin:6px 0;font-size:14px;"><strong>Login URL:</strong> <a href="{login_url}" style="color:#2563eb;word-break:break-all;">{login_url}</a></p>
          <p style="margin:6px 0;font-size:14px;"><strong>Username:</strong> <span style="font-family:monospace;background:#fff;border:1px solid #e4e4e7;padding:2px 6px;border-radius:4px;">{temp_username}</span></p>
          <p style="margin:6px 0;font-size:14px;"><strong>Temporary Password:</strong> <span style="font-family:monospace;background:#fff;border:1px solid #e4e4e7;padding:2px 6px;border-radius:4px;">{temp_password}</span></p>
          <p style="margin:10px 0 0;font-size:12px;color:#71717a;">You will be prompted to change your password on first login. Keep this email safe.</p>
        </div>

        <a href="{login_url}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:14px;">Go to your portal →</a>

        <div style="margin-top:24px;padding:16px;background:#eff6ff;border-radius:8px;">
          <p style="margin:0;font-size:13px;color:#1e40af;"><strong>What’s next?</strong></p>
          <ol style="margin:8px 0 0;padding-left:18px;color:#334155;font-size:13px;line-height:20px;">
            <li>Log in and change your temporary password</li>
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
    temp_credentials: Dict[str, str],
    domain: Optional[str] = None,
    login_url: Optional[str] = None,
) -> bool:
    """
    Send welcome email via Brevo.

    Returns True on success, False on failure (logs details).
    If BREVO_API_KEY is missing, logs and returns True (dev mode — no-op).
    """
    cfg = _brevo_config()
    domain = domain or f"{subdomain.lower().strip()}.resultapp.org"
    login_url = login_url or f"https://{domain}"

    # Dev/CI mode without key: log only
    if not cfg["api_key"]:
        logger.warning(
            f"[EMAIL] BREVO_API_KEY not set — skipping real send for {admin_email} "
            f"(domain={domain}, user={temp_credentials.get('username')}). "
            f"In production set BREVO_API_KEY to enable email."
        )
        # For Droplet dev without Brevo, we still want to log the credentials
        logger.info(
            f"[EMAIL-DEV] Would send to {admin_email}: "
            f"login={login_url} user={temp_credentials.get('username')} pass={temp_credentials.get('password')}"
        )
        return True

    # If a Brevo template is configured, use it; else send raw htmlContent
    use_template = bool(cfg["template_id"] and cfg["template_id"].strip())

    payload: Dict = {
        "sender": {"email": cfg["sender_email"], "name": cfg["sender_name"]},
        "to": [{"email": admin_email, "name": admin_name}],
        "subject": f"Your ResultApp portal is ready — {domain}",
        "tags": ["provisioning", "welcome", f"subdomain:{subdomain}"],
        "headers": {"X-ResultApp-Subdomain": subdomain},
    }

    if use_template:
        try:
            tid = int(cfg["template_id"])
        except ValueError:
            logger.error(f"[EMAIL] BREVO_WELCOME_TEMPLATE_ID must be numeric, got '{cfg['template_id']}'")
            use_template = False
            tid = None
        if use_template:
            payload["templateId"] = tid
            payload["params"] = {
                "school_name": school_name,
                "subdomain": subdomain,
                "domain": domain,
                "login_url": login_url,
                "admin_name": admin_name,
                "admin_email": admin_email,
                "student_count": student_count,
                "temp_username": temp_credentials.get("username", admin_email),
                "temp_password": temp_credentials.get("password", ""),
                "total_amount": student_count * 100,
            }

    if not use_template:
        html = _build_welcome_html(
            school_name=school_name,
            subdomain=subdomain.lower().strip(),
            domain=domain,
            admin_name=admin_name,
            admin_email=admin_email,
            student_count=student_count,
            temp_username=temp_credentials.get("username", admin_email),
            temp_password=temp_credentials.get("password", ""),
            login_url=login_url,
        )
        payload["htmlContent"] = html
        payload["textContent"] = (
            f"Welcome to ResultApp, {school_name}!\n"
            f"Your portal: {login_url}\n"
            f"Username: {temp_credentials.get('username', admin_email)}\n"
            f"Temporary Password: {temp_credentials.get('password', '')}\n"
            f"Student slots: {student_count} (NGN {student_count*100} paid)\n"
            f"Please change your password on first login.\n"
        )

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
# NOT using a template id here: Brevo templating renders the sender identity
# from the template, and we need the link built at call time from
# PUBLIC_BASE_URL (no resultapp.org domain yet, so the host varies).
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

#: Blueprint grid — a 44px tile with a single hairline top/left rule.
_EMAIL_GRID_URI = (
    "data:image/svg+xml;charset=utf-8,"
    "%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='44'%20height='44'%3E"
    "%3Cpath%20d='M44%200H0v44'%20fill='none'%20stroke='%23a78bfa'%20"
    "stroke-opacity='0.09'%20stroke-width='1'/%3E%3C/svg%3E"
)

#: Clipboard glyph for the copy cue on the OTP pill.
_EMAIL_CLIP_URI = (
    "data:image/svg+xml;charset=utf-8,"
    "%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='15'%20height='15'%20"
    "viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23a78bfa'%20"
    "stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E"
    "%3Crect%20x='9'%20y='9'%20width='13'%20height='13'%20rx='2'/%3E"
    "%3Cpath%20d='M5%2015H4a2%202%200%200%201-2V4a2%202%200%200%202-2h9a2%202%200%200%202%202v1'/%3E"
    "%3C/svg%3E"
)


def _auth_email_shell(heading: str, body_html: str, footer_note: str) -> str:
    """Shared dark-theme shell for every auth email.

    Table layout, inline styles only, and an Outlook fallback for the
    translucent borders. The blueprinted grid sits on the outer wrapper so it
    reads as page texture behind the card, and disappears silently where SVG
    data URIs are unsupported.
    """
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
<body bgcolor="{_EMAIL_BG}" style="margin:0;padding:0;background-color:{_EMAIL_BG};background-image:url({_EMAIL_GRID_URI});background-repeat:repeat;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{footer_note}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="{_EMAIL_BG}" style="background-color:{_EMAIL_BG};background-image:url({_EMAIL_GRID_URI});background-repeat:repeat;">
  <tr>
    <td align="center" style="padding:36px 14px;">
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
                <td style="padding:24px 28px 0 28px;font-family:{_EMAIL_FONT};font-size:23px;line-height:30px;font-weight:700;letter-spacing:-0.02em;color:{_EMAIL_HEADING};">
                  {heading}
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

    The raw code appears in the subject-adjacent body only, and is never logged
    at INFO — the caller logs success/failure without echoing it.
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
                  <td align="center" style="font-family:{_EMAIL_MONO};font-size:38px;line-height:44px;font-weight:700;letter-spacing:12px;color:{_EMAIL_HEADING};text-shadow:0 0 22px rgba(147,51,234,0.55);mso-line-height-rule:exactly;">{code}</td>
                </tr>
              </table>
              <!--[if mso]></td></tr></table><![endif]-->
            </td>
            <td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
            <td valign="middle" style="valign:middle;">
              <img src="{_EMAIL_CLIP_URI}" width="15" height="15" alt="" style="display:block;width:15px;height:15px;border:0;outline:none;text-decoration:none;" />
            </td>
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
        "Confirm your email address to finish creating your ResultApp school portal.\n\n"
        f"Code: {code}\n\n"
        f"This code expires in {minutes} minutes and can only be used once."
    )
    ok = send_auth_email(to_email.strip().lower(), "Your ResultApp verification code", _auth_email_shell("Confirm your email", body, "Verification code."), text)
    if not ok:
        logger.warning(f"[EMAIL-AUTH] OTP NOT delivered to {to_email} (code not logged)")
    return ok


def send_verification_email(to_email: str, to_name: str, raw_token: str, tenant: str = "") -> bool:
    """Email an inbox-ownership link. Never logs the raw token at INFO."""
    link = f"{public_base_url()}/verify-email?token={raw_token}&email={to_email.strip().lower()}"
    who = f" for {tenant}" if tenant else ""
    greeting = to_name.strip() or "there"
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
        f"Hi {greeting},\n\n"
        f"Please confirm your email address to finish setting up your ResultApp account{who}.\n\n"
        f"Verify: {link}\n\n"
        f"This link expires in 24 hours."
    )
    ok = send_auth_email(to_email.strip().lower(), "Verify your ResultApp email", _auth_email_shell("Confirm your email", body, "Verification email."), text)
    if not ok:
        # Never print the token — a log line is not a secure channel.
        logger.warning(f"[EMAIL-AUTH] Verification email NOT delivered to {to_email} (link not logged)")
    return ok


def send_password_reset_email(to_email: str, to_name: str, raw_token: str, tenant: str = "") -> bool:
    """Email a password-reset link. Never logs the raw token at INFO."""
    link = f"{public_base_url()}/reset-password?token={raw_token}&email={to_email.strip().lower()}"
    who = f" for {tenant}" if tenant else ""
    greeting = to_name.strip() or "there"
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
        f"Hi {greeting},\n\n"
        f"We received a request to reset the password for your ResultApp account{who}.\n\n"
        f"Reset here: {link}\n\n"
        f"This link expires in 1 hour and can only be used once.\n"
        f"If you did not request this, no action is needed."
    )
    ok = send_auth_email(to_email.strip().lower(), "Reset your ResultApp password", _auth_email_shell("Reset your password", body, "Password reset email."), text)
    if not ok:
        logger.warning(f"[EMAIL-AUTH] Reset email NOT delivered to {to_email} (link not logged)")
    return ok
