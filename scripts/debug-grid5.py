"""Does the opaque wrapper table paint over the body's grid?"""
import pathlib
import sys

sys.path.insert(0, "backend")
import services.notifier as nt  # noqa: E402

orig = nt._EMAIL_GRID_URI
body = '<p style="margin:0;font-size:15px;color:#cbd5e1;">probe</p>'
full = nt._auth_email_shell("Probe", body, "x")

marker = (
    'bgcolor="%s" style="background-color:%s;background-image:url(%s);'
    "background-repeat:repeat;\"" % (nt._EMAIL_BG, nt._EMAIL_BG, orig)
)
assert marker in full, "wrapper table marker not found"

case_a = full
case_b = full.replace(
    marker,
    'bgcolor="%s" style="background-color:%s;"' % (nt._EMAIL_BG, nt._EMAIL_BG),
    1,
).replace(
    '<td align="center" style="padding:36px 14px;">',
    '<td align="center" style="padding:36px 14px;background-image:url(%s);'
    "background-repeat:repeat;\">" % orig,
    1,
)

d = pathlib.Path("tmp-email-preview")
for name, html in (("1_grid_body_under_table", case_a), ("2_grid_on_td", case_b)):
    p = d / f"layer-{name}.html"
    p.write_text(html, encoding="utf-8")
    head = html.split("<table")[0]
    print(f"{name}: grid present before the wrapper table = {'background-image' in head}")