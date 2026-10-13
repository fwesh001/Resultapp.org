#!/usr/bin/env bash
# Forensics on parked registrations: what is sitting in the table, where it came
# from, and whether any admin password is stored unsealed.
#
# Written while investigating a batch of 13 rows under subdomain 'fis' that no
# script of ours had created. The lesson generalised into this tool.
#
# The admin_password is REDACTED in every query below. An earlier draft used
# jsonb_pretty(payload), which prints the full enc:v1 envelope into the
# terminal and into any captured log. Ciphertext is not plaintext, but it is
# credential material, and a forensic tool is exactly the sort of script people
# paste output from.
#
# Usage:  inspect-hold-rows.sh [tx_ref]
# Run it ON the droplet. Needs psql and sudo.
set -uo pipefail

TX="${1:-}"
PSQL="sudo -u postgres psql -d postgres"

# Redacts admin_password to a shape marker (encrypted / plain / absent) rather
# than its value. Everything else in the payload is not a credential.
REDACT="payload || jsonb_build_object('admin_password',
  CASE
    WHEN payload->>'admin_password' IS NULL THEN NULL
    WHEN payload->>'admin_password' LIKE 'enc:v1:%' THEN '<encrypted enc:v1 envelope>'
    ELSE '<PLAINTEXT — investigate>'
  END)"

echo "=== parked registrations ==="
$PSQL -c \
  "SELECT tx_ref, status, COALESCE(payload->>'school_name','?') AS school,
          payload->>'subdomain' AS subdomain, created_at
   FROM pending_registrations ORDER BY created_at DESC LIMIT 25;"

echo ""
echo "=== distinct profile (who/what is parking here) ==="
$PSQL -c \
  "SELECT payload->>'subdomain' AS sub, payload->>'school_name' AS school,
          payload->>'admin_email' AS email, count(*) AS n,
          min(created_at) AS first_seen, max(created_at) AS last_seen
   FROM pending_registrations GROUP BY 1,2,3 ORDER BY n DESC;"

echo ""
echo "=== password storage check (counts only, never values) ==="
$PSQL -c \
  "SELECT count(*) FILTER (WHERE (payload->>'admin_password') LIKE 'enc:v1:%') AS encrypted,
          count(*) FILTER (WHERE payload->>'admin_password' IS NOT NULL
                             AND (payload->>'admin_password') NOT LIKE 'enc:v1:%') AS PLAINTEXT,
          count(*) FILTER (WHERE payload->>'admin_password' IS NULL) AS no_password,
          count(*) AS total
   FROM pending_registrations;"

if [ -n "$TX" ]; then
  echo ""
  echo "=== payload of $TX (admin_password redacted) ==="
  $PSQL -tAc "SELECT jsonb_pretty($REDACT) FROM pending_registrations WHERE tx_ref='$TX';"
fi

echo ""
echo "  Tip: remove rows with cleanup-smoke-rows.sh <subdomain> --yes"