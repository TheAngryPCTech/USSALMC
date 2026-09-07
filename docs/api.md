# API Reference — USSA Lore Master Core

Base URL (dev): `http://127.0.0.1:3000`
All data routes are versioned under `/v1/`. JSON in, JSON out.
Last updated: Phase 1.

## Authentication
Every `/v1/*` route requires a per-client API key as a Bearer token:

    Authorization: Bearer <key>

Keys are never accepted in the query string. Each client
(`wiki`/`mobile`/`desktop`/`discord`/`twitch`) has its own key, its own
rate limit (requests/min), and is audited separately in `api_audit_log`.

Dev tokens seeded by `db/seed/seed.ts`:

| client  | dev token             | rate limit |
|---------|-----------------------|-----------|
| wiki    | `wiki-dev-key-0001`    | 300/min |
| mobile  | `mobile-dev-key-0001`  | 120/min |
| desktop | `desktop-dev-key-0001` | 120/min |
| discord | `discord-dev-key-0001` | 60/min |
| twitch  | `twitch-dev-key-0001`  | 60/min |

### Errors
Uniform envelope; no bare strings, no stack traces:

    { "error": { "code": "unauthorized", "message": "..." } }

Codes: `unauthorized` (401, missing key), `invalid_key` (401, unknown/disabled),
`rate_limited` (429), `bad_request` (400), `not_found` (404),
`internal_error` (500).

## Health
### `GET /health`  (no auth)
`{ "status": "ok", "db": "up", "ts": "..." }`

## Entities
### `GET /v1/entities`
Query params: `type`, `query` (substring on name/summary), `version`
(game_version), `limit` (≤200, default 50), `offset`.
→ `{ "total": N, "items": [ <entity>, ... ] }`

### `GET /v1/entities/:id`
→ full entity object (see `/docs/schema.md`). Includes `confidence` (inside
`source`), `source`, and `game_version` per the API conventions. 404 if absent.

### `GET /v1/entities/:id/relations`
Resolves each relation target to `{ id, name, type }`:

    { "id": "ship_carrack",
      "relations": [
        { "relation": "manufactured_by",
          "entity": { "id": "manufacturer_anvil_aerospace", "name": "Anvil Aerospace", "type": "item" } } ] }

### `GET /v1/entities/:id/ai-context`
Returns the auto-generated, self-contained prose paragraph plus provenance:

    { "id", "name", "ai_context", "confidence", "source", "game_version",
      "generated": true, "note": "auto-generated from structured fields..." }

`ai_context` resolves relations inline by name and is regenerated on every
entity write — it is never hand-written.

`GET /v1/entities`, `GET /v1/entities/:id`, `/relations`, and `/ai-context`
all exclude/404 entities with `status: "removed"` (soft-deleted) — removed
entities are invisible on the public API, matching the WordPress rendering,
`/ai-context`, and category counts (all read through the same public path).

### `POST /v1/entities/:id/fields/confirm`
Field-level corroboration ("green confirm") signal from a live wiki page. No
review needed — just a corroboration count.
Body: `{ "field": "summary" | "attr:<key>", "current_value": "...", "submitted_by": "<wp username>" }`
(`submitted_by` defaults to `"anonymous"` when omitted/blank).
→ `201 { "outcome": "confirmed", "id", "created_at" }`, or `429` when the
submitter exceeds `WIKI_SIGNAL_RATE_LIMIT_PER_MIN`.

### `POST /v1/entities/:id/fields/flag`
Field-level correction ("red flag") proposal from a live wiki page. Lands in
the corrections review queue (`GET /admin/corrections`) — never applied
automatically.
Body: `{ "field", "current_value", "suggested_value" (required), "note", "submitted_by" }`
→ `201 { "outcome": "flagged", "id", "status": "pending", "created_at" }`, or
`429` on rate limit.

## Search
### `GET /v1/search?q=...`
Hybrid keyword (Postgres full-text) + semantic (pgvector cosine) search.
Optional `limit` (default 10). Scores combined 0.4·keyword + 0.6·semantic.

    { "query": "...",
      "results": [ { "id", "name", "type", "summary",
                     "keyword_score", "semantic_score", "score" }, ... ] }

