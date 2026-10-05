import pathlib
import sys

sys.path.insert(0, "backend")
import services.notifier as nt  # noqa: E402

html = pathlib.Path("tmp-email-preview/otp.html").read_text(encoding="utf-8")

# Hypothesis A: it renders but 0.09 opacity on #090514 is invisible.
# Test by regenerating at 0.09 / 0.18 / 0.30 and sampling a grid-line pixel.
variants = {}
for label, op in (("as_shipped", "0.09"), ("medium", "0.18"), ("strong", "0.30")):
    orig = nt._EMAIL_GRID_URI
    nt._EMAIL_GRID_URI = orig.replace("stroke-opacity='0.09'", f"stroke-opacity='{op}'")
    nt.send_auth_email = lambda *a, **k: True
    body = f'<p style="margin:0;font-size:15px;">probe</p>'
    variants[label] = nt._auth_email_shell("Probe", body, "x")
    nt._EMAIL_GRID_URI = orig

for label, out in variants.items():
    p = pathlib.Path(f"tmp-email-preview/grid-{label}.html")
    p.write_text(out, encoding="utf-8")
    print(f"wrote {p}")

# Also confirm the grid tile is genuinely sparse: one hairline per 44px, top+left.
print("\ntile geometry: 44x44, path 'M44 0H0v44' = top edge + left edge only")
print("coverage: 2 x 44px hairlines per 1936px tile = ~4.5% of area")