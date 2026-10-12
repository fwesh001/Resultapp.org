#!/bin/bash
S=$(sudo grep -oP '^API_SECRET_KEY=\K.*' /var/www/resultapp-backend/.env | head -1 | tr -d '"'"'"' \r')
API="http://127.0.0.1:8000/api/v1/tenant"
TID="vhs"

echo "=== raw JSON from the tenant audit route ==="
curl -s "$API/$TID/audit-logs?limit=3" -H "X-API-SECRET-KEY: $S" | python3 -m json.tool

echo
echo "=== is a DIFFERENT router claiming /api/v1/tenant/{id}/audit-logs? ==="
grep -rn "audit-logs" /var/www/resultapp-backend/backend/routers/*.py | sed 's|/var/www/resultapp-backend/backend/routers/||'

echo
echo "=== is it the superadmin route (no actor_type in its SELECT)? ==="
curl -s "$API/$TID/audit-logs?limit=2" -H "X-API-SECRET-KEY: $S" | python3 -c "
import json,sys
d=json.load(sys.stdin)
e=(d.get('entries') or [])
if e:
    print('  keys returned:', sorted(e[0].keys()))
    print('  has actor_type:', 'actor_type' in e[0])
"