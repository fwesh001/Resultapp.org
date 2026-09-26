"""Flap test: same staff POST 3x. Rollback -> 201 with SAME id each time.
Persistence -> first 201, rest 409. Cleans up any created rows."""

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


created_ids = []
for i in range(3):
    s, resp = call("POST", f"/api/v1/tenant/{TID}/roster",
                   {"type": "staff", "staff_id": "", "full_name": "ZZZ Flap",
                    "email": None, "phone": None, "role": "Teacher"})
    rec = resp.get("record", {}) if isinstance(resp, dict) else {}
    print(f"attempt {i}: status={s} staff_id={rec.get('staff_id')} uuid={rec.get('id')}")
    if rec.get("id"):
        created_ids.append(rec["id"])

s, lst = call("GET", f"/api/v1/tenant/{TID}/roster?entity_type=staff&page=1&limit=100")
rows = lst.get("data", []) if isinstance(lst.get("data"), list) else []
print("final total:", lst.get("total"), "| flap rows visible:",
      sum(1 for r in rows if r.get("full_name") == "ZZZ Flap"))

for uid in created_ids:
    st, _ = call("DELETE", f"/api/v1/tenant/{TID}/roster/staff/{uid}")
    print("cleanup", uid[:8], "->", st)
