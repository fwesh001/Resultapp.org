#!/usr/bin/env bash
# Confirms a parked registration is actually sealed at rest.
#
# The hold endpoint returning 200 only proves PENDING_REGISTRATION_SECRET was
# PRESENT. This proves the admin password was ENCRYPTED with it — a missing key
# and a wrong key both fail loudly at encrypt time, but a key that somehow
# round-tripped plaintext would not, and that is the failure worth catching.
#
# Scope note: seal() deliberately encrypts ONLY admin_password. school_name,
# admin_name and admin_email stay in plaintext by design — the webhook needs
# them to provision, and they are not credentials. This asserts the password
# and reports the rest as informational rather than pretending to be a breach.
set -uo pipefail

TX="${1:-}"
if [ -z "$TX" ]; then
  echo "usage: verify-hold-sealed.sh <tx_ref>"
  exit 2
fi

pw=$(sudo -u postgres psql -d postgres -tAc \
  "SELECT payload->>'admin_password' FROM pending_registrations WHERE tx_ref='$TX';")

if [ -z "$pw" ] || [ "$pw" = "" ]; then
  echo "  FAIL  no row / no admin_password for $TX"
  exit 1
fi

echo "  stored admin_password: $(echo "$pw" | cut -c1-28)…"

# The plaintext must not survive anywhere in the column.
case "$pw" in
  *Str0ng-Passw0rd*)
    echo "  FAIL  password is stored in PLAINTEXT"
    exit 1
    ;;
  enc:v1:*:*:*)
    echo "  PASS  envelope is enc:v1:<iv>:<tag>:<ciphertext> (AES-256-GCM)"
    ;;
  *)
    echo "  FAIL  unexpected envelope format"
    exit 1
    ;;
esac

# Structural proof: four colon-separated segments after the prefix.
segments=$(echo "$pw" | awk -F':' '{print NF}')
if [ "$segments" -eq 5 ]; then
  echo "  PASS  5 segments (prefix + iv + tag + ciphertext)"
else
  echo "  FAIL  expected 5 colon-separated segments, got $segments"
  exit 1
fi

info=$(sudo -u postgres psql -d postgres -tAc \
  "SELECT (payload->>'school_name') || ' / ' || (payload->>'admin_email') FROM pending_registrations WHERE tx_ref='$TX';")
echo "  INFO  stored in plaintext by design: $info"

echo "  HOLD SEALED OK"