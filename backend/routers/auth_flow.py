"""
Email verification + password recovery — public auth surface.

Prefix: /api/v1/auth

Security posture
----------------
* Same system-to-system X-API-SECRET-KEY gate as the other routers. The
  browser never talks here directly; the Next.js proxies under app/api/auth/*
  verify the user's session/inputs first, then call in with the shared secret
  injected server-side.

* NO ACCOUNT ENUMERATION. /forgot-password and /request-verification return the
  same 200 shape whether or not the address exists. An attacker must not be able
  to distinguish "unknown email" from "known email" to harvest the tenant
  roster, which is a list of real Nigerian schools and their staff.

* Tokens are single-use and expire (24h verification / 1h reset). They are
  compared by SHA-256 hash with hmac.compare_digest, and only the hash is
  stored — see services/db_manager.py.

* Requesting a new token INVALIDATES the previous one, so only the most recent
  email contains a working link. Per-email cooldown stops mail-bombing.

Scope: tenant admins (schools) and superadmins (platform_admins). Staff accounts
are deliberately untouched — they authenticate by Staff ID with a shared default
PIN and frequently have no email on file.
"""

import logging
import os
import time
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from services import rate_limit

logger = logging.getLogger(__name__)


async def _verify_auth_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac as _hmac

        API_SECRET = os.getenv("API_SECRET_KEY", "")
        ENV = os.getenv("ENV", "production")
        if not API_SECRET:
            if ENV != "production":
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
                return True
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfigured: API_SECRET_KEY not set",
            )
        if not x_api_secret_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not _hmac.compare_digest(x_api_secret_key, API_SECRET):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(
    prefix="/api/v1/auth",
    tags=["auth"],
    dependencies=[Depends(_verify_auth_secret)],
)

# ---------------------------------------------------------------------------
# Rate limiting — in-process, best-effort.
#
# Not a substitute for a shared store across workers; it exists to stop a
# single caller spamming a mailbox during testing. The DB-side token overwrite
# is the real protection (only the newest link works).
# ---------------------------------------------------------------------------

_RESEND_COOLDOWN_SECONDS = int(os.getenv("AUTH_RESEND_COOLDOWN_SECONDS", "60"))
#: Keyed by (action, email). Bounded so it cannot grow without limit.
_last_request: Dict[str, float] = {}
_MAX_TRACKED_KEYS = 5000


def _cooldown_ok(key: str) -> bool:
    now = time.time()
    if len(_last_request) > _MAX_TRACKED_KEYS:
        _last_request.clear()
    prev = _last_request.get(key)
    if prev is not None and (now - prev) < _RESEND_COOLDOWN_SECONDS:
        return False
    _last_request[key] = now
    return True


def _release_cooldown(key: str) -> None:
    """Undo a cooldown reservation when the send it gated never happened.

    _cooldown_ok() reserves the window BEFORE the mail is attempted, which is
    the right order for anti-abuse — but it means an operational failure (Brevo
    rejecting the key, a 5xx) also burns the window. The caller then gets the
    neutral "sent" response on every retry for the next minute: the worst
    possible answer, because it tells a user to check an inbox that will never
    receive anything.

    Releasing on failure keeps the throttle doing its job against real abuse
    (a successful send still holds the window) while letting someone retry
    immediately after a transient error.
    """
    _last_request.pop(key, None)


def _normalise(email: str) -> str:
    return str(email or "").strip().lower()


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    token: str = Field(..., min_length=8, max_length=200)


class RequestVerificationRequest(BaseModel):
    email: EmailStr
    scope: str = Field("schools", pattern="^(schools|platform_admins)$")


class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    scope: str = Field("schools", pattern="^(schools|platform_admins)$")


class CheckResetTokenRequest(BaseModel):
    email: EmailStr
    token: str = Field(..., min_length=8, max_length=200)
    scope: str = Field("schools", pattern="^(schools|platform_admins)$")


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    token: str = Field(..., min_length=8, max_length=200)
    new_password: str = Field(..., min_length=8, max_length=128)
    scope: str = Field("schools", pattern="^(schools|platform_admins)$")


class RequestEmailOtpRequest(BaseModel):
    email: EmailStr
    purpose: str = Field("registration", pattern="^registration$")


class VerifyEmailOtpRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6, pattern="^[0-9]{6}$")
    purpose: str = Field("registration", pattern="^registration$")


