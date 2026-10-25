# Canonical Entity Schema — USSA Lore Master Core

Source of truth for what fields exist. Kept in sync with `/db/migrations`.
Last updated: Phase 1 (migration `0001_init.sql`).

## Storage model
Document-per-entity: one generic `entities` table with a `type` column and
structured columns for the fields we filter/sort/join on. Flexible, per-type
attributes live in the `attributes` JSONB column. There is **no** per-type
table — new attributes never require a migration.

Semantic search vectors live in a separate `embeddings` table (pgvector),
one row per entity, linked by `entity_id` / `embedding_id`.

## Entity types
`item`, `npc`, `location`, `mechanic`, `quest`, `lore`, `patch_note`,
`commodity`, `trade_route`.

(Phase 1 note: manufacturers and ship weapons are modeled as `item`-type
entities. If a dedicated `manufacturer`/`weapon` type is wanted later, add it
to the `type` CHECK constraint via a new migration and log the decision.)

## `entities` table

| field            | type          | notes |
|------------------|---------------|-------|
| id               | TEXT (PK)     | `<type>_<slug>`, e.g. `ship_carrack` |
| type             | TEXT          | one of the entity types above (CHECK) |
| name             | TEXT          | display name |
| aliases          | JSONB         | `string[]` |
| summary          | TEXT          | one/two-sentence plain summary |
| body             | TEXT          | long-form markdown |
| attributes       | JSONB         | flexible key/value; **missing = `null`, never guessed** |
| relations        | JSONB         | `[{ type, target_id }]` typed links to other entity ids |
| images           | JSONB         | `[{ url, caption, role, added_by, source_url, license_note }]` |
| source           | JSONB         | `{ origin, url, confidence, last_verified }` |
| game_version     | TEXT          | e.g. `3.23` |
| status           | TEXT          | `current` \| `deprecated` \| `removed` (CHECK) |
| freshness_class  | TEXT          | `static` \| `volatile` (CHECK); `trade_route` defaults volatile |
| ai_context       | TEXT          | **auto-generated** prose; never hand-written; regenerated on every write |
| embedding_id     | TEXT          | links to `embeddings.id` (`emb_<entity_id>`) |
| edited_by_admin  | BOOLEAN       | true once any admin content edit has ever touched this row (set only by the admin's manual-edit path; the scraper's normal publish never sets/clears it). Internal only — stripped from public `/v1` responses. |
| created_at       | TIMESTAMPTZ   | |
| updated_at       | TIMESTAMPTZ   | bumped on every write |

### Nested shapes
- **relation**: `{ "type": "manufactured_by", "target_id": "manufacturer_anvil_aerospace" }`
- **image**: `{ "url", "caption", "role": "primary"|"gallery", "added_by": "scraper"|"admin", "source_url", "license_note" }`
- **source**: `{ "origin", "url", "confidence": "confirmed"|"community"|"speculative", "last_verified": "YYYY-MM-DD" }`

### Indexes
- btree on `type`, `game_version`, `status`
- GIN on `attributes`, `relations`
- GIN full-text index over `name + summary + body + ai_context`

## `embeddings` table (pgvector)

| field       | type         | notes |
|-------------|--------------|-------|
| id          | TEXT (PK)    | `emb_<entity_id>` |
| entity_id   | TEXT (FK)    | → `entities.id`, `ON DELETE CASCADE` |
| vector      | vector(384)  | all-MiniLM-L6-v2 dimensionality |
| provider    | TEXT         | `Xenova/all-MiniLM-L6-v2` or `hashed-fallback` |
| source_text | TEXT         | the `ai_context` text that was embedded |
| created_at  | TIMESTAMPTZ  | |

- ivfflat cosine index on `vector`.

## `api_keys` table
Per-client keys (`wiki`, `mobile`, `desktop`, `discord`, `twitch`, `portal` —
migration `0012_portal_api_key_client.sql`). Stores a SHA-256 hash of the
bearer token, a per-client `rate_limit_per_min`, and an `enabled` flag. Tokens
are never stored in plaintext. `portal` is deliberately distinct from `wiki`:
it's the only client `POST /v1/trade-routes/submit` trusts to assert
`rsi_verified` (see below) — keeping the RSI-verification-gated WordPress
portal path distinguishable from the shared `wiki` key, which the fully
anonymous trade-submit app also uses.

## `api_audit_log` table
One row per authenticated `/v1` request: `client`, `api_key_id`, `method`,
`path`, `status_code`, `ip`, `created_at`. Enables per-client auditing.

## `feedback` table
`POST /v1/feedback` sink: `entity_id`, `client`, `kind`, `message`, `payload`.

## `trade_route_submissions` table
Community-submitted routes: `commodity`, `from_location`, `to_location`,
`buy_price`, `sell_price`, `profit_per_unit`, `submitted_by`, `status`
(`pending`/`confirmed`/`rejected`), `confirmations`, `last_verified`.
Confirmed rows are what `GET /v1/trade-routes` returns. Marked volatile —
short cache TTL and `last_verified` age always surfaced.

### Phase 3 additions (migration `0003_trade_corroboration.sql`)
Submission intelligence columns added to the same table:

| field                | type    | notes |
|----------------------|---------|-------|
| confidence           | TEXT    | ladder: `community` → `corroborated` → `confirmed` (CHECK). New submissions default `community` — never `confirmed`. |
| corroboration_count  | INT     | independent matching reports (starts at 1) |
| submitter_account    | TEXT    | reporting user/handle (distinct from the API client key) |
| contributor_accounts | JSONB   | `string[]` of accounts that have reported this route (used to detect self-corroboration) |
| price_history        | JSONB   | append-only `[{ buy_price, sell_price, profit_per_unit, account, reported_at, event }]`; older values are **never discarded**. `event` ∈ `initial`/`corroboration`/`conflict-superseded`/`conflict-new`/`self-repeat-ignored` |
| flagged              | BOOL    | true when an abuse pattern was detected (held for manual review, not auto-trusted) |
| flag_reason          | TEXT    | human-readable reason(s) |
| commodity_entity_id / from_entity_id / to_entity_id | TEXT | normalized links to existing entities (null if no confident match — no duplicate entity is created) |
| route_key            | TEXT    | normalized `commodity|from|to` used to group corroborating reports |

Confidence ladder rules: a new route starts `community` (or `corroborated` for
a verified submitter — see below); an independent report with a matching
price (within `TRADE_PRICE_TOLERANCE`) inside `TRADE_CORROBORATION_WINDOW_MIN`
steps it up and refreshes `last_verified`; a conflicting price supersedes the
current value (archiving the old one to `price_history`) and resets
confidence to `community` (or `corroborated` for a verified submitter); an
explicit `/confirm` sets `confirmed`.

### Phase 10 additions (migration `0011_trade_route_verified_submitter.sql`)

| field                | type    | notes |
|----------------------|---------|-------|
| rsi_verified         | BOOL    | `true` if this route's data came from (or was ever corroborated by) an RSI-handle-verified WordPress account, via the portal's gated `[ussalmc_trade_submit]`. Default `false`. Sticky — once set `true` it never reverts to `false`. |
| rsi_verified_handle  | TEXT    | the verified RSI handle responsible, when `rsi_verified=true`; `null` otherwise |

A verified submitter's report starts a **new** route at `corroborated`
confidence (skipping the anonymous `community` stage — we already know it's a
real, specific citizen) and resets a **conflicting** report to `corroborated`
too, rather than `community`. This is purely additive metadata for
transparency (per the cross-phase rule: never present something as more
trustworthy than it actually is without saying why) — it does not add a new
confidence-ladder value.

### `trade_submission_events` table (Phase 3)
Per-account audit for rate limiting + abuse detection:
`account`, `client`, `ip`, `route_key`, `submission_id`,
`action` (`submit`/`corroborate`/`conflict`/`flag_abuse`/`rate_limited`/`confirm`),
`buy_price`, `sell_price`, `detail` JSONB, `created_at`.
Rate limit: `TRADE_RATE_LIMIT_PER_MIN` submissions/min per account.
Abuse flags: implausible prices (>`TRADE_MAX_PLAUSIBLE_PRICE`, negative, or
sell<buy) and self-corroboration (same account reporting a route it already
contributed to).

## AI context generation (invariant)
`ai_context` is produced by `apps/api/src/ai-context.ts` from the structured
fields, with every relation `target_id` resolved to the target's display name
(e.g. "manufactured by Anvil Aerospace"). It is regenerated — together with
the embedding — on **every** create/update via the single `upsertEntity`
publish path, so it can never drift from the source fields. Run
`scripts/regenerate.ts` to rebuild all of them (e.g. after a model change).

## Phase 2 tables — admin scraper + review (migration `0002_admin_scraper.sql`)

### `scrape_templates`
Reusable extraction template keyed by `(category, domain)` — UNIQUE on that pair.
Field rules match by **label text / structural role**, never CSS paths.

| field         | type    | notes |
|---------------|---------|-------|
| id            | TEXT PK | `tpl_<category>_<domain>_v<N>` |
| category      | TEXT    | e.g. `ship` |
| domain        | TEXT    | e.g. `starcitizen.tools` |
| entity_type   | TEXT    | target `entities.type` (default `item`) |
| field_map     | JSONB   | `[{ field_name, match_by, label, where, is_image, role, target, relation_type }]` |
| match_signals | JSONB   | `{ categories:[], title_patterns:[], label_hints:[] }` used to recognize a page |
| clean_streak  | INT     | consecutive clean confirms (trust threshold) |
| auto_publish  | BOOL    | true once `clean_streak >= 3`; reset to 0/false on any edit or mismatch |

### `review_queue`
Every extracted/changed entity passes diff → review → publish through here.

| field           | type    | notes |
|-----------------|---------|-------|
| id              | BIGSERIAL PK | |
| source_url      | TEXT    | page the draft came from |
| domain/category | TEXT    | |
| template_id     | TEXT    | template used (nullable) |
| entity_id       | TEXT    | target entity id (`ship_<slug>`) |
| proposed        | JSONB   | full entity draft (UpsertInput) |
| diff            | JSONB   | field-level change vs the current live entity |
| link_suggestions| JSONB   | fuzzy cross-category link candidates |
| status          | TEXT    | `pending`/`published`/`mismatch`/`rejected`/`auto_completed` (CHECK) |
| auto_published  | BOOL    | true if published straight through by trust threshold, variance re-weigh, or manual auto-complete |
| note            | TEXT, created_at, published_at | |
| variance        | NUMERIC | (Phase 5) % of expected template fields that deviate on this page vs the category template at enqueue time |
| variance_detail | JSONB   | (Phase 5) `{ expected, missing, unmatched, structural, deviations, variance_pct, detail:[{field_name,label,kind,detail}] }` |
| extraction      | JSONB   | (Phase 5) the field-candidate extraction snapshot, so the queue can be re-weighed against an updated template **without re-fetching** |
| routed_reason   | TEXT    | (Phase 5) why the item is where it is: `high_variance`/`auto_publish`/`awaiting_trust`/`category_mismatch`/`reweigh_within_threshold`/`template_solved: …` |

