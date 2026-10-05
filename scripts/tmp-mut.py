import pathlib

p = pathlib.Path("backend/routers/auth_flow.py")
s = p.read_text(encoding="utf-8")
target = '        _release_cooldown(f"otp:{payload.purpose}:{email}")\n'
if target not in s:
    raise SystemExit("marker not found — line differs from expectation")
p.write_text(s.replace(target, ""), encoding="utf-8")
print("MUTATED: removed the cooldown release on delivery failure")