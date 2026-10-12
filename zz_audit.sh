#!/bin/bash
S=$(sudo grep -oP '^API_SECRET_KEY=\K.*' /var/www/resultapp-backend/.env 2>/dev/null | head -1 | tr -d '"'"'"' \r')
API="http://127.0.0.1:8000/api/v1/tenant"
TID="vhs"
FRESH="staff/0099"
BEFORE=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs;" | tr -d ' ')

echo "=== seed a moderator ==="
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_staff WHERE subdomain='$TID' AND staff_id='$FRESH';"
sudo -u postgres psql -d postgres -q -c \
 "INSERT INTO tenant_staff (subdomain, staff_id, full_name, email, role, password_hash, is_moderator, moderator_granted_at)
  VALUES ('$TID','$FRESH','Testy Moderator','mod@example.com','Moderator', crypt('modpass123', gen_salt('bf')), TRUE, NOW());"

echo
echo "=== moderator login ==="
R=$(curl -s -X POST "$API/$TID/admin/login" -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$FRESH\",\"password\":\"modpass123\"}")
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  role =', d.get('role'), '| staff_id =', (d.get('admin') or {}).get('staff_id'))"

echo
echo "=== 1. clearance HOLD, sent WITH X-Viewer-* (as the Next proxy does) ==="
SID=$(sudo -u postgres psql -d postgres -tAc "SELECT student_id FROM tenant_students WHERE subdomain='$TID' ORDER BY student_id LIMIT 1;" | tr -d ' ')
TERM=$(sudo -u postgres psql -d postgres -tAc "SELECT coalesce(current_term,'Term 1') FROM schools WHERE subdomain='$TID' LIMIT 1;" 2>/dev/null | tr -d ' ')
[ -z "$TERM" ] && TERM="Term 1"
echo "  student=$SID term=$TERM"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X PUT "$API/$TID/clearance" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" \
  -H "X-Viewer-Role: moderator" -H "X-Viewer-Id: $FRESH" -H "X-Viewer-Label: Testy Moderator" \
  -d "{\"term\":\"$TERM\",\"student_ids\":[\"$SID\"],\"is_financially_cleared\":false,\"hold_reason\":\"AUDIT TEST HOLD\"}"

echo
echo "=== 2. clearance RELEASE ==="
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X PUT "$API/$TID/clearance" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" \
  -H "X-Viewer-Role: moderator" -H "X-Viewer-Id: $FRESH" -H "X-Viewer-Label: Testy Moderator" \
  -d "{\"term\":\"$TERM\",\"student_ids\":[\"$SID\"],\"is_financially_cleared\":true}"

echo
echo "=== 3. DELETE a roster record (throwaway student) ==="
T2="std/0099"
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_students WHERE subdomain='$TID' AND student_id='$T2';"
sudo -u postgres psql -d postgres -q -c \
 "INSERT INTO tenant_students (subdomain, student_id, full_name, class_name) VALUES ('$TID','$T2','Audit Test Student','JSS1A');"
RID=$(sudo -u postgres psql -d postgres -tAc "SELECT id FROM tenant_students WHERE subdomain='$TID' AND student_id='$T2';" | tr -d ' ')
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X DELETE "$API/$TID/roster/student/$RID" \
  -H "X-API-SECRET-KEY: $S" \
  -H "X-Viewer-Role: moderator" -H "X-Viewer-Id: $FRESH" -H "X-Viewer-Label: Testy Moderator"

echo
echo "=== 4. PROFILE UPDATE ==="
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X PATCH "$API/$TID/profile" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" \
  -H "X-Viewer-Role: moderator" -H "X-Viewer-Id: $FRESH" -H "X-Viewer-Label: Testy Moderator" \
  -d '{"motto":"Audit test motto"}'

sleep 1
echo
echo "=== 5. THE AUDIT ROWS (newest first) ==="
sudo -u postgres psql -d postgres -tAc "SELECT actor||' | '||actor_type||' | '||action||' | '||coalesce(details->>'fields',details->>'students',details->>'student_id','-') FROM audit_logs WHERE subdomain='$TID' ORDER BY id DESC LIMIT 6;"

echo
echo "=== 6. TENANT AUDIT READ ROUTE ==="
curl -s "$API/$TID/audit-logs?limit=5" -H "X-API-SECRET-KEY: $S" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  total:', d.get('total'))
for e in (d.get('entries') or [])[:5]:
    print('   ', e['actor_type'], '|', e['action'], '|', e['actor'])
"

echo
echo "=== 7. FILTER by actor_type=moderator ==="
curl -s "$API/$TID/audit-logs?actor_type=moderator&limit=5" -H "X-API-SECRET-KEY: $S" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  moderator rows:', d.get('total'))
ok = d.get('total',0) > 0
print('  VERDICT:', 'PASS - moderator actions attributed' if ok else 'FAIL')
"

echo
echo "=== 8. clean up ==="
sudo -u postgres psql -d postgres -q -c "DELETE FROM tenant_staff WHERE subdomain='$TID' AND staff_id='$FRESH';"
sudo -u postgres psql -d postgres -q -c "DELETE FROM audit_logs WHERE subdomain='$TID' AND (details->>'hold_reason'='AUDIT TEST HOLD' OR (details->>'student_id')='$T2' OR (details->>'fields')='[\"motto\"]');"
echo "  audit rows before=$BEFORE after=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs;" | tr -d ' ')"
echo "  (rows for the TEST student only should be gone)"
echo "DONE"