`auto_completed` = a queued item resolved automatically by a queue **re-weigh**
(see Phase 5) rather than a reviewer clicking approve; the entity is published via
the same `upsertEntity` path, and the row is stamped `auto_published=true`.

### `scrape_log`
Append-only audit of scraper actions, always with source URL + timestamp:
`action` ∈ `scan`/`confirm`/`apply`/`publish`/`mismatch`/`robots_block`/`image_add`
/`variance_route`/`reweigh`/`auto_complete`/`template_refine`/`category_threshold`
/`batch_start`/`discover`/`categorize`/`link_add`/`link_remove`,
plus a JSONB `detail`.

## Image provenance & licensing (Phase 2)
Scraped images are stored with `added_by='scraper'` and a `license_note` of
"REVIEW REQUIRED: scraped image, likely copyrighted" and are never
auto-published publicly without review. Admin-added images use
`added_by='admin'` with a "verify license before public use" note.

## `admin_users` table (migration 0004, extended by 0007) — admin login
DB-backed admin authentication (replaces static Basic auth). Columns:
`username` (PK), `password_hash` (scrypt `salt:hash`), `must_change_password`
(bool, forces a password change on first login), `is_dev_credential` (flags the
bootstrapped account), `role` (`admin` default | `super_admin`, migration
0007), `email` (nullable, unique when set — matched against a WordPress
user's email for SSO), `created_at`, `updated_at`, `last_login_at`.
Bootstrapped from ADMIN_USER/ADMIN_PASSWORD/ADMIN_EMAIL on admin start; the
bootstrap account is always `role='super_admin'` (re-asserted on every
restart). Sessions are in-memory (cookie), and carry the role so it doesn't
need a DB lookup on every request.

**Role enforcement** — the only place role currently changes server behavior:
hard-deleting an entity (`POST /admin/entities/:id/hard-delete`) requires a
single `confirm:true` for `super_admin` vs. typing the exact entity name for
`admin`. Additional admin accounts (and their role/email) are created via
`POST /admin/admins`, super_admin-only.

## `entity_audit_log` table (migration 0007, extended 0010) — destructive-change audit trail
One row per soft-delete/restore/hard-delete/**connector force-overwrite**,
snapshotting the **full entity** at the moment of the action (so none of
these is ever a silent, unrecoverable-without-a-trace loss): `id`,
`entity_id` (no FK — the row may no longer exist after a hard delete),
`action` (`soft_delete`/`restore`/`hard_delete`/`connector_force_overwrite`),
`snapshot` (JSONB, the full entity object as it was right before the action),
`performed_by` (admin_users username, or the bulk-import job_key for a
connector overwrite), `created_at`.

### Tiered delete (concept)
- **Soft delete** ("Remove entry"): sets `entities.status='removed'`. The
  public API (`GET /v1/entities*`) excludes/404s removed entities, which is
  what makes this actually take effect for every reader (WordPress rendering,
  `/ai-context`, category counts) — not just a status label. Restorable via
  `POST /admin/entities/:id/restore` (sets `status='current'`).
- **Hard delete**: `DELETE FROM entities` (embeddings cascade via
  `ON DELETE CASCADE`). No restore — the `entity_audit_log` snapshot is what's
  left. Friction scales with role (see above).

## Phase 5 tables — category taxonomy + variance (migration `0005_categories_variance.sql`)

### `categories` — the category/subcategory taxonomy tree
A display hierarchy over the existing flat category slugs. Leaf `slug`s match the
values used in `attributes.category` on entities and in `scrape_templates.category`
exactly, so the tree layers structure over the current model **without moving any
entity data**. Grouping nodes (`is_group=true`) are branch labels only (Vehicles,
Organizations, …) and carry no template/threshold.

| field                   | type      | notes |
|-------------------------|-----------|-------|
| slug                    | TEXT PK   | leaf slug (`ship`, `weapon`, …) or group slug (`grp_vehicles`) |
| display_name            | TEXT      | shown in the tree |
| parent_slug             | TEXT FK   | → `categories.slug` (`ON DELETE SET NULL`); NULL = top-level |
| is_group                | BOOL      | true = grouping node (no entities/template of its own) |
| variance_threshold_pct  | NUMERIC   | per-category variance threshold; **NULL = use the configured default** (`SCRAPER_VARIANCE_THRESHOLD_PCT`, default 40) |
| description             | TEXT      | (migration 0006) optional admin-editable description |
| sort_order              | INT       | tree ordering |
| created_at / updated_at | TIMESTAMPTZ | |

Seeded with 6 groups + the 12 existing leaf categories. Admin-edited thresholds
survive re-running the migration (`ON CONFLICT DO NOTHING` on the seed rows).
The taxonomy is fully editable from the admin Categories page (migration 0006 +
Phase 6): create/rename/describe/reparent/delete. Reparenting is cycle-guarded;
the 12 canonical leaf slugs can't be deleted (templates/entities key on them),
and a node can't be deleted while it has children or assigned entities.

### `entities.source.hidden` (Phase 6, admin "hide source")
`source` may carry an optional boolean `hidden`. When true, the public `/v1`
serializer suppresses `source.origin` and `source.url` but keeps `confidence` +
`last_verified` (every fact still carries its confidence, per the cross-phase
rule). The `hidden` flag itself is stored internally and never appears in the
`/v1` payload. Toggled from the entity edit form.

### Variance measure (concept, not a column of its own)
With a page's category assigned **first**, variance compares the page's detected
fields to that category's **current** template and is the percentage of expected
(non-ignore) template fields that *deviate*: **missing** (template expects it, page
lacks it), **unmatched** (present but empty/null), or **structural** (present but in
a different structural place than the template learned it, e.g. side info box vs
body text). `variance_pct = round(deviations / expected * 100)`.

- **LOW** (`variance_pct ≤ threshold`): proceed per the category's current mode
  (manual-confirm, or auto-publish if past the trust threshold).
- **HIGH** (`variance_pct > threshold`): route to the review queue **regardless of
  trust status** — this specific page doesn't match the template well enough to
  publish blindly ("too many variables changed").

### Re-weigh mechanism (one mechanism, two triggers)
Whenever a template **changes for any reason**, the category's pending queue is
re-judged against the updated template using each item's stored `extraction`
snapshot (no re-fetch). Items now within threshold **auto-complete** (status
`auto_completed`, published via the same `upsertEntity` path + audit logging as the
trust-threshold fix); items still over threshold stay `pending`. The two triggers:
1. **Trust threshold crossed** — `clean_streak` reaching 3 flips `auto_publish` on
   (`pipeline.publishQueueItem` → re-weigh hook).
2. **Template solved/refined** — an admin editing a template's `field_map` from the
   category management page (`/admin/templates/:id/refine` → re-weigh).

## Field corroboration + corrections tables (migration `0008_field_corrections.sql`)
Field-level "green confirm" / "red flag" signals submitted from a live wiki
page — distinct from the scraper's `review_queue`. Public endpoints:
`POST /v1/entities/:id/fields/{confirm,flag}` (see `/docs/api.md`).

### `field_confirmations` — corroboration signals ("this is right")
No review step; just a count. `id`, `entity_id` (FK, `ON DELETE CASCADE`),
`field_name` (`name`/`summary`/`body`/`attr:<key>`), `current_value` (the
value at the time it was confirmed), `submitted_by` (WordPress username, or
`'anonymous'` when logged out), `ip`, `created_at`.

### `field_corrections` — proposed corrections ("this is wrong"), reviewed
`id`, `entity_id` (FK, `ON DELETE CASCADE`), `field_name`, `current_value`,
`suggested_value`, `note`, `submitted_by`, `ip`, `status`
(`pending`/`accepted`/`rejected`), `reviewed_by`, `reviewed_at`, `created_at`.
Accepting (`POST /admin/corrections/:id/accept`) applies `suggested_value` to
the entity via `updateEntity` (regenerates `ai_context` + embedding);
rejecting makes no entity change. Both are logged to `scrape_log`
(`correction_accept`/`correction_reject`) with full attribution
(`submitted_by` = who flagged it, `reviewed_by` = who decided).

### `wiki_signal_events` — rate-limit/abuse audit for confirm/flag
Mirrors `trade_submission_events` (Phase 3) for the same reason: `id`,
`submitted_by`, `ip`, `entity_id`, `field_name`, `action`
(`confirm`/`flag`/`rate_limited`), `created_at`. Rate limit is
`WIKI_SIGNAL_RATE_LIMIT_PER_MIN` (default 10) submissions/min per
`submitted_by`.

### Username attribution (concept, not a column of its own)
The WordPress plugin (`apps/wordpress-plugin/inc/corroboration.php`) attributes
every confirm/flag to `wp_get_current_user()->user_login` when logged in, else
the literal string `'anonymous'` — never a client-supplied value the browser
could forge as someone else's identity (WordPress's own session determines it
server-side, in the AJAX handler, not from anything the request body claims).

## Phase 10 — UEX commodity trade data (enrichment only, no migration)

`apps/admin/src/import-uex-commodities.ts` enriches existing `commodity_*`
entities (wiki-scraped, unchanged summary/body/images) with real per-terminal
trade data from UEX Corp (`https://uexcorp.space`, unofficial fan project,
unaffiliated with CIG/RSI). Matches by normalized name against the 166
existing commodity entities — never creates a new entity on a miss, same
rule as ship enrichment. Adds to `attributes`:

| field                    | meaning |
|--------------------------|---------|
| `uex_best_sell_price`    | highest real price a terminal is actively paying right now |
| `uex_best_sell_terminal` | which terminal |
| `uex_best_buy_price`     | lowest real price a terminal is actively charging right now |
| `uex_best_buy_terminal`  | which terminal |
| `uex_terminal_count`     | how many terminals trade this commodity at all |
| `uex_last_updated`       | ISO timestamp of the most recent real price update across all terminals for this commodity — trade data is volatile per the cross-phase rule, so this always travels with the price, never presented as a flat undated fact |
| `uex_commodity_id`       | UEX's numeric commodity id — needed to query per-terminal price history (below); not itself displayed |
| `uex_best_sell_terminal_id` | UEX's numeric terminal id for `uex_best_sell_terminal` — same purpose |
| `uex_best_buy_terminal_id`  | UEX's numeric terminal id for `uex_best_buy_terminal` — same purpose |

Run manually (`npm run import-uex-commodities` inside the admin container) —
not on a schedule; re-run whenever fresh trade data is wanted. Rerunning
after adding the three `*_id` fields above required one rebuild of the
`admin` image first, since `apps/admin` is baked into the image rather than
bind-mounted (unlike the WordPress plugin/theme code, which is bind-mounted
and takes effect immediately on save).

### Phase 10b — live price-history + trade-location panel (entity page, no migration)

Investigated what else UEX's API exposes beyond the "current best price"
snapshot above, per a request for graphs and "where the last submitted
trades were made": `commodities_prices_history?id_commodity=&id_terminal=`
(both required — UEX has no bulk/cross-terminal history endpoint) returns
real historical per-terminal snapshots, each carrying its own price **and**
full location hierarchy (`star_system_name`, `planet_name`, `city_name` /
`space_station_name` / `outpost_name`, `terminal_name`) plus a
`date_added` timestamp. This directly answers both asks (a real time series
to chart, and the location of each historical trade point) without a new
migration — it's fetched live, not stored.

`apps/wordpress-plugin/inc/fetch.php`:
- `ussalmc_wiki_uex_price_history( $id_commodity, $id_terminal, $limit )` —
  calls UEX live, server-side, using the same Bearer key the portal ticker
  uses (shared `wp_options` row `ussalmc_uex_api_key`, since both plugins
  live in one WordPress install with one options table); cached in a
  10-minute transient per commodity+terminal pair to stay well inside UEX's
  120/min & 172,800/day limit. Scoped to the commodity's existing
  **best-sell terminal only** (not all terminals the commodity trades at —
  UEX has ~2,594 commodity+terminal pairs total, which would be
  impractical to pull per-page-load; the best-sell terminal is already the
  one surfaced in the "LIVE TRADE DATA" panel, so the chart/table stay
  consistent with what's already shown).
- `ussalmc_wiki_render_uex_sparkline_svg( $history )` — renders the series
  as an inline SVG line (no chart library, no external request), skipped
  entirely if there are fewer than 2 real data points.

Both entity templates (`apps/wordpress-plugin/templates/entity.php` default,
`apps/wordpress-theme/ussalmc-wiki/entity.php` theme override) add panels
below "LIVE TRADE DATA" when history exists: a "SELL PRICE TREND" sparkline
chart and a "RECENT SELL ACTIVITY & LOCATIONS" table (when, system › planet
› city, terminal, sell price) — most-recent-first, each row carrying its own
age via the same `ussalmc_wiki_time_ago_from_iso()` used elsewhere, per the
volatile-trade-data rule. Verified live on `commodity_gold` (7 real
historical points at TDD Area 18, Stanton › ArcCorp › Area 18).

### Phase 10c — buy-side trend/table + full terminal list (entity page, no migration)

Follow-up: the sell-side chart/table above was only half the picture, and
"TERMINALS TRADING: 27" was shown as a bare count with no way to actually see
those 27 terminals. Filled both gaps, live-fetched, still no migration:

- `ussalmc_wiki_render_uex_sparkline_svg()` generalized to take a `$field`
  param (`price_sell` or `price_buy`) instead of hardcoding sell, so the same
  renderer draws both lines (amber for buy, matching the amber freshness/age
  color elsewhere, vs. the existing blue signal color for sell).
- A second `ussalmc_wiki_uex_price_history()` call at the commodity's
  **best-buy terminal** (not the sell terminal — a different terminal, so a
  separate history fetch, cached under its own transient key) feeds a
  "BUY PRICE TREND" chart and a "RECENT BUY ACTIVITY & LOCATIONS" table,
  mirroring the sell-side ones exactly.
- New `ussalmc_wiki_uex_all_commodity_terminals( $id_commodity, $limit )` —
  fetches UEX's full `commodities_prices_all` feed (the same one the
  enrichment importer and portal ticker use; the endpoint doesn't support
  server-side filtering by commodity despite accepting an `id_commodity`
  param — confirmed live, it's silently ignored), filtered client-side to
  the current commodity, sorted by best real sell price first. Cached in
  ONE shared 5-minute transient (`ussalmc_uex_prices_all_raw`) reused across
  every commodity page hit in that window, not fetched per-commodity —
  the raw feed is ~2,600 rows regardless of which commodity is being
  filtered, so there's no reason to fetch it more than once per cache
  window. Renders as an "ALL TERMINALS TRADING <NAME> (N)" table: terminal,
  sell price, buy price, stock (SCU), updated age — `null` price (not `0`)
  when that terminal isn't actively trading that side (`status_sell`/
  `status_buy` = 0 in the source data), never a fabricated zero.

VERIFIED live on `commodity_gold`: BUY PRICE TREND renders (flat line at
24,360 aUEC — real data, HDMS-Anderson's buy price hasn't moved across its
history window, not a rendering bug); RECENT BUY ACTIVITY & LOCATIONS shows
3 real dated entries at Stanton › Hurston › HDMS-Anderson; ALL TERMINALS
TRADING GOLD (27) lists all 27 real terminals with real prices/stock/ages,
sorted 31,000 aUEC (TDD Area 18) down to terminals only buying, not selling.

## Phase 10 — StarCitizen-API import (no schema migration; new `categories` rows only)

New leaf categories (plain data rows, same mechanism the admin category
manager already uses — no migration needed): `organization` (under
`grp_organizations`), `star_system` / `jump_point` (under `grp_world`),
`species` / `affiliation` / `roadmap` (under `grp_meta`). All content comes
from the community StarCitizen-API (`https://starcitizen-api.com`), never
from fetching `robertsspaceindustries.com` directly — see `docs/api.md`'s
Organizations section and `apps/admin/src/import-starcitizen-api.ts`.

| category      | base `type`  | id scheme                          | source |
|----------------|--------------|--------------------------------------|--------|
| `star_system`  | `location`   | `location_<slug(name)>`              | bulk import (`--systems`) |
| `jump_point`   | `location`   | `location_jump_<sc_api_id>`          | bulk import (`--tunnels`); `relations` (`connects_from`/`connects_to`) reference the two endpoint `star_system` entities, resolved via each system's `attributes.sc_api_id` |
| `species`      | `lore`       | `lore_species_<slug(name)>`          | bulk import (`--species`) |
| `affiliation`  | `lore`       | `lore_affiliation_<slug(name)>`      | bulk import (`--affiliations`) |
| `roadmap`      | `patch_note` | `patch_note_roadmap_<slug(name)>_<sc_api_id>` | bulk import (`--roadmap`) — CIG's public dev roadmap, distinct from actual shipped `patch_note` entries which share the same base `type` |
| `ship`         | `item`       | *(existing `ship_*` ids, unchanged)* | `--ships` **enriches** existing wiki-scraped ship entities' `attributes` (mass, dimensions, crew, price, production_status, etc.) by normalized-name match — never creates a new ship entity on a miss |
| `organization` | `item`       | `item_org_<slug(sid)>`               | **not** bulk-imported — only ever created via `POST /v1/organizations/submit`, triggered exclusively by a member's successful RSI-handle verification (see `docs/api.md`) |

`import-starcitizen-api.ts` uses `mode=cache` exclusively (unlimited per the
API's own docs) — none of this competes with the portal's `live`/`eager`
verification-check quota (1000/day, shared across the whole site).

## Phase 9 tables — connector force-overwrite import (migration `0010_force_overwrite_import.sql`)

### `bulk_import_jobs` — one row per bulk-import job (resumable across processes)
`id`, `job_key` (TEXT, UNIQUE — re-running the same key resumes instead of
restarting), `categories` (JSONB string array), `force_overwrite` (BOOLEAN),
`status` (`running`/`paused_rate_limit`/`done`/`error`), `summary` (JSONB —
running per-category `created`/`overwritten_clean`/`overwritten_manual`
counts, kept current even if the process exits mid-run), `created_at`,
`updated_at`.

### `bulk_import_progress` — one row per URL the job has finished with
`(job_id, url)` PK, `category`, `status` (`done`/`skipped`/`error`),
`outcome` (`created`/`overwritten_clean`/`overwritten_manual`/null),
`entity_id`, `note`, `processed_at`. A resumed run (same `job_key`) skips any
URL already present here, so a rate-limit pause never re-fetches or
re-overwrites already-processed pages.

### Rate limiting (concept, not a table of its own)
The bulk-import job counts its own `scrape_log` rows (`action =
'bulk_import_fetch'`) over rolling 60-second/24-hour windows before each
fetch — 40/min, 500/day (`SCRAPER_BULK_IMPORT_RATE_PER_MIN` /
`SCRAPER_BULK_IMPORT_RATE_PER_DAY`, `.env.example`). Hitting the daily cap
sets the job to `paused_rate_limit` and exits cleanly; re-running with the
same `job_key` resumes. This is scoped to the bulk-import job specifically —
it does not change the scraper's existing flat 1-second politeness gap used
by ordinary scan/confirm/category-batch runs.

### Phase 10d — uniform trade-data statistic reporting across all commodity pages (no migration)

Compared our commodity page layout directly against UEX Corp's own commodity
detail page (`uexcorp.space/commodities/info/name/<slug>/`, screenshotted
live) per an explicit request to match its statistic-reporting structure.
Two real differences, both fixed:

1. **UEX always renders the same section skeleton** for every commodity —
   even a thinly-traded one (2 terminals) still shows every stat box and
   chart panel, with `—`/empty placeholders where a particular commodity has
   no data, rather than the section disappearing. Our pages previously
   varied structurally: enriched commodities (120/166) showed the full set
   of sections, unenriched ones (46/166) showed NONE of them (the whole
   trade-data area was simply absent). Fixed: any entity whose
   `category === 'commodity'` now always renders all six sections (LIVE
   TRADE DATA, SELL PRICE TREND, BUY PRICE TREND, RECENT SELL ACTIVITY &
   LOCATIONS, RECENT BUY ACTIVITY & LOCATIONS, ALL TERMINALS TRADING) in the
   same order — each showing real data when present, or a plain "No ... yet"
   line when not — so every commodity in the KB reports the identical set
   of statistics regardless of how much real UEX data exists for it.
2. **UEX computes Profit/SCU, Margin %, and ROI %** from its best sell/buy
   pair; we didn't. Added `ussalmc_wiki_uex_profit_metrics( $trade )`
   (`apps/wordpress-plugin/inc/fetch.php`) — `profit = sell - buy`,
   `margin = profit / sell * 100`, `roi = profit / buy * 100` — verified
   against UEX's own live Osoian Hides page (sell 870,000, buy 283,500 ->
   UEX reports profit 586,500 / margin 67.4% / ROI 206.9%; our formula
   reproduces the same three numbers exactly). `null` (never a fabricated
   0%) when either price is missing. Added as three more stat tiles in the
   existing LIVE TRADE DATA grid.

Deliberately NOT replicated: UEX's "Datarunner Reports" monthly submission-
count bar chart and its per-orbit/per-system Availability & Volume donut
charts — those come from UEX's own community-report/analytics dataset, not
the public price-history endpoints already integrated, and would require
either fabricating data or a new, unverified data source. Out of scope for
"match the layout of the page" without inventing numbers we can't source.

VERIFIED live: `commodity_gold` (enriched) now additionally shows PROFIT /
SCU 6,640 aUEC, MARGIN 21.4%, ROI 27.3% (31,000 sell − 24,360 buy, correct
arithmetic) alongside its existing full data; `commodity_biological_samples`
(one of the 46 unenriched commodities, previously showed NO trade-data
section at all) now shows the full six-section skeleton with "No ... yet"
placeholders in every section, matching the structure of every other
commodity page.

### Phase 10e — clickable ticker cards (portal plugin, no migration)

`[ussalmc_ticker]` cards (`apps/wordpress-portal-plugin/inc/uex-ticker.php`)
now link to their commodity's KB entity page. `ussalmc_portal_commodity_entity_map()`
calls the core API (`GET /v1/entities?category=commodity&limit=200` — one
page covers all 166 real commodity entities) via the SAME `ussalmc_portal_api_get()`
client the rest of the portal plugin already uses (shares the wiki plugin's
Bearer key, per the existing convention in `inc/api.php`), builds a
normalized-name -> entity-id map, and caches it alongside the ticker's own
data (same `UEX_TICKER_CACHE_TTL`, default 300s). `ussalmc_portal_render_flip_card()`
renders a card as `<a href="/wiki/?entity=<id>">` when its commodity has a
real KB match, or a plain non-clickable `<div>` when it doesn't (not every
real UEX commodity has been scraped into the KB — see the enrichment
importer's unmatched list) — never links to a page that doesn't exist.

VERIFIED live: 328 of ~344 rendered card instances are real clickable links,
16 remain plain (commodities UEX tracks that aren't yet in the KB); spot-
checked via Playwright — hovering a row pauses its scroll (pre-existing
behavior), and clicking a fully-visible card navigates to the correct real
commodity page (e.g. a "Party Favors" ticker card -> `commodity_party_favors`,
title and content confirmed matching).

## Phase 11 — UEX trade route import (`trade_route` entities, no migration)

`apps/admin/src/import-uex-trade-routes.ts` imports real computed buy/sell
routes from UEX Corp's `commodities_routes` endpoint (`GET
/commodities_routes?id_commodity=<id>` — requires exactly one commodity per
call; no bulk/all-commodities mode) into the KB as `trade_route` entities.
Unlike commodity enrichment (which only ever merges attributes onto an
existing scraped entity), this importer CREATES entities — nothing was ever
scraped for "trade routes" before — using UEX's own numeric route `id` in
the entity id (`trade_route_uex_<id>`) so re-running the script upserts the
same rows instead of duplicating them. `trade_route` was already an allowed
`type` (and defaults to `freshness_class='volatile'`) per the original
schema — no migration needed.

Scope: for each of the 120 UEX-enriched commodity entities (has a real
`uex_commodity_id`), fetch its routes, keep only PROFITABLE ones
(`profit > 0` — UEX returns every terminal-pair combination including many
negative-margin ones that aren't a real "trade route"), sort by UEX's own
`score` ranking, take the top 3 per commodity (`--top=N` overrides). First
real run: 8,869 real routes seen, 1,259 unprofitable filtered out, 213
created (73/120 commodities had at least one profitable route — the other
47 only had 1-2 real terminals for that commodity, matching the earlier
Phase 10c finding, so no meaningful "route" exists to compute).

**Important field-meaning correction caught before calling this done**: UEX's
`profit`/`investment` fields are TOTALS for the whole reachable cargo run
(`(sell_price - buy_price) * scu_reachable`), not per-SCU figures, despite
reading like one — confirmed live against two real routes (e.g. 218 aUEC/SCU
x 250,000 SCU = 54,500,000, exactly UEX's own reported `profit`). Stored
BOTH, clearly separated: `profit_per_scu` (computed ourselves: `sell_price -
buy_price`) and `profit_total` (UEX's raw `profit` field, i.e. for
`scu_reachable` units) — an earlier draft of this importer mislabeled the
total as `profit_per_scu` and wrote a misleading "aUEC/SCU" summary sentence;
caught by spot-checking the arithmetic before considering the import done,
fixed, and the same entities re-upserted with corrected data.

Attributes stored per route: `commodity_name`, `commodity_entity_id` (link
to the KB commodity, not shown as a stat — internal linkage), `origin_terminal`,
`origin_location`, `destination_terminal`, `destination_location`, `buy_price`,
`sell_price`, `profit_per_scu`, `profit_total`, `margin_pct`, `roi_pct`,
`distance`, `score`, `investment_total`, `scu_reachable`, `uex_route_id`
(internal, hidden), `uex_last_updated`. `confidence: 'community'` (UEX is
unofficial/community-maintained, same framing used everywhere else this
session), `freshness_class: 'volatile'`.

### Entity-page display fix (both templates)

The generic SPECIFICATIONS stats loop unconditionally hid any `uex_*`
attribute, on the assumption only commodities carry them (which get their
own dedicated LIVE TRADE DATA panel elsewhere on the page). `trade_route`
entities have no such panel, so `uex_last_updated` was being silently
dropped entirely — violating the volatile-data rule that this data must
always show its age. Fixed: the `uex_*` skip now only applies when
`$is_commodity` is true; `uex_last_updated` renders as a normal stat with
label "LAST OBSERVED" and a humanized age (`ussalmc_wiki_time_ago_from_iso()`)
instead of a raw ISO timestamp; `uex_route_id` and `commodity_entity_id`
(internal linkage, not reader-facing) stay hidden for every entity type.

VERIFIED live on `trade_route_uex_838` (Waste: Admin - Nyx Gateway (Stanton)
→ Admin - Everus Harbor): renders centered, all real fields present and
correctly labeled, "LAST OBSERVED — Updated 1h ago" visible, confidence
COMMUNITY, source uex_corp.

## Phase 12 — weapon shop-price enrichment (no migration, NOT filed under commodities)

User feedback: weapons must not be filed under the `commodity` category (they
aren't bulk tradeable raw goods, sold by SCU — they're shop-purchased
equipment, sold per-unit) but their current price still needs tracking.
UEX Corp tracks shop items on a completely SEPARATE feed from commodities —
`items_prices_all` (24,140 rows, 2,827 distinct items covering weapons,
armor, gadgets, ship components, everything sold in a shop), shaped
differently from `commodities_prices_all` (no `status_buy`/`status_sell`
flags; a positive price IS the "actively available" signal).

`apps/admin/src/import-uex-weapon-prices.ts`: same enrichment-only pattern
as commodities/ships — matches by normalized name against the 149 existing
wiki-scraped `weapon`-category `item` entities, merges real shop-price
attributes, never touches `attributes.category` (stays `weapon`, never
becomes `commodity`), never creates a new entity on a miss. Adds
`uex_item_id`, `uex_best_buy_price` / `uex_best_buy_terminal` (cheapest real
shop to acquire it), `uex_best_sell_price` / `uex_best_sell_terminal`
(best real sell-back price), `uex_terminal_count`, `uex_last_updated` — same
attribute vocabulary as the commodity importer, but on `item`/`weapon`
entities the generic entity template shows them as plain SPECIFICATIONS
stats (no dedicated commodity-style panel — that panel is gated to
`category === 'commodity'` specifically and correctly does NOT fire for
weapons). `freshness_class` deliberately left as-is (not forced to
`volatile`) to match the existing commodity importer's behavior exactly.

First real run: 84/149 weapon entities matched and enriched (65 had no real
UEX shop listing — mostly newer/limited weapons UEX doesn't track yet, left
untouched, not fabricated).

Also excluded three more purely-internal linkage fields from the generic
SPECIFICATIONS display (both entity templates) that this import surfaced as
noise: `uex_item_id`, `uex_best_buy_terminal_id`, `uex_best_sell_terminal_id`
— same treatment as the existing `uex_route_id`/`commodity_entity_id`
exclusions from Phase 11.

VERIFIED live on `item_attrition_1_repeater`: breadcrumb correctly reads
"WEAPON" (not "COMMODITY"); real price data present (best buy 10,241 aUEC @
Hurston Dynamics Showcase, 13 terminals, "LAST OBSERVED — Updated 13d ago")
alongside the weapon's original scraped specs (DPS, range, damage, etc.);
no internal ids leaking into the display.

## Phase 13 — roadmap category listing crash fix (data bug + defensive fix)

User reported `?category=roadmap` claimed 854 entities but listed none.
Root cause: `import-starcitizen-api.ts`'s `importRoadmap()` stored the raw
RSI media object StarCitizen-API returns for a card's thumbnail
(`{ id, urls: { rect, large, source, square } }`) directly as
`images[0].url`, instead of extracting a real URL string — a schema
violation (`docs/schema.md`'s image shape requires `url` to be a string).
848 of 854 roadmap entities had this malformed shape. `esc_url()` on a
non-string value is a PHP 8 fatal TypeError, and it fired on the FIRST
roadmap card's thumbnail, killing output for the rest of the page — so the
category page showed its header/count (a separate, unaffected API call) but
zero cards, matching exactly what was reported.

Fixed at the source (`roadmapThumbnailUrl()`, new helper): extracts
`urls.large` (falling back through `rect`/`square`/`source`) instead of
storing the nested object. Re-ran `import-starcitizen-api.ts --roadmap` to
backfill all existing bad rows (upsert, same ids) — 0 malformed rows remain
in the DB afterward (verified via a direct `jsonb_typeof()` query).

**Defensive fix, both entity templates + `ussalmc_wiki_fetch_all_in_category()`**:
every place that reads `images[].url` (category-listing thumbnail
extraction, single-entity hero image, single-entity gallery thumbnails) now
requires `is_string( $img['url'] ?? null ) && $img['url'] !== ''` instead of
just `! empty( $img['url'] )` — `empty()` is `false` for a non-empty array,
so it never actually caught this shape of bad data. A malformed image now
falls back to the letter-avatar placeholder (category cards) or is simply
skipped (hero/gallery) instead of ever fataling the whole page again — this
protects against the SAME class of bug from any future importer, not just
this one instance.

VERIFIED live: `?category=roadmap` now lists all 854 real cards with real
thumbnails (screenshotted); a single roadmap card's own entity page renders
its hero image correctly; spot-checked the `ship` category (236 cards,
unaffected/unrelated data) still renders correctly after the defensive
change.

## Phase 14 — species photos (starcitizen.tools enrichment, no migration)

User asked whether StarCitizen-API had species photos (it doesn't —
`/starmap/species` returns only `{code, id, name}`, no per-species detail
endpoint exists either), then asked to check other APIs. Checked UEX Corp's
API docs too: no species/race endpoint exists there (only `factions`/
`organizations`, which are player-org data, not lore races). Real concept
art DOES exist on starcitizen.tools — the same wiki this project already
scrapes ships/commodities/weapons from (ToS-cleared once for the whole
domain earlier this session) — on each species' own page.

`apps/admin/src/import-species-images.ts` reuses the existing scrape
pipeline (`fetcher.ts`'s robots-checked, rate-limited `fetchPage()` +
`extractor.ts`'s structural image detection — the same code the original
wiki scrape used) rather than a new one-off HTML parser. Enrichment-only:
matches each of the 6 existing `species`-category `lore` entities to its
real starcitizen.tools page by name (verified all 6 URLs live before
writing the list — no guessed slugs), merges ONLY `images` (never touches
summary/body/attributes), skips an entity that already has images
(idempotent re-run), never creates a new entity.

**Caught before calling this done**: the Kr'Thak page has no real concept
art yet — the wiki shows its own generic "Placeholderv2.png" / "no image
available" graphic instead of species art. The extractor doesn't know the
difference (it just finds the infobox image), so the first run stored that
placeholder as if it were a real photo — confirmed by directly inspecting
the page, not assumed. Fixed: filters out any image URL matching
`/placeholder/i` before selecting a primary/gallery image; re-ran after
clearing the bad entry, and Kr'Thak now correctly has 0 images rather than a
fake one, honestly reflecting that no real art exists for it yet on this
source.

Real result: Human (1 image), Banu/Xi'An/Tevarin/Vanduul (5 images each —
primary infobox portrait + up to 4 gallery concept-art pieces), Kr'Thak (0,
correctly, no real art available on the source page).

VERIFIED live on `lore_species_xi_an`: real reptiloid concept-art hero image
+ 4-image gallery render correctly (screenshotted).

## Phase 15 — KB-wide placeholder image cleanup

User feedback: the same class of bug caught in the species import
(starcitizen.tools' own "Placeholderv2.png" — a generic silhouette
graphic shown when a page has no real image — being stored as if it were
real content) had also slipped through the ORIGINAL wiki scrape's admin
review, across the whole KB, not just species. A DB-wide scan
(`img->>'url' ILIKE '%placeholder%'` per image, not per entity — an
entity's `images` array can mix a real photo with a placeholder) found 462
affected entities: `location` (216), `commodity` (99), `manufacturer` item
(74), `weapon` item (60), `ship` item (11), one `roadmap` patch_note.

`apps/admin/src/cleanup-placeholder-images.ts`: removes only the matching
image OBJECT(S) from each entity's `images` array (`/placeholder/i` or
`/coming.?soon/i` in the url) via a direct SQL update — not the full
`upsertEntity` pipeline, since images don't feed `ai_context` or the
embedding, so there's nothing to regenerate for a pure image-array edit.
Deliberately did NOT touch RSI's own "NotSignedOff_*" roadmap screenshots
(140 entities) — those are real, if preliminary/unofficial, dev screenshots
CIG actually published for in-progress roadmap features, not a blank
"missing image" graphic; a different, much bigger judgment call the user
hasn't asked for.

Real run: 462 entities updated, 484 placeholder images removed (some
entities had the placeholder duplicated at multiple thumbnail sizes,
counted as separate image objects); 415 entities had ONLY a placeholder and
now correctly show 0 images (falls back to the existing letter-avatar
placeholder in category listings, or simply no hero image on the entity
page) rather than a fake photo; 47 entities (mostly ships, e.g.
`ship_gladius_dunlevy`) had a real photo alongside the placeholder and kept
their real photo after cleanup. VERIFIED live: 0 images matching either
pattern remain anywhere in the KB (direct query); `commodity_ammonia`
(previously placeholder-only) now shows the clean letter-avatar "A" instead
of the fake wiki graphic in the category listing (screenshotted);
`ship_gladius_dunlevy` still shows its real referral-paint photo.

Root cause also fixed at the source, same session: `extractor.ts`'s image
candidate detection (used by both the main wiki scraper and
`import-species-images.ts`) now rejects any `/placeholder/i` or
`/coming.?soon/i` URL unconditionally, wherever it sits on the page — the
previous `logo|icon|sprite|...` exclusion only applied OUTSIDE the infobox,
which is exactly backwards for this graphic (it appears INSIDE the infobox
precisely when there's no real photo, which is why it got picked up as a
"primary" image candidate in the first place). Future scraper runs will
never propose this graphic as a candidate at all, so a human reviewer can't
accidentally approve it again either.

## Phase 16 — branded "no visual data" placeholder (theme, no migration)

Follow-up to the placeholder-image cleanup: with 415 entities now honestly
showing zero images, the fallback needed to look intentional rather than
bare. Replaced the plain letter-only category-card placeholder and added a
NEW entity-page hero placeholder (previously nothing rendered there at all
when an entity had no image) with a shared `.ussalmc-novisual` component
matching the theme's existing HUD visual language — same corner-bracket
treatment as `.ussalmc-entity`/`.dial-panel`, a faint grid texture (smaller
scale than the page-wide hex-grid, reads as texture not a literal grid),
Space Mono uppercase "NO VISUAL DATA" readout label. Category cards keep
the entity's first-letter glyph (still useful to distinguish cards at a
glance in a grid); the entity-page hero uses a generic broken-image line
icon instead (the entity name is already the H3 right above it, so
repeating the letter there would be redundant) — `ussalmc_wiki_render_novisual_icon()`
in fetch.php, pure inline SVG matching the theme's existing icon style (rail
icons, dial gauge), shared by both entity templates.

Updated: `apps/wordpress-theme/style.css` (`.ussalmc-novisual*` rules),
`apps/wordpress-theme/ussalmc-wiki/category.php` (letter variant),
`apps/wordpress-theme/ussalmc-wiki/entity.php` and
`apps/wordpress-plugin/templates/entity.php` (new hero-fallback branch,
previously just omitted). Left the plugin's default `templates/category.php`
placeholder alone — its own doc comment states it's a deliberately generic,
theme-agnostic baseline ("usable on any theme"), not meant to carry this
theme's specific branding; the theme override is what actually renders on
the live site anyway.

VERIFIED live: `commodity_ammonia` category card shows the new branded
frame (corner brackets, grid texture, "A" glyph, "NO VISUAL DATA" label)
instead of a bare letter; its entity page shows the new hero-fallback panel
(broken-image icon + label) where a real photo would otherwise sit —
screenshotted on production.

## Phase 17 — lightbox opens the real full-size image; roadmap image URLs fixed

User asked for clicking an image to open it full size. Investigated the
existing lightbox (`assets/js/lightbox.js`, already built earlier this
session) and found it technically "worked" but just reopened the SAME
small displayed thumbnail in a bigger box — for starcitizen.tools images
(the dominant source: 1,298 of ~2,360 stored images) that's a 400px-wide
webp rendition (~37KB), not the real photo. Confirmed live: the true
original at the same MediaWiki path (stripping `/thumb/` and the
`{N}px-filename` suffix — a standard, documented MediaWiki URL convention,
not a guess) is ~300KB, 1654×1800px for the Xi'An portrait tested. Fixed
`lightbox.js`'s `fullSizeUrl()` to derive that real original URL before
opening, for both the hero image and gallery thumbs; any URL that doesn't
match the thumb pattern (RSI's own media CDN, direct non-thumbnailed files)
passes through unchanged since those aren't resized-down thumbnails to
begin with.

**Found and fixed a second, more serious bug while investigating**: 703
roadmap entities had a completely BROKEN image URL (a 404, not just
low-resolution) — `import-starcitizen-api.ts`'s roadmap thumbnail
extraction (already touched once this session for a different bug, see
Phase 13) assumed a string-shaped `thumbnail.urls.large` value was already
a complete URL. Checked the live API directly: the VAST MAJORITY of roadmap
cards (925 of 1,069) actually return a site-RELATIVE path here (e.g.
`/media/1w9r0ekh3lj0er/hub_large/HelmetPolish.jpg`) — only a minority (144)
return a full URL. A relative path stored as-is 404s in the browser (no
host to resolve against). Confirmed the fix by testing
`https://robertsspaceindustries.com` + that same path returns a real 200
(RSI's own public roadmap media host — the same origin family the absolute
URLs already point at, not a new site). `resolveThumbUrl()` now prepends
that host to any `/`-leading path; re-ran `--roadmap` to backfill — 0
entities with a `/media/...` relative-path image remain.

VERIFIED live: Xi'An's hero image lightbox now loads and displays the real
1654×1800 original (screenshotted, sharp) instead of the blurry-when-
enlarged 400px thumbnail; the "Helmet Polish & Lighting Improvements"
roadmap entity's hero image now loads (HTTP 200) instead of 404ing.

## Phase 18 — self-hosted entity images (new: `original_url` / `full_url` fields)

User directive: we don't control starcitizen.tools or robertsspaceindustries.com,
so we can't guarantee their URLs keep working — already caught two real cases
of them being outright wrong this session (Phase 13, Phase 17). Every entity
image is now downloaded once and self-hosted instead of just linking the
external URL forever.

### Image object shape — two new fields

`{ url, original_url, full_url, caption, role, added_by, source_url, license_note }`

| field | meaning |
|-------|---------|
| `url` | self-hosted DISPLAY-sized copy (was the only image field before this phase) |
| `original_url` | **new.** The external URL this was downloaded from — kept for attribution/provenance even though we no longer depend on it staying live |
| `full_url` | **new, optional.** Self-hosted TRUE full-resolution copy, when derivable (see two-tier design below); `null`/absent when not applicable |

### Storage & serving

New Docker volume `ussalmc_media`, mounted at `/app/media` in both the `api`
and `admin` services (admin writes, api serves). New unversioned route
`GET /media/*` on the core API (`apps/api/src/index.ts`, via `@fastify/static`)
— deliberately OUTSIDE `/v1/` so a plain `<img src>` works with no
Authorization header (same exemption `/health` already relies on in
`auth.ts`, which only intercepts paths starting with `/v1/`). Content-
addressed filenames (`sha256(source URL)`, truncated) served with a 30-day
immutable cache-control — safe since the filename never changes for the
same source. New env vars: `MEDIA_DIR` (filesystem path inside the
containers) and `MEDIA_PUBLIC_BASE` (the public origin used to build stored
URLs — `https://api.ussa.space` in production).

### Two-tier download (`apps/admin/src/media-store.ts`)

`downloadAndStoreImage(url)` stores the DISPLAY-sized copy at whatever
resolution the source actually linked (e.g. a starcitizen.tools "thumb" is
typically 400px) as `url` — so a category grid of 20 cards doesn't pull down
20 multi-hundred-KB originals. When derivable (starcitizen.tools' MediaWiki
`/thumb/.../{N}px-filename` URL shape — same transform as the lightbox's
`fullSizeUrl()`, kept in sync deliberately), it ALSO downloads and
self-hosts the TRUE full-resolution original as `full_url` — confirmed live
the Xi'An portrait's thumb is 37KB at 400px vs. 302KB / 1654×1800 at full
size, an 8x difference worth not loading everywhere. `full_url` is absent
(not an error) for sources with no separate full-size variant (RSI's own
CDN, direct non-thumbnailed files) — the stored `url` is already the best
copy available for those.

A SVG resized-thumb rendition sometimes 404s on starcitizen.tools (a known
MediaWiki rasterizer issue) even though the true original vector file is
fine — confirmed live on two real manufacturer logos; `downloadAndStoreImage`
falls back to the derived original URL before giving up.

Every image-producing importer now downloads through this helper instead of
storing a bare external URL: the main wiki scraper (`scan.ts`), the roadmap
and star-system importers (`import-starcitizen-api.ts`), and the species
image importer (`import-species-images.ts`). A download failure leaves the
field exactly as it was (never drops the image, never fabricates a broken
local reference).

### Backfill (`apps/admin/src/download-existing-images.ts`)

One-time (idempotent — safe to re-run) pass over the whole existing KB.
Two-layer idempotency: an image never self-hosted gets the full treatment
(display copy + full-size original); an image already self-hosted by an
earlier run of this exact script — from before `full_url` existed — gets
ONLY the lightweight full-size backfill via its preserved `original_url`,
never re-downloading the display copy it already has.

Real run: 2,360 images across 1,807 entities. First pass: 2,358 downloaded
successfully as display copies, 2 failed (the same "SVG thumb 404s, source
is fine" case above — fixed by the fallback, then 0 failures). Second pass
(full-size backfill): 1,298 full-resolution originals backfilled, 1,062 had
no separate full-size available (expected — RSI CDN sources), 0 failures.

### Client-side: lightbox prefers the self-hosted full-size copy

Both entity templates now render a `data-full` attribute (from
`images[].full_url`, when present) on the hero `<img>` and each gallery
`<a>`. `assets/js/lightbox.js` opens `data-full` when present, falling back
to its existing URL-transform heuristic for anything not yet carrying one
(images from a source with no separate full-size variant).

### A real gap this surfaced, not a bug in this work

Verifying from THIS machine (which sits on the same LAN as the production
server) initially showed the self-hosted images failing to load with a
Chrome "Private Network Access" CORS error. Traced to split-horizon DNS:
`api.ussa.space` resolves to a private LAN address (`192.168.1.29`) for
local network clients, but correctly resolves to the same public IP as
`ussa.space` (`192.24.65.11`) when queried via a public resolver (Google's
8.8.8.8) — confirmed both ways. This only affects testing/verification FROM
the same LAN as the server; a real internet visitor gets the correct public
IP and never hits this. Re-verified with Chromium's DNS forced to the real
public IP (`--host-resolver-rules`): the self-hosted full-size image loads
correctly at its native 1654×1800 resolution, and a full category listing
page shows zero broken images.

## Phase 19 — real top menu (replaces decorative breadcrumb)

User: replace the decorative "TERMINAL / HURSTON HUB / <page title>" text in
the topbar with real site navigation. That text was pure flavor (never
linked anywhere); the topbar's only actual nav path to the wiki was a
single "Knowledge Base" link via an empty WP nav-menu location
(`register_nav_menus('topbar' => 'Top Bar')`, never assigned a menu in
WP Admin — confirmed via `theme_mods_ussalmc-theme`'s `nav_menu_locations`,
empty — so removing it loses nothing an admin configured).

Replaced both with one real, CSS-only (no JS) top menu in
`apps/wordpress-theme/header.php`: **Dashboard** | **Knowledge Base ▾**
(hover/focus dropdown) | **Trade Routes**. The dropdown is built from the
LIVE category index (`ussalmc_wiki_category_index()`, server-side cached
via `API_CATEGORIES_CACHE_TTL_SEC`) — filtered to categories that actually
have content (`entry_count > 0` or a `freshness` value, i.e. `trade_route`),
sorted by entry count descending, each showing its real count — so it
always reflects what's actually in the KB and never drifts into a
hand-maintained list that goes stale. Falls back to nothing extra (still
functions, just an empty dropdown besides "All Categories") if the core API
is unreachable — a header include must never break the whole page.

Removed as now-genuinely-unused (confirmed no other callers): the `topbar`
nav-menu registration, `ussalmc_topbar_menu_fallback()`, and
`ussalmc_wiki_url()` (the smart wiki-page-URL resolver it was the only
caller of — every other template already links `home_url('/wiki/')`
directly, so this wasn't actually relied on for anything).

CSS: new `.topmenu`/`.topmenu__item`/`.topmenu__link`/`.topmenu__panel`/
`.topmenu__sublink`/`.topmenu__count` rules matching the theme's existing
HUD panel language (clip-path corners, `--panel-raised`/`--line-bright`,
Aquire/Rajdhani labels). Removed `.topbar{ overflow:hidden; }` (added
during the earlier topbar-overflow fix as a belt-and-suspenders measure) —
it silently clipped the new dropdown panel, which must render below the
fixed 64px bar; the actual overflow prevention was always the per-element
ellipsis/hide-at-breakpoint rules, not this property, so removing it is
safe.

**Known first-pass limitation**: the dropdown is `:hover`/`:focus-within`
only, so on a touch device tapping "Knowledge Base" navigates straight to
`/wiki/` (its own href) rather than opening the panel — not broken (that
page IS the category index, reachable another way), just skips the
dropdown convenience on mobile. Deliberately kept JS-free for this first
version; revisit with a tap-to-toggle behavior if wanted later.

VERIFIED live: dropdown renders with real, correctly-sorted categories and
counts (Roadmap Item 854 ... Species 6); clicking "Ship" navigates to and
correctly loads `?category=ship`; screenshotted both closed and open states
on production.

## Phase 20 — trade routes browse view (Picking Up / Dropping Off)

User: trade routes need to be sorted by "picking up" or "dropping off",
then System/Planet/Station/Location, then Commodity. The generic
entity-card grid (same one ships/commodities use) doesn't suit this data —
a "Commodity: Origin → Destination" card doesn't answer the actual question
("what can I do FROM HERE?"). Built a dedicated view instead of forcing it
into the generic template.

### New attributes on `trade_route` entities

`import-uex-trade-routes.ts` now stores separate location COMPONENTS
(`origin_star_system`, `origin_planet`, `destination_star_system`,
`destination_planet` — terminal names were already stored) alongside the
existing concatenated `origin_location`/`destination_location` strings, so
the browse page can group/sort hierarchically without fragile string
parsing. Backfilled via a re-run (same 213 route ids, upsert).

### Grouping (`ussalmc_wiki_trade_routes_grouped()`, fetch.php)

Builds TWO trees from the same 213 real routes — every route appears in
both, since both are genuinely useful questions about it:
- **PICKING UP**: grouped by each route's ORIGIN (where you'd go to buy),
  nested System → Planet → Terminal; each row shows the commodity and where
  to sell it (the destination).
- **DROPPING OFF**: grouped by each route's DESTINATION (where you'd go to
  sell), same nesting; each row shows the commodity and where to buy it.

Within a terminal, routes sort by commodity name — per the explicit ask.
`(unspecified)` is the fallback bucket when UEX didn't report a planet for
that side (e.g. free-floating space stations like Nyx's — confirmed live,
not a bug) — never silently dropped.

### Rendering (`templates/trade-routes.php`, both plugin default + theme
override)

Native `<details>`/`<summary>` for the System → Planet → Terminal
drill-down — zero JavaScript, terminal level defaults open (system/planet
collapsed) so the page is dense but navigable. Each route row: commodity
name, the OTHER side's location, profit/SCU + margin %, and freshness age
— links to the route's own entity page. New dispatch branch in
`ussalmc-wiki.php`'s `[ussalmc_categories]` handler: `?category=trade_route`
now renders this dedicated view instead of the generic category template.

### Real bug caught and fixed while building this

Querying all `trade_route` entities for this page turned up 271 when only
213 should exist — the importer had never pruned routes that fall out of
UEX's top-3-per-commodity ranking between runs (rankings shift as prices
change; upserting only ever adds/updates, nothing was deleting the ones
that got displaced across three earlier runs this session). Fixed: the
importer now tracks every id it keeps in the current run and deletes any
`trade_route` entity NOT in that set afterward (scoped strictly to
`type='trade_route'` — never touches anything else). `embeddings` cascade-
deletes automatically (`ON DELETE CASCADE` on `entity_id`). Re-ran: 58 stale
routes pruned, back to the correct 213.

VERIFIED live: `?category=trade_route` shows 213 real routes in both trees
with correct counts at every level (screenshotted collapsed and drilled all
the way down to individual routes); clicking a route row navigates to and
correctly loads that route's own entity page.

## Phase 25 — retroactive cross-linking pass (`relations`)

Confirmed live before writing anything: every category except `jump_point`
(linked at import time by `importTunnels()`) and `quest` (just linked in the
Phase 24 follow-up) had `relations: []` on 100% of its entities — 313
manufacturers, 236 ships, 213 trade routes, 166 commodities, 149 weapons,
96 star systems, 500 locations, 854 roadmap items, all floating disconnected
from the rest of the KB.

First pass (`apps/admin/src/link-entities.ts`), the highest-confidence links
available from data already in the KB — nothing here is a fuzzy guess dressed
up as a fact:

- **ship/weapon → manufacturer** (bidirectional: the manufacturer also gets
  a `manufactures` relation back, so a manufacturer's own page now lists
  everything it makes — confirmed live, e.g. `manufacturer_aegis_dynamics`
  now cross-references 26 real ships). Resolved via `class_name`'s leading
  token (e.g. `"AEGS_Sabre"` → `"AEGS"`) matched exactly against
  `manufacturer.attributes.manufacturer_code` (already a real stored field,
  confirmed live — not a code-to-name table I made up), falling back to the
  project's existing fuzzy name matcher (`linker.ts`'s `resolveLink()`,
  already used at scrape time — reused, not reinvented) for weapons, whose
  `manufactured_by` field is a clean name rather than a class-name string.
  306 of 385 linked; 79 left unlinked (no confident match) rather than
  guessed.
- **trade_route → commodity** and **→ origin/destination star_system**:
  the commodity link was trivial — `attributes.commodity_entity_id` was
  already a resolved real id sitting unused; the two system links come from
  an exact name match against `star_system`-category location entities.
  All 213 trade routes linked; commodities get a `traded_via` relation back.

Not yet covered (a real, acknowledged gap, not silently ignored): 500
locations aren't nested under their parent star system (the source data —
a free-text `location` attribute like `"Stanton system — On Daymar"` — is
too unstructured to parse confidently at scale without more work), and 854
roadmap items aren't linked to whatever ship/feature they're about (name
matching here would be noisy — roadmap card titles are often not exact
entity names). Left for a later pass rather than forcing a low-confidence
link now.

## Phase 24 — full mission/contract database (`quest` entities, 1,733 imported)

Per the user's explicit instruction to scrape SCMDB's mission database "as a
site visitor" (no API exists). Same robots.txt discipline as Phase 23: only
ever renders real pages with a real browser and reads what's displayed,
never touching `/data/`.

### Two real sub-problems, both solved live (not guessed)

1. **The mission list is a virtualized scroll table**, not a paginated one —
   `.contract-table-body` is ~62,000px tall with only ~20 of ~1,733 rows
   actually in the DOM at once. Solved by scrolling `.contract-table-body`
   (not the window) in small increments, accumulating every unique
   `/?m=<id>` row's 17 `.table-cell` values into a Map as they scroll in and
   out. Consistently collects 1,733 unique missions.
2. **Per-mission detail lives behind tabs** (`.detail-tabs`: Overview,
   sometimes Combat, Requirements, Calculator, Community) that replace a
   shared `.detail-body` pane on click — not separate pages. Every tab
   except Calculator (an interactive planning tool, not a stored fact) is
   captured generically, keyed by its own name, rather than hand-modeling
   fields per mission type — some missions have a Combat tab, most don't;
   the scraper doesn't need to know which in advance.

### New: 1,733 `quest` entities (`type='quest'`, `attributes.category='quest'`)

Reuses the EXISTING `quest` category (already in the KB from an earlier
starcitizen.tools scrape, ~12 hand-picked named story missions) rather than
inventing a new one — Star Citizen's own mission manager treats procedural
contracts and story quests as the same concept. `id = quest_scmdb_<scmdb's
own short id>`, so it can never collide with the older
`quest_<slugified-name>` entities. Titles are kept in their literal
templated form (e.g. `"[DESTINATION] Errand"`) — that placeholder bracket
is genuinely how the game/SCMDB represent an unresolved procedural mission
before a specific location is rolled; resolving it to a fake example would
be inventing data that isn't real.

`attributes`: `scmdb_id`, `scmdb_template_key` (the mission's real internal
template identifier, e.g. `HH_Pyro_LastLandings_Local_1box_Single_Courier`
— found in the detail page's own title attribute, a bonus find, not
scraped from anywhere hidden), `faction`, `star_system`, `mission_type`,
`is_legal`, `base_xp`, `reward_auec`, `est_uec_per_hour`,
`est_rep_per_hour`, `community_difficulty`, `community_satisfaction`, and
`tabs` (every detail tab's full raw text, keyed by tab name — includes the
Requirements tab's standing range, location variants, and
shareable/illegal/cooldown flags). `body` = the Overview tab's narrative
text. A handful of list columns (`bp_col_raw`, `check_col_raw`, etc.)
whose exact meaning wasn't confidently determined from the UI are stored
as raw text rather than guessed at and mislabeled.

`source.confidence = 'community'` throughout, same as every other
SCMDB-derived fact. `game_version: null` — not reliably shown per-mission
on the site, so never guessed as "whatever the site's current patch is."

Import: `apps/admin/src/import-scmdb-missions.ts` — resumable (skips any
`scmdb_id` already stored, so a partial/interrupted run or a later
"just get what's new" re-run both just work), moderate concurrency (4
parallel browser pages — a real site-visitor pace, not a hammering
crawler). Real run: 1,727 of 1,733 on the first pass (1 silent detail-read
miss, not a thrown error), 100% after one resumed re-run.

### Follow-up same day: "the data is disjointed" (structure + presentation, both real)

User feedback after the import landed identified real problems, confirmed
live before touching anything (never assumed which one without checking):
1. **No `relations`** — every quest floated disconnected from the rest of
   the KB, even though e.g. `location_pyro` already exists and could be
   linked.
2. **Raw semi-structured text blobs** (`attributes.tabs`) instead of clean
   fields — genuinely unusable for anything but a raw dump.
3. **`entity.php` never rendered `body` at all** (only `summary`, which the
   original import left `null` for every mission) — the actual narrative
   content was completely invisible on the entity page, full stop. This
   was a pre-existing gap in the shared template, invisible until quest
   entities (the first content type whose real value IS its prose body)
   existed.
4. **Raw internal field names leaking to readers** — the stats-grid builder
   skips arrays/objects (so `tabs` silently vanished) but still rendered
   scalar placeholder fields like `bp_col_raw`/`check_col_raw`/`tags_raw`
   verbatim as if they were understood specifications, and a `false`
   boolean attribute rendered as an empty string (silently dropped, visually
   indistinguishable from "no data") while `true` showed the bare word "1".

Fixed without re-scraping (all source data was already captured in
`attributes.tabs` from the original import) via
`apps/admin/src/reprocess-scmdb-missions.ts`: parses Requirements text into
clean discrete fields (`standing_min/max_rank`+`_xp`, `shareable`,
`shareable_to_rank`, `once_only`, `reaccept_after_abandon/fail`, `cooldown`,
`available_locations`), keeps Combat as clean prose (`combat_notes`), pulls
`top_ships` out of Community, strips the reward/blueprint block scmdb
appends to Overview text out of `body` (already captured cleanly as
`reward_auec`/new `blueprint_reward_options`) so `body` is pure narrative,
derives a real `summary` (first sentence-like paragraph, skipping short
header lines like a bare company name), and adds a `located_in` relation to
the matching `location_<system>` entity when one exists (Pyro/Nyx/Stanton
do; "Multi" correctly gets no relation — there's no single system to point
at). Ambiguous `*_raw` fields are dropped rather than kept under a
not-understood label.

`entity.php` (both the plugin default and the theme override, kept in
sync) fixed to: render `body` as its own prose section via the new
`ussalmc_wiki_render_body_html()` helper (`inc/fetch.php`) — a real,
general fix that benefits every entity type, not just quests; exclude any
`*_raw`-suffixed attribute from the specifications grid on principle (an
honest field name is better than a wrong assumption, but neither belongs
in front of a reader); and render booleans as "Yes"/"No" instead of
PHP's "1"/"" (the empty-string case was silently indistinguishable from a
missing value).

Verified live (screenshotted before and after against the real WordPress
test instance): full narrative now renders, the specifications grid shows
only genuinely meaningful fields, `CROSS-REFERENCES` shows a real, working
"located in Pyro" link, and boolean fields read correctly.

## Phase 23 — "Sig Ident": mining scan-signature identification

Pilots scan a rock in-game and get a raw signature number with no obvious
meaning — previously they'd have to leave the game/Discord and go look it up
on scmdb.net themselves. Enriches existing `commodity` entities with the real
per-ore signature-value table from SCMDB
(https://scmdb.net/?page=mine — unofficial fan project, unaffiliated with
CIG/RSI) and exposes a lookup tool (WordPress page + Discord/MCP tool) named
"Sig Ident" per the user's own naming, mirroring scmdb.net's own query UX
(exact / `~tolerance` / `min-max` range).

### robots.txt handling (the actual reason this needed a real browser)

scmdb.net's robots.txt: `Allow: /` for pages, but `Disallow: /data/` and
`/data-nda/` — its own comment says those are "machine-consumed via fetch()
from the SPA", i.e. intended for the page's own client-side JS, not a bot
fetching them directly. Respected literally: `import-scmdb-signatures.ts`
NEVER fetches `/data/*` itself — it renders `?page=mine&sig=` with a real
headless browser (Playwright) and reads only what the page actually
displays, identical to what a human visitor's browser does. Added
`playwright` to `apps/admin`; the runtime Dockerfile now runs
`npx playwright install --with-deps chromium` (works in a Docker build,
unlike an interactive host shell, since builds run as root — no sudo/TTY
prompt).

### New: `attributes.scan_signatures` on `commodity` entities

`{ base: number, values: number[] }` — the ore's base scan value and its
full set of displayed multiples (rarity-tier-capped: 2 to 15 values
depending on the ore). Enrichment-only (`import-scmdb-signatures.ts`), same
rule as `enrichShips()`/`import-uex-commodities.ts`: never creates a new
commodity entity on a name-miss. 25 of 26 SCMDB ore rows matched an
existing commodity (`Aluminium` → `commodity_aluminum`, a known spelling
alias); `Ice` has no commodity entity in the KB and was skipped, not
fabricated. Three generic bands (ROC Mineables / FPS Mineables / Salvage)
aren't tied to one specific ore and are skipped for the same reason.
`source = { origin: 'scmdb.net', confidence: 'community', ... }` — never
higher, matching every other community-sourced fact in the KB.

### New: `GET /v1/mining/signature?q=`

`q` = an exact number, `~number` (±10% tolerance), or `min-max` range —
mirrors SCMDB's own three query modes exactly. Scans every commodity with
`attributes.scan_signatures`, returns every ore whose value band falls in
range (a signature CAN legitimately match more than one ore). See
`docs/api.md`.

### New surfaces named "Sig Ident"

- WordPress: `[ussalmc_sig_ident]` shortcode (`apps/wordpress-plugin`,
  `templates/sig-ident.php`), same GET-and-render pattern as
  `[ussalmc_search]` (`?sig=` query var, no JS/AJAX needed). Live at
  `/sig-ident/` on the test instance (created via `wp-cli`, installed
  fresh into the container for this — no `mysql`/`wp` client was already
  present).
- Discord/AngryDaemon: `ussalmc_identify_signature` MCP tool
  (`apps/openclaw-mcp`). First attempt at this tool's description wasn't
  enough — OpenClaw's own `tool_search` discovery didn't surface it for
  natural phrasing ("I scanned a rock and got 8600, what is it?"), and the
  agent fell back to `ussalmc_get_entity` with the raw number AS an entity
  id (failed safely — clean 404, no fabrication — but the wrong tool).
  Fixed by rewriting the description around how a pilot actually phrases
  this, and adding an explicit cross-reference in `ussalmc_get_entity`'s
  own description ("a bare number is never a valid id here — that's
  ussalmc_identify_signature's job"). Verified fixed: fresh session, same
  phrasing, now correctly calls `ussalmc_identify_signature`, cross-checked
  against `api_audit_log` (`GET /v1/mining/signature?q=3585` → 200,
  correctly identified as Gold).

## Phase 22 — instructional guides (`guide` category, no `entities.type` change)

Expanded the KB from "what is X" (lore/stats/reference) into "how do I do X"
(mining, quantum travel, docking, combat, cargo runs, ...) — pilots asking
AngryDaemon a how-to question previously got either silence or (once, badly)
fabricated steps. Content source: creator-submitted YouTube tutorial links,
structured by a local LLM extraction pass — never a hosted API, matching the
project's local-AI constraint (decisions-log.md, Phase 21).

### New category: `guide` (no `entities.type` migration needed)

Follows the exact same pattern already used by `ship`/`manufacturer`/`weapon`
(confirmed live: `ship_carrack` and `manufacturer_gold_horizon` are both
`type='item'`, distinguished by `attributes.category`) — so a guide entity is
`type='item'`, `attributes.category='guide'`. `db/migrations/0014_guide_category.sql`
only adds the leaf category row (+ its own top-level group "Guides &
Tutorials", kept separate from `mechanic` — a mechanic *explains* a system,
a guide *walks through* a task) so it appears correctly in the categories
tree, `/v1/categories` counts, and admin category manager.

Guide `attributes` shape:

| field | type | notes |
|---|---|---|
| `category` | string | always `"guide"` |
| `topic` | string\|null | short topic tag (e.g. `"mining"`), LLM-inferred or human override |
| `difficulty` | `"beginner"｜"intermediate"｜"advanced"`\|null | never guessed if the transcript doesn't say |
| `prerequisites` | string[] | ships/items/unlocks needed first |
| `estimated_minutes` | number\|null | |
| `ships_or_equipment` | string[] | |
| `steps` | `{order, instruction, tip}[]` | the actual walkthrough — real sequence extracted from the transcript, never summarized/reordered |
| `transcript_truncated` | boolean | true if the source video exceeded the extraction script's char cap |
| `extraction_model` | string | which local model produced this, for audit |
| `video_title` | string\|null | source video's real title, kept since the entity's own `name` is a topic-focused title, not necessarily the clickbait video title (no channel/creator attribution stored — user takes over editing these after import) |

`source.confidence` is always `"community"` for a guide — a single YouTube
creator's tutorial run through automated extraction never earns
`"corroborated"` or `"confirmed"` on the existing confidence ladder, same
rule as everything else in the KB.

### New: `apps/admin/src/import-youtube-guide.ts`

`tsx src/import-youtube-guide.ts <youtube-url> [--topic mining] [--difficulty beginner]`

1. Fetches the video's public transcript (`youtube-transcript` package —
   the same publicly-served caption track a browser fetches, no YouTube API
   key needed) and metadata (title/channel via YouTube's oEmbed endpoint).
2. Runs it through a local model via Ollama (`GUIDE_EXTRACTION_MODEL`, env,
   default `qwen3.6:35b-a3b`) with `format: "json"` and a system prompt that
   hard-requires `null`/`[]` over inventing anything the transcript doesn't
   actually say — the exact same anti-fabrication discipline just added to
   `AGENTS.md`/`apps/openclaw-mcp` after a live hallucination incident
   (decisions-log.md, 2026-09-19), now applied to automated extraction too.
3. `upsertEntity()`s the result (ai_context/embedding regenerate same as any
   other entity) and prints the full extracted JSON so the importing human
   can spot-check it before trusting it published.

New env: `OLLAMA_BASE_URL`, `GUIDE_EXTRACTION_MODEL` (`.env.example`).

### AngryDaemon / MCP: teaching, not just lookup

`ussalmc_entities_by_category`'s description now calls out `"guide"`
explicitly. `AGENTS.md` instructs: for a "how do I..." question, check for a
guide entity and actually teach from its `steps` in AngryDaemon's own voice
— not paste raw JSON, and not caveat every answer with which video/creator
it came from (these are living KB entries like any other, not standing
citations) — but never improvise a walkthrough from general knowledge if no
guide exists yet; that's the fabrication failure this whole discipline
exists to prevent.

### Fixed in the same phase: migration replay bug (`0012`)

Migrations replay in full on every container start (no per-migration
applied-tracking). `0012_portal_api_key_client.sql` re-narrowed the
`api_keys_client_check` constraint on every replay, which started hard-failing
the moment a real `'openclaw'` row existed (added by `0013`) — silently
blocking `0013`/`0014` from ever running again on subsequent restarts. Fixed
by widening `0012`'s list to match `0013`'s. Any future migration that
ALTERs the same constraint a later migration also touches needs to stay a
superset going forward, or replay will break again the same way.

## Phase 21 — OpenClaw MCP server (read-only AI agent access, no schema change)

User already runs OpenClaw locally (a multi-channel AI agent gateway —
`angrydaemon`, model `ollama/qwen3.6:27b`, fully local inference) with
Discord already connected. Rather than build the originally-planned separate
`apps/bots/discord` (discord.js) and `apps/bots/twitch` (tmi.js) codebases,
integrated through OpenClaw instead: it already has a proper skills/MCP
extension system, and Twitch is a supported-but-unconfigured OpenClaw
channel — so ONE integration serves every channel that agent is or becomes
connected to, not one bot per platform.

### New: `apps/openclaw-mcp`

A small MCP (Model Context Protocol) stdio server, run directly on the HOST
(spawned by OpenClaw itself via its `mcp.servers` config — NOT a Docker
service; OpenClaw isn't containerized, so this talks to the core API over
its published `127.0.0.1:8090` port like any external client). Four
read-only tools, each a thin wrapper over an existing `/v1` endpoint:

| tool | wraps |
|------|-------|
| `ussalmc_search` | `GET /v1/search` |
| `ussalmc_get_entity` | `GET /v1/entities/:id` |
| `ussalmc_list_categories` | `GET /v1/categories` |
| `ussalmc_entities_by_category` | `GET /v1/entities?category=` |

No new API routes — this is purely a new *consumer* of the existing public
API, authenticated as its own client. Every tool response is passed through
verbatim (never summarized/stripped), including `confidence`, `source`, and
any `uex_last_updated`/freshness fields — each tool's description explicitly
instructs the model never to state a price or trade fact without also
conveying its age, mirroring the project's own volatile-data rule for the
benefit of whoever's chatting with the agent on Discord/Twitch.

### New `openclaw` api_keys client (migration `0013_openclaw_api_key_client.sql`)

Distinct from the pre-existing (Phase 1) `discord`/`twitch` client values,
which assumed a separate bot codebase per channel. This is one gateway
serving multiple channels through one agent, so it gets one identity
(`OPENCLAW_API_KEY` in `.env`) rather than being forced into either of the
old per-channel slots. Rate limit 60/min (same as the old discord/twitch
placeholders).

VERIFIED live: `openclaw mcp add ussalmc ...` probed and saved successfully;
`openclaw mcp probe ussalmc` confirms all 4 tools are visible to the agent;
a direct `curl` against `/v1/search` with the new key's plaintext token
returned real results before it was registered. A live end-to-end agent
turn (`openclaw agent -m "..."`) was in progress at write time — local
27B-model tool-calling turns take a few minutes; see decisions-log.md for
the completed result.

### Stellar Atlas presentation

No stored entity or taxonomy schema changes. The public category projection now
includes nullable representative image metadata (`url`, `entity_id`,
`entity_name`), derived from existing public entity images. Details and cache
behavior are documented in `docs/api.md`.

### Planetary Atlas metadata (no new tables)

The Atlas reads existing generic location attributes and relations. For curated
spatial data, an entity can record `atlas_kind` (`system`, `planet`, `moon`, or
`body`), `parent_entity_id`/`parent_id`/`body_entity_id`/`body_id`, and
`star_system_id`/`star_system`. A mapped location needs an identifiable body and
numeric degree `surface_coordinates: {latitude, longitude, units: "degrees"}`
(or the equivalent `coordinates` object/top-level latitude and longitude).
Coordinates must use north-positive/east-positive planetocentric degrees with
the source's zero meridian correctly reconciled. Do not copy x/y/z system
positions into these fields. Unresolved body names or unknown coordinate frames
must be verified before adding map positions.

The public projection is described in docs/api.md. Latitude/longitude zero is a
valid recorded value; absent coordinates stay null. Surface positions never
come from procedurally generated terrain. Surface imagery, radii and orbital
ephemerides are not currently modeled by this feature.
