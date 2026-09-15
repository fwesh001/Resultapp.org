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
        "sender_email": os.getenv("BREVO_SENDER_EMAIL", "noreply@resultapp.org"),
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
