# Star Citizen Knowledge Base — Project Standards

Read this file fully before doing any work in this repo. Every phase of this
build must follow these standards exactly — don't introduce a different
folder layout, naming convention, or tech choice than what's specified here,
even if it seems easier for the task at hand. If something isn't covered
here and you have to make a judgment call, add it to this file under
"Decisions Log" so later phases stay consistent with what you chose.

## Project Location
Root: /home/angrypctech/Desktop/ussa-lore-master-core

## Tech Stack (fixed — do not substitute)
- **Language/runtime:** Node.js + TypeScript
- **API framework:** Fastify (or Express if Fastify isn't available in the
  environment — note which one you used in the Decisions Log)
- **Database:** PostgreSQL, entities stored as JSONB per the schema in
  `/docs/schema.md`
- **Vector search:** pgvector extension on the same Postgres instance —
  do not stand up a separate vector database unless pgvector genuinely
  can't be installed
- **Bot frameworks:** discord.js (Discord), tmi.js or similar (Twitch)
- **Admin UI:** plain React (no heavyweight meta-framework needed) served
  from `/apps/admin`

## Repo Layout (relative to project root above)

/docs
schema.md — canonical entity schema, kept in sync with reality
api.md — endpoint reference, kept in sync with reality
decisions-log.md — running log of judgment calls made mid-build
deployment.md      — deployment/infra steps (Docker, ports, env setup),
                     kept in sync with the actual running setup
ai-agent-guidelines.md — behavioral rules for any AI agent answering
                     questions from this KB (anti-fabrication discipline,
                     tool-use gotchas) — persona-agnostic, portable to any
                     orchestration system. See Decisions Log.
/db
migrations/ — every schema change is a numbered migration file
seed/ — seed data scripts (example entities from Phase 1)
/apps
api/ — the core REST API service
admin/ — the scraper + admin review web UI
bots/
discord/
twitch/
openclaw-mcp/ — MCP (Model Context Protocol) stdio server giving the
              user's own locally-run OpenClaw AI agent real read-only
              tools over the knowledge base (search, get entity, list
              categories). Runs on the HOST (spawned by OpenClaw itself
              via its `mcp.servers` config), not in Docker — replaces the
              separate bots/discord + bots/twitch codebases, since
              OpenClaw is already one gateway connected to Discord (and
              Twitch is a supported OpenClaw channel too) rather than
              needing a bot per channel. See Decisions Log, Phase 21.
/scripts — one-off or maintenance scripts (re-embed, backfill, etc.)
/.env.example — every required env var, with a placeholder value and
a one-line comment on what it's for

Do not create top-level folders outside this layout. If a phase needs
something new (e.g. a queue worker), add it under `/apps/` and document it
here.

## Environment Variables
All config comes from environment variables, never hardcoded values or
secrets committed to the repo. Every var must be listed in `.env.example`
the moment it's introduced, in the same phase that introduces it.

Naming convention: `SCREAMING_SNAKE_CASE`, prefixed by area —
`DB_*`, `API_*`, `DISCORD_*`, `TWITCH_*`, `SCRAPER_*`.

## API Conventions
- All routes versioned under `/v1/`.
- JSON in, JSON out. Every response includes `confidence`, `source`, and
  `game_version` on entity payloads per the schema.
- Per-client API keys (wiki/mobile/desktop/discord/twitch), each — auth
  header `Authorization: Bearer <key>`, never a query-string key.
- Errors return `{ "error": { "code": "...", "message": "..." } }` — no bare
  strings, no stack traces in responses.
- Any endpoint added in a later phase gets added to `/docs/api.md` in the
  same commit/session that adds the route — the doc must never lag the code.

## Database Conventions
- Every schema change is a migration file in `/db/migrations`, numbered
  sequentially (`0001_init.sql`, `0002_add_trade_routes.sql`, ...). Never
  hand-edit the schema outside a migration.