# Uniform response for anything account-scoped. Never varies with existence.
_GENERIC_SENT = {
    "success": True,
    "sent": True,
    "message": "If that address has a ResultApp account, a link is on its way.",
}


@router.post("/verify-email", summary="Consume an email-verification token")
def verify_email(payload: VerifyEmailRequest):
    """Single-use: the hash is nulled by the same UPDATE that flips the flag."""
    from services.db_manager import consume_verification_token

    email = _normalise(payload.email)

    # Try schools first, then platform_admins — a token is issued against a
    # specific table, and only one of these will hold a matching hash.
    for table in ("schools", "platform_admins"):
        if consume_verification_token(email, payload.token, table=table):
            logger.info(f"[auth-flow] email verified: {email} ({table})")
            return {"success": True, "verified": True, "email": email}

    # One generic failure for "wrong token", "expired", and "replayed" so the
    # response cannot be used as an oracle.
    return {"success": False, "verified": False, "message": "This verification link is invalid or has expired."}


@router.post("/request-verification", summary="Issue a verification token (neutral response)")
def request_verification(payload: RequestVerificationRequest):
    email = _normalise(payload.email)

    if not _cooldown_ok(f"verify:{payload.scope}:{email}"):
        # Neutral: identical body to the success path.
        return _GENERIC_SENT

    from services.db_manager import is_email_verified, issue_verification_token
    from services.notifier import send_verification_email

    verified = is_email_verified(email, table=payload.scope)
    if verified is True:
        # Already verified — nothing to send, and the caller learns nothing new.
        return _GENERIC_SENT

    issued = issue_verification_token(email, table=payload.scope)
    if issued is None:
        # Unknown address: still the generic 200.
        return _GENERIC_SENT

    tenant = issued.get("name") or ""
    delivered = send_verification_email(
        issued["email"], issued.get("name") or "", issued["raw_token"], tenant=tenant
    )
    if not delivered:
        # Mail failure is an operational problem, not an enumeration risk, so it
        # is surfaced honestly — but only for an address that actually exists.
        logger.error(f"[auth-flow] verification email not delivered to {email}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="We could not send the verification email. Please try again shortly.",
        )
    return _GENERIC_SENT


@router.post("/forgot-password", summary="Issue a password-reset token (always 200)")
def forgot_password(payload: ForgotPasswordRequest):
    email = _normalise(payload.email)

    if not _cooldown_ok(f"reset:{payload.scope}:{email}"):
        return _GENERIC_SENT

    from services.db_manager import issue_reset_token
    from services.notifier import send_password_reset_email

    issued = issue_reset_token(email, table=payload.scope)
    if issued is None:
        # Unknown address — generic 200, no email sent.
        return _GENERIC_SENT

    tenant = issued.get("name") or ""
    delivered = send_password_reset_email(
        issued["email"], issued.get("name") or "", issued["raw_token"], tenant=tenant
    )
    if not delivered:
        logger.error(f"[auth-flow] reset email not delivered to {email}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="We could not send the reset email. Please try again shortly.",
        )
    return _GENERIC_SENT


@router.post("/check-reset-token", summary="Pre-flight a reset link without consuming it")
def check_reset_token(payload: CheckResetTokenRequest):
    """Lets /reset-password reject an expired link BEFORE the user types a new
    password, so they are not told "invalid token" after doing so.

    Returns a uniform {valid:false} for unknown/used tokens — it never confirms
    whether an address exists.
    """
    from services.db_manager import check_reset_token as _check

    email = _normalise(payload.email)
    for table in ("schools", "platform_admins"):
        state = _check(email, payload.token, table=table)
        if state.get("ok"):
            return {"valid": not state.get("expired"), "expired": bool(state.get("expired"))}
    return {"valid": False, "expired": False}


@router.post("/reset-password", summary="Consume a reset token and set a new password")
def reset_password(payload: ResetPasswordRequest):
    from services.db_manager import consume_reset_token_set_password

    email = _normalise(payload.email)

    for table in ("schools", "platform_admins"):
        if consume_reset_token_set_password(email, payload.token, payload.new_password, table=table):
            logger.info(f"[auth-flow] password reset for {email} ({table})")
            return {"success": True, "reset": True, "email": email}

    # Uniform failure for wrong / expired / already-used token.
    return {
        "success": False,
        "reset": False,
        "message": "This reset link is invalid or has expired. Request a new one.",
    }


