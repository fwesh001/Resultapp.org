import pathlib

p = pathlib.Path("backend/services/notifier.py")
s = p.read_text(encoding="utf-8")
bad = '_EMAIL_COPY_GLYPH = "?"'
good = '_EMAIL_COPY_GLYPH = "⧉"'
if bad in s:
    p.write_text(s.replace(bad, good), encoding="utf-8")
    print("repaired mangled glyph ->", good)
elif good in s:
    print("glyph already correct")
else:
    print("UNEXPECTED: marker not found; inspect manually")
    for line in s.splitlines():
        if "_EMAIL_COPY_GLYPH =" in line:
            print("  found:", repr(line))