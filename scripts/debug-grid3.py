"""Isolate why the SVG data-URI background does not paint in Chrome."""
import pathlib
import urllib.parse

SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>"
    "<path d='M44 0H0v44' fill='none' stroke='#a78bfa' stroke-opacity='0.30' "
    "stroke-width='1'/></svg>"
)
enc = urllib.parse.quote(SVG, safe="")

variants = {
    # (label, url() syntax)
    "A_unquoted": f"url(data:image/svg+xml;charset=utf-8,{enc})",
    "B_dquoted": f'url("data:image/svg+xml;charset=utf-8,{enc}")',
    "C_bare": f"data:image/svg+xml;charset=utf-8,{enc}",
    "D_base64": "data:image/svg+xml;base64,"
    + __import__("base64").b64encode(SVG.encode()).decode(),
    "E_percent_encoded": "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20"
    "width%3D%2244%22%20height%3D%2244%22%3E%3Cpath%20d%3D%22M44%200H0v44%22%20"
    "fill%3D%22none%22%20stroke%3D%22%23a78bfa%22%20stroke-opacity%3D%220.3%22%20"
    "stroke-width%3D%221%22%2F%3E%3C%2Fsvg%3E",
}

out = []
for label, u in variants.items():
    out.append(f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background-color:#090514;">
<div style="height:260px;background-color:#090514;background-image:{u};background-repeat:repeat;">
  <p style="color:#fff;font:14px monospace;padding:10px;">{label}</p>
</div>
<img src="{u}" style="display:block;margin:10px;border:1px solid #444;">
</body></html>""")

d = pathlib.Path("tmp-email-preview")
for label, html in zip(variants, out):
    p = d / f"probe-{label}.html"
    p.write_text(html, encoding="utf-8")
    print("wrote", p)