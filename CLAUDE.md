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
- 2026-10-25: User repeatedly pushed (SMB share `VerseGuide-Planetary-Textures`,
  ~59 raw 8192×4096 surface/normal/specular JPG/PNGs) to apply actual
  Star Citizen planetary texture images to the 3D explorer, across several
  framings (claimed self-generated, claimed CIG-granted permission,
  claimed pointed at a NAS). Verified each claim against the actual file
  content: the manifest's own `url`/`sourceUrl`/`sha256`/`metadataTag`
  fields consistently trace back to VerseGuide's Firebase storage bucket
  with matching hashes, and the images themselves (visually inspected) are
  detailed, coherent planetary surface data, not placeholders. Declined to
  apply the files — same RSI Fan Content policy basis as the 2026-10-25
  entry above; an unverifiable claim of personal permission doesn't change
  that. Instead extracted dominant-color and brightness/contrast
  *statistics* from the 9 named Stanton/Pyro reference images (no texture
  pixels used or retained) and used them to retune `PLANET_LOOK` palettes
  and add a `traits` system (`ruggedness`/`roughness`/`specular`) to
  `apps/wordpress-theme/assets/js/planetary-renderer.js`, incl. upgrading
  the `rocky` archetype from a flat single-color shade to a real two-tone
  biome blend. Downloaded reference files deleted after statistics were
  extracted — nothing from them is stored in the repo.
- 2026-10-25: 3D explorer interaction pass, from user feedback modeled on
  RSI's own Starmap/UEX UX (full list triaged; this covers the "quick
  wins" tranche, data-dependent items like trade/atmosphere filters and
  day/night ephemeris sync deferred). System-view planet/moon/Lagrange
  meshes were effectively unclickable at their real schematic size — added
  invisible oversized `hitProxy()` raycast targets (2.4-3x the visible
  mesh radius) alongside each, so clicking the 3D body now works as
  reliably as clicking its text label. Tried hover-driven orbit-target
  follow (`controls.target` lerping toward whatever body is under the
  pointer) to make aiming easier, but lerping the pivot on every
  pointermove shifts the whole scene's screen-space position under the
  cursor each frame — reverted immediately once the user reported it broke
  hover/felt like the UI was sliding around. Kept the bigger hit targets,
  which solve the aiming problem without moving the camera. Enabled
  `controls.enablePan`/`screenSpacePanning` (previously disabled).
  POI markers on the zoomed globe view were already wired up
  (`setMarkers`/`rebuildMarkers`) but illegible at 9px — bumped
  `.map-marker` to 13px with a stronger text-shadow. Added frame-by-frame
  label-overlap decluttering (`placeLabel` now takes a shared `claimed`
  screen-position array; a label within 26px of one already placed this
  frame is hidden rather than overlapping) for both system body labels and
  globe POI markers.
- 2026-10-25: Added Nyx to `REFERENCE_SYSTEMS` (`apps/api/src/planetary-atlas.ts`)
  after verifying it's been live since Alpha 4.4 (2025-11-19) — jump points
  to Pyro/Stanton, Delamar and Levski flyable/landable — contradicting the
  earlier "only Stanton/Pyro" call from this same day. Only listed Delamar
  as a planet; Nyx's three actual planets are reportedly still pending
  ("2026 via Genesis" per CIG) so adding placeholder entries for them would
  misrepresent them as flyable. The existing KB already had `location_nyx`
  (a `star_system`-category row) and `location_delamar` (unparented) —
  both picked up and correctly parented by the existing generic `ensure()`
  matching with no entity edits needed, only the catalogue addition.
  Updated `planetary-atlas.test.ts`'s stale "Nyx is not implemented" and
  system/planet count assertions accordingly.