## Trade routes (volatile)
Responses set `Cache-Control: no-cache, max-age=<API_TRADE_ROUTE_CACHE_TTL_SEC>`
and always surface `last_verified` + `last_verified_age_minutes`.

### `GET /v1/trade-routes?commodity=&from=`
Returns **confirmed** routes only, sorted by `profit_per_unit` descending.

    { "count": N, "sorted_by": "profit_per_unit",
      "routes": [ { "id", "commodity", "from_location", "to_location",
                    "buy_price", "sell_price", "profit_per_unit",
                    "confirmations", "last_verified", "last_verified_age_minutes",
                    "freshness_class": "volatile", "volatile_warning" }, ... ] }

### `POST /v1/trade-routes/submit`
Body: `{ commodity, from_location, to_location, buy_price?, sell_price?, account? }`
(`account` = the reporting user/handle, distinct from the API client key; also
accepts `submitted_by` as an alias). Runs the submission-intelligence engine
(`apps/api/src/trade-submissions.ts`):

- **Normalizes** commodity/location names against existing entities (fuzzy,
  same token-overlap matcher as the Phase 2 linker) — no duplicate entities are
  created; unmatched names are kept as text.
- Defaults new routes to **`community`** confidence — never `confirmed`.
- **Auto-corroborates**: an independent account reporting a matching price
  (within `TRADE_PRICE_TOLERANCE`, inside `TRADE_CORROBORATION_WINDOW_MIN`)
  steps confidence up (`community`→`corroborated`→`confirmed`) and refreshes
  `last_verified`.
- **Preserves history**: a conflicting price supersedes the current value but
  archives the old one in `price_history`; confidence resets to `community`.
- **Rate-limits** per account (`TRADE_RATE_LIMIT_PER_MIN`) → 429; **flags**
  abuse (implausible prices, sell<buy, self-corroboration) for manual review
  instead of trusting volume.

Response (201, or 429 when rate-limited):

    { id, route_key, outcome: "created"|"corroborated"|"conflict-superseded"|"rate_limited",
      confidence, corroboration_count, profit_per_unit, last_verified,
      flagged, flag_reason,
      normalization: { commodity:{input,canonical,entity_id,decision,score}, from:{...}, to:{...} },
      history_len, note }

### `POST /v1/trade-routes/:id/confirm`
Explicit vouch: increments `confirmations`, sets `status='confirmed'` and
`confidence='confirmed'`, bumps `last_verified`, logs a `confirm` event. Body
`{ account? }`. → updated row `{ id, status, confidence, confirmations, corroboration_count, last_verified, flagged }`, or 404.

## Changelog
### `GET /v1/changelog?since=<ISO date>`
Entities created/updated since the given date (default: last 30 days).

    { "since": "...", "changes": [ { "id","type","name","status","game_version","updated_at" }, ... ] }

## Feedback
### `POST /v1/feedback`
Body: `{ entity_id?, kind?, message?, payload? }` (message or payload required).
→ 201 `{ "id", "created_at", "status": "received" }`. Records submitting client.

---

# Admin API (Phase 2) — scraper + review tool

Separate service in `apps/admin`, default `http://127.0.0.1:4000` (`ADMIN_PORT`).
Serves the plain-React UI at `/` and the endpoints below. This is an internal
admin tool (not the public per-client API); it writes into the Phase 1 schema
via the shared `upsertEntity` publish path. Same error envelope as the core API.

## Admin authentication (DB-backed login + forced first-login change)
The admin tool is login-gated by a session cookie (not the per-client API keys).

- Bootstrap: on start the admin account is created from `ADMIN_USER`/`ADMIN_PASSWORD`
  with `must_change_password=true` (a dev credential) and `role='super_admin'`
  (re-asserted on every restart — the bootstrap account is always super_admin).
  The server refuses to start if those env vars are unset.
- Passwords are stored as scrypt hashes in the `admin_users` table (migration
  `0004`); the plaintext lives only in `.env` for the bootstrap.
- Sessions are HttpOnly cookies (`ussalmc_admin`, 12h). Set `COOKIE_SECURE=true`
  when the admin is served over HTTPS.
