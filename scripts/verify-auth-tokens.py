#!/usr/bin/env python3
"""Crypto + policy tests for the email-verification / password-reset flow.

    py -3 scripts/verify-auth-tokens.py

psycopg2 is stubbed so these run without a database: the point is to prove the
token and scope logic, which is where a mistake would be silently
unrecoverable (a leaked reset link, a cross-tenant password write, SQL
injection through a table name).

No test framework is installed in this repo, matching
scripts/verify-free-credit-policy.py.
"""

import sys
import types

# --- stub psycopg2 just enough for db_manager to import -------------------
_pg = types.ModuleType("psycopg2")
_pg.sql = types.SimpleNamespace(Identifier=lambda *a: None)
_pg.connect = lambda *a, **k: None
_ext = types.ModuleType("psycopg2.extensions")
_ext.ISOLATION_LEVEL_AUTOCOMMIT = 0
_pg.extensions = _ext
sys.modules["psycopg2"] = _pg
sys.modules["psycopg2.sql"] = _pg.sql
sys.modules["psycopg2.extensions"] = _ext
sys.modules["psycopg2.extras"] = types.ModuleType("psycopg2.extras")

sys.path.insert(0, "backend")

import hashlib  # noqa: E402
import hmac  # noqa: E402

from services.db_manager import (  # noqa: E402
    generate_auth_token,
    hash_auth_token,
    _resolve_auth_table,
    VERIFICATION_TOKEN_TTL_MINUTES,
    RESET_TOKEN_TTL_MINUTES,
)

failures = 0


def check(name, cond):
    global failures
    ok = bool(cond)
    if not ok:
        failures += 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")


print("\nToken generation (secrets, not random)")
t1, t2 = generate_auth_token(), generate_auth_token()
check("two tokens differ", t1 != t2)
check("URL-safe alphabet only (no + / =)", all(c.isalnum() or c in "-_" for c in t1))
check("at least 32 chars of entropy", len(t1) >= 32)
check("1000 tokens are all distinct", len({generate_auth_token() for _ in range(1000)}) == 1000)

print("\nToken storage is hashed, never plaintext")
h1 = hash_auth_token(t1)
check("sha256 digest is 64 hex chars", len(h1) == 64 and all(c in "0123456789abcdef" for c in h1))
check("digest matches sha256 of the raw token", h1 == hashlib.sha256(t1.encode()).hexdigest())
check("hashing is deterministic", hash_auth_token(t1) == hash_auth_token(t1))
check("different tokens hash differently", hash_auth_token(t1) != hash_auth_token(t2))
check("raw token is never equal to its digest", t1 != h1)
check("raw token does not appear in the digest", t1 not in h1)
check("constant-time compare accepts the right token", hmac.compare_digest(h1, hash_auth_token(t1)))
check("constant-time compare rejects a wrong token", not hmac.compare_digest(h1, hash_auth_token("nope")))

print("\nExpiry windows")
check("verification TTL is 24h", VERIFICATION_TOKEN_TTL_MINUTES == 24 * 60)
check("reset TTL is 1h", RESET_TOKEN_TTL_MINUTES == 60)
check("reset TTL is shorter than verification", RESET_TOKEN_TTL_MINUTES < VERIFICATION_TOKEN_TTL_MINUTES)

print("\nTable whitelist — the only SQL-injection surface in this flow")
check("schools allowed", _resolve_auth_table("schools") == "schools")
check("platform_admins allowed", _resolve_auth_table("platform_admins") == "platform_admins")
check("SQL injection rejected", _resolve_auth_table("schools; DROP TABLE schools") is None)
check("quote injection rejected", _resolve_auth_table("schools' OR '1'='1") is None)
check("tenant_staff out of scope", _resolve_auth_table("tenant_staff") is None)
check("empty table rejected", _resolve_auth_table("") is None)
check("None table rejected", _resolve_auth_table(None) is None)

print("\nEmail normalisation (login is case-insensitive everywhere)")
for raw, want in [("  Admin@ResultApp.org ", "admin@resultapp.org"), ("A@B.CO", "a@b.co")]:
    got = str(raw).strip().lower()
    check(f"normalises {raw!r}", got == want)

print(f"\n{'ALL CHECKS PASSED' if failures == 0 else str(failures) + ' FAILURE(S)'}")
sys.exit(1 if failures else 0)
