#!/usr/bin/env python3
"""Render the auth email templates to disk for visual inspection.

Does not send anything. Writes OTP + verification HTML so the design can be
opened in a browser exactly as a mail client would render it.
"""
import pathlib
import re
import sys

sys.path.insert(0, "backend")

from services.notifier import (  # noqa: E402
    _auth_email_shell,
    _EMAIL_BG,
    _EMAIL_CARD_BG,
    _EMAIL_PILL_BG,
    _EMAIL_BORDER_RGBA,
    _EMAIL_GRID_URI,
    _EMAIL_COPY_GLYPH,
)

OUT = pathlib.Path("tmp-email-preview")
OUT.mkdir(exist_ok=True)

# Reproduce the OTP body by calling the real builder, then capture the HTML the
# way Brevo would receive it.
import services.notifier as nt  # noqa: E402

captured = {}
orig = nt.send_auth_email


def spy(to_email, subject, html, text):
    captured["html"] = html
    captured["subject"] = subject
    captured["text"] = text
    return True


nt.send_auth_email = spy
nt.send_otp_email("preview@example.com", "123456", expires_minutes=10)

(OUT / "otp.html").write_text(captured["html"], encoding="utf-8")
(OUT / "otp.txt").write_text(captured["text"], encoding="utf-8")

nt.send_auth_email = orig

# Verification-link preview
body = (
    '<p style="margin:0 0 10px 0;font-family:%s;font-size:15px;color:%s;">Hi Jane,</p>'
    % ("-apple-system,sans-serif", "#cbd5e1")
)
from services.notifier import _cta_button, _fallback_link  # noqa: E402

link = "https://resultapp.org/verify-email?token=PREVIEWTOKENNOTREAL&email=preview%40example.com"
body += (
    '<p style="margin:0;font-size:15px;color:#cbd5e1;">Please confirm your email address.</p>'
    + _cta_button("Verify my email", link)
    + _fallback_link(link)
)
(OUT / "verify.html").write_text(
    _auth_email_shell("Confirm your email", body, "Verification email."), encoding="utf-8"
)

# --- assertions on the rendered output -------------------------------------
otp_html = (OUT / "otp.html").read_text(encoding="utf-8")

checks = [
    ("outer bg is midnight purple", f'bgcolor="{_EMAIL_BG}"' in otp_html),
    ("card bg present", f'bgcolor="{_EMAIL_CARD_BG}"' in otp_html),
    ("pill bg present", f'bgcolor="{_EMAIL_PILL_BG}"' in otp_html),
    ("glow border rgba", _EMAIL_BORDER_RGBA in otp_html),
    ("grid data-uri embedded", "data:image/svg+xml" in otp_html and _EMAIL_GRID_URI.split(",")[1][:20] in otp_html),
    ("copy cue is a TEXT glyph", _EMAIL_COPY_GLYPH in otp_html),
    ("no <img> anywhere in the render", "<img" not in otp_html),
    # The grid is still an SVG data URI and is verified separately by
    # verify-email-grid.py / verify-email-uri.py. What must not come back is an
    # <img>, i.e. an image DECODE dependency — which is exactly what broke.
    ("no data:image inside an <img>", not re.search(r'<img[^>]*data:image', otp_html)),
    ("code rendered", ">123456<" in otp_html),
    ("branding text", "resultapp.org" in otp_html),
    ("footer copy", "Secured by ResultApp" in otp_html),
    ("body text colour", "#cbd5e1" in otp_html),
    ("heading colour", "#ffffff" in otp_html),
    ("presentation tables", 'role="presentation"' in otp_html),
    ("mso conditionals", "<!--[if mso]>" in otp_html),
    ("no dark-on-light", "#1a1a1a" not in otp_html),
    ("no legacy #71717a", "#71717a" not in otp_html),
    ("no legacy #f4f4f5", "#f4f4f5" not in otp_html),
    ("preheader present", "display:none;max-height:0" in otp_html),
    ("dark colour-scheme", 'name="color-scheme" content="dark"' in otp_html),
]

print("rendered:")
for f in sorted(OUT.iterdir()):
    print(f"  {f}  ({f.stat().st_size} bytes)")

print("\nassertions:")
bad = 0
for name, ok in checks:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    bad += 0 if ok else 1

print(f"\n{len(checks) - bad}/{len(checks)} passed")
sys.exit(1 if bad else 0)