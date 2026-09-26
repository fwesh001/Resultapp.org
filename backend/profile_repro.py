"""Throwaway repro: PATCH staff profile with a fake DB connection.

Surfaces any non-HTTPException escaping the handler (the droplet's
'Internal server error' signature). Delete after use.
"""

import datetime
import json
import logging
import os
import uuid

os.environ["API_SECRET_KEY"] = "probe"
os.environ["ENV"] = "development"
logging.disable(logging.CRITICAL)

import services.db_manager as dbm  # noqa: E402


class FakeCursor:
    def __init__(self):
        self.rowcount = 1
        # RETURNING id, subdomain, staff_id, full_name, email, phone, role,
        #           signature_url, created_at
        self._row = (
            uuid.uuid4(), "vhs", "staff/002", "Ruth Tope",
            "ruth@example.com", None, "Teacher",
            "/uploads/vhs/signature-1.png",
            datetime.datetime(2026, 9, 26, 12, 0, 0),
        )
        # description mimics psycopg2 cursor.description
        self.description = [(c,) for c in (
            "id", "subdomain", "staff_id", "full_name", "email",
            "phone", "role", "signature_url", "created_at")]

    def execute(self, *a, **k):
        return None

    def fetchone(self):
        return self._row

    def fetchall(self):
        return []


class FakeConn:
    def cursor(self):
        return FakeCursor()

    def commit(self):
        return None

    def rollback(self):
        return None

    def close(self):
        return None


dbm._connect_as_superuser = lambda: FakeConn()  # noqa: E731

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)
r = client.patch(
    "/api/v1/tenant/vhs/staff/profile?staff_id=staff%2F002",
    headers={"X-API-SECRET-KEY": "probe", "Content-Type": "application/json"},
    content=json.dumps({"signature_url": "/uploads/vhs/signature-1.png"}),
)
print("STATUS:", r.status_code)
print("BODY:", r.text[:400])
