import pathlib
import re
import sys

sys.path.insert(0, "backend")

# Behavioural, not textual: does the function as-shipped actually emit a
# quote-free URI? A regex over the source would pass even if the encoder were
# broken, which is exactly the bug being guarded against.
from services.notifier import _svg_data_uri, _EMAIL_GRID_URI, _EMAIL_CLIP_URI  # noqa: E402

svg = "<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0'/></svg>"
out = _svg_data_uri(svg)

fail = 0


def check(name, ok, detail=""):
    global fail
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' — ' + detail) if not ok and detail else ''}")
    fail += 0 if ok else 1


print("encoder behaviour:")
check("emits no raw single quote", "'" not in out, out[:80])
check("emits no raw double quote", '"' not in out)
check("emits no raw < or >", "<" not in out and ">" not in out)
check("emits no raw # (would truncate as a fragment)", "#" not in out)
check("quotes are percent-encoded", "%27" in out)
check("starts with the svg data-uri prefix", out.startswith("data:image/svg+xml;charset=utf-8,"))
check("round-trips to the original svg", __import__("urllib.parse", fromlist=["unquote"]).unquote(out.split(",", 1)[1]).replace("%27", "'") == svg)

print("\nshipped constants:")
# Only the grid remains an image. The clipboard cue became a text glyph after
# it arrived as a tofu box in a real mailbox.
check("_EMAIL_GRID_URI is quote-free", "'" not in _EMAIL_GRID_URI and '"' not in _EMAIL_GRID_URI)
check("no clipboard SVG constant remains", not hasattr(nt, "_EMAIL_CLIP_URI"))
check("copy cue is a text glyph", isinstance(getattr(nt, "_EMAIL_COPY_GLYPH", None), str))

print(f"\n{'PASS' if not fail else 'FAIL'}: {fail} failing")
sys.exit(1 if fail else 0)