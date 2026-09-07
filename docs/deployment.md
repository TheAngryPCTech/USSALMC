# Deployment — USSA Lore Master Core

**STATUS: LIVE in production as of 2026-09-06.** This doc reflects the actual
running deployment, not a plan. Read it first when resuming work.

## PAUSED 2026-09-06 — physical relocation (spin-down + rack install)
Server is being powered down and physically moved into a rack. All work as of
this point is committed to git (`main`, this commit). Docker volumes
(`ussalmc_pgdata`, `wordpress_data`, `wordpress_db_data`) are named volumes —
they persist on the host's local disk across a normal shutdown; a *clean*
shutdown (`sudo shutdown -h now`, not pulling power mid-write) is what makes
that safe for Postgres/MariaDB specifically.

**On power-up in the rack, check in this order:**
1. `sg docker -c "docker compose ps"` — Docker daemon is `systemctl enabled`
   and every long-running service has `restart: unless-stopped`, so all 6
   containers should come back on their own. If any didn't (only containers
   that were manually `stop`ped before shutdown stay down): `docker compose up -d`.
2. **LAN IP** — this doc's "Host / environment facts" says LAN IP
   192.168.1.29; a new rack location will very likely assign a different one.
   Find the new IP (`ip addr` / `hostname -I`) and update:
   - The router/switch port-forward rule (WAN 80/443 -> new LAN IP) — see
     "Router / firewall" below.
3. **Public/WAN IP** — DNS (ussa.space, www, api, trader, admin — all A
   records) currently points to `192.24.65.11`. If the new rack has a
   different public IP (new ISP/uplink at the datacenter), **every A record
   needs updating** or nothing public resolves. Check with `curl -s ifconfig.me`
   from the new location and compare against `dig +short ussa.space`.
4. Once DNS/routing is confirmed pointing at the right IP again, re-run the
   "Verify (live)" checks below (health endpoint, wiki page, trader form) —
   don't assume it's fine just because containers are running.
5. Nothing in the application config (`.env`, docker-compose) hardcodes an IP
   address — everything routes by hostname (nginx `server_name` + the
   `ussa.space`-family DNS), so a LAN/WAN IP change needs a DNS/router update
   only, not an app or container config change.

## Live URLs (public, HTTPS)
- **https://API.USSA.SPACE**    -> core REST API              (container `ussalmc-api`)
- **https://Trader.USSA.SPACE** -> trade-route submission form + bot command (container `ussalmc-trade-submit`)
- **https://ussa.space** (+ **https://www.ussa.space**) -> WordPress site / knowledge base (container `ussalmc-wordpress`)
- **https://admin.ussa.space** -> admin scraper/review tool (container `ussalmc-admin`) — login-gated (DB-backed
  session auth), public but not discoverable/linked anywhere public. Added in
  Phase 7 specifically so the wp-admin "USSA Admin" SSO iframe works: Chrome's
  Private Network Access policy blocks a public HTTPS page from embedding a
  private-network (`localhost`) target, so the admin tool needed its own public
  HTTPS domain (see "SSO" below). The old SSH-tunnel-only path (`http://localhost:8091`)
  still works for direct access but is superseded as the primary path.
- HTTP on all 301-redirects to HTTPS. Three Let's Encrypt certs (api.ussa.space
  covering api+trader; ussa.space covering ussa.space+www; admin.ussa.space its
  own cert), all auto-renew via `certbot.timer`.

## Not public (but reachable if you know the URL — all login-gated)
- **wp-admin** — the WordPress admin (`https://ussa.space/wp-admin`) is reachable
  over the public site but is login-gated; the public front site + `/wiki/` are
  the intended public surface. Default admin login is in `.env`
  (`WORDPRESS_ADMIN_USER` / `WORDPRESS_ADMIN_PASSWORD`); the bootstrap build used
  **ussa_admin** with a generated strong password. Elementor (free) + the USSALMC
  wiki/portal plugins + theme are auto-activated at startup by the one-shot
  `wordpress-cli` service (see below). The wiki plugin is configured against the
  core API in-network (`http://api:3000`, key = `WIKI_API_KEY`).
