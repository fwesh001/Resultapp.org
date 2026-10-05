import pathlib

p = pathlib.Path("backend/routers/auth_flow.py")
s = p.read_text(encoding="utf-8")
target = '        _release_cooldown(f"otp:{payload.purpose}:{email}")\n'
# M2: release on SUCCESS too — would defeat the anti-abuse throttle entirely.
if target not in s:
    raise SystemExit("marker not found")
p.write_text(
    s.replace(target, "") + "    _release_cooldown(f\"otp:{payload.purpose}:{email}\")\n",
    encoding="utf-8",
)
print("MUTATED: cooldown now released on success as well as failure")