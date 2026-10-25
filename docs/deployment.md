# Deployment — USSA Lore Master Core

**STATUS: migrated to full production on a dedicated AAPanel-managed host as
of 2026-09-25** (post-MVP; see "Phase 27" below). The 2026-09-06 setup
described further down (LAN IP 192.24.65.11, physical rack machine) now runs
as a **test/staging environment**, not production — kept running, not
decommissioned. This doc reflects the actual running deployment, not a plan.
Read it first when resuming work.

## Phase 27 — production migration to dedicated AAPanel host (2026-09-25)

Moved from the rack-mounted dev/early-production machine to a dedicated
webhosting box (AAPanel-managed, Ubuntu 24.04, `ns5.zbsdns.com`,
`192.24.65.14`) once the project reached MVP. AAPanel itself has no usable
API for deploying a custom multi-service Docker Compose stack (its
documented API covers system stats and its own PHP/FTP/DB "website"
abstraction only, confirmed against the official API PDF — no Docker or
shell-exec endpoints exist; its installed Docker plugin has a private,
undocumented API of its own). Deployed via direct root SSH instead
(password auth — the account requires the exact right auth-method
negotiation; public-key attempts and even password attempts can fail with
a misleading "Permission denied (publickey)" if the client doesn't
negotiate cleanly, not necessarily a real server misconfiguration).

- **Path convention**: `/www/dk_project/dk_app/<name>/<name>/` — matches
  where AAPanel's own Docker-app installs (e.g. an existing `anythingllm`
  install) keep their compose files, found via `find` for
  `docker-compose.y*ml` on the host (not guessed) — confirmed after
  deploying that this makes a manually-placed compose project show up in
  AAPanel's own Docker app list alongside apps installed through its UI.
- **Deploy method**: repo synced via `rsync` directly from the dev machine
  (not `git push`/`clone` — no GitHub credentials configured for pushing
  from this environment), followed by `scripts/backup.sh` output rsync'd
  over and restored with `scripts/restore.sh --yes`.
