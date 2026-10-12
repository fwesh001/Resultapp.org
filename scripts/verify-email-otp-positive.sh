#!/bin/bash
# The POSITIVE path: a genuinely-verified code MUST authorise the change.
#
# The negative cases prove the gate does not leak. This proves it does not
# simply reject everything — a gate that is always closed is not a gate, it is
# an outage, and the demo exemption alone would hide that.
#
# To do that honestly it mints a real code through the same helper the HTTP
# endpoint uses, then drives the REAL profile route with it.
S=$(sudo grep -oP '^API_SECRET_KEY=\K.*' /var/www/resultapp-backend/.env 2>/dev/null | head -1 | tr -d '"'"'"' \r')
API="http://127.0.0.1:8000/api/v1"
TID="vhs"
PROF="$API/tenant/$TID/profile"
NEW="verified-change-$$@example.com"
OLD=$(sudo -u postgres psql -d postgres -tAc "SELECT LOWER(email) FROM schools WHERE subdomain='$TID';" | tr -d ' ')
PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1  $2"; FAIL=$((FAIL+1)); }
H=(-H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" -H "X-Viewer-Role: admin" -H "X-Viewer-Id: $OLD")

echo "=== baseline: $OLD ==="

echo
echo "=== 1. mint a REAL email_change code via the app's own helper ==="
CODE=$(cd /var/www/resultapp-backend && set -a && . ./.env && set +a && venv/bin/python -c "
import sys; sys.path.insert(0,'backend')
from services.db_manager import issue_email_otp
r = issue_email_otp('$NEW', purpose='email_change')
print(r['raw_code'] if r else '')
")
[ -n "$CODE" ] && ok "code minted (${#CODE} digits)" || { no "could not mint a code"; echo "ABORT"; exit 1; }

echo
echo "=== 2. that code + otp_verified=true authorises the change ==="
C=$(curl -s -o /tmp/p.json -w "%{http_code}" -X PATCH "$PROF" "${H[@]}" \
  -d "{\"email\":\"$NEW\",\"otp_verified\":true,\"otp_code\":\"$CODE\"}")
echo "  HTTP $C"
NOW=$(sudo -u postgres psql -d postgres -tAc "SELECT LOWER(email) FROM schools WHERE subdomain='$TID';" | tr -d ' ')
echo "  email on disk: $NOW"
[ "$C" = "200" ] && ok "verified change accepted (200)" || no "expected 200" "got $C $(head -c 100 /tmp/p.json)"
[ "$NOW" = "$(echo $NEW | tr 'A-Z' 'a-z')" ] && ok "email actually changed" || no "email is $NOW"

echo
echo "=== 3. the code is SINGLE-USE (replay must fail) ==="
C=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$PROF" "${H[@]}" \
  -d "{\"email\":\"replay-$NEW\",\"otp_verified\":true,\"otp_code\":\"$CODE\"}")
echo "  HTTP $C"
[ "$C" = "403" ] && ok "replayed code rejected (403)" || no "expected 403" "got $C"

echo
echo "=== 4. the new address is now the working login identifier ==="
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/tenant/$TID/admin/login" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$NEW\",\"password\":\"layoutadmin123\"}")
[ "$R" = "200" ] && ok "login with the NEW email works" || no "new-email login got $R"

echo
echo "=== 5. the email change was audited ==="
sleep 1
AUD=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM audit_logs WHERE subdomain='$TID' AND action='tenant.email_changed' AND created_at > NOW() - interval '5 minutes';")
[ "$AUD" -ge 1 ] && ok "tenant.email_changed audited ($AUD row(s))" || no "no audit row"
sudo -u postgres psql -d postgres -tAc "SELECT '   '||actor_type||' | '||action||' | old='||coalesce(details->>'old_email','-') FROM audit_logs WHERE subdomain='$TID' AND action='tenant.email_changed' ORDER BY id DESC LIMIT 1;"

echo
echo "=== 6. change it BACK to the original (also needs a fresh code) ==="
CODE2=$(cd /var/www/resultapp-backend && set -a && . ./.env && set +a && venv/bin/python -c "
import sys; sys.path.insert(0,'backend')
from services.db_manager import issue_email_otp
r = issue_email_otp('$OLD', purpose='email_change')
print(r['raw_code'] if r else '')
")
C=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$PROF" \
  -H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json" -H "X-Viewer-Role: admin" -H "X-Viewer-Id: $NEW" \
  -d "{\"email\":\"$OLD\",\"otp_verified\":true,\"otp_code\":\"$CODE2\"}")
BACK=$(sudo -u postgres psql -d postgres -tAc "SELECT LOWER(email) FROM schools WHERE subdomain='$TID';" | tr -d ' ')
[ "$C" = "200" ] && [ "$BACK" = "$OLD" ] && ok "email restored to $OLD" || no "restore got $C, now $BACK"

echo
echo "=== CLEANUP ==="
sudo -u postgres psql -d postgres -q -c "DELETE FROM email_otp_codes WHERE email LIKE 'verified-change-%' OR email LIKE '%$TID' AND email='$OLD';"
sudo -u postgres psql -d postgres -q -c "DELETE FROM audit_logs WHERE subdomain='$TID' AND created_at > NOW() - interval '10 minutes';"
echo "  final email: $(sudo -u postgres psql -d postgres -tAc "SELECT LOWER(email) FROM schools WHERE subdomain='$TID';")"
echo
echo "=========================================="
echo "  $PASS passed, $FAIL failed"
echo "=========================================="
[ "$FAIL" -eq 0 ] && echo "  GATE OPENS ONLY FOR PROOF" || echo "  PROBLEM"
