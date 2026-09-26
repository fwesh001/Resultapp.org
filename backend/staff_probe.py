"""Collision probe: POST an EXPLICIT staff_id that already exists ('stf001').

409 UNIQUE violation -> writer sees the same DB as readers (rollback theory).
201 Created         -> writer is on a different DB (split-brain theory).
No cleanup needed: nothing new should persist either way (verify after).
"""

import json
import logging
import os
import re
import urllib.request
import urllib.error

logging.disable(logging.CRITICAL)

repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = open(os.path.join(repo, ".env.local"), encoding="utf-8").read()


def env_val(*names):
    for n in names:
        m = re.search(rf"^{n}=(.*)$", env, re.M)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return ""


BASE = (env_val("BACKEND_URL") or "http://159.223.178.34:8000").rstrip("/")
SECRET = env_val("BACKEND_API_SECRET", "PROVISION_API_SECRET", "API_SECRET_KEY")
TID = "vhs"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"X-API-SECRET-KEY": SECRET, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


print("== POST duplicate staff_id='stf001' (exists per GET) ==")
s, resp = call("POST", f"/api/v1/tenant/{TID}/roster",
               {"type": "staff", "staff_id": "stf001", "full_name": "ZZZ Collision",
                "email": None, "phone": None, "role": "Teacher"})
print("status:", s, "| body:", json.dumps(resp)[:220])

print("== GET total afterwards ==")
s2, lst = call("GET", f"/api/v1/tenant/{TID}/roster?entity_type=staff&page=1&limit=100")
rows = lst.get("data", []) if isinstance(lst.get("data"), list) else []
print("total:", lst.get("total"), "| ids:", [r.get("staff_id") for r in rows][:10])
