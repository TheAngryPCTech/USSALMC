#!/usr/bin/env bash
# pg.sh — manage the rootless PostgreSQL (micromamba env `ussa`) for local dev.
# Usage: scripts/pg.sh {start|stop|status|psql|migrate}
set -euo pipefail

export MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:-$HOME/.micromamba}"
MM="$HOME/.local/bin/micromamba run -n ussa"
export PGDATA="${PGDATA:-$HOME/.ussa-pgdata}"
PGPORT="${DB_PORT:-5433}"
PGHOST="${DB_HOST:-/tmp}"
PGUSER="${DB_USER:-ussa}"
PGDB="${DB_NAME:-ussa_lore}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${1:-status}" in
  start)
    $MM pg_ctl -D "$PGDATA" -o "-p $PGPORT -k $PGHOST" -l "$HOME/.ussa-pgdata.log" start
    sleep 2
    $MM pg_isready -p "$PGPORT" -h "$PGHOST"
    ;;
  stop)
    $MM pg_ctl -D "$PGDATA" stop
    ;;
  status)
    $MM pg_isready -p "$PGPORT" -h "$PGHOST"
    ;;
  psql)
    shift
    $MM psql -p "$PGPORT" -h "$PGHOST" -U "$PGUSER" -d "$PGDB" "$@"
    ;;
  migrate)
    for f in "$ROOT"/db/migrations/*.sql; do
      echo ">> applying $(basename "$f")"
      $MM psql -p "$PGPORT" -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -f "$f"
    done
    ;;
  *)
    echo "usage: $0 {start|stop|status|psql|migrate}"; exit 1;;
esac
