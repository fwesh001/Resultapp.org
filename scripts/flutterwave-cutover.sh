#!/usr/bin/env bash
#
# Flutterwave production cutover.
#
# WHY THIS IS A SCRIPT AND NOT SOMETHING THE AGENT JUST RAN
# -------------------------------------------------------
# These values are live payment credentials. Setting them through a chat
# transcript or an agent tool call would copy them into a channel they were
# never meant to live in, and the correct response to that is rotation rather
# than convenience. This reads .env.local directly and pipes straight to
# Vercel, so no key is ever echoed, logged, or pasted.
#
# WHAT IT DOES
# ------------
#   1. Reports the mode of each key WITHOUT printing it.
#   2. Pushes the three canonical vars to Vercel production.
#   3. Notes the two that need a human first.
#
# Usage:  bash scripts/flutterwave-cutover.sh          (dry run — changes nothing)
#         bash scripts/flutterwave-cutover.sh --apply  (actually sets them)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

[[ -f "$ENV_FILE" ]] || { echo "!! $ENV_FILE not found"; exit 1; }

# Read a value without ever echoing it.
read_env() {
  local name="$1"
  grep -E "^${name}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^"//;s/"$//'
}

mode_of() {
  local v="$1"
  [[ -z "$v" ]] && { echo "EMPTY"; return; }
  [[ "$v" == *TEST* ]] && { echo "TEST"; return; }
  [[ "$v" == FLWPUBK-* || "$v" == FLWSECK-* ]] && { echo "LIVE"; return; }
  echo "set(non-flw)"
}

# The webhook hash has a DIFFERENT SHAPE from the API keys, so it gets its own
# classifier. Using mode_of() here was a bug: Flutterwave derives the hash from
# the secret key, so in test mode it carries a `FLWSECK_TEST` prefix but in LIVE
# mode it is a bare hex string with no prefix at all. mode_of() only recognised
# the FLWPUBK-/FLWSECK- prefixes, so every correctly-configured live hash fell
# through to "set(non-flw)" and blocked the cutover.
#
# The only meaningful distinction is TEST vs not. A test-mode hash will fail every
# LIVE webhook at the signature check, so that is the one thing worth refusing on.
# Anything else is treated as the opaque value Flutterwave generated — we do not
# invent a format for it, and we do not require the user to.
webhook_hash_state() {
  local v="$1"
  [[ -z "$v" ]] && { echo "EMPTY"; return; }
  [[ "$v" == *_TEST* || "$v" == *TEST* ]] && { echo "TEST-MODE"; return; }
  echo "LIVE"
}

PUB=$(read_env NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY)
DEMO=$(read_env NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY)
SEC=$(read_env FLUTTERWAVE_SECRET_KEY)
HASH=$(read_env FLUTTERWAVE_WEBHOOK_SECRET_HASH)
PEND=$(read_env PENDING_REGISTRATION_SECRET)

echo "=== current .env.local (modes only — values are never printed) ==="
printf "  %-42s %s\n" "NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY"      "$(mode_of "$PUB")"
printf "  %-42s %s\n" "NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY" "$(mode_of "$DEMO")"
printf "  %-42s %s\n" "FLUTTERWAVE_SECRET_KEY"                  "$(mode_of "$SEC")"
printf "  %-42s %s\n" "FLUTTERWAVE_WEBHOOK_SECRET_HASH"         "$(webhook_hash_state "$HASH")"
printf "  %-42s %s\n" "PENDING_REGISTRATION_SECRET"             "$(mode_of "$PEND")"
echo

