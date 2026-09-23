#!/usr/bin/env python3
"""Seed a platform (superadmin) user. CLI only — there is intentionally NO
public signup endpoint for platform admins.

Usage (from backend/ dir, venv active):
    python scripts/seed_platform_admin.py --email you@resultapp.org --password '...' [--role admin]

Roles: owner | admin | support (default: admin).
Refuses to run with ENV=production unless --confirm-live is passed.
The password is never logged; only the pgcrypto bcrypt hash is stored.
"""

import argparse
import getpass
import os
import sys

# Allow running as `python scripts/seed_platform_admin.py` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a platform admin user.")
    parser.add_argument("--email", required=True, help="Admin email (unique)")
    parser.add_argument("--password", help="Password (min 8 chars; prompted securely if omitted)")
    parser.add_argument("--role", default="admin", choices=["owner", "admin", "support"])
    parser.add_argument("--confirm-live", action="store_true", help="Required when ENV=production")
    args = parser.parse_args()

    if os.getenv("ENV", "production").strip().lower() == "production" and not args.confirm_live:
        print("Refusing to seed with ENV=production without --confirm-live.", file=sys.stderr)
        return 2

    password = args.password or getpass.getpass("Platform admin password (min 8 chars): ")
    if not password:
        print("Password is required.", file=sys.stderr)
        return 2

    from services.db_manager import create_platform_admin, init_schools_registry

    # Ensure tables exist (idempotent) before inserting.
    init_schools_registry()
    try:
        admin = create_platform_admin(args.email, password, args.role)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(f"Platform admin ready: {admin['email']} (role={admin['role']}, id={admin['id']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