- Entity table stays generic (one `entities` table, `type` column,
  `data JSONB`) rather than a separate table per entity type — keeps the
  schema flexible without needing per-type migrations every time a new
  attribute shows up.
- `/docs/schema.md` is the source of truth for what fields exist — update
  it in the same phase you change the schema, not after.

## Naming Conventions
- Files: `kebab-case.ts`
- Entity IDs: `<type>_<slug>` (e.g. `ship_carrack`, `manufacturer_anvil_aerospace`,
  `trade_route_0001`) — lowercase, underscores, no spaces.
- Template IDs: `tpl_<category>_v<N>` (e.g. `tpl_ship_v1`).
- Git commits: one logical change per commit, present-tense summary
  (`add trade route submission endpoint`, not `added` or `WIP`).

## Cross-Phase Rules (non-negotiable, carried from the spec)
- Never guess or auto-fill a missing field — store `null` and say so.
- Every fact tracks `confidence` and `source`; nothing gets presented as
  `confirmed` unless it actually is.
- The admin-facing scraper review screen is always plain language — no
  raw selectors, JSON, or DOM terms shown to a human reviewer.
- The `/ai-context` field on every entity is always auto-generated from
  structured data at publish time — never hand-written, never allowed to
  drift from the source fields.
- Trade route data is `volatile` — short/no cache TTL, `last_verified`
  always surfaced, never presented as current fact without its age.
- Respect robots.txt/ToS on any site the scraper touches.

## Definition of Done (every phase)
A phase isn't finished when the code is written — it's finished when:
1. It actually runs, against real data, not a mock.
2. `/docs/schema.md` and `/docs/api.md` reflect whatever changed.
3. Any new env vars are in `.env.example`.
4. You've shown the output of running it, not just described what it would do.
5. docs/deployment.md reflects any change to how the project is built, 
   run, or deployed — not just schema/API changes.

## Decisions Log
*(Append entries here as judgment calls come up — one line each, dated,
with the decision and why.)*
- 2026-09-19: Added `/apps/openclaw-mcp` (new top-level app folder) instead
  of building out the planned `bots/discord`/`bots/twitch` — the user
  already runs OpenClaw (a local multi-channel AI agent gateway, already
  connected to Discord, with Twitch as a supported-but-unconfigured
  channel) and asked to integrate through it instead. One MCP server, one
  `openclaw` api_keys client (migration 0013), serves every channel that
  agent is connected to. Full rationale + verification in
  docs/decisions-log.md.
