import pathlib

p = pathlib.Path("backend/services/notifier.py")
s = p.read_text(encoding="utf-8")
target = 'quote(svg, safe="")'
if target not in s:
    raise SystemExit("marker not found")
# safe="x" leaves quotes, #, < and > UNENCODED -> the exact original bug.
p.write_text(s.replace(target, 'quote(svg, safe="\'<>#/")'), encoding="utf-8")
print('MUTATED: safe="\'<>#/" — quotes are no longer escaped')