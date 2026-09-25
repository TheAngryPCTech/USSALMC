#!/usr/bin/env bash
# backup.sh — self-contained, portable backup of the whole stack: both
# Postgres (app KB) and MariaDB (WordPress) databases via native dump tools
# (not raw volume copies — survives a Postgres/MariaDB version change on
# restore, unlike a bit-for-bit data-dir copy), plus the two data volumes
# that aren't reproducible from git (self-hosted media, WordPress
# core/uploads — plugin/theme code is already in the repo, not duplicated
# here), plus .env and docker-compose.yml so the archive is deployable on a
# fresh machine with nothing but Docker and this repo checked out.
#
# Deliberately different from the whole-disk-image strategy documented in
# docs/deployment.md (host-level, in-house-datacenter-specific) — this is
# an application-level backup you can move anywhere Docker runs.
#
# Usage: scripts/backup.sh [output-dir]   (default: ./backups)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_BASE="${1:-$ROOT/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_BASE/ussalmc-backup-$STAMP"
mkdir -p "$OUT"

echo "==> backing up into $OUT"

# --- env vars needed for the dumps (WordPress DB creds only live in .env) ---
# Deliberately NOT `source .env` — some real values (e.g. SCRAPER_USER_AGENT's
# "USSASLMC-Bot/0.1 (+respect-robots)") contain characters (unquoted parens)
# that are valid in a dotenv file but a bash syntax error when sourced.
if [ ! -f .env ]; then
  echo "ERROR: .env not found at repo root — cannot read WordPress DB credentials." >&2
  exit 1
fi
env_var() { grep "^$1=" .env | head -1 | cut -d= -f2-; }
DB_USER="$(env_var DB_USER)"; DB_NAME="$(env_var DB_NAME)"
WORDPRESS_DB_USER="$(env_var WORDPRESS_DB_USER)"
WORDPRESS_DB_PASSWORD="$(env_var WORDPRESS_DB_PASSWORD)"
WORDPRESS_DB_NAME="$(env_var WORDPRESS_DB_NAME)"

# --- 1. Core app Postgres (entities, embeddings, api_keys, admin_users, ...) ---
echo "==> dumping Postgres (ussalmc_lore)"
docker compose exec -T db pg_dump -U "${DB_USER:-ussa}" -d "${DB_NAME:-ussa_lore}" \
  --no-owner --no-acl --format=plain --clean --if-exists > "$OUT/postgres_ussa_lore.sql"

# --- 2. WordPress MariaDB ---
echo "==> dumping MariaDB (wordpress)"
docker compose exec -T wordpress-db mariadb-dump --add-drop-table \
  -u"${WORDPRESS_DB_USER:-wordpress}" -p"${WORDPRESS_DB_PASSWORD:?WORDPRESS_DB_PASSWORD not set in .env}" \
  "${WORDPRESS_DB_NAME:-wordpress}" > "$OUT/mariadb_wordpress.sql"

# --- 3. Data volumes not reproducible from git ---
# (plugin/theme code is bind-mounted from apps/wordpress-* in the repo, so
# wordpress_data here is just WP core + uploads, not our own source.)
for vol in ussalmc_media wordpress_data; do
  full_vol="$(basename "$ROOT")_${vol}"
  echo "==> archiving volume $full_vol"
  docker run --rm \
    -v "${full_vol}:/data:ro" \
    -v "$OUT:/backup" \
    alpine sh -c "tar czf /backup/volume_${vol}.tar.gz -C /data ."
done

# --- 4. Config needed to redeploy ---
cp .env "$OUT/.env"
cp docker-compose.yml "$OUT/docker-compose.yml"
chmod 600 "$OUT/.env"   # contains real secrets (API keys, DB passwords)

# --- 5. Manifest ---
cat > "$OUT/MANIFEST.md" <<EOF
# USSALMC backup — $STAMP

Created by scripts/backup.sh. Contains:

- \`postgres_ussa_lore.sql\` — full plain-SQL dump of the core app database
  (entities, embeddings, api_keys, admin_users, review_queue, ...).
- \`mariadb_wordpress.sql\` — full SQL dump of the WordPress database.
- \`volume_ussalmc_media.tar.gz\` — every self-hosted entity image.
- \`volume_wordpress_data.tar.gz\` — WordPress core files + uploads
  (plugin/theme code itself lives in this git repo, not duplicated here).
- \`.env\` — **contains real secrets** (API keys, DB passwords). chmod 600.
- \`docker-compose.yml\` — snapshot of the compose file at backup time.

## Restore

From a fresh checkout of this repo on the target machine:

    scripts/restore.sh $OUT

See that script for exactly what it does before running it against a
machine with existing data — it recreates the named volumes and databases.
EOF

echo "==> done: $OUT"
du -sh "$OUT"
