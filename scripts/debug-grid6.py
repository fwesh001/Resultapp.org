"""Test the EXACT module constant in a minimal page.

The probe file used urllib.parse.quote(); the shipped constant is hand-written.
They differ, so test the shipped one verbatim.
"""
import pathlib
import sys

sys.path.insert(0, "backend")
from services.notifier import _EMAIL_GRID_URI, _EMAIL_BG  # noqa: E402

rows = []
for label, u in (
    ("shipped constant (unquoted)", "url(%s)" % _EMAIL_GRID_URI),
    ("shipped constant, quoted", 'url("%s")' % _EMAIL_GRID_URI),
):
    rows.append(
        '<td style="padding:10px;background-image:%s;background-repeat:repeat;'
        'background-color:%s;color:#fff;font:12px monospace;">%s</td>'
        % (u, _EMAIL_BG, label)
    )

html = (
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
    '<body style="margin:0;background-color:%s;"><table role="presentation" '
    'cellpadding="0" cellspacing="0" border="0" width="100%%"><tr>%s</tr></table>'
    "</body></html>" % (_EMAIL_BG, "".join(rows))
)
out = pathlib.Path("tmp-email-preview/probe-shipped.html")
out.write_text(html, encoding="utf-8")
print("wrote", out)
print()
print("the constant, verbatim:")
print(_EMAIL_GRID_URI)