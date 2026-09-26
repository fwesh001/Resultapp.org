#!/usr/bin/env bash
#
# ResultApp backend deploy script — pull, verify, restart, PROVE it.
#
# Run from the repo checkout root on the droplet:
#     bash ./update.sh
# (First time only, make it executable:  chmod +x ./update.sh)
#
# What it does:
#   1. Shows working-tree status (dirty tree aborts the pull loudly).
#   2. git pull --stat  (full +++/--- per-file visuals, as requested).
#   3. Installs Python deps (skip with SKIP_DEPS=1).
#   4. Pre-flight: byte-compiles the backend BEFORE touching the live server,
#      so a syntax error can never take down a healthy process.
#   5. Frees :8000 (stray holders), supervised restart of $DEPLOY_UNIT.
#   6. Waits for /api/version and asserts the serving commit equals the
#      freshly pulled HEAD. Any mismatch = loud failure (exit 1), never a
#      fake success banner.
#
# Env overrides: DEPLOY_UNIT (default resultapp-provision),
#                DEPLOY_PORT (default 8000),
#                SKIP_DEPS=1, VENV_DIR (default ./venv).
#
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

UNIT="${DEPLOY_UNIT:-resultapp-provision}"
PORT="${DEPLOY_PORT:-8000}"
VENV_DIR="${VENV_DIR:-./venv}"
VERSION_URL="http://127.0.0.1:${PORT}/api/version"

if [ -t 1 ]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'
  YELLOW=$'\e[33m'; CYAN=$'\e[36m'; RESET=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""
fi

step()  { printf '\n%s==> %s%s\n' "$CYAN" "$1" "$RESET"; }
ok()    { printf '%s✔ %s%s\n' "$GREEN" "$1" "$RESET"; }
warn()  { printf '%s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
die()   { printf '%s✖ FATAL: %s%s\n' "$RED" "$1" "$RESET"; exit 1; }

# ---------------------------------------------------------------- 1. tree
step "1/7 Working tree"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "not inside a git checkout ($APP_DIR)"
fi
DIRTY="$(git status --short)"
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY"
  die "working tree is dirty — commit or stash droplet-local changes first (pull would fail halfway)"
fi
ok "tree clean"

# ---------------------------------------------------------------- 2. pull
step "2/7 Pulling latest code (with per-file diffstat)"
BEFORE_SHA="$(git rev-parse --short HEAD)"
git pull --stat || die "git pull failed — remote unreachable or merge conflict"
AFTER_SHA="$(git rev-parse --short HEAD)"
printf '%sbefore:%s %s  %safter:%s %s\n' "$DIM" "$RESET" "$BEFORE_SHA" "$DIM" "$RESET" "$AFTER_SHA"
step "Recent history"
git log --oneline -5
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  warn "already at latest ($AFTER_SHA) — will still verify the live server below"
fi

# ---------------------------------------------------------------- 3. deps
step "3/7 Python dependencies"
if [ "${SKIP_DEPS:-0}" = "1" ]; then
  warn "SKIP_DEPS=1 — skipping pip install"
elif [ ! -x "$VENV_DIR/bin/pip" ]; then
  die "no pip at $VENV_DIR/bin/pip (set VENV_DIR or create the venv)"
else
  "$VENV_DIR/bin/pip" install -r backend/requirements.txt \
    || die "pip install failed"
  ok "dependencies satisfied"
fi

# ---------------------------------------------------------------- 4. pre-flight
step "4/7 Pre-flight: byte-compile backend BEFORE touching live traffic"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  die "no python at $VENV_DIR/bin/python"
fi
"$VENV_DIR/bin/python" -m compileall -q backend \
  || die "pre-flight compile failed — live server left untouched, fix the syntax error first"
ok "backend compiles"

# ---------------------------------------------------------------- 5. restart
step "5/7 Restarting $UNIT (kill-before-start, no EADDRINUSE roulette)"
pkill -f 'uvicorn main:app' 2>/dev/null || true
sleep 2
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  die "port ${PORT} still held after pkill — find the holder:  ss -ltnp | grep ${PORT}"
fi
systemctl reset-failed "$UNIT" 2>/dev/null || true
systemctl start "$UNIT" || die "systemctl start $UNIT failed"
sleep 3
if ! systemctl is-active --quiet "$UNIT"; then
  echo "--- journal tail ($UNIT) ---"
  journalctl -u "$UNIT" --no-pager 2>/dev/null | tail -25
  die "unit is not active after start (log above)"
fi
ok "unit $UNIT is active"

# ---------------------------------------------------------------- 6. prove it
step "6/7 Proving the new code serves (commit match)"
READY=""
for _ in $(seq 1 30); do
  if curl -sf --max-time 5 "$VERSION_URL" 2>/dev/null | grep -q '"status":"ok"'; then
    READY="yes"
    break
  fi
  sleep 2
done
[ -n "$READY" ] || die "/api/version never became healthy — check: journalctl -u $UNIT --no-pager | tail -30"
SERVING_SHA="$(curl -s --max-time 10 "$VERSION_URL" 2>/dev/null | grep -o '"commit":"[^"]*"' | cut -d'"' -f4)"
printf 'serving commit: %s%s%s   checkout HEAD: %s%s%s\n' "$BOLD" "${SERVING_SHA:-?}" "$RESET" "$BOLD" "$AFTER_SHA" "$RESET"
if [ -z "$SERVING_SHA" ] || [ "$SERVING_SHA" = "unknown" ]; then
  die "/api/version did not report a commit — server may predate the version endpoint; investigate before trusting this deploy"
fi
if [ "$SERVING_SHA" != "$AFTER_SHA" ]; then
  die "STALE CODE SERVING (serving $SERVING_SHA, checkout $AFTER_SHA) — a stray process owns :$PORT; find it: ss -ltnp | grep $PORT"
fi

# ---------------------------------------------------------------- 7. done
step "7/7 Deploy verified"
ok "live backend serves $SERVING_SHA — deploy complete"