# ---------------------------------------------------------------------------
# Email OTP — registration wizard inbox-ownership proof.
#
# Why OTP rather than the existing verification link: a link opens a new tab,
# which tears down the multi-step wizard's client state and the payment handoff
# that follows it. A 6-digit code keeps the user in the same tab.
#
# Enumeration posture: the request endpoint NEVER reveals whether an address is
# registered or already verified — the registration wizard is precisely the
# place where "unknown email" and "email already taken" are both sensitive
# answers. The verify endpoint's failure modes (wrong / expired / replayed /
# attempt-cap) are collapsed into one uniform false.
# ---------------------------------------------------------------------------

#: Uniform response for anything account-scoped. Never varies with existence.
_OTP_SENT = {
    "success": True,
    "sent": True,
    "message": "If that address can receive mail, a verification code is on its way.",
}

#: Verify-side throttle. A 6-digit code has only 1e6 candidates, so this plus
#: the per-code attempt cap in db_manager are the controls that matter — the
#: SHA-256 hash only ensures the raw code is never at rest.
_OTP_VERIFY_MAX_HITS = 10
_OTP_VERIFY_WINDOW_S = 300


@router.post("/request-email-otp", summary="Issue a registration OTP (neutral response)")
def request_email_otp(payload: RequestEmailOtpRequest, request: Request):
    email = _normalise(payload.email)
    client_ip = request.client.host if request.client else "unknown"

    if not _cooldown_ok(f"otp:{payload.purpose}:{email}"):
        # Neutral: identical body to the success path.
        return _OTP_SENT

    # Per-address cap on generation: stops a caller cycling through many
    # addresses to mail-bomb a domain.
    allowed, retry_after = rate_limit.check(
        f"otp-send:{email}", max_hits=5, window_s=3600
    )
    if not allowed:
        logger.warning(
            f"[auth-flow] OTP generation rate limit hit for {email} "
            f"(client={client_ip}); suppressing send"
        )
        return _OTP_SENT

    from services.db_manager import issue_email_otp
    from services.notifier import send_otp_email

    issued = issue_email_otp(email, purpose=payload.purpose)
    if issued is None:
        # Storage failure — not an enumeration risk (no code exists either way).
        logger.error(f"[auth-flow] could not issue OTP for {email}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We could not send a verification code. Please try again shortly.",
        )

    delivered = send_otp_email(
        issued["email"],
        issued["raw_code"],
        expires_minutes=int(issued.get("ttl_minutes") or 10),
    )
    if not delivered:
        # Surfaced honestly — an operator needs to see that mail is broken, and
        # the code is worthless to anyone who did not receive it, so this
        # discloses nothing an attacker could already guess.
        logger.error(f"[auth-flow] OTP email not delivered to {email}")
        # Nothing was sent, so the user must be able to retry at once instead of
        # being met with a neutral "sent" for the rest of the cooldown window.
        _release_cooldown(f"otp:{payload.purpose}:{email}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="We could not send the verification code. Please try again shortly.",
        )
    return _OTP_SENT


@router.post("/verify-email-otp", summary="Verify a registration OTP")
def verify_email_otp(payload: VerifyEmailOtpRequest, request: Request):
    email = _normalise(payload.email)
    client_ip = request.client.host if request.client else "unknown"

    allowed, retry_after = rate_limit.check(
        f"otp-verify:{client_ip}:{email}",
        max_hits=_OTP_VERIFY_MAX_HITS,
        window_s=_OTP_VERIFY_WINDOW_S,
    )
    if not allowed:
        logger.warning(
            f"[auth-flow] OTP verify rate limit hit (client={client_ip}); "
            f"retry in {retry_after}s"
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please request a new code and wait a moment.",
        )

    from services.db_manager import consume_email_otp

    ok = consume_email_otp(email, payload.code, purpose=payload.purpose)
    if ok:
        logger.info(f"[auth-flow] email OTP verified: {email} (client={client_ip})")
        return {"success": True, "verified": True, "email": email}

    # One message for wrong / expired / replayed / attempt-cap. Never echo which.
    return {
        "success": False,
        "verified": False,
        "message": "That code is incorrect or has expired. Request a new one.",
    }


# NOTE — deliberately NO "/verify-status" endpoint here.
# A public "does this address exist and is it verified?" route would itself be
# the enumeration oracle P0-1 closed: it turns the auth surface into a roster
# lookup. The verified flag is instead returned by the LOGIN responses
# (routers/admin_auth.py, routers/platform_auth.py), so it is only ever
# disclosed to someone who already proved they hold valid credentials.