BLOCKERS=0
[[ "$(mode_of "$PUB")"  == "LIVE" ]] || { echo "!! NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY must be LIVE"; BLOCKERS=1; }
[[ "$(mode_of "$SEC")"  == "LIVE" ]] || { echo "!! FLUTTERWAVE_SECRET_KEY must be LIVE"; BLOCKERS=1; }
[[ "$(mode_of "$DEMO")" == "TEST" ]] || { echo "!! NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY should be TEST (demo shows card 5531...)"; BLOCKERS=1; }
[[ "$(webhook_hash_state "$HASH")" == "LIVE" ]] || {
  echo ""
  echo ">> FLUTTERWAVE_WEBHOOK_SECRET_HASH is $(webhook_hash_state "$HASH")."
  if [[ "$(webhook_hash_state "$HASH")" == "TEST-MODE" ]]; then
    echo "   That looks like the TEST-MODE hash. Copy the LIVE value from"
    echo "   Flutterwave Dashboard -> Settings -> Webhooks (the same page you are"
    echo "   on; click the eye icon to reveal it) and replace it."
    echo "   Until you do, every live webhook is rejected at the signature check —"
    echo "   the safety net stays dormant, but nothing else is affected."
  else
    echo "   Set it to the value shown on Flutterwave Dashboard -> Settings -> Webhooks."
    echo "   It is an opaque string Flutterwave generates; do not invent your own."
  fi
  BLOCKERS=1
}
[[ -n "$PEND" ]] || { echo "!! PENDING_REGISTRATION_SECRET is empty — the hold endpoint will refuse"; BLOCKERS=1; }

if [[ $BLOCKERS -ne 0 ]]; then
  echo ""
  echo "!! Fix the above before running with --apply."
  exit 1
fi

echo "=== Vercel targets ==="
for pair in "NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY:$PUB" \
            "NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY:$DEMO" \
            "FLUTTERWAVE_SECRET_KEY:$SEC" \
            "FLUTTERWAVE_WEBHOOK_SECRET_HASH:$HASH" \
            "PENDING_REGISTRATION_SECRET:$PEND"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" == "$PUB"  ]] && echo "  $name = (live public key)"
  [[ "$value" == "$SEC"  ]] && echo "  $name = (live secret key)"
  [[ "$value" == "$DEMO" ]] && echo "  $name = (test demo key)"
  [[ "$value" == "$HASH" ]] && echo "  $name = (webhook hash)"
  [[ "$value" == "$PEND" ]] && echo "  $name = (pending-registration secret)"
done
echo

if [[ $APPLY -ne 1 ]]; then
  echo "Dry run. Re-run with --apply to write these to Vercel production."
  exit 0
fi

echo "=== writing to Vercel production ==="
set_one() {
  local name="$1" value="$2" scope="${3:-production}"
  printf "  %-42s " "$name"
  if printf '%s' "$value" | npx --yes vercel env add "$name" "$scope" --force --yes - >/dev/null 2>&1; then
    echo "set"
  else
    echo "FAILED"
    FAILED_VARS+=("$name")
  fi
}

FAILED_VARS=()

set_one NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY      "$PUB"
set_one NEXT_PUBLIC_FLUTTERWAVE_DEMO_PUBLIC_KEY "$DEMO"
set_one FLUTTERWAVE_SECRET_KEY                  "$SEC"
set_one FLUTTERWAVE_WEBHOOK_SECRET_HASH         "$HASH"
set_one PENDING_REGISTRATION_SECRET             "$PEND"

# A partial cutover is the dangerous state here: production would run with some
# variables live and some missing, which fails closed but looks like a success
# if the script just returns 0. Refuse to call it done.
if [ ${#FAILED_VARS[@]} -gt 0 ]; then
  echo
  echo "!! ${#FAILED_VARS[@]} variable(s) did not reach Vercel:"
  for v in "${FAILED_VARS[@]}"; do echo "     - $v"; done
  echo "   Nothing below will work until these are set. Most often this means"
  echo "   the CLI is logged out — run 'npx vercel login' and try again."
  exit 1
fi

echo
echo "NEXT_PUBLIC_* values are inlined at BUILD time, so a rebuild is required:"
echo "  npx vercel --prod        (or push a no-op commit)"
echo "Then confirm with:"
echo "  node scripts/verify-live-keys.mjs   # expect: PRODUCTION IS ON LIVE KEYS"
echo "  node scripts/verify-billing-live.mjs"