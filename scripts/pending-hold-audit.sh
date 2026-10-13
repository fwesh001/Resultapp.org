#!/usr/bin/env bash
# Reports what is currently parked, so leftovers are visible rather than`n# assumed absent. See inspect-hold-rows.sh for deeper forensics.
set -uo pipefail

echo "  current pending_registrations:"
sudo -u postgres psql -d postgres -c \
  "SELECT tx_ref, status, COALESCE(payload->>'school_name','?') AS school, created_at FROM pending_registrations ORDER BY created_at DESC LIMIT 20;"

count=$(sudo -u postgres psql -d postgres -tAc "SELECT count(*) FROM pending_registrations;")
echo "  total rows: $count"

# Anything whose subdomain is obviously ours and not a real school.
stray=$(sudo -u postgres psql -d postgres -tAc \
  "SELECT tx_ref FROM pending_registrations WHERE tx_ref ~* '(smoke|test|self|zzz)';")
if [ -z "$stray" ]; then
  echo "  no test-looking rows"
else
  echo "  test-looking rows still present:"
  echo "$stray" | sed 's/^/    /'
fi