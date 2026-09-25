import logging

logging.disable(logging.CRITICAL)

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)

targets = [
    "/api/v1/tenant/vhs/command-center/summary?term=Term%201",
    "/api/v1/tenant/vhs/command-center/missing-batch?class_names=JSS1&term=Term%201",
    "/api/v1/tenant/vhs/roster?entity_type=students&page=1&limit=20",
]
for t in targets:
    r = client.get(t, headers={"X-API-SECRET-KEY": "probe"})
    body = r.text[:160].replace("\n", " ")
    print(r.status_code, t.split("?")[0], "->", body)
