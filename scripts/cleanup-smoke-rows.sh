#!/usr/bin/env bash
# Deletes parked registrations by subdomain, safely.
#
# These rows hold AES-encrypted admin passwords and are invisible to the UI, so
# test rows accumulate unnoticed. This removes them without touching anything
# real.
#
# Safety properties, in order of importance:
#   - dry run by default; --yes is required to actually delete
#   - matches on the SUBDOMAIN inside the sealed payload, not the tx_ref text
#   - refuses empty and wildcard matches, which would mean the filter is wrong
#   - prints every row before removing any, and prints the count removed
#
# Usage:
#   cleanup-smoke-rows.sh <subdomain>            # show what would go
#   cleanup-smoke-rows.sh <subdomain> --yes      # actually delete
#
# Run it ON the droplet. It needs psql and sudo.
set -uo pipefail

SUB="${1:-}"
CONFIRM="${2:-}"

if [ -z "$SUB" ]; then
  echo "usage: $0 <subdomain> [--yes]"
  echo "  e.g. $0 racefixsmoke --yes"
  exit 2
fi

case "$SUB" in
  *%*|*'*'*|*' '*|"")
    echo "  REFUSING: '$SUB' looks like a wildcard or blank. Match one exact subdomain."
    exit 2
    ;;
esac

PSQL="sudo -u postgres psql -d postgres"

rows=$($PSQL -tAc \
  "SELECT tx_ref || ' | ' || status || ' | ' || COALESCE(payload->>'school_name','?')
   FROM pending_registrations
   WHERE payload->>'subdomain' = '$SUB'
   ORDER BY created_at;")

if [ -z "$rows" ]; then
  echo "  nothing parked under subdomain '$SUB'"
  exit 0
fi

count=$(echo "$rows" | grep -c .)
echo "  $count row(s) parked under subdomain '$SUB':"
echo "$rows" | sed 's/^/    /'
echo ""

if [ "$CONFIRM" != "--yes" ]; then
  echo "  dry run. Re-run with --yes to delete."
  exit 0
fi

# Delete by the same predicate that produced the listing above, so what was
# shown is exactly what goes.
deleted=$($PSQL -tAc \
  "WITH gone AS (
     DELETE FROM pending_registrations
     WHERE payload->>'subdomain' = '$SUB'
     RETURNING 1
   ) SELECT count(*) FROM gone;")

left=$($PSQL -tAc \
  "SELECT count(*) FROM pending_registrations WHERE payload->>'subdomain' = '$SUB';")

echo "  deleted $deleted row(s)"
echo "  remaining under '$SUB': $left"

if [ "$left" != "0" ]; then
  echo "  INCOMPLETE — something was not removed"
  exit 1
fi
echo "  CLEANUP OK"