- **Real bug caught and fixed during this deploy**: `restore.sh` passed a
  relative backup-dir path to `docker run -v`, which Docker silently
  misinterprets as an (invalid) named-volume reference rather than a bind
  mount — the SQL restores (which don't go through `docker run`) had
  already succeeded by the time this surfaced. Fixed by canonicalizing
  `BACKUP_DIR` to an absolute path immediately in the script.
- **Verified live, not just "containers up"**: all 6 services healthy,
  `GET /health` → `{"status":"ok","db":"up"}`, 4,421 total entities and
  exactly 1,733 quest entities restored (matching the pre-migration count).
- **nginx**: the 4 existing reverse-proxy vhosts (`docs/nginx/*.http.conf`
  — api/trader/admin/ussa.space, unchanged from the original deployment)
  deployed to AAPanel's vhost directory (`/www/server/panel/vhost/nginx/`)
  and verified working via `curl --resolve`/Host-header spoofing (DNS
  doesn't point here yet). SSL deliberately left for the user to issue via
  AAPanel's own Let's Encrypt panel per domain once DNS is repointed,
  rather than running raw certbot against AAPanel-managed nginx.
- **Outstanding, on the user**: DNS A records for `ussa.space`,
  `www.ussa.space`, `api.ussa.space`, `trader.ussa.space`, and
  `admin.ussa.space` still point at the old server (`192.24.65.11`) as of
  this writing — need repointing to `192.24.65.14`. SSL certs then need
  issuing per domain via AAPanel's panel.

### Known gotcha: AAPanel's SSL/reverse-proxy wizard drops `X-Forwarded-Proto`

Hit live on `ussa.space` right after DNS was repointed and SSL issued through
AAPanel's panel: "too many redirects" in the browser. Root cause — using
AAPanel's own SSL/Reverse-Proxy setup for a domain **replaces** the plain
`docs/nginx/*.http.conf` vhost with AAPanel's own auto-generated one (still
at the same `/www/server/panel/vhost/nginx/<domain>.conf` path, but a much
larger AAPanel-templated file with `#PROXY-CONF-START`/`END` markers). That
generated proxy block sets `Host`/`X-Real-IP`/`X-Forwarded-For` but
**not** `X-Forwarded-Proto` — so WordPress (`wp-config.php` already has the
standard `HTTP_X_FORWARDED_PROTO` → `$_SERVER['HTTPS']='on'` snippet, that
part was never the problem) can never tell the original request was HTTPS,
and its own canonical-URL redirect fires on every request, looping forever
once the browser is already on `https://`.

**Fix applied**: add `proxy_set_header X-Forwarded-Proto $scheme;` inside
the `#PROXY-CONF-START`/`#PROXY-CONF-END` block AAPanel generated, right
after the `proxy_pass` line, then `nginx -t && nginx -s reload`. Verified
from a genuinely external client (not the server itself — see the hairpin-
NAT note above) that `https://ussa.space/` returns a clean `200` with no
redirect, and `http://ussa.space/` redirects exactly once to `https://`.

**This will very likely recur** for `api`/`trader`/`admin`.ussa.space the
moment SSL gets set up for them the same way through AAPanel's panel —
check for and re-apply this same one-line fix each time.

**Update 2026-09-25, same day**: it did recur — the user set up SSL for all
three remaining domains via AAPanel's panel, and all three got the same
missing-header treatment; fixed the same way (one `proxy_set_header
X-Forwarded-Proto $scheme;` line added to each generated block). All 4
domains (`ussa.space`, `api`, `trader`, `admin`) now confirmed working from
a real external client — clean `200`s, no loops, `api.ussa.space/health`
returns real JSON (`/` alone 404s, correctly — the API has no root route).

**Separate incident, same session — do not repeat this**: attempted to
install `certbot`/`python3-certbot-nginx` via `apt-get` to issue certs
directly (to sidestep the AAPanel-wizard bug above) — this silently pulled
in the **stock Ubuntu `nginx`/`nginx-common` packages** as a dependency of
the certbot nginx plugin, which auto-started and bound to ports 80/443
*alongside* AAPanel's own separate nginx install
(`/www/server/nginx/sbin/nginx`), both simultaneously serving traffic on
the same ports. The site kept working by luck during this window, but it
was a genuinely unstable state (requests could've been randomly routed to
whichever nginx accepted the connection, and the stock one knows nothing
about our vhosts). Resolved by `systemctl stop nginx && systemctl disable
nginx && apt-get purge -y nginx nginx-common python3-certbot-nginx`,
confirmed via `ps` that all remaining nginx worker processes are children
of AAPanel's own master process. **Lesson: never `apt-get install`
anything nginx-related on an AAPanel box** — AAPanel bundles and manages
its own nginx outside the system package manager entirely; use its panel
UI for SSL/certs instead, even though that UI has the bug documented
above.

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
- `ussalmc_media` volume (Phase 18), mounted at `/app/media` in both `api`
  (serves, `GET /media/*`) and `admin` (writes, via the scraper's
  `media-store.ts`) — self-hosted entity images, since we don't control
  starcitizen.tools/robertsspaceindustries.com's uptime. `MEDIA_DIR=/app/media`
  in both; `MEDIA_PUBLIC_BASE` (default `https://api.ussa.space`) is the
  public origin baked into every stored `images[].url`/`full_url` — changing
  it after images already exist does NOT retroactively rewrite stored URLs,
  only affects new downloads (a domain migration would need a one-off SQL
  rewrite of every `entities.images` row, not currently scripted).
  **GOTCHA verifying from this server/LAN itself**: `api.ussa.space` resolves
  to the LAN IP (`192.168.1.29`) here, but to the real public IP
  (`192.24.65.11`, same as `ussa.space`) everywhere else — split-horizon DNS,
  same category of issue already solved for `admin.ussa.space`'s SSO iframe
  (see "Live URLs" above re: Chrome's Private Network Access policy). Loading
  a wiki page FROM THIS LAN shows self-hosted images failing with a CORS/PNA
  error in the browser console — that's expected here and does NOT reproduce
  for a real internet visitor; don't chase it as a bug. To verify image
  loading correctly from this machine, force the public IP (e.g. Chromium's
  `--host-resolver-rules=MAP api.ussa.space 192.24.65.11`, or `curl --resolve`)
  rather than trusting local DNS.

## WordPress plugin/theme test instance (Docker Compose)
A real, running WordPress used to develop/test the USSALMC plugins + theme. It is
part of this same compose stack and network (`ussalmc`), private (127.0.0.1:8093).
- **Services:** `wordpress` (image `wordpress:7.1.3-php8.5-apache`), `wordpress-db`
  (image `mariadb:11`, internal-only), and `wordpress-cli` (image
  `wordpress:cli-2.12-php8.5`) — a one-shot bootstrap that runs `apps/wordpress/wp-init.sh`
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
  - `ussalmc-portal` 0.3.0 — three real Elementor widgets (Market, Stat Readout,
    Module Grid) reading the core API, palette inherited from the Kit. All three
    are gated on RSI-handle verification (`[ussalmc_register]`/`[ussalmc_verify]`,
    checked against StarCitizen-API, a separate ToS-permitted third-party service
    — never robertsspaceindustries.com directly) — an account isn't fully active
    until it passes. Key = `STARCITIZEN_API_KEY`, wired the same way as
    `WIKI_API_KEY` (see below).
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
- `STARCITIZEN_API_KEY` (Phase 10) — a StarCitizen-API (starcitizen-api.com)
  account key, obtained via Discord login on their site (not something this repo
  can provision). Used only by the portal plugin's RSI-handle verification.
  GOTCHA: setting it in `.env` alone does nothing by itself — like `WIKI_API_KEY`,
  it has to flow through to a WP **option** (`ussalmc_starcitizen_api_key`), which
  only happens via the `wordpress-cli` bootstrap container reading it from
  `docker-compose.yml`'s `environment:` block and running `wp option update` in
  `wp-init.sh`. On an already-provisioned instance (bootstrap already ran once),
  changing `.env` requires either re-running
  `docker compose run --rm wordpress-cli` or setting the option directly
  (`wp option update ussalmc_starcitizen_api_key "<key>"`).
- `PORTAL_API_KEY` (Phase 10) — a dedicated core-API client key for the portal
  plugin's gated trade submission (`[ussalmc_trade_submit]`), separate from
  `WIKI_API_KEY`. `POST /v1/trade-routes/submit` only honors `rsi_verified`
  from this client, so it can't be spoofed by any other caller (including the
  standalone trade-submit app, which reuses the wiki key and stays anonymous).
  Same `<client>_<48hex>` format; seeded into `api_keys` via
  `db/migrations/0012_portal_api_key_client.sql` (adds `portal` to the allowed
  `client` values) — the `api_keys` row itself has to be inserted once
  (`INSERT ... ON CONFLICT (client) DO UPDATE`, same shape `seedApiKeys()` in
  `db/seed/seed.ts` uses; **don't** run the full seed script against a live DB
  to add this one row — it also re-upserts the Phase 1 example entities, which
  would stomp real scraped data for any of those same IDs). Same wp_options
  wiring gotcha as `STARCITIZEN_API_KEY` above: flows through
  `wordpress-cli`/`wp-init.sh` into option `ussalmc_portal_trade_api_key`.

## OpenClaw MCP server (`apps/openclaw-mcp`, Phase 21)

Runs on the HOST, NOT in docker-compose — it's spawned directly by the
user's own local OpenClaw AI agent gateway (`~/.openclaw/`), which isn't
containerized. Gives that agent (`angrydaemon`, local Ollama model) 4
read-only tools over the KB, reused by every OpenClaw channel it's
connected to (Discord already; Twitch is a supported OpenClaw channel, not
yet enabled).

- Build: `cd apps/openclaw-mcp && npm install && npm run build` (plain
  tsc, produces `dist/index.js`).
- Talks to the core API over its published `127.0.0.1:8090` port (same as
  any other external client) — reads `USSALMC_API_BASE`/`USSALMC_API_KEY`
  from its own env (passed by OpenClaw's `mcp.servers` config, not a
  docker-compose env block) or falls back to the project's `.env` via
  `dotenv` for convenience.
- **`openclaw mcp reload` does NOT kill already-running server processes** —
  confirmed live 2026-09-19: 16 orphaned `node .../openclaw-mcp/dist/index.js`
  processes had accumulated since the very first registration (one per
  historical rebuild, none ever terminated), and the long-lived Discord
  channel session was still bound to a stale one from BEFORE a tool
  (`ussalmc_identify_signature`) was added — so that live session genuinely
  could not see the tool, for hours, despite every `mcp reload` run since.
  `reload` only disposes an internal runtime-cache reference for NEW
  sessions; it does not touch existing child processes or force existing
  sessions to reconnect. After every `npm run build` + `openclaw mcp reload`
  for this server, ALSO: `pkill -f 'openclaw-mcp/dist/index.js'` (kills all
  instances; OpenClaw respawns one on the next turn) AND delete/restart any
  long-running session that might be holding a stale connection (e.g. the
  live Discord channel session — `openclaw sessions delete "agent:angrydaemon:discord:channel:<id>" --agent angrydaemon --yes`).
  Skipping this step means a code change can silently never reach a real,
  ongoing conversation while every fresh-session CLI test (which naturally
  gets a new connection) looks correct — exactly what happened here.
- Registered with OpenClaw via:
  `openclaw mcp add ussalmc --command node --arg <repo>/apps/openclaw-mcp/dist/index.js --env USSALMC_API_BASE=http://localhost:8090 --env USSALMC_API_KEY=<key>`
  — this writes into `~/.openclaw/openclaw.json`'s `mcp.servers` (OpenClaw's
  own config, outside this repo — re-run `mcp add` with `--force`-equivalent
  behavior, i.e. it overwrites the existing entry, if the path or key ever
  changes). `openclaw mcp probe ussalmc` re-checks connectivity/tool
  discovery without restarting anything.
