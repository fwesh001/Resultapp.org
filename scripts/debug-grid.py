import base64
import pathlib
import re
import sys

sys.path.insert(0, "backend")
from services.notifier import _EMAIL_GRID_URI, _EMAIL_CLIP_URI  # noqa: E402

html = pathlib.Path("tmp-email-preview/otp.html").read_text(encoding="utf-8")

m = re.search(r"background-image:url\(([^)]+)\)", html)
uri = m.group(1) if m else ""
print("uri found in html:", bool(uri))
print("matches module constant:", uri == _EMAIL_GRID_URI)
print("length:", len(uri))

# Decode the data URI the way a browser would, and check the SVG parses.
payload = uri.split(",", 1)[1] if "," in uri else ""
svg = base64.b64decode(payload + "==") if ";base64" in uri else None
import urllib.parse

decoded = urllib.parse.unquote(payload)
print("\n--- decoded svg ---")
print(decoded[:220])

import xml.etree.ElementTree as ET

try:
    ET.fromstring(decoded.replace("'", '"'))
    print("\nSVG parses: YES")
except Exception as exc:
    print("\nSVG parses: NO ->", exc)

print("\nclip uri:")
print(_EMAIL_CLIP_URI.split(",", 1)[1][:120])