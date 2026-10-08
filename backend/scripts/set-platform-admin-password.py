"""
Set or reset a platform-admin (superadmin) password.

    py scripts/set-platform-admin-password.py ephraimd131@gmail.com --password-stdin
    py scripts/set-platform-admin-password.py ephraimd131@gmail.com --generate

WHY STDIN
    The plaintext must never appear in a command line (visible to `ps` and shell
    history) nor in chat/transcript logs. `--password-stdin` reads it from the
    terminal with echo disabled, so the secret exists only in your keystrokes and
    in this process's memory. Hashing happens server-side via pgcrypto
    `crypt(..., gen_salt('bf'))` — identical to what create_platform_admin and
    verify_platform_admin use, so the new value works immediately at
    POST /api/v1/platform/login.

Run from the droplet (or anywhere that can reach Postgres) with the app env
loaded, the same way the service does:

    set -a; . /var/www/resultapp-backend/.env; set +a
    /var/www/resultapp-backend/venv/bin/python scripts/set-platform-admin-password.py \
        ephraimd131@gmail.com --password-stdin
"""

from __future__ import annotations

import argparse
import getpass
import os
import secrets
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.db_manager import PLATFORM_ADMINS_TABLE  # noqa: E402

MIN_LEN = 12


def _connect():
    return psycopg2.connect(
        host=os.getenv("PG_HOST", "localhost"),
        port=os.getenv("PG_PORT", "5432"),
        user=os.getenv("PG_SUPERUSER_USER", "postgres"),
        password=os.getenv("PG_SUPERUSER_PASSWORD"),
        dbname=os.getenv("PG_SUPERUSER_DB", "postgres"),
    )


def _validate(pw: str) -> None:
    problems = []
    if len(pw) < MIN_LEN:
        problems.append(f"at least {MIN_LEN} characters")
    if not any(c.isalpha() for c in pw):
        problems.append("at least one letter")
    if not any(c.isdigit() for c in pw):
        problems.append("at least one number")
    if problems:
        raise SystemExit("Password too weak: needs " + ", ".join(problems) + ".")


def main() -> int:
    ap = argparse.ArgumentParser(description="Set a platform admin password.")
    ap.add_argument("email", help="Platform admin email (must already exist).")
    ap.add_argument("--password-stdin", action="store_true", help="Read the password with echo off.")
    ap.add_argument("--generate", action="store_true", help="Generate a strong password and print it once.")
    ap.add_argument(
        "--create", action="store_true", help="Create the account if it does not exist."
    )
    args = ap.parse_args()

    email = (args.email or "").strip().lower()
    if "@" not in email or len(email) < 5:
        raise SystemExit(f"Not a valid email: {email!r}")
    if args.password_stdin == args.generate:
        raise SystemExit("Choose exactly one of --password-stdin or --generate.")

    if args.generate:
        # Readable alphabet: no O/0 or l/1 ambiguity when transcribed by hand.
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
        alphabet += "!@#%^*-_=+"
        pw = "".join(secrets.choice(alphabet) for _ in range(20))
        print(f"Generated password (shown once): {pw}")
        _validate(pw)
    else:
        pw = getpass.getpass(f"New password for {email}: ")
        confirm = getpass.getpass("Confirm: ")
        if pw != confirm:
            raise SystemExit("Passwords do not match.")
        _validate(pw)

    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT id, is_active FROM {PLATFORM_ADMINS_TABLE} WHERE LOWER(email)=LOWER(%s);", (email,))
        row = cur.fetchone()
        if row is None:
            if not args.create:
                raise SystemExit(
                    f"No platform admin with email {email}. Re-run with --create to create it."
                )
            cur.execute(
                f"INSERT INTO {PLATFORM_ADMINS_TABLE} "
                f"(email, password_hash, role, is_active, is_email_verified) "
                f"VALUES (%s, crypt(%s, gen_salt('bf')), 'admin', TRUE, TRUE) RETURNING id;",
                (email, pw),
            )
            conn.commit()
            print(f"Created platform admin {email} (role=admin, email_verified=True).")
            return 0

        # No updated_at column on platform_admins — only created_at.
        cur.execute(
            f"UPDATE {PLATFORM_ADMINS_TABLE} "
            f"SET password_hash = crypt(%s, gen_salt('bf')), is_active = TRUE, is_email_verified = TRUE "
            f"WHERE LOWER(email) = LOWER(%s) RETURNING id;",
            (pw, email),
        )
        conn.commit()
        print(f"Password updated for {email} (was_active={row[1]}).")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())