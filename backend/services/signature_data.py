"""
Shared validation for INLINE drawn signatures.

A drawn signature is stored as a base64 PNG data URI directly on the record,
not as a Blob URL. That is a deliberate choice: a Blob URL is publicly
addressable by anyone who holds it, and a handwritten signature is
biometric-adjacent personal data (see lib/legal/privacy.ts and the P7 finding in
LEGAL_REMEDIATION.md). Keeping the bytes inside an authenticated API response
means a signature is never readable by a third party who guesses or scrapes a
URL.

The counterpart is that nothing but this module decides what may be stored, so
the rules live in ONE place and both routers import it. A length check alone is
not sufficient: without the magic-byte test a caller could store an arbitrary
base64 blob (a photograph, a script payload, megabytes of junk) and Postgres
TEXT would happily accept every byte of it.

Hardening summary:
  - must be a `data:image/png;base64,` URI  (PNG only; SVG would be an XSS
    vector if ever navigated to directly, and JPEG/AVIF add bytes for nothing
    at a 24px render size)
  - must be <= MAX_SIGNATURE_DATA_BYTES (base64 characters, NOT decoded bytes)
  - the decoded stream must begin with the PNG signature bytes
  - blank/None means "clear it", which callers map to SQL NULL
"""

import base64
import binascii

# PNG magic number. 8 bytes, per the PNG specification.
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

PNG_DATA_URI_PREFIX = "data:image/png;base64,"

# 64 KiB of base64 characters ~ 48 KiB of decoded PNG.
#
# A hand-drawn signature, trimmed and downscaled by the client, lands in the
# 5-20 KiB range. The headroom absorbs a detailed signature without letting a
# caller inflate the DB or the report payload for every student. This also sits
# well under the 4 MB body cap used by the upload routes.
MAX_SIGNATURE_DATA_BYTES = 64 * 1024


def validate_signature_data(raw, field_name: str = "signature") -> str | None:
    """Return a normalized data URI, or None when the input is blank.

    Raises a ValueError with a caller-safe message when the payload is present
    but malformed. Callers translate that into a 422.

    Kept dependency-free (no FastAPI import) so it is trivially unit-testable
    and cannot create an import cycle from the routers.
    """
    if raw is None:
        return None

    if not isinstance(raw, str):
        raise ValueError(f"{field_name} must be a string")

    value = raw.strip()
    if not value:
        # Explicit blank == clear the signature. Callers store NULL.
        return None

    if len(value) > MAX_SIGNATURE_DATA_BYTES:
        raise ValueError(
            f"{field_name} is too large "
            f"(max {MAX_SIGNATURE_DATA_BYTES} characters)"
        )

    if not value.startswith(PNG_DATA_URI_PREFIX):
        raise ValueError(f"{field_name} must be a PNG data URI")

    payload = value[len(PNG_DATA_URI_PREFIX):]
    if not payload:
        raise ValueError(f"{field_name} is empty")

    try:
        # validate=True rejects any non-alphabet character rather than silently
        # discarding it, so a truncated/garbage payload fails here instead of
        # decoding to something unexpected.
        decoded = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError(f"{field_name} is not valid base64")

    if not decoded.startswith(PNG_MAGIC):
        raise ValueError(f"{field_name} payload is not a PNG")

    return PNG_DATA_URI_PREFIX + payload