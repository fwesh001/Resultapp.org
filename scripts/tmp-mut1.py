import pathlib

p = pathlib.Path("backend/services/notifier.py")
s = p.read_text(encoding="utf-8")
target = '.replace("\'", "%27")'
if target not in s:
    raise SystemExit("marker not found: %r" % target)
p.write_text(s.replace(target, ""), encoding="utf-8")
print("MUTATED: removed %27 quote encoding from _svg_data_uri")