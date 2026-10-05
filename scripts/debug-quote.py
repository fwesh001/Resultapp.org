import pathlib
import sys

sys.path.insert(0, "backend")
from services.notifier import _svg_data_uri  # noqa: E402

# What does the encoder ACTUALLY emit for the real grid SVG?
svg = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>"
    "<path d='M44 0H0v44' fill='none' stroke='#a78bfa' "
    "stroke-opacity='0.09' stroke-width='1'/></svg>"
)
out = _svg_data_uri(svg)
print("length:", len(out))
print("contains %27 :", "%27" in out)
print("contains raw ' :", "'" in out)
print()
print(out[:200])