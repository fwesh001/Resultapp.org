#!/usr/bin/env python3
"""Seed default notification templates (Phase 1 — Template-Driven Notification Engine).

Idempotent: uses INSERT ... ON CONFLICT (event_type) DO NOTHING so
superadmin edits are never overwritten on re-runs.

Usage (from backend/ dir, venv active):
    python scripts/seed_notification_templates.py

Tables are created first via init_notification_tables(), so this script is
safe on fresh and existing deployments.
"""

import os
import sys

# Allow running as `python scripts/seed_notification_templates.py` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    from services.db_manager import (
        init_notification_tables,
        seed_default_notification_templates,
    )

    init_notification_tables()
    try:
        result = seed_default_notification_templates()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(
        f"Notification templates ready: "
        f"{result['inserted']} inserted, {result['skipped']} existing "
        f"(total {result['total']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
