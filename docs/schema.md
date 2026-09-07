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
Per-client keys (`wiki`, `mobile`, `desktop`, `discord`, `twitch`). Stores a
SHA-256 hash of the bearer token, a per-client `rate_limit_per_min`, and an
`enabled` flag. Tokens are never stored in plaintext.

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

Confidence ladder rules: a new route starts `community`; an independent report
with a matching price (within `TRADE_PRICE_TOLERANCE`) inside
`TRADE_CORROBORATION_WINDOW_MIN` steps it up and refreshes `last_verified`; a
conflicting price supersedes the current value (archiving the old one to
`price_history`) and resets confidence to `community`; an explicit
`/confirm` sets `confirmed`.

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

## `entity_audit_log` table (migration 0007) — delete audit trail
One row per soft-delete/restore/hard-delete, snapshotting the **full entity**
at the moment of the action (so a hard delete is never a silent, unrecoverable-
without-a-trace loss): `id`, `entity_id` (no FK — the row may no longer
exist after a hard delete), `action` (`soft_delete`/`restore`/`hard_delete`),
`snapshot` (JSONB, the full entity object), `performed_by` (admin_users
username), `created_at`.

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
