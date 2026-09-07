-- 0002_admin_scraper.sql — Phase 2: template-driven scraper + review pipeline.
-- Builds on 0001 (entities/embeddings/etc). Nothing from 0001 is altered.

-- ---------------------------------------------------------------------------
-- scrape_templates: a reusable extraction template keyed by (category, domain).
-- Matches fields by label text / structural role, NOT fixed CSS paths, so it
-- survives minor markup changes. Tracks a clean-confirm streak for the
-- trust-threshold auto-publish behavior.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_templates (
  id             TEXT PRIMARY KEY,             -- tpl_<category-slug>_<domain>_v<N>
  category       TEXT NOT NULL,                -- e.g. 'ship'
  domain         TEXT NOT NULL,                -- e.g. 'starcitizen.tools'
  entity_type    TEXT NOT NULL DEFAULT 'item', -- target entities.type
  -- field_map: [{ field_name, match_by:'label_text'|'structural_role',
  --              label, where, default_checked, is_image, role }]
  field_map      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- match signals used to recognize a page belongs to this category
  match_signals  JSONB NOT NULL DEFAULT '{}'::jsonb, -- {categories:[], title_patterns:[], label_hints:[]}
  clean_streak   INTEGER NOT NULL DEFAULT 0,   -- consecutive clean confirms
  auto_publish   BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category, domain)
);

-- ---------------------------------------------------------------------------
-- review_queue: every extracted/changed entity passes diff -> review -> publish.
-- `proposed` is the full entity draft; `diff` is the field-level change vs the
-- current live entity (if any). status flows pending -> published / mismatch /
-- rejected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_queue (
  id            BIGSERIAL PRIMARY KEY,
  source_url    TEXT NOT NULL,
  domain        TEXT,
  category      TEXT,
  template_id   TEXT,
  entity_id     TEXT NOT NULL,                 -- target entity id (ship_<slug>)
  proposed      JSONB NOT NULL,                -- full UpsertInput draft
  diff          JSONB NOT NULL DEFAULT '{}'::jsonb,
  link_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','published','mismatch','rejected')),
  note          TEXT,
  auto_published BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_review_entity ON review_queue (entity_id);

-- ---------------------------------------------------------------------------
-- scrape_log: append-only audit of everything the scraper does, with URL + ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_log (
  id          BIGSERIAL PRIMARY KEY,
  source_url  TEXT,
  action      TEXT NOT NULL,   -- 'scan','confirm','apply','publish','mismatch','robots_block','image_add'
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scrapelog_action ON scrape_log (action, created_at);