- **Roles** (migration `0007`): `admin` (default) or `super_admin`. Enforced
  server-side (never trust a client-supplied role) on hard-delete friction —
  see `POST /admin/entities/:id/hard-delete` below.

### `POST /admin/login`
Body `{ username, password }`. Sets the session cookie. → `{ ok, username, role, must_change_password }` or 401.

### `POST /admin/logout`
Destroys the session + clears the cookie. → `{ ok: true }`.

### `GET /admin/session`
Current auth state (drives the UI). → `{ authenticated, username?, role?, must_change_password? }`.

### `GET /admin/admins`  (super_admin only)
List admin accounts. → `{ items: [{ username, role, email, must_change_password, last_login_at, created_at }] }`.

### `POST /admin/admins`  (super_admin only)
Create an admin account. Body `{ username, password, role?: "admin"|"super_admin", email? }`
(`email` enables SSO for that account). New accounts always start
`must_change_password=true`. → `201 { ok, username, role, email }`.

### `GET /sso?token=<signed>`  (no session required)
SSO handoff from the wp-admin "USSA Admin" menu page. `token` is an
HMAC-SHA256-signed, 120s-lived payload (`{ email, display_name, exp }`, shared
secret `ADMIN_SSO_SECRET`) generated by the WordPress plugin
(`apps/wordpress-plugin/inc/sso.php`). On a valid token whose `email` matches
an `admin_users` row: sets the session cookie and `302`s to `/` (no separate
login prompt). On an invalid/expired token or no matching account: renders a
themed HTML error page (not JSON — this loads directly in the wp-admin
iframe) using the same design tokens as the rest of the admin UI.
Requires `ADMIN_APP_PUBLIC_URL` to be a public HTTPS domain sharing a
registrable domain with the WordPress site — Chrome's Private Network Access
policy blocks a public `https://` page from embedding a private-network
(`localhost`/LAN) iframe target.

### `POST /admin/change-password`
Body `{ current_password, new_password }` (new must be ≥8 chars and differ).
Updates the hash and clears `must_change_password`. Required before any other
`/admin/*` route while the flag is set (those return 403 `must_change_password`).
All other `/admin/*` routes return 401 without a valid session.


### `POST /admin/scan`
Body `{ url }`. Fetches (robots-checked) + extracts + assigns the page a
category **first** (from its own signals), then — if a template for that
`(category, domain)` exists — runs the variance check against it. Returns the
plain-language candidate checklist:

    { source_url, domain, category, title, description, robots_ok, content_signal,
      mode: "template_confirm"|"full_review"|"blocked"|"no_category",
      template: { id, auto_publish, clean_streak, matched, reason } | null,
      candidates: [ { key, label, value, where, defaultChecked, kind:"field"|"image",
                      imageUrl?, role?, numeric? }, ... ],
      variance: { expected, deviations, missing, unmatched, structural, variance_pct,
                  detail: [ { field_name, label, kind:"missing"|"unmatched"|"structural", detail } ] } | null,
      variance_threshold_pct: <number> | null,
      variance_high: <bool> }

`variance_high:true` means this page exceeds the category's threshold and will be
routed to the review queue for manual review **even if the category is already
trusted (auto-publish)**. `where` is a plain-language location (`Side info box`,
`Body text`, `Data table`, `Image`, `Navigation`, `Footer`, …) — never a CSS
selector. Real specs are `defaultChecked:true`; nav/ads/footer are `false`.

### `POST /admin/confirm`
Body `{ url, selections: [ { key, field_name, target:"attribute"|"summary"|"relation"|"image"|"ignore", role?, relation_type? } ], category?, maxPages? }`.
Generalizes the selections into a reusable `(category, domain)` template, builds
the entity draft (resolving cross-category links), diffs vs live, enqueues, and
publishes. Then AUTOMATICALLY starts a background batch that discovers the rest
of the category and runs every page through the template (each still lands in
the review queue unless the template has earned auto-publish). Batch size caps
at `maxPages` (default `SCRAPER_BATCH_MAX_PAGES`, 50).
→ `{ template_id, queue_id, entity_id, diff, link_suggestions, published, auto_publish_now_on, batch_id, category }`.