- **wordpress-db** (MariaDB 11) — container `ussalmc-wordpress-db`, NO host port,
  reachable only inside the compose network. Separate from the app Postgres.
- **admin** (scraper/review + entity categorize/cross-link/delete/corrections UI)
  — container `ussalmc-admin`, published to `127.0.0.1:8091`, fronted publicly
  by nginx at `https://admin.ussa.space` (see above). Also still reachable via
  SSH tunnel: `ssh -L 8091:127.0.0.1:8091 angrypctech@192.168.1.29` then browse
  `http://localhost:8091` — but note `COOKIE_SECURE=true` now (see below), so a
  session created via the plain-HTTP tunnel path will NOT have its cookie
  persisted by the browser; use the HTTPS domain for real browser sessions.
  The admin's live wiki preview calls the core API in-network via
  `ADMIN_API_BASE=http://api:3000` (set in docker-compose.yml) using
  `WIKI_API_KEY` server-side; rebuild/recreate the admin container after
  pulling this change (`sudo docker compose build admin && sudo docker compose create admin && sudo docker compose start admin`).
- **db** (Postgres 16 + pgvector) — container `ussalmc-db`, NO host port at all,
  reachable only inside the compose network.

## SSO — wp-admin "USSA Admin" menu -> admin tool (Phase 7)
Logged-in wp-admin users with `manage_options` see a "USSA Admin" menu item
that embeds the admin tool via iframe (WordPress menu / admin nav+queue /
editor+preview = the three-column layout). The iframe src carries a 120s
HMAC-signed token (`{email, exp}`, secret `ADMIN_SSO_SECRET` — set the same
value in `.env` and it's synced into WP option `ussalmc_sso_secret` by
`wp-init.sh`). The admin app's `GET /sso` verifies it and matches the email
against `admin_users.email`: match -> signs in with no separate prompt;
no match -> a themed "no matching account" page (still uses the real design
tokens, since it's rendered inline by the admin server, not by React).
Requires `ADMIN_APP_PUBLIC_URL=https://admin.ussa.space` (browser-reachable,
public, and same registrable domain as the WordPress site — that's what
satisfies Chrome's Private Network Access check).

## Host / environment facts
- Host LAN IP: **192.168.1.29**  (public/WAN routing points the domains here)
- OS: Ubuntu 26.04; Docker 29.x, Docker Compose v5.x
- Docker access: the shell user `angrypctech` is in the `docker` group, BUT a
  session must be started AFTER that change to use `docker` without sudo. In the
  build session `sudo docker …` was used (terminal injects sudo pw). Prefer
  plain `docker` in a fresh login; fall back to `sudo docker` otherwise.
- nginx 1.28 (system package, NOT aaPanel — aaPanel is not installed), certbot 4.
- ufw is inactive (no host firewall rules).

## Container port map (all published to 127.0.0.1 — nginx is the only front door)
| container            | host bind        | container port | exposure |
|----------------------|------------------|----------------|----------|
| ussalmc-api          | 127.0.0.1:8090   | 3000           | public via API.USSA.SPACE |
| ussalmc-trade-submit | 127.0.0.1:8092   | 5000           | public via Trader.USSA.SPACE |
| ussalmc-admin        | 127.0.0.1:8091   | 4000           | public via ADMIN.USSA.SPACE (login-gated) + SSH tunnel |
| ussalmc-wordpress    | 127.0.0.1:8093   | 80             | public via ussa.space + www.ussa.space |
| ussalmc-wordpress-db | (none)           | 3306           | internal network only (MariaDB) |
| ussalmc-db           | (none)           | 5432           | internal network only |

## Router / firewall
Router is a **UniFi Dream Machine (UDM)**. Forward ONLY WAN **tcp/80** and
**tcp/443** -> 192.168.1.29. Do NOT forward 8090/8091/8092/8093 (container
loopback ports) — nginx is the only front door, routing by hostname to the
right container (including admin.ussa.space -> 8091 as of Phase 7). The
container ports themselves are still never exposed to the internet directly.

UDM port-forward and DNS settings are stored on the controller itself (not
ephemeral/session state), so both **persist across router reboots and
firmware updates** without needing to be re-entered — confirmed 2026-09-06.
The UDM is also the LAN's DNS resolver (handles/forwards DNS requests for
devices on the network); the public `ussa.space`-family A records are still
managed at the domain registrar/DNS host, not on the UDM.

## nginx
- Vhosts live at `/etc/nginx/sites-enabled/{api,trader}.ussa.space.conf` and
  `/etc/nginx/sites-enabled/ussa.space.conf` (TLS blocks are managed in-place by
  certbot). Stock `default` site was removed.
- Public sites: **api.ussa.space** -> 8090, **trader.ussa.space** -> 8092,
  **ussa.space + www.ussa.space** -> 8093 (WordPress).
- ACME webroot: `/var/www/certbot`.
- Repo keeps HTTP-only reference copies at `docs/nginx/*.http.conf` and the full
  manual-TLS templates at `docs/nginx/*.ussa.space.conf`.
- Certs (two, both auto-renew via certbot.timer, expire 2026-12-05):
  - `api.ussa.space` covers api.ussa.space + trader.ussa.space.
  - `ussa.space` covers ussa.space + www.ussa.space.
- Reissue/adjust:  `sudo certbot --nginx -d api.ussa.space -d trader.ussa.space`
  and  `sudo certbot --nginx --cert-name ussa.space -d ussa.space -d www.ussa.space`

## Compose services (docker-compose.yml)
- All app containers: `restart: unless-stopped` (survive reboot). db too.
- Networking is injected by compose (config-driven, no code change): api/admin
  use `DB_HOST=db DB_PORT=5432`; api/admin/trade-submit bind `0.0.0.0` inside the
  container; `TRUST_PROXY=true` so real client IPs come from nginx X-Forwarded-For.
- trade-submit reaches the API in-network at `http://api:3000` (not localhost).

## WordPress plugin/theme test instance (Docker Compose)
A real, running WordPress used to develop/test the USSALMC plugins + theme. It is
part of this same compose stack and network (`ussalmc`), private (127.0.0.1:8093).
- **Services:** `wordpress` (image `wordpress:php8.3-apache`), `wordpress-db`
  (image `mariadb:11`, internal-only), and `wordpress-cli` (image
  `wordpress:cli-php8.3`) — a one-shot bootstrap that runs `apps/wordpress/wp-init.sh`
  then exits (`restart: "no"`).
- **Named volumes:** `wordpress_data` (WP core + uploads) and `wordpress_db_data`
  (MariaDB) — nothing is lost on container restart.
- **Live-mounted code (edits on disk reflected without a rebuild):**
  - `apps/wordpress-plugin`        -> `wp-content/plugins/ussalmc-wiki`
  - `apps/wordpress-portal-plugin` -> `wp-content/plugins/ussalmc-portal`
  - `apps/wordpress-theme`         -> `wp-content/themes/ussalmc-theme`
- **Bootstrap (`wordpress-cli`, idempotent):** waits for wp-config + DB, runs
  `wp core install` (site title + admin from env, NOT hardcoded), installs +
  activates **Elementor (free)**, activates the USSALMC plugins + theme, sets
  `ussalmc_api_base` / `ussalmc_api_key` options so the wiki plugin reads the core
  API at `http://api:3000` with `WIKI_API_KEY`, **syncs the Elementor Global Kit
  with the USSALMC design tokens** (`wp ussalmc sync-kit`), and creates the
  **Dashboard** (front page, `[ussalmc_dashboard]`, `template-dashboard.php`) and
  **Knowledge Base** (`/wiki/`, `[ussalmc_wiki]`) pages. It SKIPS install and
  leaves existing pages in place if WordPress is already up (Definition-of-Done
  #6: durable infra, never re-scaffold).
- **Theme + plugins (all bind-mounted, edits live without rebuild):**
  - `ussalmc-theme` 0.2.0 — HUD/corporate-portal identity. Design tokens in
    `style.css` mirrored into the Elementor Global Kit; wiki template overrides in
    `ussalmc-wiki/`; brand assets in `assets/`; visual source of truth kept at
    `reference/corp-portal.html`.
  - `ussalmc-portal` 0.2.0 — three real Elementor widgets (Market, Stat Readout,
    Module Grid) reading the core API, palette inherited from the Kit.
  - `ussalmc-wiki` 0.2.0 — entity cards + hybrid search + category views via a
    theme template-override system.
  - Fleet / Contracts / Personnel / Comms are static SAMPLE placeholder panels
    (no live API yet) — see docs/decisions-log.md.
- **Pages:** Dashboard = `https://ussa.space/` (front page). Knowledge base =
  `https://ussa.space/wiki/` (`?entity=`, `?q=`, `?category=`). WP site URL + home
  are set to `https://ussa.space` (WP-CLI `option update siteurl/home`).
- **First bring-up / re-run the bootstrap:**
      docker compose create wordpress-db wordpress
      docker compose start  wordpress-db wordpress
      docker compose run --rm wordpress-cli      # installs WP + Elementor, activates plugins/theme
- **Access:** SSH tunnel `ssh -L 8093:127.0.0.1:8093 angrypctech@192.168.1.29`,
  then `http://localhost:8093` (front site) and `http://localhost:8093/wp-admin`.
  Admin login: `WORDPRESS_ADMIN_USER` / `WORDPRESS_ADMIN_PASSWORD` from `.env`.
- **wp-cli on this instance** (the apache image has no `wp`): use the cli image,
  e.g. `docker compose run --rm --entrypoint wp wordpress-cli --allow-root plugin list`.
- **Verified (2026-09-06):** stack up; front page HTTP 200 (title "USSA Lore
  Master Core"), wp-login 200; `wp plugin list` shows elementor + ussalmc-wiki +
  ussalmc-portal **active**, `wp theme list` shows ussalmc-theme active; Elementor
  admin menu present. The wiki plugin's `ussalmc_wiki_fetch_entity('ship_carrack')`
  returned the live Carrack entity from the core API, and a page with
  `[ussalmc_entity id="ship_carrack"]` rendered the Carrack card (summary,
  confidence, game_version 4.10.0-LIVE, source starcitizen.tools) in a browser.
  Live bind-mount confirmed (a disk edit appeared in-container with no restart).
  Screenshots in `docs/screenshots/wp-0[1-5]-*.png`.

## Secrets / config (.env — gitignored, NOT in the repo)
- Per-client API keys are REAL random secrets (rotated off dev tokens). Format
  `<client>_<48hex>`. Seed reads WIKI/MOBILE/DESKTOP/DISCORD/TWITCH_API_KEY from
  env; only the sha256 hash is stored in `api_keys`. `TRADE_SUBMIT_API_KEY` == the
  wiki key.
- `SEED_ON_START=false` (DB already populated; flip to true only for a fresh DB).
- `SCRAPER_VARIANCE_THRESHOLD_PCT=40` (Phase 5, optional) — default variance
  threshold when a category has no per-category override; code defaults to 40 if
  unset, so no .env change is required to deploy Phase 5.
- `COOKIE_SECURE=true` (as of Phase 7 — admin has its own TLS domain,
  admin.ussa.space). `ADMIN_SSO_SECRET` (shared HMAC secret with the WordPress
  plugin) and `ADMIN_APP_PUBLIC_URL=https://admin.ussa.space` (browser-facing
  admin URL, used both for links and the wp-admin SSO iframe src) are new.
  `ADMIN_EMAIL` sets the bootstrap super_admin's email for SSO matching.
  `WIKI_SIGNAL_RATE_LIMIT_PER_MIN` (default 10) rate-limits the new field
  confirm/flag endpoints.
- `SUDO_PASSWORD` is NOT stored in .env (was used transiently, removed).
- WordPress vars: `WORDPRESS_DB_NAME/USER/PASSWORD` (MariaDB), `WORDPRESS_SITE_URL`
  (`http://localhost:8093`), `WORDPRESS_SITE_TITLE`, `WORDPRESS_ADMIN_USER/PASSWORD/EMAIL`
  (WP admin, set at install), and `USSALMC_API_BASE` (`http://api:3000`; the wiki
  plugin's key is `WIKI_API_KEY`, reused). All in `.env` + documented in `.env.example`.
- `.env.example` documents every var with placeholders + a key-generation hint.

## Admin authentication (DB-backed, migration 0004 `admin_users`, roles added 0007)
- Session-cookie login (NOT the API bearer keys). Bootstrap account from
  `ADMIN_USER`/`ADMIN_PASSWORD`/`ADMIN_EMAIL`; server refuses to start if the
  first two are unset. Bootstrap account is always `role='super_admin'`.
- Current bootstrap credential: **angrypctech**, password already changed from
  the dev default (forced on first login, `must_change_password=true` only for
  new accounts). scrypt password hashes; sessions in-memory (re-login after an
  admin container restart, or after logging in via the plain-HTTP tunnel path
  now that `COOKIE_SECURE=true`).
- Two roles: `admin` (default) and `super_admin`. Only behavior difference
  today: hard-deleting an entity needs a single confirm for super_admin vs.
  typing the exact entity name for admin. Create additional accounts via
  `POST /admin/admins` (super_admin only).
- Endpoints: POST /admin/login, /admin/logout, /admin/change-password;
  GET /admin/session, GET/POST /admin/admins; GET /sso (WordPress handoff).

## Operating the stack
    cd /home/angrypctech/Desktop/ussa-lore-master-core
    sudo docker compose ps                      # status
    sudo docker compose logs -f api             # tail a service
    sudo docker compose build <svc>             # rebuild after code changes
    sudo docker compose up -d <svc>             # (re)create + start
    # NOTE: in the build session the terminal heuristic blocked `compose up`;
    # the reliable pattern used was:  sudo docker compose create <svc> && sudo docker compose start <svc>
    sudo docker compose restart <svc>

## Verify (live)
    curl https://API.USSA.SPACE/health                                  # {"status":"ok","db":"up"}
    curl -H "Authorization: Bearer <WIKI_API_KEY>" https://API.USSA.SPACE/v1/entities?type=item   # 200
    curl https://API.USSA.SPACE/v1/entities?type=item                   # 401 (no key)
    open https://Trader.USSA.SPACE                                      # submission form

## Data & lifecycle
- Postgres data persists in named volume **`ussalmc_pgdata`**, on host at
  `/var/lib/docker/volumes/ussa-lore-master-core_ussalmc_pgdata/_data`.
- Backups: whole-system disk images to an in-house datacenter (no separate
  pg_dump). Include `/var/lib/docker/` in the image scope. For a guaranteed-clean
  capture, `docker compose stop db` before a hot snapshot, `start` after.
- Migrations apply automatically + idempotently on api start. Seed only when
  `SEED_ON_START=true`. (Phase 5 adds `0005_categories_variance.sql`; Phase 6 adds
  `0006_category_description.sql`; Phase 7 adds `0007_admin_roles_and_delete_audit.sql`
  + `0008_field_corrections.sql` — all auto-applied on next api start. The admin
  container must be **rebuilt** to pick up the Categories management UI, the entity
  edit form, category-tree entity browsing, roles, delete tiers, and corrections
  queue, e.g. `docker compose build admin && docker compose up -d admin`. Phase 6+7
  also change the api image (`serveEntity` source-hiding, removed-entity filtering,
  field confirm/flag endpoints), so rebuild `api` too.)
- `docker compose down` stops (keeps data); **`docker compose down -v` WIPES the
  DB volume** — never run with `-v` unless intentionally resetting.

## Current data
5 seed entities, 2 trade routes (+ live submissions), 1 admin user. pgvector 0.8.x.
WordPress test instance: WP 6.x installed, Elementor 4.2.4 + ussalmc-wiki/portal +
ussalmc-theme active, 1 demo page (`?page_id=5`) using the wiki shortcode.

## Outstanding / next-session TODO
- [x] ~~Confirm router 80/443 forward is a permanent rule~~ — confirmed
      2026-09-06: router is a UniFi Dream Machine, port-forward + DNS settings
      are stored on the controller and persist across reboots/updates.
- [ ] Rotate the host sudo password (it appeared in a build-session chat).
- [ ] Phase 5 candidates: Discord bot + Twitch bot (`apps/bots/*`, discord.js /
      tmi.js) using DISCORD_API_KEY / TWITCH_API_KEY; WordPress/wiki consumer.
- [x] ~~Give admin its own TLS domain~~ — done in Phase 7 (admin.ussa.space,
      COOKIE_SECURE=true), needed to make the SSO iframe actually work.
