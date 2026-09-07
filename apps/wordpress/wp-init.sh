#!/bin/sh
# wp-init.sh — one-shot WordPress bootstrap run by the `wordpress-cli` service.
#
# Idempotent by design (Definition of Done #6: durable infra — never re-scaffold
# something already up). It waits for the WordPress files + database, then:
#   1. runs `wp core install` (site title + admin from env, NOT hardcoded)
#   2. installs + activates Elementor (free)
#   3. activates the bind-mounted USSALMC plugins + theme
#   4. points the wiki plugin at the running core API (base + key via options)
# Re-running it on an already-installed site is a no-op for install/plugins.
#
# Runs as root inside the throwaway cli container so it can write into the
# named WordPress volume; --allow-root is required for wp-cli as root.

set -eu

WP=/var/www/html
FLAGS="--allow-root --path=$WP"

echo "[wp-init] waiting for wp-config.php (WordPress container populates the volume)..."
i=0
until [ -f "$WP/wp-config.php" ]; do
	i=$((i + 1))
	if [ "$i" -gt 90 ]; then
		echo "[wp-init] ERROR: timed out waiting for wp-config.php" >&2
		exit 1
	fi
	sleep 2
done

echo "[wp-init] waiting for the database connection..."
i=0
until wp db check $FLAGS >/dev/null 2>&1; do
	i=$((i + 1))
	if [ "$i" -gt 120 ]; then
		echo "[wp-init] ERROR: timed out waiting for the database" >&2
		exit 1
	fi
	sleep 2
done

if wp core is-installed $FLAGS 2>/dev/null; then
	echo "[wp-init] WordPress already installed — leaving it as durable infra (skip core install)."
else
	echo "[wp-init] running initial WordPress install..."
	wp core install $FLAGS \
		--url="${WORDPRESS_SITE_URL}" \
		--title="${WORDPRESS_SITE_TITLE}" \
		--admin_user="${WORDPRESS_ADMIN_USER}" \
		--admin_password="${WORDPRESS_ADMIN_PASSWORD}" \
		--admin_email="${WORDPRESS_ADMIN_EMAIL}" \
		--skip-email
fi

# --- Elementor (free) --------------------------------------------------------
if wp plugin is-installed elementor $FLAGS 2>/dev/null; then
	echo "[wp-init] Elementor already installed — activating."
	wp plugin activate elementor $FLAGS
else
	echo "[wp-init] installing + activating Elementor (free)..."
	wp plugin install elementor --activate $FLAGS
fi

# --- USSALMC plugins + theme (bind-mounted from disk) ------------------------
if wp plugin is-installed ussalmc-wiki $FLAGS 2>/dev/null; then
	wp plugin activate ussalmc-wiki $FLAGS && echo "[wp-init] ussalmc-wiki activated."
else
	echo "[wp-init] NOTE: ussalmc-wiki not present (mount missing?)."
fi
if wp plugin is-installed ussalmc-portal $FLAGS 2>/dev/null; then
	wp plugin activate ussalmc-portal $FLAGS && echo "[wp-init] ussalmc-portal activated."
else
	echo "[wp-init] NOTE: ussalmc-portal not present yet (mount missing?)."
fi
if [ -f "$WP/wp-content/themes/ussalmc-theme/style.css" ]; then
	wp theme activate ussalmc-theme $FLAGS && echo "[wp-init] ussalmc-theme activated."
else
	echo "[wp-init] NOTE: ussalmc-theme not present yet (mount missing?)."
fi

# --- Point the wiki plugin at the running core API --------------------------
wp option update ussalmc_api_base "${USSALMC_API_BASE}" $FLAGS
wp option update ussalmc_api_key "${USSALMC_API_KEY}" $FLAGS
echo "[wp-init] wiki plugin configured against ${USSALMC_API_BASE}"

# --- SSO handoff config (wp-admin "USSA Admin" menu -> the admin tool) ------
if [ -n "${ADMIN_SSO_SECRET:-}" ]; then
	wp option update ussalmc_sso_secret "${ADMIN_SSO_SECRET}" $FLAGS
fi
if [ -n "${ADMIN_APP_PUBLIC_URL:-}" ]; then
	wp option update ussalmc_admin_url "${ADMIN_APP_PUBLIC_URL}" $FLAGS
fi
echo "[wp-init] SSO handoff configured against ${ADMIN_APP_PUBLIC_URL:-<unset>}"

# --- Sync the Elementor Global Kit with the USSALMC design tokens -----------
# (theme registers `wp ussalmc sync-kit`; makes plugin widgets inherit the palette)
if wp ussalmc sync-kit $FLAGS 2>/dev/null; then
	echo "[wp-init] Elementor Kit synced with USSALMC tokens."
else
	echo "[wp-init] NOTE: kit sync command unavailable (theme not active yet?)."
fi

# --- Ensure the Dashboard + Wiki pages exist (idempotent) ------------------
# Dashboard: front page built from the [ussalmc_dashboard] shortcode, using the
# theme's USSALMC Dashboard page template. Wiki: single /wiki/ surface.
DASH_ID=$(wp post list --post_type=page --name=dashboard --field=ID $FLAGS 2>/dev/null | head -n1)
if [ -z "$DASH_ID" ]; then
	DASH_ID=$(wp post create --post_type=page --post_status=publish \
		--post_title="Corporate Dashboard" --post_name="dashboard" \
		--post_content='[ussalmc_dashboard]' --porcelain $FLAGS)
	echo "[wp-init] created Dashboard page (ID $DASH_ID)."
else
	echo "[wp-init] Dashboard page already exists (ID $DASH_ID) — leaving it."
fi
# Apply the dashboard page template + set it as the static front page.
wp post meta update "$DASH_ID" _wp_page_template "template-dashboard.php" $FLAGS >/dev/null 2>&1 || true
wp option update show_on_front page $FLAGS
wp option update page_on_front "$DASH_ID" $FLAGS

WIKI_ID=$(wp post list --post_type=page --name=wiki --field=ID $FLAGS 2>/dev/null | head -n1)
if [ -z "$WIKI_ID" ]; then
	WIKI_ID=$(wp post create --post_type=page --post_status=publish \
		--post_title="Knowledge Base" --post_name="wiki" \
		--post_content='[ussalmc_wiki]' --porcelain $FLAGS)
	echo "[wp-init] created Wiki page (ID $WIKI_ID)."
else
	echo "[wp-init] Wiki page already exists (ID $WIKI_ID) — leaving it."
fi
wp rewrite structure '/%postname%/' $FLAGS >/dev/null 2>&1 || true
wp rewrite flush $FLAGS >/dev/null 2>&1 || true

# --- Make runtime dirs writable by apache (www-data uid 33) -----------------
mkdir -p "$WP/wp-content/uploads"
chown -R 33:33 "$WP/wp-content/uploads" "$WP/wp-content/plugins/elementor" 2>/dev/null || true

echo "[wp-init] done. Plugin/theme status:"
wp plugin list $FLAGS
wp theme list $FLAGS