- `OPENCLAW_API_KEY` — see `.env.example`; a dedicated `api_keys` client
  (migration `0013`), independent of `WIKI_API_KEY`, so this surface can be
  revoked/rate-limited without touching the WordPress site.
- No Docker rebuild ever needed for this piece — it's plain Node run
  directly on the host, picked up by OpenClaw the next time it spawns the
  MCP process (OpenClaw manages that lifecycle, not docker-compose).

## Instructional guide ingestion (`apps/admin/src/import-youtube-guide.ts`, Phase 22)

Runs from `apps/admin` on the HOST (or wherever admin scripts already run),
not a new Docker service — it's a one-shot CLI import script, same category
as `import-starcitizen-api.ts`.

- `cd apps/admin && npm install` (pulls in the new `youtube-transcript` dep).
- Requires Ollama reachable locally with `GUIDE_EXTRACTION_MODEL` pulled
  (default `qwen3.6:35b-a3b`, same Ollama install already used by OpenClaw —
  see `agents.defaults.model` in `~/.openclaw/openclaw.json`, unrelated
  config store, but same underlying `ollama list`).
- `OLLAMA_BASE_URL` / `GUIDE_EXTRACTION_MODEL` in `.env`/`.env.example`.
- **Two-phase by necessity**: Ollama (behind the NVIDIA "Personal AI Router")
  only accepts plaintext requests from true loopback — confirmed live, even
  `host.docker.internal` from inside a container gets hard-rejected
  (`{"code":"loopback-only"}`). `db` is deliberately unreachable from the
  host (no `ports:` mapping, trust auth — safe only because nothing outside
  the compose network can reach it; publishing even a loopback port would
  make it a credential-free connection for any local process, unlike the
  app services' loopback ports which still sit behind their own auth). No
  single place has both, so extraction runs on the host, storage runs in
  the container, bridged by a JSON payload over stdout/stdin:
  ```
  cd apps/admin
  npx tsx src/import-youtube-guide.ts "<youtube-url>" [--topic mining] [--difficulty beginner] \
    | docker compose exec -T admin npx tsx src/import-youtube-guide.ts --store-from-stdin
  ```
- No new API routes, no Docker rebuild — reuses the existing entities
  table/`upsertEntity`, just a new `attributes.category = 'guide'` value.

## "Sig Ident" — mining signature identification (Phase 23)

- `apps/admin/src/import-scmdb-signatures.ts` — run inside the `admin`
  container (`docker compose exec admin npx tsx src/import-scmdb-signatures.ts`),
  unlike the YouTube guide importer: this one has no loopback-only
  constraint (Playwright just needs normal internet access), only the DB
  constraint, so it runs entirely in one place.
- Requires Chromium in the admin image — `apps/admin/Dockerfile`'s runtime
  stage now runs `npx playwright install --with-deps chromium` (needs a
  rebuild: `docker compose build admin`, larger image/longer build than
  before, first-time browser download).
- WordPress: `[ussalmc_sig_ident]` shortcode, live at `/sig-ident/` on the
  test instance (created via wp-cli, installed ad hoc into the `wordpress`
  container — `curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar`
  — no `mysql`/`wp` client was already present there).
- Discord/AngryDaemon: `ussalmc_identify_signature` MCP tool
  (`apps/openclaw-mcp`) — same build/reload steps as any other MCP tool
  change (`npm run build`, `openclaw mcp reload`).
- No new env vars, no `db`/Ollama access changes.

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
- Backups: whole-system disk images to an in-house datacenter (host-level,
  no separate pg_dump). Include `/var/lib/docker/` in the image scope. For
  a guaranteed-clean capture, `docker compose stop db` before a hot
  snapshot, `start` after.
- **Portable, Docker-deployable backup (Phase 26, `scripts/backup.sh` /
  `scripts/restore.sh`)**: an application-level alternative to the
  host-image strategy above — a single timestamped archive you can move to
  any machine with Docker + this repo checked out, not tied to the
  in-house datacenter. Runs `pg_dump`/`mariadb-dump` inside the live
  containers (never touches the host-vs-container `DB_HOST` split
  documented elsewhere in this file) with `--clean --if-exists` so the SQL
  dump is self-contained whether restored onto an empty or existing
  database, plus a `tar` of the two data volumes that aren't reproducible
  from git (`ussalmc_media`, `wordpress_data` — plugin/theme code is
  already in the repo, not duplicated). Includes `.env` and
  `docker-compose.yml` so the archive alone (plus a repo checkout) is
  enough to redeploy. `scripts/backup.sh [output-dir]` (default
  `./backups/`, gitignored — **contains real secrets**, chmod 600 on the
  copied `.env`). `scripts/restore.sh <backup-dir>` is a dry run by
  default; add `--yes` to actually perform the (destructive — overwrites
  both databases and both volumes) restore. Verified live: a real backup
  run produced a 40MB Postgres dump (confirmed real entity data present,
  not just schema) and 2.2GB of volume archives; `restore.sh`'s dry-run
  safety gate confirmed to refuse without `--yes`.
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
- [ ] **Resume the Phase 9 initial force-overwrite import** — `ship` (236) and
      `manufacturer` (246) are actually fully processed (confirmed via
      `bulk_import_progress`, 2026-09-08); the job is paused at the 500/day
      fetch cap **before starting** `weapon`/`location`/`commodity`, not
      "partway through manufacturer" as this note previously said. Re-run
      from `apps/admin` inside the admin container:
      `npm run bulk-import -- --force-overwrite --categories=ship,manufacturer,weapon,location,commodity --job-key=initial_force_pull --max-per-category=500`
      (same `job_key` resumes, skipping ship/manufacturer since they're
      already done; safe to re-run daily until `bulk_import_jobs.status='done'`).
      This is a one-time flag for this initial pull only — do not add
      `--force-overwrite` to any scheduled/cron invocation.
- [ ] **Resume the manufacturer image backfill** (`job_key=manufacturer_image_backfill`,
      started 2026-09-08 to pick up the SVG-image fix below) — also paused at
      the shared 500/day fetch cap (0 of 313 pages processed so far; the cap
      is a rolling 24h window shared across every bulk-import job_key, and
      yesterday's `initial_force_pull` run had already used all 500). Re-run
      from `apps/admin` inside the admin container:
      `npm run bulk-import -- --force-overwrite --categories=manufacturer --job-key=manufacturer_image_backfill --max-per-category=500`
      until `status='done'`.
      A **reminder-only** systemd `--user` timer is installed on the host
      (`ussalmc-bulk-import-reminder.timer`, daily 09:00 America/Chicago,
      runs `scripts/check-bulk-import-status.sh`) — it checks
      `bulk_import_jobs.status` for **both** job keys above and nudges
      (desktop notification + `wall` + `~/.local/state/ussalmc-bulk-import-reminder.log`)
      with the exact resume command for whichever is still paused; it never
      runs bulk-import itself, per the no-cron-force-overwrite rule above.
      Self-disables once both report `status='done'`. Not part of the repo's
      deployed containers — host-level only, so it doesn't survive a host
      rebuild; re-run `systemctl --user enable --now ussalmc-bulk-import-reminder.timer`
      (units live in `~/.config/systemd/user/`) if this host is ever recreated.
- [x] ~~Image extraction silently skipped SVG-only infobox images (all 246
      manufacturer logos)~~ — fixed 2026-09-08, see decisions-log. Rebuilt +
      redeployed the `admin` container (code isn't bind-mounted). `weapon` and
      `location` don't have saved templates yet (bulk-import hasn't reached
      them) so they'll pick up the fix automatically on first build; no
      backfill needed for those two.
- [x] ~~Give admin its own TLS domain~~ — done in Phase 7 (admin.ussa.space,
      COOKIE_SECURE=true), needed to make the SSO iframe actually work.

## External-only scraper requests (2026-10-25)

The admin scraper accepts public HTTP/HTTPS sites only. Its page, robots.txt,
image downloads, and MediaWiki category discovery (including bulk imports) share `apps/admin/src/public-fetch.ts`.
It rejects URL credentials, private/reserved IPs, mixed public/private DNS answers,
and redirects to blocked destinations. Connections use the validated IP while
retaining the hostname for TLS certificate verification. IPv6 is restricted to
public global unicast, excluding special-purpose transition/documentation ranges.
There is no internal-site exception or new environment variable. The admin's
configured core-API preview client is separate from scraping.

Each HTTP request has a 15-second deadline, a 5 MiB response limit and at most
five redirects. Rebuild/restart the admin service to deploy this change. Direct
DNS resolution and outbound TCP 80/443 access to public sites are required;
proxy-only environments need an egress route that preserves destination validation.
Run security regressions with `cd apps/admin && node --import tsx --test test/public-fetch.test.ts`,
and compile with `npm run build`. This change addresses scraper SSRF; the audit's
separate route authentication bypass still requires its own fix.

## Stellar Atlas homepage and Ships browser

The existing `[ussalmc_dashboard]` front-page shortcode now renders the approved
search-first Stellar Atlas layout. The original logo files are unchanged. All
category, search, ship/entity, and trade-route URLs continue to use `/wiki/`.
Ships use `/wiki/?category=ship`, with name filtering (`filter`), natural-name
sorting (`sort=az|za`) and 24 entries per page (`kb_page`). Filtering occurs
before pagination across the fetched category, including existing subcategories.
Blank photos get a quiet fallback; absent specs and nonpositive USD pledge
prices are omitted. The mining tool is reachable without creating a WP page at
`/wiki/?tool=sig-ident` and preserves that route when submitting its form.

The homepage uses six existing taxonomy categories and editorial images from
actual KB entity IDs (400i, Laranite, Area18, Greatsword, Banu, and Prospector).
These are references, not copied image assets. Guide imagery deliberately uses
the Prospector mining ship, as approved in the mockup. If an editorial entity
has no valid image, the category's representative image is used; otherwise an
explicit missing-image state is shown. Recent entries use their own images and
real `updated_at` values. Only successful image lookups (5 minutes) and recent
lists (1 minute) are cached by WordPress. Live trade freshness is never replaced
by a cached timestamp or a decorative live indicator.

Deploy the updated wiki plugin and theme directories together, preserving their
existing mount paths and permissions. Rebuild/recreate the API for the additive
category image metadata. Existing WordPress content, users and media volumes do
not need recreation or `wp-init.sh`; do not reset or reimport production data.
The theme and plugin version are 0.5.0; purge any external page/CDN cache after
release. Old plugin templates retain their default global search outside Atlas.

Validation: API TypeScript build, PHP lint on the theme/wiki plugin, and a real
local WordPress + PostgreSQL/API browser run using a snapshot of public KB
content (236 ships). The smoke test expects a populated local site and
`apps/admin` development dependencies with Playwright Chromium installed:

```sh
ATLAS_PREVIEW_URL=http://localhost:8093 node apps/wordpress-theme/tests/atlas-browser.mjs
```

This verifies navigation, unchanged-logo asset reference, paging, filtering,
entity detail, empty results, sorting, page clamping, directory/search/tool
routes, and horizontal layout at 390, 768, and 1440 pixels. Local preview
containers and snapshot files are development artifacts, not production data.

## Planetary Atlas locations tool

The new `[ussalmc_planetary_atlas]` shortcode is available in the theme. It is
also reachable through `/wiki/?tool=locations` and `/wiki/?category=location`.
The existing directory remains accessible at
`/wiki/?category=location&view=list`. Body/location selection uses shareable
`body=<entity_id>&place=<entity_id>` parameters. The header's Locations link and
homepage Locations card lead to the explorer; existing entity URLs are retained.

Deploy the API, wiki plugin and theme changes together. Rebuild/recreate the API
container, sync theme/plugin mounts, and purge any page/CDN cache. No database
migration, secret, production re-seed or WordPress page creation is required.
The existing logo files are unchanged. The frontend never sees the API key.

Three.js 0.180.0 and OrbitControls are vendored with their MIT license under
`assets/vendor/three`. Files were checked against the npm tarball's SHA-512
integrity; OrbitControls has only its import redirected to the local module.
They load lazily on an Atlas page, without a runtime CDN or import map. The
location browser/details work when WebGL is unavailable. With JavaScript off,
the page links to the existing server-rendered directory.

The globe surface, world sizes and system layout are explicitly illustrative,
not navigationally accurate. Only valid recorded degree coordinates on a known
body become pins. Unassigned or unpositioned records remain searchable. The
Stanton and Pyro planet/moon reference hierarchies is documented in docs/api.md;
no Cornerstone code, coordinates, textures or location dataset is copied.

Checks (from repository root, with API/admin dev dependencies installed):

```sh
npm --prefix apps/api run build
node --import ./apps/api/node_modules/tsx/dist/loader.mjs --test apps/api/test/planetary-atlas.test.ts
node --test apps/wordpress-theme/tests/planetary-model.test.mjs
# Local configured WP/API and migrated disposable DB; never production:
ATLAS_TEST_DATABASE=atlas_preview node apps/wordpress-theme/tests/planetary-browser.mjs
```

The browser test creates/removes clearly named fixtures only in a database
explicitly named `atlas_preview` or `test_*`. It verifies the real WP/API/DB
path, complete ancestry, zero-coordinate pins, layers, filtering, system/globe
drilldown, mobile/tablet/desktop layout, safe embedded JSON, WebGL failure and
no-JS directory access. A Playwright Chromium installation is required. No
production records are changed by preview or validation.

### Release scope / remaining coverage

This branch implements the WordPress Stellar Atlas shell/homepage and the
Planetary Atlas viewer/API. It is not a complete, surveyed universe database.
The globe can display any classified KB body; Stanton and Pyro have complete authored planet/moon reference hierarchies
matching the supplied survey catalogue (28 bodies across the two systems).
Other systems depend on recorded relationships.
Unknown coordinates/services remain unknown, and surface terrain and system
layouts remain illustrative. Accurate surface maps, game-derived textures,
complete system catalogues and ephemerides are not included.

The separately reviewed manufacturer/role and commodities/trade submission
screens are design prototypes, not production implementations in this branch.
The existing trade backend and gated submission flow are unchanged. The current
ship category has a restyled generic listing; its manufacturer/role workflow
still needs implementation. Deployers should not assume those prototypes are
wired into the running theme.
