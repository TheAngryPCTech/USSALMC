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
/db
migrations/ — every schema change is a numbered migration file
seed/ — seed data scripts (example entities from Phase 1)
/apps
api/ — the core REST API service
admin/ — the scraper + admin review web UI
bots/
discord/
twitch/
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
