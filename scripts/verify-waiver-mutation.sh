#!/bin/bash
# Exercises the waiver-token reservation CAS against a live database.
#
# WHY THIS IS A SEPARATE SCRIPT
# -----------------------------
# scripts/verify-pending-hold.sh proves the registration hold's claim is
# exclusive. This proves the waiver token's is. They guard the same class of
# bug in two different places, and a token double-spend is more expensive: a
# duplicated hold costs a 409 on a subdomain, while a duplicated token hands a
# school free slots it never paid for and cannot be un-granted afterwards.
#
# The engine is scripts/waiver-mutation-probe.py, which opens real connections
# and races real threads. That split is deliberate: a shell script can curl an
# endpoint twice, but only a threaded driver can prove that two SIMULTANEOUS
# requests resolve to one winner. The property being tested is a claim about
# PostgreSQL row locking, so the test has to actually race Postgres.
#
# Everything here runs against a real schema and creates only rows it then
# deletes (waiver_tokens with prefix RW-probe%, schools named probe-*).
#
# Usage on the droplet:
#   sudo -u root bash /var/www/resultapp-backend/scripts/verify-waiver-mutation.sh
# Usage anywhere with PG_* exported (see below).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BACKEND="${RESULTAPP_BACKEND_DIR:-$ROOT/backend}"

# --- resolve python -------------------------------------------------------
# Three traps here, all of which have bitten this script before:
#
#  1. `command -v python3` SUCCEEDS on Windows even when there is no Python —
#     the Microsoft Store ships a `python3.exe` app-execution alias.
#  2. That stub does not fail fast. Invoking it can launch the Microsoft Store
#     and block forever, so even "is it a working interpreter?" is unsafe to ask
#     it directly.
#  3. A Windows Python installs `python.exe`, not `python3.exe`, so preferring
#     python3 picks the stub even when a perfectly good python is on PATH.
#
# So: prefer `python`, skip anything under WindowsApps, and only then ask
# whether the resolved binary actually runs.
PY=""
PY_PATH=""
for c in python python3; do
  cand="$(command -v "$c" 2>/dev/null)" || continue
  case "$cand" in
    *WindowsApps*) continue ;;
  esac
  if "$cand" -c 'import sys' >/dev/null 2>&1; then
    PY="$c"
    PY_PATH="$cand"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "FATAL: no working Python interpreter on PATH."
  echo "       (A Microsoft Store python3 alias is not a working interpreter.)"
  echo "       Install python3, or set PATH to a real Python installation."
  exit 127
fi
echo "  python  : $PY_PATH"

# --- resolve DB config ----------------------------------------------------
# On the droplet the credentials live in the backend .env. Locally they come
# from the environment. Defaults match db_manager._pg_config().
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PG_SUPERUSER_PASSWORD="${PG_SUPERUSER_PASSWORD:-}"
PG_SUPERUSER_DB="${PG_SUPERUSER_DB:-postgres}"

for ENVFILE in "$BACKEND/.env" "/var/www/resultapp-backend/.env"; do
  [ -r "$ENVFILE" ] || continue
  while IFS='=' read -r k v; do
    case "$k" in
      PG_HOST|PG_PORT|PG_SUPERUSER|PG_SUPERUSER_PASSWORD|PG_SUPERUSER_DB)
        # printf -v rather than eval: assigning to a variable named by $k is
        # what this is for, and eval-ing quote-stripped input is how a .env
        # with a stray backtick becomes a command execution.
        v="${v%$'\r'}"
        v="${v#\"}"; v="${v%\"}"
        printf -v "$k" '%s' "$v"
        ;;
    esac
  done < "$ENVFILE"
done
export PG_HOST PG_PORT PG_SUPERUSER PG_SUPERUSER_PASSWORD PG_SUPERUSER_DB

echo "=========================================="
echo "  Waiver token exclusivity probe"
echo "=========================================="
echo "  backend : $BACKEND"
echo "  database: $PG_SUPERUSER@$PG_HOST:$PG_PORT/$PG_SUPERUSER_DB"
echo

# --- 0. schema is present, before anything else ---------------------------
echo "=== 0. schema present ==="
SCHEMA_Q="SELECT to_regclass('public.waiver_tokens');"
if command -v psql >/dev/null 2>&1; then
  # psql gets PG*, not PG_HOST/PG_SUPERUSER*. Export the password under the name
  # it actually reads, and pass -w so it FAILS rather than prompting.
  #
  # Without -w, a host that wants a password makes psql prompt on stdin and
  # block forever. A verification script that can hang is worse than one that
  # fails: it looks like a slow suite, and whoever runs it waits on nothing.
  # The </dev/null is belt and braces for the same reason.
  export PGPASSWORD="$PG_SUPERUSER_PASSWORD"
  PSQL=(psql -w -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPERUSER" -d "$PG_SUPERUSER_DB" -tA)

  T=$("${PSQL[@]}" -c "$SCHEMA_Q" </dev/null 2>/dev/null)
  if [ "$T" = "waiver_tokens" ]; then
    echo "  PASS  waiver_tokens table exists"
  else
    echo "  FAIL  waiver_tokens missing at $PG_SUPERUSER@$PG_HOST:$PG_PORT/$PG_SUPERUSER_DB (got '${T:-<no output>}')"
    echo "        Is the DDL deployed, and are those credentials right?"
    exit 1
  fi
  H=$("${PSQL[@]}" -c \
      "SELECT count(*) FROM information_schema.columns WHERE table_name='pending_registrations'
         AND column_name IN ('waiver_token_id','charge_required','charge_ngn','charged_slots');" \
      </dev/null 2>/dev/null)
  if [ "${H:-0}" = "4" ]; then
    echo "  PASS  pending_registrations carries the waiver binding"
  else
    echo "  FAIL  pending_registrations waiver columns incomplete (${H:-0}/4)"
    exit 1
  fi
else
  echo "  SKIP  psql not on PATH — the probe re-checks the schema itself"
  echo "        (expected on a dev box; on the droplet psql is always present)"
fi
echo

# --- 1..n. the actual proof ------------------------------------------------
FAILED=0

echo "--- exclusivity (one token, one redemption) ---"
PYTHON_BIN="$PY_PATH" "$PY_PATH" "$HERE/waiver-mutation-probe.py"
if [ $? -ne 0 ]; then FAILED=1; fi
echo

echo "--- atomicity (burn and slot grant are one unit) ---"
# Driven by the routers that can actually spend a token, with a real
# PostgreSQL trigger failing the slot UPDATE mid-transaction.
API_SECRET_KEY="${API_SECRET_KEY:-probe-only}" PYTHON_BIN="$PY_PATH" \
  "$PY_PATH" "$HERE/waiver-rollback-probe.py"
if [ $? -ne 0 ]; then FAILED=1; fi
echo

if [ $FAILED -ne 0 ]; then
  echo "  DO NOT SHIP. A waiver token is not safe to hand to a school."
  exit 1
fi

echo "  Reminder: this proves the BACKEND. It does not yet prove that the"
echo "  Next.js proxies pass a caller-supplied tenant_id or tx_ref through"
echo "  safely, nor that the 100% bypass skips Flutterwave in the browser."
echo "  verify-waiver-bypass.sh and verify-waiver-split.sh cover those once"
echo "  the client routes exist."
exit 0