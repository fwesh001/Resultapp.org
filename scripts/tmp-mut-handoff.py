import pathlib
import sys

# Use a regex tolerant of whitespace so the mutation cannot silently miss and
# produce a vacuous pass.
p = pathlib.Path("components/forms/RegisterSchoolForm.tsx")
s = p.read_text(encoding="utf-8")

target = "window.location.href = adminLoginUrl;"
if target not in s:
    print("MARKER NOT FOUND — mutation would be a no-op")
    sys.exit(2)

mode = sys.argv[1]
if mode == "navigate":
    # Remove the automatic navigation only (keep the button's handler).
    lines = s.splitlines(keepends=True)
    out = []
    for i, ln in enumerate(lines):
        if ln.strip() == target and "onClick" not in ln:
            out.append(ln.replace(target, "return;"))
        else:
            out.append(ln)
    p.write_text("".join(out), encoding="utf-8")
    print("MUTATED: automatic navigation removed")
elif mode == "router":
    p.write_text(s.replace(target, "router.push(adminLoginUrl);"), encoding="utf-8")
    print("MUTATED: handoff converted to a client-side route")
else:
    print("unknown mode")
    sys.exit(2)