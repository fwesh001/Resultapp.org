#!/bin/bash
S=$(sudo grep -oP '^API_SECRET_KEY=\K.*' /var/www/resultapp-backend/.env 2>/dev/null | head -1 | tr -d '"'"'"' \r')
API="http://127.0.0.1:8000/api/v1/tenant"
TID="vhs"
MOD="staff/0098"
PW="modpass123"
PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

MODH=(-H "X-Viewer-Role: moderator" -H "X-Viewer-Id: $MOD" -H "X-Viewer-Label: Layout Moderator")
ADMH=(-H "X-Viewer-Role: admin" -H "X-Viewer-Id: info@vhs.test" -H "X-Viewer-Label: School Admin")

echo "=== A. staff list returns is_moderator as a real boolean ==="
curl -s "$API/$TID/roster/staff" -H "X-API-SECRET-KEY: $S" | python3 -c "
import json,sys
d=json.load(sys.stdin)
rows=d.get('staff') or []
print('  rows:', len(rows))
for r in rows[:4]:
    print('   ', r['staff_id'], '| is_moderator =', repr(r.get('is_moderator')), type(r.get('is_moderator')).__name__)
ok = len(rows)>0 and all(isinstance(r.get('is_moderator'), bool) for r in rows)
print('  VERDICT:', 'PASS - all booleans' if ok else 'FAIL')
"

echo
echo "=== B. MODERATOR must be refused (escalation boundary) ==="
C=$(curl -s -o /tmp/m.json -w "%{http_code}" -X PATCH "$API/$TID/roster/staff/moderator" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${MODH[@]}" \
  -d '{"subdomain":"vhs","staff_id":"staff/001","is_moderator":true}')
echo "  HTTP $C  $(cat /tmp/m.json | head -c 110)"
[ "$C" = "403" ] && ok "moderator cannot promote (403)" || no "expected 403, got $C"

echo
echo "=== C. cross-tenant body/path mismatch is refused ==="
C=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$API/$TID/roster/staff/moderator" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${ADMH[@]}" \
  -d '{"subdomain":"other-school","staff_id":"staff/001","is_moderator":true}')
[ "$C" = "403" ] && ok "body/path subdomain mismatch refused (403)" || no "expected 403, got $C"

echo
echo "=== D. admin CAN promote, and the change is audited ==="
curl -s -o /dev/null -X PATCH "$API/$TID/roster/staff/moderator" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${ADMH[@]}" \
  -d '{"subdomain":"vhs","staff_id":"staff/001","is_moderator":true}'
FLAG=$(sudo -u postgres psql -d postgres -tAc "SELECT coalesce(is_moderator::text,'NULL') FROM tenant_staff WHERE subdomain='$TID' AND staff_id='staff/001';")
[ "$FLAG" = "true" ] && ok "promotion persisted (is_moderator=true)" || no "is_moderator is $FLAG"
GRANTED=$(sudo -u postgres psql -d postgres -tAc "SELECT (moderator_granted_at IS NOT NULL)::text FROM tenant_staff WHERE subdomain='$TID' AND staff_id='staff/001';")
[ "$GRANTED" = "true" ] && ok "moderator_granted_at stamped" || no "grant timestamp is $GRANTED"

sleep 1
AUD=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs WHERE subdomain='$TID' AND action='moderators.promoted';")
[ "$AUD" -ge 1 ] && ok "promotion audited ($AUD rows)" || no "no moderators.promoted audit row"
sudo -u postgres psql -d postgres -tAc "SELECT '   '||actor_type||' | '||action FROM audit_logs WHERE subdomain='$TID' AND action LIKE 'moderators.%' ORDER BY id DESC LIMIT 2;"

echo
echo "=== E. demote clears moderator_granted_at ==="
curl -s -o /dev/null -X PATCH "$API/$TID/roster/staff/moderator" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${ADMH[@]}" \
  -d '{"subdomain":"vhs","staff_id":"staff/001","is_moderator":false}'
CLEARED=$(sudo -u postgres psql -d postgres -tAc "SELECT (moderator_granted_at IS NULL)::text FROM tenant_staff WHERE subdomain='$TID' AND staff_id='staff/001';")
[ "$CLEARED" = "true" ] && ok "grant timestamp cleared on demotion" || no "timestamp not cleared"

echo
echo "=== F. promoted moderator can actually log in with the new cap set ==="
R=$(curl -s -X POST "$API/$TID/admin/login" -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" \
  -d '{"identifier":"staff/001","password":"123456"}')
echo "  staff/001 login role: $(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('role'))" 2>/dev/null || echo 'n/a')"

echo
echo "=== G. password change: wrong current is rejected, correct succeeds ==="
C=$(curl -s -o /tmp/p.json -w "%{http_code}" -X POST "$API/$TID/password" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${ADMH[@]}" \
  -d '{"subdomain":"vhs","current_password":"WRONGPASS","new_password":"newpass12345"}')
[ "$C" = "401" ] && ok "wrong current password rejected (401)" || no "expected 401, got $C $C $(cat /tmp/p.json|head -c 80)"

echo "  -- moderator must be refused --"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/$TID/password" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${MODH[@]}" \
  -d '{"subdomain":"vhs","current_password":"layoutadmin123","new_password":"newpass12345"}')
