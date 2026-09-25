#!/usr/bin/env bash
# restore.sh — restore a scripts/backup.sh archive. DESTRUCTIVE: overwrites
# the current Postgres/MariaDB databases and the ussalmc_media/wordpress_data
# volumes on this machine. Requires --yes to actually run (dry-run otherwise).
#
# Usage: scripts/restore.sh <backup-dir> [--yes]
#   scripts/restore.sh backups/ussalmc-backup-20260101T000000Z --yes

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${1:?Usage: scripts/restore.sh <backup-dir> [--yes]}"
CONFIRM="${2:-}"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: $BACKUP_DIR is not a directory." >&2
  exit 1
fi
for f in postgres_ussa_lore.sql mariadb_wordpress.sql volume_ussalmc_media.tar.gz volume_wordpress_data.tar.gz; do
  if [ ! -f "$BACKUP_DIR/$f" ]; then
    echo "ERROR: $BACKUP_DIR/$f missing — not a complete backup.sh archive." >&2
    exit 1
  fi
done

echo "This will PERMANENTLY OVERWRITE, on this machine:"
echo "  - the ussalmc_lore Postgres database"
echo "  - the wordpress MariaDB database"
echo "  - the ussalmc_media Docker volume (self-hosted images)"
echo "  - the wordpress_data Docker volume (WP core + uploads)"
echo "with the contents of: $BACKUP_DIR"
echo

if [ "$CONFIRM" != "--yes" ]; then
  echo "Dry run only (pass --yes to actually restore). Nothing was changed."
  exit 0
fi

if [ -f "$BACKUP_DIR/.env" ] && [ ! -f .env ]; then
  echo "==> no .env in this checkout — copying the one from the backup"
  cp "$BACKUP_DIR/.env" .env
fi
# Deliberately NOT `source .env` — see the matching comment in backup.sh.
env_var() { grep "^$1=" .env | head -1 | cut -d= -f2-; }
DB_USER="$(env_var DB_USER)"; DB_NAME="$(env_var DB_NAME)"
WORDPRESS_DB_USER="$(env_var WORDPRESS_DB_USER)"
WORDPRESS_DB_PASSWORD="$(env_var WORDPRESS_DB_PASSWORD)"
WORDPRESS_DB_NAME="$(env_var WORDPRESS_DB_NAME)"

echo "==> bringing up db + wordpress-db"
docker compose up -d db wordpress-db
echo "==> waiting for both to report healthy..."
until [ "$(docker inspect --format='{{.State.Health.Status}}' ussalmc-db 2>/dev/null)" = "healthy" ] && \
      [ "$(docker inspect --format='{{.State.Health.Status}}' ussalmc-wordpress-db 2>/dev/null)" = "healthy" ]; do
  sleep 2
done

echo "==> restoring Postgres (ussalmc_lore)"
docker compose exec -T db psql -U "${DB_USER:-ussa}" -d "${DB_NAME:-ussa_lore}" < "$BACKUP_DIR/postgres_ussa_lore.sql"

echo "==> restoring MariaDB (wordpress)"
docker compose exec -T wordpress-db mariadb \
  -u"${WORDPRESS_DB_USER:-wordpress}" -p"${WORDPRESS_DB_PASSWORD:?WORDPRESS_DB_PASSWORD not set in .env}" \
  "${WORDPRESS_DB_NAME:-wordpress}" < "$BACKUP_DIR/mariadb_wordpress.sql"

echo "==> stopping stack before touching volumes (avoid restoring into live-written data)"
docker compose down

for vol in ussalmc_media wordpress_data; do
  full_vol="$(basename "$ROOT")_${vol}"
  echo "==> restoring volume $full_vol"
  docker volume create "$full_vol" >/dev/null
  docker run --rm \
    -v "${full_vol}:/data" \
    -v "$BACKUP_DIR:/backup:ro" \
    alpine sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /backup/volume_${vol}.tar.gz -C /data"
done

echo "==> bringing the full stack back up"
docker compose up -d

echo "==> done. Verify: curl http://localhost:8090/health"
