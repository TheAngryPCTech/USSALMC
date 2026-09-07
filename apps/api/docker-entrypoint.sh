#!/usr/bin/env bash
# docker-entrypoint.sh — wait for the "db" service, apply migrations (idempotent:
# every migration uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), optionally
# seed, then exec the container CMD (npm start). Containerization only — it does
# not modify application behavior.
set -euo pipefail

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-ussa}"
DB_NAME="${DB_NAME:-ussa_lore}"
export PGPASSWORD="${DB_PASSWORD:-}"

echo "[entrypoint] waiting for postgres at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 60); do
  if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; then
    echo "[entrypoint] postgres is ready."
    break
  fi
  sleep 1
  if [ "$i" = "60" ]; then echo "[entrypoint] ERROR: postgres never became ready" >&2; exit 1; fi
done

echo "[entrypoint] applying migrations from /app/db/migrations ..."
for f in $(ls /app/db/migrations/*.sql | sort); do
  echo "  >> $(basename "$f")"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f"
done

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] SEED_ON_START=true -> running seed ..."
  npm run seed || echo "[entrypoint] seed failed (non-fatal)"
fi

echo "[entrypoint] starting: $*"
exec "$@"
