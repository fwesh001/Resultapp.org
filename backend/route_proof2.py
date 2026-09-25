import logging
import os

os.environ["API_SECRET_KEY"] = "probe"
os.environ["ENV"] = "development"
logging.disable(logging.CRITICAL)

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)

targets = [
    "/api/v1/tenant/vhs/staff/forms/JSS1?term=Term%201",
    "/api/v1/tenant/vhs/staff/grading/JSS1/Maths?term=Term%201",
]
for t in targets:
    r = client.get(t, headers={"X-API-SECRET-KEY": "probe"})
    print(r.status_code, t.split("?")[0], "->", r.text[:200].replace("\n", " "))
