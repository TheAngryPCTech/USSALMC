-- 0005_categories_variance.sql — Phase 5: category taxonomy tree + per-category
-- variance threshold, plus the variance/extraction snapshot on review_queue that
-- powers variance-based queue routing and re-weigh-on-template-solve.
-- Builds on 0002 (scrape_templates / review_queue). Idempotent (IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- categories: the category/subcategory taxonomy shown as a tree in the admin.
-- `parent_slug` NULL = a top-level group; a leaf category (ship/weapon/...) is
-- the slug templates + entities already key on (attributes.category), so the
-- tree layers a display hierarchy over the existing flat model without moving
-- any data. `variance_threshold_pct` NULL = fall back to the configurable
-- default (SCRAPER_VARIANCE_THRESHOLD_PCT); set per leaf category from the
-- category management page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  slug                   TEXT PRIMARY KEY,          -- 'ship', 'grp_vehicles', ...
  display_name           TEXT NOT NULL,
  parent_slug            TEXT REFERENCES categories(slug) ON DELETE SET NULL,
  is_group               BOOLEAN NOT NULL DEFAULT false, -- true = grouping node, not a real entity category
  variance_threshold_pct NUMERIC,                   -- NULL = use configured default
  sort_order             INTEGER NOT NULL DEFAULT 100,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_slug);

-- ---------------------------------------------------------------------------
-- review_queue: carry the variance measure + the extraction snapshot so the
-- queue can be re-weighed against an updated template WITHOUT re-fetching the
-- page. `extraction` is the plain field-candidate snapshot captured at scan
-- time; `variance_detail` breaks the score into missing/unmatched/structural.
-- ---------------------------------------------------------------------------
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS variance NUMERIC;             -- % of expected template fields deviating
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS variance_detail JSONB;        -- { expected, missing, unmatched, structural, deviations }
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS extraction JSONB;             -- ExtractionResult snapshot for re-weigh
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS routed_reason TEXT;           -- why it landed here (e.g. 'high_variance')

-- allow 'auto_completed' as a distinct terminal status (re-weigh resolved it).
-- The 0002 CHECK only allowed pending/published/mismatch/rejected; widen it.
ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_status_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_status_check
  CHECK (status IN ('pending','published','mismatch','rejected','auto_completed'));

-- ---------------------------------------------------------------------------
-- Seed the taxonomy: 6 top-level groups + the 12 existing leaf categories.
-- Leaf slugs match apps/admin CATEGORIES exactly so templates/entities line up.
-- ON CONFLICT DO NOTHING keeps admin-edited thresholds/names on re-run.
-- ---------------------------------------------------------------------------
INSERT INTO categories (slug, display_name, parent_slug, is_group, sort_order) VALUES
  ('grp_vehicles',      'Vehicles',      NULL, true, 10),
  ('grp_organizations', 'Organizations', NULL, true, 20),
  ('grp_equipment',     'Equipment',     NULL, true, 30),
  ('grp_world',         'World',         NULL, true, 40),
  ('grp_gameplay',      'Gameplay',      NULL, true, 50),
  ('grp_meta',          'Lore & Meta',   NULL, true, 60)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, display_name, parent_slug, is_group, sort_order) VALUES
  ('ship',         'Ship',         'grp_vehicles',      false, 11),
  ('manufacturer', 'Manufacturer', 'grp_organizations', false, 21),
  ('weapon',       'Weapon',       'grp_equipment',     false, 31),
  ('item',         'Item',         'grp_equipment',     false, 32),
  ('location',     'Location',     'grp_world',         false, 41),
  ('commodity',    'Commodity',    'grp_world',         false, 42),
  ('npc',          'NPC',          'grp_world',         false, 43),
  ('mechanic',     'Mechanic',     'grp_gameplay',      false, 51),
  ('quest',        'Quest',        'grp_gameplay',      false, 52),
  ('lore',         'Lore',         'grp_meta',          false, 61),
  ('patch_note',   'Patch note',   'grp_meta',          false, 62),
  ('trade_route',  'Trade route',  'grp_meta',          false, 63)
ON CONFLICT (slug) DO NOTHING;
