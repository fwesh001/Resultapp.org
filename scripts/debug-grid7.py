"""Ground-truth test of SVG data-URI encodings in a real browser.

The shipped constant embedded raw single quotes inside an unquoted url().
Per CSS tokenisation, an unquoted url() may not contain quotes, so the whole
token is invalid and the declaration is dropped. The earlier probe file looked
like it passed only because urllib.quote() had encoded those quotes to %27.

Variants tested here:
  A raw single quotes, unquoted url()   <- what shipped (suspected broken)
  B quotes encoded as %27, unquoted     <- candidate fix
  C fully percent-encoded, unquoted
  D fully percent-encoded, quoted
"""
import base64
import pathlib
import urllib.parse

SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'>"
    "<path d='M44 0H0v44' fill='none' stroke='#a78bfa' "
    "stroke-opacity='0.30' stroke-width='1'/></svg>"
)
FULL = urllib.parse.quote(SVG, safe="")
Q27 = FULL.replace("'", "%27")

variants = [
    ("A raw-quote unquoted", "url(data:image/svg+xml;charset=utf-8,%s)" % SVG.replace(" ", "%20").replace("#", "%23").replace("<", "%3C").replace(">", "%3E").replace("/", "%2F")),
    ("B q27 unquoted", "url(data:image/svg+xml;charset=utf-8,%s)" % Q27),
    ("C full unquoted", "url(data:image/svg+xml;charset=utf-8,%s)" % FULL),
    ("D full quoted", 'url("data:image/svg+xml;charset=utf-8,%s")' % FULL),
    ("E base64 quoted", 'url("data:image/svg+xml;base64,%s")' % base64.b64encode(SVG.encode()).decode()),
]

rows = []
for label, u in variants:
    rows.append(
        '<td id="%s" style="padding:12px;height:90px;background-color:#090514;'
        'background-image:%s;background-repeat:repeat;color:#fff;'
        'font:12px monospace;">%s</td>' % (label.split()[0], u, label)
    )

html = (
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
    '<body style="margin:0;background-color:#090514;"><table role="presentation" '
    'cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
    + "".join(rows)
    + "</tr></table></body></html>"
)
out = pathlib.Path("tmp-email-preview/probe-encoding.html")
out.write_text(html, encoding="utf-8")
print("wrote", out)
for label, u in variants:
    print(f"  {label}: quotes_present={'YES' if chr(39) in u else 'no'}")