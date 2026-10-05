import base64
import pathlib
import urllib.parse

SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>"
    "<path d='M44 0H0v44' fill='none' stroke='#a78bfa' "
    "stroke-opacity='0.30' stroke-width='1'/></svg>"
)
enc = urllib.parse.quote(SVG, safe="")
b64 = "data:image/svg+xml;base64," + base64.b64encode(SVG.encode()).decode()

variants = [
    ("A unquoted", 'url(data:image/svg+xml;charset=utf-8,%s)' % enc),
    ("B dquoted", 'url("data:image/svg+xml;charset=utf-8,%s")' % enc),
    ("D base64", 'url("%s")' % b64),
]

rows = []
for label, u in variants:
    rows.append(
        '<div style="height:110px;margin:4px;background-color:#090514;'
        'background-image:%s;background-repeat:repeat;color:#fff;'
        'font:13px monospace;padding:6px;">%s</div>' % (u, label)
    )

html = (
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
    '<body style="margin:0">' + "".join(rows) + "</body></html>"
)
out = pathlib.Path("tmp-email-preview/probe-all.html")
out.write_text(html, encoding="utf-8")
print("wrote", out)