- 2026-10-22: Bumped the WordPress stack's PHP version from 8.3 to 8.5
  (current stable PHP line). `wordpress` image: `wordpress:php8.3-apache`
  -> `wordpress:7.1.3-php8.5-apache` (pinned to WP core 7.1.3 rather than a
  floating `php8.5-apache` tag, so core doesn't silently move on a pull).
  `wordpress-cli` image: `wordpress:cli-php8.3` -> `wordpress:cli-2.12-php8.5`
  (matching WP-CLI 2.12). Verified both tags exist on Docker Hub before
  switching.

- 2026-10-25: Scraper imports are external-only; public-fetch validates and pins public DNS answers for every page, robots, category and redirect request. Internal API preview calls remain separate.
- 2026-10-25: Merged `feat/stellar-atlas` (new Stellar Atlas homepage + 3D
  Planetary Atlas locations explorer) into `main`, deployed to the local
  Docker test instance only (not production yet). Found the local test
  WordPress instance's `siteurl`/`home` options were pinned to
  `https://ussa.space` (an earlier deliberate choice, `docs/deployment.md`
  line ~311) — this made every new theme asset URL resolve against
  production instead of localhost, breaking the local test render. Reset
  both options to `http://localhost:8093` for local testing; production is
  unaffected. Also found only 2 of 96 `kind:"system"` atlas nodes (Stanton,
  Pyro) are actually implemented in-game — the other 94 are lore-only
  StarCitizen-API starmap entries with no in-game system to visit. Added an
  `implemented` field to `AtlasPlace` (true only for Stanton/Pyro) and
  filtered the WordPress theme's system picker on it, so the 3D explorer
  only ever lists real, flyable systems; lore-only systems stay in the KB/
  search, just not in the explorer. See docs/api.md.
- 2026-10-25: Ships category gained "By manufacturer"/"By role" tabs
  (`?category=ship&view=manufacturer|role`) alongside the existing flat
  "All ships" view, grouped from the real `manufactured_by` relation and
  normalized `role` attribute. 3D explorer: fixed Lagrange-point stations'
  `"<System> — Sunward/Anti-sunward/±60°/180° from <planet>"` location text
  never matching the existing "On <body>" parent-parsing regex (they were
  silently unparented); added matching `L1`-`L5` markers in the system view.
  Fixed the sidebar planet/moon list rendering in plain alphabetical DB
  order instead of real distance order (added `orbit_index`, sorted the
  tree and the orbital radii by it). Fixed orbit geometry that was baked
  elliptical (an unrequested `*0.52` z-scale) back to true circles. Planet
  globe textures: separated the bump/height map from the diffuse color map
  (reusing color-as-height produced meaningless noisy bumps), removed a
  hard-edged shading seam, doubled texture resolution, and blended each
  texture toward a fixed-longitude sample near the poles (longitude lines
  converge there, so a longitude-dependent pattern otherwise spirals into a
  pinwheel) — no third-party textures used, procedural only, per the
  existing Cornerstone-derived rule in docs/deployment.md. Declined to
  source actual Star Citizen game textures from a third-party site even
  under a claimed non-commercial/attribution exception — verified against
  RSI's actual Fankit/Fandom FAQ, which says the opposite (graphic assets
  can't be extracted and redistributed separately; non-commercial IP use
  needs a signed license RSI isn't currently issuing).
- 2026-10-25: Imported real Stanton location data from a user-retrieved
  VerseGuide export (never scraped by this project — see the note above on
  third-party data). `scripts/import-verseguide-stanton-coordinates.ts`
  patched 69 existing entities with real surface coordinates (latitude
  negated to match this KB's north-positive convention vs. VerseGuide's
  north-negative display). `scripts/import-verseguide-stanton-new-locations.ts`
  created 1,238 net-new location entities (caves/wrecks/outposts VerseGuide
  tracks individually that this KB didn't) via the normal `upsertEntity`
  pipeline, matched/parented by exact name only. Found microTech had NO
  location-type KB entity at all (only `manufacturer_microtech`, the
  company) — every microTech-body location, including its 5 Lagrange
  stations, was silently unparented as a result.
  `scripts/fix-microtech-parentage.ts` created `location_microtech` (named
  `"MicroTech (planet)"` to match `starcitizen.tools` and the existing
  ArcCorp-style disambiguation convention) and re-parented 117 affected
  entities. Cross-checking the full `REFERENCE_SYSTEMS` roster against the
  KB found the same gap for Yela, Lyria, Wala, Magda, and nearly all of
  Pyro's planets/moons (Pyro I, Monox, Pyro V, Terminus, Vatra, Vuur, Pyro
  IV) — each existed only as a `patch_note` roadmap mention, never a real
  scraped article. `scripts/scrape-missing-stanton-pyro-bodies.ts` reuses
  the existing admin scraper's real fetch/extract/template pipeline
  (`apps/admin/src/{fetcher,extractor,template,scan}.ts`) against each
  specific starcitizen.tools URL, bypassing only the broad category gate
  (these pages are wiki-categorized "Moons"/"Planets", not "Locations" —
  the template's field-match count is the real safety net) since the URL
  list itself was manually curated against `REFERENCE_SYSTEMS`, not an open
  crawl. All 11 pages scraped successfully with real content.