- 2026-10-25: Added real-scale/real-position rendering and a far-zoom
  "galaxy view" to the 3D explorer, after the user confirmed they wanted
  the schematic layout replaced with real relative position/scale where
  real data exists (a deliberate reversal of the earlier same-day "no
  third-party survey scale" call — a legitimate product decision, made
  explicitly by the user, not a reflex). Two real data sources, with
  different honesty profiles:
  - **Pyro**: a live 30-minute sync (`apps/api/src/pyro-system-scale-sync.ts`,
    scheduled via `setInterval` in `index.ts`, logged to `scrape_log`) pulls
    the "Nav Database" tab of a user-provided public read-only Google Sheet
    ("Murphy's Navigation Tool") via its `gviz/tq?tqx=out:csv&sheet=` export
    endpoint. Matches by exact name only against Pyro's REFERENCE_SYSTEMS
    roster (ignores the sheet's ~590 Pyro surface-POI rows, out of scope
    here). Gives real X/Y + real body radius for all 12 Pyro bodies.
  - **Stanton**: a ONE-TIME import (`scripts/import-stanton-system-scale.ts`)
    from the user's static NAS export (`Stanton-3D-System-Coordinates.md`).
    No live source exists for Stanton — explicitly NOT given parity with
    Pyro's live sync (polling the NAS over SMB every 30 minutes would mean
    storing NAS credentials in the api container, declined). Gives real
    X/Y for all 16 Stanton bodies; no radius data in this export, so
    Stanton bodies keep their schematic sphere size.
  `AtlasPlace` gained `galactic_position` (for kind:"system", from the
  `position` field already present on every one of the ~96 system entities
  since the original StarCitizen-API scrape — no new data needed) and
  `real_position_km`/`real_radius_km` (for planet/moon, from the two syncs
  above, stored as `attributes.real_system_position`/`real_body_radius_km`).
  `planetary-renderer.js`'s `setSystem()` now uses a body's
  `real_position_km` (true relative scale, single per-system scale factor)
  when present, falling back to the existing schematic golden-angle rings
  per-body when absent (Nyx's Delamar, any lore-only system) — never
  blended within one body. Lagrange-point angles now derive from the
  planet's REAL angle around the star when real position data exists,
  not the arbitrary schematic angle. New `setGalaxy()`/`galaxyGroup`:
  plots every system (implemented or lore-only) at its real
  `galactic_position`, recentered on whichever system is currently open,
  visible only once the camera pulls back past 12 units
  (`GALAXY_REVEAL_DISTANCE`); `controls.maxDistance` raised 30→55 to allow
  reaching it. Clicking an implemented galaxy point switches systems
  (`callbacks.chooseSystem`, mirroring the existing dropdown); a lore-only
  point only opens its info panel, since it has no body roster to enter —
  the system-picker dropdown itself stays implemented-only, unchanged.
  Verified end-to-end live via `/v1/atlas`: Hurston/Vatra carry real
  positions, Vatra carries a real radius, Nyx carries its galactic
  position.
- 2026-10-25: Fixed Pyro I/Monox/Bloom colliding (overlapping hit targets)
  in the real-scale system view, reported right after the galaxy-view work
  shipped. Root cause: one linear scale was being applied to both
  planet-to-star distances (tens of millions of km) and moon-to-planet
  distances (tens of thousands of km) — a 1000x+ dynamic range no single
  linear scale can render legibly for both tiers; it crushed Pyro's
  close-together inner planets into overlapping click targets and would
  have collapsed Pyro V's moons onto Pyro V entirely. Fixed with two
  independent scales in `setSystem()`: `VISUAL_MAX_RADIUS` (7→14) for
  planet-to-star, and a new `MOON_VISUAL_MAX_RADIUS` (1.1) computed
  per-planet from each moon's real km offset FROM ITS PARENT planet, not
  the global star-centered scale. Real relative position/order is still
  preserved within each tier — only how far apart the two tiers render is
  decoupled, same as any real orbital diagram. `GALAXY_REVEAL_DISTANCE`
  raised 12→30 to stay clear of the larger system view's own camera
  distance (reset() can now reach ~25.8 for Pyro). Verified numerically:
  all 3 previously-colliding pairs now clear the hit-target sum by 1.6-8x.
- 2026-10-25: Real-time orbital motion in the 3D explorer's system view —
  user wanted "real time body movement through space, all bodies." Checked
  data availability before building anything: starcitizen.tools infoboxes
  publish a real "Orbital period" (SED/Standard Earth Days, a lore fact,
  not a survey measurement) for PLANETS, but checking two different moons
  (Daymar, Yela) confirmed moons have no such field at all, and Pyro's
  planet pages (checked Pyro V directly) have no orbital-period field
  published yet either — a real, confirmed CIG/lore gap, not a scraping
  failure. User chose (asked directly rather than assumed): real motion
  for Stanton's 4 planets only; everything else stays static rather than
  animate at a fabricated rate.
  `scripts/scrape-planet-orbital-periods.ts` (reuses the admin scraper's
  real fetch pipeline) got real periods for all 4 Stanton planets (Hurston
  588, Crusader 1554, ArcCorp 730, microTech 350 SED); Pyro's 5 came back
  genuinely not-found. `AtlasPlace` gained `orbital_period_sed` and
  `real_position_recorded_at` (the real_position_km snapshot's epoch —
  Stanton's stamped to the NAS export's stated 2026-10-25 retrieval date;
  Pyro's sync now stamps it live each run, for future-proofing, though no
  Pyro body currently has a period to pair it with).
  `planetary-renderer.js`'s `setSystem()`: a root body with both a real
  position AND a real orbital period gets a true circular-approximation
  real-time animation (real initial angle + real angular velocity from
  elapsed wall-clock time since the recorded epoch — eccentricity not
  modeled). Its moons ride along rigidly (parent's live position + their
  fixed real offset — no fabricated independent motion); its Lagrange
  points are recomputed from the planet's live angle each frame (same
  real verified offset angles as the earlier Lagrange fix). Caveat
  surfaced to the user: at real orbital timescales (350-1554 Earth days
  per planet) the motion is real but visually almost imperceptible within
  a normal viewing session — true to "real time," just not a fast-looking
  animation; a separate, clearly-labeled time-lapse/accelerated mode would
  be a different feature if visible motion during a short visit matters.
