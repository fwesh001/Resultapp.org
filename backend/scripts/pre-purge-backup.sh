#!/usr/bin/env bash
# Pre-purge safety backup. Dumps the whole registry DB to a timestamped file.
# Cheap insurance before an irreversible hard purge of tenant rows.
set -euo pipefail

ENV_FILE=/var/www/resultapp-backend/.env
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/var/backups/resultapp-prepurge-${STAMP}.sql
mkdir -p /var/backups

set -a
# shellcheck disable=SC1091
. "$ENV_FILE"
set +a

PGPASSWORD="${PG_SUPERUSER_PASSWORD:?PG_SUPERUSER_PASSWORD not set}" \
  pg_dump -h "${PG_HOST:-localhost}" -p "${PG_PORT:-5432}" \
  -U "${PG_SUPERUSER_USER:-postgres}" -d "${PG_SUPERUSER_DB:-postgres}" \
  --clean --if-exists > "$OUT"

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"