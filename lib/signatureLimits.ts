/**
 * Client-side mirror of the drawn-signature cap enforced server-side.
 *
 * The authoritative limit lives in the backend
 * (`backend/services/signature_data.py`), which also validates the PNG magic
 * bytes. This constant exists so the Next.js proxy can reject an oversized
 * payload with a message we control BEFORE spending a round-trip — and, more
 * importantly, so the number the UI warns about is the number the server
 * enforces.
 *
 * Two independently-maintained copies of a limit will eventually disagree, so
 * `scripts/verify-signature.mjs` asserts this value equals the backend's
 * MAX_SIGNATURE_DATA_BYTES. If you change one, change both or the test fails.
 */
export const MAX_SIGNATURE_DATA_BYTES = 64 * 1024;

/** Human-readable cap for helper copy and error messages. */
export const MAX_SIGNATURE_LABEL = "64KB";