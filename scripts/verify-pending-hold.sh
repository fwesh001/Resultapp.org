#!/bin/bash
# Exercises the pending-registration hold + claim/release against the live DB.
# Proves the table exists, the endpoints round-trip, and the claim is genuinely
# mutually exclusive — the property the whole webhook safety net rests on.
S=$(sudo grep -oP '^API_SECRET_KEY=\K.*' /var/www/resultapp-backend/.env 2>/dev/null | head -1 | tr -d '"'"'"' \r')
B="http://127.0.0.1:8000/api/v1/admin"
PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1  $2"; FAIL=$((FAIL+1)); }
H=(-H "X-API-SECRET-KEY: $S" -H "Content-Type: application/json")
TX="resultapp_selftest_$(date +%s)_abc123"

echo "=== 0. schema present ==="
T=$(sudo -u postgres psql -d postgres -tAc "SELECT to_regclass('public.pending_registrations');")
[ "$T" = "pending_registrations" ] && ok "pending_registrations table exists" || no "table missing" "$T"

echo
echo "=== 1. create a hold ==="
C=$(curl -s -o /tmp/h.json -w "%{http_code}" -X POST "$B/pending-registrations" "${H[@]}" \
  -d "{\"tx_ref\":\"$TX\",\"subdomain\":\"selftest\",\"payload\":{\"school_name\":\"Self Test\",\"admin_email\":\"a@b.test\",\"student_count\":150,\"admin_password\":\"enc:v1:xx\"},\"ttl_minutes\":30}")
echo "  HTTP $C $(head -c 90 /tmp/h.json)"
[ "$C" = "200" ] && ok "hold created" || no "create failed" "$C"

echo
echo "=== 2. read it back (sealed payload round-trips) ==="
C=$(curl -s -o /tmp/r.json -w "%{http_code}" "$B/pending-registrations?tx_ref=$TX" -H "X-API-SECRET-KEY: $S")
P=$(python3 -c "import json;d=json.load(open('/tmp/r.json'));print(d.get('payload',{}).get('school_name'))" 2>/dev/null)
echo "  HTTP $C  school_name=$P  status=$(python3 -c "import json;print(json.load(open('/tmp/r.json')).get('status'))" 2>/dev/null)"
[ "$C" = "200" ] && [ "$P" = "Self Test" ] && ok "hold round-trips with payload intact" || no "read failed" "$C"

echo
echo "=== 3. MISSING tx_ref is a 404, not a 500 ==="
C=$(curl -s -o /dev/null -w "%{http_code}" "$B/pending-registrations?tx_ref=resultapp_nope_1_zz" -H "X-API-SECRET-KEY: $S")
[ "$C" = "404" ] && ok "unknown tx_ref -> 404" || no "expected 404" "$C"

echo
echo "=== 4. CLAIM is mutually exclusive (the idempotency primitive) ==="
C1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/pending-registrations/claim" "${H[@]}" -d "{\"tx_ref\":\"$TX\"}")
C2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/pending-registrations/claim" "${H[@]}" -d "{\"tx_ref\":\"$TX\"}")
echo "  first claim=$C1  second claim=$C2"
if [ "$C1" = "200" ] && [ "$C2" = "409" ]; then
  ok "second claim refused (409) — only one runner can provision"
else
  no "claim is not exclusive" "first=$C1 second=$C2"
fi

echo
echo "=== 5. RELEASE puts it back so a failed provision can retry ==="
curl -s -o /dev/null -X POST "$B/pending-registrations/release" "${H[@]}" -d "{\"tx_ref\":\"$TX\"}"
C3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/pending-registrations/claim" "${H[@]}" -d "{\"tx_ref\":\"$TX\"}")
[ "$C3" = "200" ] && ok "released hold can be claimed again (retry possible)" || no "release did not restore" "$C3"

echo
echo "=== 6. re-POST the same tx_ref does not overwrite (idempotent create) ==="
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/pending-registrations" "${H[@]}" \
  -d "{\"tx_ref\":\"$TX\",\"subdomain\":\"selftest\",\"payload\":{\"school_name\":\"Overwritten\"},\"ttl_minutes\":30}")
N=$(python3 -c "
import json,urllib.request
" 2>/dev/null; sudo -u postgres psql -d postgres -tAc "SELECT payload->>'school_name' FROM pending_registrations WHERE tx_ref='$TX';")
echo "  stored school_name='$N'"
[ "$N" = "Self Test" ] && ok "re-POST did NOT overwrite an existing hold" || no "hold was overwritten" "$N"

echo
echo "=== 7. bad input is refused ==="
# 422 is Pydantic rejecting the body before the handler runs; 400 would be our
# own guard. Both are correct refusals — assert the request is rejected rather
# than pinning which layer caught it, so tightening the model later does not
# read as a regression.
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/pending-registrations" "${H[@]}" -d '{"tx_ref":"","subdomain":"x"}')
{ [ "$C" = "400" ] || [ "$C" = "422" ]; } && ok "empty tx_ref refused ($C)" || no "expected 400/422" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/pending-registrations" "${H[@]}" -d "{\"tx_ref\":\"$TX\",\"subdomain\":\"\"}")
{ [ "$C" = "400" ] || [ "$C" = "422" ]; } && ok "empty subdomain refused ($C)" || no "expected 400/422" "$C"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/pending-registrations" "${H[@]}" -d "{\"tx_ref\":\"$TX\",\"subdomain\":\"selftest\",\"payload\":{}}")
{ [ "$C" = "200" ] || [ "$C" = "400" ] || [ "$C" = "422" ]; } && ok "empty payload handled ($C)" || no "unexpected" "$C"

echo
echo "=== CLEANUP ==="
sudo -u postgres psql -d postgres -q -c "DELETE FROM pending_registrations WHERE tx_ref='$TX';"
echo "  removed"
echo
echo "=========================================="
echo "  $PASS passed, $FAIL failed"
echo "=========================================="
[ "$FAIL" -eq 0 ] && echo "  HOLD STORE OK" || echo "  PROBLEMS"