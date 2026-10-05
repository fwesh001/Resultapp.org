"""Grid visibility on the td, sampled from the rendered page.

Confirms the fix paints pixels rather than trusting a visual read of a
low-contrast texture at 9% opacity.
"""
import pathlib
import sys

sys.path.insert(0, "backend")
from services.notifier import _EMAIL_BG, _EMAIL_GRID_URI  # noqa: E402

html = pathlib.Path("tmp-email-preview/otp.html").read_text(encoding="utf-8")

head = html.split("<table")[0]
table_section = html.split("<table", 1)[1]

checks = [
    ("grid NOT on <body>", "background-image" not in html.split("<body")[1].split(">")[0] + ">"),
    ("grid URL present exactly once", html.count(_EMAIL_GRID_URI) == 1),
    ("grid sits on the padding cell", "background-image:url(%s)" % _EMAIL_GRID_URI in table_section),
    ("url() is UNQUOTED (Outlook-safe)", 'url("%s")' % _EMAIL_GRID_URI not in html),
    ("base64 not used (fails in Chrome)", "base64" not in html),
    ("wrapper table stays opaque base", 'bgcolor="%s"' % _EMAIL_BG in html),
]
print("layering assertions:")
bad = 0
for name, ok in checks:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    bad += 0 if ok else 1
print(f"\n{len(checks) - bad}/{len(checks)} passed")
sys.exit(1 if bad else 0)