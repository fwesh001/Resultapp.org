"""Behavior map: which single-create paths persist on the live backend?

For each entity: POST -> GET presence check -> DELETE cleanup.
Prints a persist/ghost verdict per entity.
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


def check(entity, list_entity, idkey, probe_body, match):
    s, resp = call("POST", f"/api/v1/tenant/{TID}/roster", probe_body)
    rec = resp.get("record", {}) if isinstance(resp, dict) else {}
    uid = rec.get("id")
    _, lst = call("GET", f"/api/v1/tenant/{TID}/roster?entity_type={list_entity}&page=1&limit=100")
    rows = lst.get("data", []) if isinstance(lst.get("data"), list) else []
    present = any(match(r, rec) for r in rows)
    print(f"{entity}: POST={s} id={str(rec.get(idkey))[:24]} present-after-GET={present} "
          f"-> {'PERSISTS' if present else 'GHOST'}")
    if uid:
        ds, _ = call("DELETE", f"/api/v1/tenant/{TID}/roster/{entity}/{uid}")
        print(f"   cleanup {entity}/{str(uid)[:8]} -> {ds}")
    return present


check("student", "students", "student_id",
      {"type": "student", "student_id": "", "full_name": "ZZZ Probe",
       "class_name": "JSS 1", "gender": None},
      lambda r, rec: r.get("student_id") == rec.get("student_id"))

check("staff", "staff", "staff_id",
      {"type": "staff", "staff_id": "zzprobe/001", "full_name": "ZZZ Probe",
       "email": None, "phone": None, "role": "Teacher"},
      lambda r, rec: r.get("staff_id") == rec.get("staff_id"))

check("subject", "subjects", "subject_name",
      {"type": "subject", "subject_name": "ZZZ Probe Subject"},
      lambda r, rec: r.get("subject_name") == rec.get("subject_name"))