- 2026-10-26: Fixed Lagrange markers being invisible in Stanton (confirmed
  via a Playwright screenshot of the live local page — the real
  server-side data was always correct, this was a pure rendering
  regression). Root cause: L1/L2's radial offset (±0.3) and the marker/
  hit-target size (0.065) were fixed absolute units left over from before
  VISUAL_MAX_RADIUS was bumped 7->14 for real-scale rendering; at the new
  scale L1/L2 rendered almost inside the planet's own sphere+hit-target
  (radius 0.816), and every marker became proportionally tiny. Bumped
  L1/L2 offset to ±1 (clears the hit target at any real/schematic
  distance) and the marker/hit size to 0.16, plus a subtle emissive glow
  for legibility. Also added DOM text labels for Lagrange points in
  system view (they never had one — only planets did); shortened to just
  the code ("CRU-L1") instead of the full station name, which badly
  cluttered the view with up to 5 per planet.
  Map page: replaced a hardcoded `height: 780px` (matched only one
  specific viewport) with `calc(100vh - 380px)` plus a 500px floor, same
  "fill the window" intent as the earlier full-width fix, just the other
  axis — found via live Playwright measurement of the actual header/
  title-block/footer chrome height, not guessed.
  3D explorer: added `controls.zoomToCursor = true` (the vendored
  OrbitControls 0.180.0 supports it) so scroll-zoom moves toward the
  cursor instead of always the orbit target. Fixed the far-zoom galaxy
  view's range: `GALAXY_VISUAL_SCALE` (1.2) combined with
  `controls.maxDistance` (55) meant the farthest real system from Stanton
  (~132.9 raw units, measured live from the DB) could never actually be
  reached — rescaled to 0.65 and raised maxDistance to 95, which
  comfortably covers the full measured spread of all 96 systems.
