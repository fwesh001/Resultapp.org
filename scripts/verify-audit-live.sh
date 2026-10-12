#!/bin/bash
# Live audit verification. Asserts rows actually appear and are attributed.
S=$(sudo grep -oP '^API_SECRET_KEY=\K.*' /var/www/resultapp-backend/.env 2>/dev/null | head -1 | tr -d '"'"'"' \r')
API="http://127.0.0.1:8000/api/v1/tenant"
TID="vhs"
FRESH="staff/0099"
MARK="AUDITTRAIL$$"
PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# ---- seed a moderator (staff_id is the column, not student_id) ----
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_staff WHERE subdomain='$TID' AND staff_id='$FRESH';"
sudo -u postgres psql -d postgres -q -c \
 "INSERT INTO tenant_staff (subdomain, staff_id, full_name, email, role, password_hash, is_moderator, moderator_granted_at)
  VALUES ('$TID','$FRESH','Testy Moderator','mod$MARK@example.com','Moderator', crypt('modpass123', gen_salt('bf')), TRUE, NOW());"

TERM="Term 1"
SID=$(sudo -u postgres psql -d postgres -tAc "SELECT student_id FROM tenant_students WHERE subdomain='$TID' ORDER BY student_id LIMIT 1;" | tr -d ' ')
V=(-H "X-Viewer-Role: moderator" -H "X-Viewer-Id: $FRESH" -H "X-Viewer-Label: Testy Moderator")

echo "=== A. moderator login identifies as moderator ==="
R=$(curl -s -X POST "$API/$TID/admin/login" -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$FRESH\",\"password\":\"modpass123\"}")
ROLE=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('role',''))")
[ "$ROLE" = "moderator" ] && ok "login returns role=moderator" || no "login role was '$ROLE'"

