import logging

logging.disable(logging.CRITICAL)

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)

# Wrong secret -> 500 "misconfigured" proves the route RESOLVED (404 = no route).
targets = [
    ("GET", "/api/v1/tenant/vhs/staff/forms/JSS1?term=Term%201"),
    ("GET", "/api/v1/tenant/vhs/staff/grading/JSS1/Maths?term=Term%201"),
    ("GET", "/api/v1/tenant/vhs/roster?entity_type=form_assignments&page=1&limit=20"),
]
for method, t in targets:
    r = client.request(method, t, headers={"X-API-SECRET-KEY": "probe"})
    print(r.status_code, t.split("?")[0], "->", r.text[:120].replace("\n", " "))

# POST batch without staff_id -> 422 proves required field (not silently accepted).
r = client.post(
    "/api/v1/tenant/vhs/staff/grading/batch",
    headers={"X-API-SECRET-KEY": "probe", "Content-Type": "application/json"},
    json={"term": "Term 1", "subject_name": "Maths", "class_name": "JSS1",
          "assessment_key": "A1", "scores": [{"student_id": "vhs/001", "score": 5}]},
)
print(r.status_code, "batch-no-staff ->", r.text[:160].replace("\n", " "))
