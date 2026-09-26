"""Throwaway probe: staff create -> list -> delete round trip on the live backend.

Reads BACKEND_URL + secret from the repo .env.local (never printed).
Creates ONE probe row and deletes it afterwards.
"""
import json
import logging
import os
import re
import time
import urllib.request

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
TAG = f"ZZZ Probe {int(time.time()) % 100000}"


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


print("== 1. GET staff list (shape check) ==")
s1, list1 = call("GET", f"/api/v1/tenant/{TID}/roster?entity_type=staff&page=1&limit=20")
print("status:", s1, "| top-level keys:", sorted(list1.keys()))
if isinstance(list1.get("data"), list):
    print("paginated shape: total =", list1.get("total"),
          "| rows =", len(list1["data"]),
          "| ids =", [r.get("staff_id") for r in list1["data"]][:8])
else:
    print("LEGACY BLOB SHAPE (no data/total). staff rows:",
          len(list1.get("staff", [])) if isinstance(list1.get("staff"), list) else "?")

print("== 2. POST single staff ==")
s2, created = call("POST", f"/api/v1/tenant/{TID}/roster",
                  {"type": "staff", "staff_id": "", "full_name": TAG,
                   "email": None, "phone": None, "role": "Teacher"})
rec = created.get("record", {}) if isinstance(created, dict) else {}
print("status:", s2, "| staff_id:", rec.get("staff_id"), "| uuid:", rec.get("id"))

print("== 3. GET staff list again (presence check) ==")
s3, list2 = call("GET", f"/api/v1/tenant/{TID}/roster?entity_type=staff&page=1&limit=20")
rows = list2.get("data", []) if isinstance(list2.get("data"), list) else list2.get("staff", [])
ids = [r.get("staff_id") for r in rows if isinstance(r, dict)]
print("status:", s3, "| total:", list2.get("total", "n/a"),
      "| probe present:", rec.get("staff_id") in ids,
      "| newest 3:", ids[:3])

print("== 4. DELETE probe row ==")
if rec.get("id"):
    s4, _ = call("DELETE", f"/api/v1/tenant/{TID}/roster/staff/{rec['id']}")
    print("delete status:", s4)
else:
    print("skipped (no id returned)")
