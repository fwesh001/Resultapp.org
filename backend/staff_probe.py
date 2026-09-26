"""Decisive probes: (1) does a staff row EVER become visible later (lag test)?
(2) do student writes still persist on current code? One row each, cleaned up."""

import json
import logging
import os
import re
import time
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
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def staff_ids():
    _, lst = call("GET", f"/api/v1/tenant/{TID}/roster?entity_type=staff&page=1&limit=100")
    rows = lst.get("data", []) if isinstance(lst.get("data"), list) else []
    return lst.get("total"), [r.get("staff_id") for r in rows]


def student_ids():
    _, lst = call("GET", f"/api/v1/tenant/{TID}/roster?entity_type=students&page=1&limit=100")
    rows = lst.get("data", []) if isinstance(lst.get("data"), list) else []
    return lst.get("total"), [r.get("student_id") for r in rows]


print("== TEST 1: staff ghost with 45s delayed re-read ==")
s, resp = call("POST", f"/api/v1/tenant/{TID}/roster",
               {"type": "staff", "staff_id": "zzlag/001", "full_name": "ZZZ Lag",
                "email": None, "phone": None, "role": "Teacher"})
rec = resp.get("record", {}) if isinstance(resp, dict) else {}
print("POST:", s, "| detail:", str(resp.get("detail") or resp.get("error"))[:100])
t0, ids0 = staff_ids()
print(f"immediate GET: total={t0} present={rec.get('staff_id') in ids0}")
print("sleeping 45s...")
time.sleep(45)
t1, ids1 = staff_ids()
print(f"delayed GET: total={t1} present={rec.get('staff_id') in ids1}")
if rec.get("id"):
    print("cleanup DELETE:", call("DELETE", f"/api/v1/tenant/{TID}/roster/staff/{rec['id']}")[0])

print("== TEST 2: student write persistence on current code ==")
s2, resp2 = call("POST", f"/api/v1/tenant/{TID}/roster",
                 {"type": "student", "student_id": "", "full_name": "ZZZ Persist",
                  "class_name": "JSS 1", "gender": None})
rec2 = resp2.get("record", {}) if isinstance(resp2, dict) else {}
print("POST:", s2, "| detail:", str(resp2.get("detail") or resp2.get("error"))[:100])
st, sids = student_ids()
print(f"GET: total={st} present={rec2.get('student_id') in sids} id={rec2.get('student_id')}")
if rec2.get("id"):
    print("cleanup DELETE:", call("DELETE", f"/api/v1/tenant/{TID}/roster/student/{rec2['id']}")[0])