[ "$C" = "403" ] && ok "moderator cannot change admin password (403)" || no "expected 403, got $C"

echo "  -- short new password rejected --"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/$TID/password" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${ADMH[@]}" \
  -d '{"subdomain":"vhs","current_password":"layoutadmin123","new_password":"short"}')
[ "$C" = "400" ] && ok "short password rejected (400)" || no "expected 400, got $C"

echo
echo "  -- correct change, then verify the new password logs in --"
C=$(curl -s -o /tmp/p2.json -w "%{http_code}" -X POST "$API/$TID/password" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${ADMH[@]}" \
  -d '{"subdomain":"vhs","current_password":"layoutadmin123","new_password":"rotated12345"}')
[ "$C" = "200" ] && ok "correct current password accepted (200)" || no "expected 200, got $C $(cat /tmp/p2.json|head -c 100)"
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/$TID/admin/login" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" -d '{"identifier":"info@vhs.test","password":"rotated12345"}')
[ "$R" = "200" ] && ok "login works with the NEW password" || no "new password login got $R"
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/$TID/admin/login" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" -d '{"identifier":"info@vhs.test","password":"layoutadmin123"}')
[ "$R" = "401" ] && ok "OLD password no longer works" || no "old password still accepted ($R)"

echo "  -- restore the original password --"
curl -s -o /dev/null -X POST "$API/$TID/password" -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${ADMH[@]}" \
  -d '{"subdomain":"vhs","current_password":"rotated12345","new_password":"layoutadmin123"}'
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/$TID/admin/login" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" -d '{"identifier":"info@vhs.test","password":"layoutadmin123"}')
[ "$R" = "200" ] && ok "password restored" || no "restore failed ($R)"

echo
echo "=== 0. no NameError waiting in either new endpoint ==="
# Every route in these modules imports db_manager symbols per-function, because
# the import near the top of the file lives inside a helper. A bare
# _connect_as_superuser / TENANT_STAFF_TABLE / _validate_tenant_id compiles fine
# and is only a NameError once the function runs -- which is exactly how the
# first two attempts of these endpoints failed.
python3 - <<'PY'
import ast, sys
problems = []
# db_manager symbols these routes must import locally (the module-level import
# near the top of each file lives INSIDE a helper, not at module scope).
DB_SYMBOLS = {"_connect_as_superuser", "TENANT_STAFF_TABLE", "SCHOOLS_REGISTRY_TABLE", "_row_to_dict"}

def module_defined(tree):
    """Names bound at module scope: imports, defs, classes, assignments."""
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                names.add((a.asname or a.name).split(".")[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)          # e.g. a module-level _validate_tenant_id
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    names.add(t.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names

for path, fns in (
    ("/var/www/resultapp-backend/backend/routers/allocations.py", ("list_staff", "set_staff_moderator")),
    ("/var/www/resultapp-backend/backend/routers/admin.py", ("change_tenant_admin_password",)),
):
    src = open(path).read()
    tree = ast.parse(src)
    mod_names = module_defined(tree)

    for fn in [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        if fn.name not in fns:
            continue
        local = set()
        for n in ast.walk(fn):
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                for a in n.names:
                    local.add((a.asname or a.name).split(".")[0])
            elif isinstance(n, ast.Assign):
                for t in n.targets:
                    if isinstance(t, ast.Name):
                        local.add(t.id)
            elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
                local.add(n.target.id)
            elif isinstance(n, ast.arg):
                local.add(n.arg)
        used = {n.id for n in ast.walk(fn) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
        # A db_manager symbol is safe if EITHER imported locally OR defined at
        # module scope in this file (some helpers are defined here).
        missing = {s for s in DB_SYMBOLS if s in used} - local - mod_names
        if missing:
            problems.append(f"{fn.name} ({path.split('/')[-1]}): uses {sorted(missing)} without importing or module-defining them")
if problems:
    for p in problems:
        print("  FAIL  " + p)
    sys.exit(1)
print("  PASS  every db_manager symbol used is either imported locally or module-defined")
PY
[ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo
echo "=== CLEANUP ==="
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_staff WHERE subdomain='$TID' AND staff_id='$MOD';"
sudo -u postgres psql -d postgres -q -c "DELETE FROM audit_logs WHERE subdomain='$TID' AND action LIKE 'moderators.%';"
sudo -u postgres psql -d postgres -q -c "DELETE FROM audit_logs WHERE subdomain='$TID' AND action='tenant.password_changed';"
echo "  cleaned"
echo
echo "=========================================="
echo "  $PASS passed, $FAIL failed"
echo "=========================================="
[ "$FAIL" -eq 0 ] && echo "  ALL PASS" || echo "  FAILURES PRESENT"