-- 0001_init.sql — initial schema for USSA Lore Master Core (Phase 1)
-- Document-per-entity model: one generic `entities` table with type + JSONB data.
-- pgvector for semantic search. See /docs/schema.md for the canonical field list.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- entities: one row per knowledge entity, regardless of type.
-- Structured columns exist for the fields we filter/sort/join on;
-- everything flexible lives in `data` (JSONB) per the schema doc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
  id             TEXT PRIMARY KEY,                       -- <type>_<slug>, e.g. ship_carrack
  type           TEXT NOT NULL CHECK (type IN (
                   'item','npc','location','mechanic','quest',
                   'lore','patch_note','commodity','trade_route')),
  name           TEXT NOT NULL,
  aliases        JSONB NOT NULL DEFAULT '[]'::jsonb,     -- string[]
  summary        TEXT,
  body           TEXT,                                   -- markdown
  attributes     JSONB NOT NULL DEFAULT '{}'::jsonb,     -- flexible key/value
  relations      JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{type, target_id}]
  images         JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{url,caption,role,added_by,source_url,license_note}]
  source         JSONB NOT NULL DEFAULT '{}'::jsonb,     -- {origin,url,confidence,last_verified}
  game_version   TEXT,
  status         TEXT NOT NULL DEFAULT 'current'
                   CHECK (status IN ('current','deprecated','removed')),
  freshness_class TEXT NOT NULL DEFAULT 'static'
                   CHECK (freshness_class IN ('static','volatile')),
  ai_context     TEXT,                                   -- auto-generated prose, never hand-written
  embedding_id   TEXT,                                   -- FK-ish link to embeddings.id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entities_type          ON entities (type);
CREATE INDEX IF NOT EXISTS idx_entities_game_version  ON entities (game_version);
CREATE INDEX IF NOT EXISTS idx_entities_status        ON entities (status);
CREATE INDEX IF NOT EXISTS idx_entities_attributes    ON entities USING gin (attributes);
CREATE INDEX IF NOT EXISTS idx_entities_relations     ON entities USING gin (relations);
-- keyword full-text search across name, summary, body, ai_context
CREATE INDEX IF NOT EXISTS idx_entities_fts ON entities USING gin (
  to_tsvector('english',
    coalesce(name,'') || ' ' || coalesce(summary,'') || ' ' ||
    coalesce(body,'') || ' ' || coalesce(ai_context,''))
);

-- ---------------------------------------------------------------------------
-- embeddings: vector store on the same Postgres instance (pgvector).
-- 384 dims = all-MiniLM-L6-v2. `provider` records how it was produced.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embeddings (
  id          TEXT PRIMARY KEY,             -- emb_<entity_id>
  entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  vector      vector(384) NOT NULL,
  provider    TEXT NOT NULL,               -- 'xenova/all-MiniLM-L6-v2' or 'hashed-fallback'
  source_text TEXT NOT NULL,               -- the ai_context text that was embedded
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings (entity_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector
  ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);

-- ---------------------------------------------------------------------------
-- api_keys: per-client keys (wiki/mobile/desktop/discord/twitch), each with
-- its own rate limit + separate auditing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id                TEXT PRIMARY KEY,        -- key_<client>
  client            TEXT NOT NULL UNIQUE
                      CHECK (client IN ('wiki','mobile','desktop','discord','twitch')),
  key_hash          TEXT NOT NULL,           -- sha256 of the bearer token
  rate_limit_per_min INTEGER NOT NULL DEFAULT 120,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- api_audit_log: one row per authenticated request, per client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  client       TEXT,
  api_key_id   TEXT,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  status_code  INTEGER,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_client ON api_audit_log (client, created_at);

-- ---------------------------------------------------------------------------
-- feedback: POST /v1/feedback sink.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id          BIGSERIAL PRIMARY KEY,
  entity_id   TEXT,
  client      TEXT,
  kind        TEXT,                          -- 'correction' | 'rating' | 'comment' | ...
  message     TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- trade_route_submissions: community-submitted trade routes awaiting confirm.
-- Confirmed submissions get promoted into an `entities` row of type trade_route.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_route_submissions (
  id             TEXT PRIMARY KEY,           -- trade_route_NNNN
  commodity      TEXT NOT NULL,
  from_location  TEXT NOT NULL,
  to_location    TEXT NOT NULL,
  buy_price      NUMERIC,
  sell_price     NUMERIC,
  profit_per_unit NUMERIC,
  submitted_by   TEXT,                       -- client name
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','rejected')),
  confirmations  INTEGER NOT NULL DEFAULT 0,
  last_verified  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tr_commodity ON trade_route_submissions (commodity);
CREATE INDEX IF NOT EXISTS idx_tr_from      ON trade_route_submissions (from_location);