### `GET /admin/batch/:id`
Progress of an auto-started category batch (polled by the UI for
"Processing X of Y pages…"). → `{ batch_id, template_id, category, domain,
seed_url, total, processed_count, current_url, status:
"discovering"|"running"|"done"|"error", started_at, finished_at, results:
[ { url, entity_id, status, matched, expected, queue_id?, auto_published? } ], error? }`.
Batches are in-memory (lost on restart); pages already queued survive in `review_queue`.

### `POST /admin/apply-category`
Body `{ url, category, maxPages? }`. Manual re-run of the same discovery+apply
the auto batch performs: discovers other pages in the category (via the site's
MediaWiki API, preferring the seed page's own wiki categories from the template's
match signals) and applies the saved template to each. Missing fields
→ null; no-match pages → flagged `mismatch` (never published). Each matched page
gets a **variance check** vs the category template + threshold: HIGH-variance
pages are queued (`status: queued_high_variance`) **even if the template is
trusted**; LOW-variance pages auto-publish only if the template has earned it.
→ `{ template_id, category, domain, processed: [ { url, entity_id, status, matched, expected, queue_id?, auto_published?, variance_pct?, variance_high? } ] }`.

### `GET /admin/queue?status=` and `GET /admin/queue/:id`
List / fetch review-queue items. List rows include `variance` and `routed_reason`;
`:id` returns the full `proposed` draft + `diff` + `link_suggestions` +
`variance`/`variance_detail`/`extraction`/`routed_reason`. `status` may be any of
`pending`/`published`/`mismatch`/`rejected`/`auto_completed`.

### `POST /admin/queue/:id/publish`
Body `{ edited?: bool, proposed?: <draft> }`. Publishes a queued item into the
live schema. `edited:true` (or any correction) resets the template's trust streak;
a clean approve advances it (auto-publish at 3). → `{ published, entityId, autoPublishNowOn }`.
When a clean approve crosses the trust threshold, the category's pending queue is
automatically **re-weighed** (see `/admin/templates/:id/reweigh`).

### `GET /admin/templates`
Saved templates with trust status: `{ id, category, domain, field_count, clean_streak, auto_publish }`.

### `GET /admin/templates/:id`
Full template incl. `field_map` (for the refine editor):
`{ id, category, domain, entity_type, field_map, match_signals, clean_streak, auto_publish }`.

