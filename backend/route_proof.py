import logging

logging.disable(logging.CRITICAL)

from main import app  # noqa: E402

total = 0
for r in app.routes:
    if type(r).__name__ != "_IncludedRouter":
        continue
    router = getattr(r, "router", None)
    prefix = getattr(router, "prefix", "")
    for rr in getattr(router, "routes", []):
        path = str(getattr(rr, "path", ""))
        methods = sorted(getattr(rr, "methods", []) or [])
        print(repr(prefix + path), methods)
        total += 1
print("INCLUDED_TOTAL:", total)
