#!/usr/bin/env bash
# Demo sweep — hard-deletes ephemeral demo tenants older than the TTL.
#
# Runs under systemd (demo-sweep.service + demo-sweep.timer, every 15 min).
# Calls the secret-gated FastAPI endpoint over loopback only; the API secret
# is sourced from the backend .env and never leaves this host.
set -u

set -a
# shellcheck disable=SC1091
. /var/www/resultapp-backend/.env
set +a

exec /usr/bin/curl -sS -m 120 -X POST http://127.0.0.1:8000/api/v1/demo/sweep \
  -H "Content-Type: application/json" \
  -H "X-API-SECRET-KEY: ${API_SECRET_KEY:?API_SECRET_KEY not set}" \
  -d '{"max_age_seconds":3600,"limit":50}'