### `POST /admin/templates/:id/refine`
Body `{ field_map: [ { field_name, match_by, label, where, is_image, role?, target, relation_type? } ] }`.
"Solve"/refine a template's field map from the category management page. This does
**not** reset the trust streak (it's a template change, not a reviewer confirm),
then re-weighs the category's pending queue against the updated template.
→ `{ template_id, reweigh: <ReweighResult> }`.

### `POST /admin/templates/:id/reweigh`
Manually trigger the same re-weigh the trust-cross and template-solve fire
automatically: recompute each pending item's variance from its stored extraction
snapshot vs the current template; items now within threshold auto-complete
(published + `status:auto_completed`), the rest stay queued. →
`ReweighResult = { template_id, category, domain, threshold_pct, trigger,
auto_completed:[{queue_id,entity_id,variance_pct}], still_queued:[…], skipped:[…] }`.

### `GET /admin/categories/tree`
The category/subcategory taxonomy tree with live pending-item badge counts, for
the category management page. → `{ default_variance_threshold_pct,
tree: [ { slug, display_name, parent_slug, is_group, variance_threshold_pct,
effective_threshold_pct, threshold_is_default, pending_count, subtree_pending,
children:[…] } ] }`. `pending_count` = this leaf's own pending queue items;
`subtree_pending` = rolled up over the node + all descendants (drives group badges).

### `GET /admin/categories`
Flat list for pickers/tables: `{ default_variance_threshold_pct, items:[ CategoryRow ] }`.

### `POST /admin/categories/:slug/threshold`
Body `{ variance_threshold_pct: <0–100> | null }`. Set (or clear → default) a leaf
category's variance threshold. Grouping nodes reject a non-null threshold.
→ the updated `CategoryRow`.

### `POST /admin/categories`
Body `{ display_name, parent_slug?, is_group?, slug?, description? }`. Create a
category or subcategory (slug auto-derived from the name if not given).
→ the new `CategoryRow`.

### `POST /admin/categories/:slug`
Body `{ display_name?, description?, parent_slug? }` (any subset). Rename /
describe / reparent a category. Reparenting is cycle-guarded (can't nest a
category under its own descendant). → the updated `CategoryRow`.

### `POST /admin/categories/:slug/delete`
Delete a category. Rejects the 12 canonical leaf slugs and any node that still
has children or assigned entities. → `{ deleted: slug }`.

### `POST /admin/entities/:id/images`
Body `{ url, caption?, role?, replace? }`. Manually add or replace an image on any
entity, independent of scraping. Admin-added images get `added_by:'admin'` and a
"verify license" note. → `{ entity_id, images }`.

### `GET /admin/log`
Tail of `scrape_log` (source URL + action + timestamp) for auditing.

### `GET /admin/wiki-preview/:id`
Live wiki-view proxy for the admin UI's split-panel preview. Fetches
`GET /v1/entities/:id` from the core API **as the wiki client** (server-side,
using `WIKI_API_KEY` from env — the browser never sees the key; base URL from
`ADMIN_API_BASE`, default `http://127.0.0.1:3000`, `http://api:3000` in
compose). Returns `{ api_status, fetched_at, entity, error }` with the API's
status passed through untouched — a 404 here means the wiki genuinely gets a
404. Used by the Entities editor and review-queue split views; no `/v1`
endpoint was added or changed for this feature.

## Entities admin (manual categorization + cross-linking)
Manage EXISTING saved entities directly (the admin UI "Entities" tab). Every
mutation republishes through `upsertEntity`, so `ai_context` + embedding
regenerate automatically. Actions are logged to `scrape_log`
(`categorize`/`link_add`/`link_remove`).

### `GET /admin/meta`
`{ categories: [...], relation_types: [...] }` — the pickers for the UI.
`categories` = the 12 canonical + any admin-created non-group leaf (so new
subcategories are assignable to entities).

### `GET /admin/entities?q=&category=&status=`
Browse/search saved entities (matches id, name, or alias; optional `category=`
filters to one leaf slug — powers the tree-based browsing in the Entities tab).
`status=removed` includes soft-deleted entities (excluded by default, matching
the public API) — this is the "Removed" filter in the Entities tab. →
`{ items: [ { id, name, type, category, status, aliases, relation_count } ] }`.

### `GET /admin/entities/:id`
Full entity for the editor, relations resolved to names:
`{ id, name, type, category, aliases, summary, body, attributes, images, source,
   game_version, status, freshness_class, ai_context,
   relations: [ { type, target_id, target_name, target_type, broken } ] }`.

### `POST /admin/entities/:id`
Full field-level edit — the single plain-language edit path (no raw JSON). Body is
a partial patch; only provided keys change:
`{ name?, summary?, body?, aliases?, attributes?, images?, relations?, source?,
   game_version?, status?, category? }`. `attributes`/`images`/`relations` fully
replace when provided; empty string → null (never guessed); relation targets are
validated to exist; `source.hidden` toggles public source suppression; `category`
also sets the base type. Republishes via `upsertEntity` (regenerates ai_context +
embedding). → the updated entity (same shape as `GET /admin/entities/:id`).

### `POST /admin/entities/:id/category`
Body `{ category }` (one of `/admin/meta` categories). Sets the base
`entities.type` and `attributes.category` (ship/manufacturer/weapon map to base
type `item`), then republishes. → updated entity, or 400.

### `POST /admin/entities/:id/relations`
Body `{ relation_type, target_id }`. Adds a cross-link to another entity
(relation_type from the list or free-text). Rejects self-links and links to
non-existent targets (link only to real entities). → updated entity, or 400.

### `POST /admin/entities/:id/relations/remove`
Body `{ relation_type, target_id }`. Removes a cross-link. → updated entity.

## Tiered entity delete (soft-delete, restore, hard-delete) + audit trail
Every state-changing action here snapshots the full entity into
`entity_audit_log` (migration `0007`) **before** applying the change, so
nothing is lost even on a hard delete.

### `POST /admin/entities/:id/remove`
Soft-delete ("Remove entry"): sets `status='removed'` and republishes. A
removed entity is excluded from `GET /v1/entities`, 404s on
`GET /v1/entities/:id` (and `/relations`, `/ai-context`), disappears from
WordPress rendering and category counts (all read the public API), but stays
in the DB and can be restored. → updated entity, or 400.

### `POST /admin/entities/:id/restore`
Restores a removed entity to `status='current'` and republishes — reappears
everywhere the public API is read from. 400 if the entity isn't removed.

### `POST /admin/entities/:id/hard-delete`
Permanently deletes the row (embeddings cascade via `ON DELETE CASCADE`).
Friction is enforced **server-side** by the caller's role (never trust a
client-supplied role):
- `super_admin`: body `{ "confirm": true }` — a single explicit confirmation.
- `admin`: body `{ "confirm_name": "<exact entity name>" }` — must match
  `entities.name` exactly, or `400 { code: "name_mismatch" }`.

