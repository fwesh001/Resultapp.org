import logging

logging.disable(logging.CRITICAL)

from routers.staff_grading import router  # noqa: E402

print("PREFIX:", router.prefix)
for r in router.routes:
    print(" ", r.path, sorted(getattr(r, "methods", []) or []))