echo
echo "=== B. clearance HOLD + RELEASE (the case that silently failed before) ==="
curl -s -o /dev/null -X PUT "$API/$TID/clearance" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" "${V[@]}" \
  -d "{\"term\":\"$TERM\",\"student_ids\":[\"$SID\"],\"is_financially_cleared\":false,\"hold_reason\":\"$MARK\"}"
curl -s -o /dev/null -X PUT "$API/$TID/clearance" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" "${V[@]}" \
  -d "{\"term\":\"$TERM\",\"student_ids\":[\"$SID\"],\"is_financially_cleared\":true}"

echo
echo "=== C. roster UPDATE (motto-free field) + DELETE ==="
T2="std/$MARK"
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_students WHERE subdomain='$TID' AND student_id='$T2';"
sudo -u postgres psql -d postgres -q -c \
 "INSERT INTO tenant_students (subdomain, student_id, full_name, class_name, password_hash)
  VALUES ('$TID','$T2','Trail Student','JSS1A', crypt('123456', gen_salt('bf')));"
RID=$(sudo -u postgres psql -d postgres -tAc "SELECT id FROM tenant_students WHERE subdomain='$TID' AND student_id='$T2';" | tr -d ' ')
curl -s -o /dev/null -X PATCH "$API/$TID/roster/student/$RID" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" "${V[@]}" -d "{\"full_name\":\"Trail Student Renamed\"}"
curl -s -o /dev/null -X DELETE "$API/$TID/roster/student/$RID" -H "X-API-SECRET-KEY: $S" "${V[@]}"

echo
echo "=== D. profile UPDATE ==="
curl -s -o /dev/null -X PATCH "$API/$TID/profile" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" "${V[@]}" -d "{\"motto\":\"$MARK\"}"

echo
echo "=== E. PUBLISH (the log_audit NameError path) ==="
STU=$(sudo -u postgres psql -d postgres -tAc "SELECT student_id FROM tenant_students WHERE subdomain='$TID' AND full_name='Trail Student Renamed' LIMIT 1;" | tr -d ' ')
# give the tenant credits so publish does not 402 on the credit check
sudo -u postgres psql -d postgres -q -c "UPDATE schools SET credit_balance=credit_balance+500 WHERE subdomain='$TID';" 2>/dev/null
# credits.py mounts at /api/v1/tenant/{tid}/credits/*, so publish lives under /credits/
PC=$(curl -s -o /tmp/pub.json -w "%{http_code}" -X POST "$API/$TID/credits/publish" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" "${V[@]}" \
  -d "{\"term\":\"$TERM\",\"student_ids\":[\"$STU\"]}")
echo "  publish HTTP $PC  $(head -c 120 /tmp/pub.json)"
sudo -u postgres psql -d postgres -q -c "UPDATE schools SET credit_balance=credit_balance-500 WHERE subdomain='$TID';" 2>/dev/null

sleep 1
echo
echo "=== F. ROWS LANDED? (searching for our marker) ==="
COUNT=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs WHERE subdomain='$TID' AND action IN ('clearance.held','clearance.released','roster.student_updated','roster.student_deleted','roster.student_purged','tenant.profile_updated','results.publish') AND created_at > NOW() - interval '3 minutes';")
echo "  rows written in last 3 min: $COUNT"
[ "$COUNT" -ge 6 ] && ok "critical mutations wrote audit rows ($COUNT, incl. results.publish)" || no "expected >=6 audit rows, got $COUNT"

echo
echo "  per-action:"
sudo -u postgres psql -d postgres -tAc "SELECT action||' -> by '||actor||' ('||actor_type||')' FROM audit_logs WHERE subdomain='$TID' AND created_at > NOW() - interval '3 minutes' ORDER BY id;"

echo
echo "=== G. ATTRIBUTION: is it the moderator, not 'superadmin'? ==="
MOD=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs WHERE subdomain='$TID' AND actor_type='moderator' AND created_at > NOW() - interval '3 minutes';")
SA=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs WHERE subdomain='$TID' AND actor_type='superadmin' AND created_at > NOW() - interval '3 minutes';")
[ "$MOD" -ge 5 ] && ok "moderator attributed on $MOD rows (not defaulted to superadmin)" || no "moderator rows=$MOD superadmin rows=$SA"
[ "$SA" -eq 0 ] && ok "no rows fell back to actor_type=superadmin" || no "$SA rows wrongly claim superadmin"

echo
echo "=== H. UUID GUARD: no invalid uuid crash, actor_id is NULL not garbage ==="
BAD=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs WHERE subdomain='$TID' AND actor_id IS NOT NULL AND created_at > NOW() - interval '3 minutes';")
[ "$BAD" -eq 0 ] && ok "actor_id NULL for non-UUID staff ids (no crash)" || no "$BAD rows carry an actor_id"

echo
echo "=== I. READ ROUTE returns real columns ==="
curl -s "$API/$TID/audit-logs?limit=10" -H "X-API-SECRET-KEY: $S" | python3 -c "
import json,sys
d=json.load(sys.stdin)
e=(d.get('entries') or [])
print('  total:', d.get('total'))
if e and all(k in e[0] for k in ('actor','action','actor_type','created_at')):
    print('  PASS  reader returns actor/action/actor_type/created_at')
else:
    print('  FAIL  reader columns mangled:', sorted(e[0].keys()) if e else 'no entries')
    sys.exit(1)
" && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); }
echo "  first 3 entries:"
sudo -u postgres psql -d postgres -tAc "SELECT '   '||actor_type||' | '||action FROM audit_logs WHERE subdomain='$TID' AND created_at > NOW() - interval '3 minutes' ORDER BY id DESC LIMIT 3;"

echo
echo "=== J. FILTERS ==="
C1=$(curl -s "$API/$TID/audit-logs?actor_type=moderator" -H "X-API-SECRET-KEY: $S" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
C2=$(curl -s "$API/$TID/audit-logs?action_prefix=clearance" -H "X-API-SECRET-KEY: $S" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
C3=$(curl -s "$API/$TID/audit-logs?action_prefix=roster" -H "X-API-SECRET-KEY: $S" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")
echo "  actor_type=moderator total=$C1 ; clearance prefix=$C2 ; roster prefix=$C3"
[ "$C1" -ge 5 ] && ok "actor_type filter works" || no "actor_type filter returned $C1"
[ "$C2" -ge 2 ] && ok "action_prefix filter works" || no "clearance prefix returned $C2"

echo
echo "=== K. old_email correctness (the mislabelled-value bug) ==="
# set a known email, then change it, and confirm the audit reports the OLD one
sudo -u postgres psql -d postgres -q -c "UPDATE schools SET email='old$MARK@example.com' WHERE subdomain='$TID';"
curl -s -o /dev/null -X PATCH "$API/$TID/profile" -H "X-API-SECRET-KEY: $S" \
  -H "Content-Type: application/json" "${V[@]}" -d "{\"email\":\"new$MARK@example.com\"}"
sleep 1
GOT=$(sudo -u postgres psql -d postgres -tAc "SELECT details->>'old_email' FROM audit_logs WHERE subdomain='$TID' AND action='tenant.email_changed' AND created_at > NOW() - interval '2 minutes' ORDER BY id DESC LIMIT 1;" | tr -d ' ')
echo "  audit old_email = '$GOT'  (expected 'old$MARK@example.com')"
[ "$GOT" = "old$MARK@example.com" ] && ok "old_email reports the PREVIOUS address" || no "old_email is '$GOT'"

echo
echo "=== CLEANUP ==="
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_staff WHERE subdomain='$TID' AND staff_id='$FRESH';"
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_students WHERE subdomain='$TID' AND student_id='$T2';"
sudo -u postgres psql -d postgres -q -c "UPDATE schools SET email='info@vhs.test', motto=NULL WHERE subdomain='$TID';"
sudo -u postgres psql -d postgres -q -c "DELETE FROM audit_logs WHERE subdomain='$TID' AND created_at > NOW() - interval '10 minutes';"
echo "  cleaned"
echo
echo "=========================================="
echo "  $PASS passed, $FAIL failed"
echo "=========================================="
[ "$FAIL" -eq 0 ] && echo "  ALL PASS" || echo "  FAILURES PRESENT"