→ `{ id, deleted: true }`, or 400 if the confirmation didn't match/wasn't given.

### `GET /admin/entities/:id/audit`
Audit trail for one entity: `{ items: [ { id, action, snapshot, performed_by,
created_at } ] }`, `action` ∈ `soft_delete`/`restore`/`hard_delete`, newest first.

## Field corroboration + corrections review queue
Field-level "green confirm" / "red flag" signals submitted from a live wiki
page (`POST /v1/entities/:id/fields/{confirm,flag}`, migration `0008`). This
is distinct from the scraper's `review_queue` above.

### `GET /admin/entities/:id/confirmations`
Recorded confirm signals for one entity (the admin-tool-side proof that a
wiki click actually persisted — not just a frontend checkmark):
`{ items: [ { id, field_name, current_value, submitted_by, created_at } ] }`.

### `GET /admin/corrections?status=`
List field corrections (`status` ∈ `pending`/`accepted`/`rejected`, omit for
all). → `{ items: [ { id, entity_id, entity_name, field_name, current_value,
suggested_value, note, submitted_by, status, reviewed_by, reviewed_at,
created_at } ] }`.

### `POST /admin/corrections/:id/accept`
Applies `suggested_value` to the entity field (`field_name` encodes
`name`/`summary`/`body`/`attr:<key>`) via `updateEntity` — regenerates
`ai_context` + embedding — then marks the correction `accepted` with
`reviewed_by` set to the approving admin (attribution: `submitted_by` = who
flagged it, `reviewed_by` = who approved it). → the correction record, or 400
if already reviewed or the entity no longer exists.

### `POST /admin/corrections/:id/reject`
Marks the correction `rejected` with `reviewed_by` set; no entity change. →
the correction record, or 400 if already reviewed.

---

# Trade-submit app (Phase 3) — web form + bot-style command

Separate service in `apps/trade-submit`, default `http://127.0.0.1:5000`
(`TRADE_SUBMIT_PORT`). Serves a plain web form at `/` and forwards every
submission to the core API's `POST /v1/trade-routes/submit` — it never writes
the DB directly (no parallel path). Bearer key from `TRADE_SUBMIT_API_KEY`.

### `POST /submit`  (web form)
Body `{ commodity, origin, destination, buy?, sell?, account? }`. Forwards to
`/v1/trade-routes/submit`. Returns the core API's submission outcome verbatim.

### `POST /command`  (bot-style, CLI/HTTP-testable now, bot-ready later)
Body `{ text, account? }` where `text` is the raw command a future Discord/Twitch
bot will forward verbatim:

    !trade submit <commodity> <origin> <destination> <buy> <sell>

Multi-word names may be quoted (`"Port Tressler"`); prices accept `1,234`,
`1.5k`, `2m`, `2650aUEC`. Parsed by `apps/trade-submit/src/command-parser.ts`.
→ `{ parsed, api_status, result, reply_text }` (a bot-friendly one-line reply).
Malformed commands → 400 with a usage message (nothing forwarded).

### `POST /confirm/:id`
Body `{ account? }`. Forwards to `/v1/trade-routes/:id/confirm`.

### `GET /info`
`{ app, API_BASE, API_KEY_client }` — which core API and client key it uses.
