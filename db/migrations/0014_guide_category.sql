-- 0014_guide_category.sql — Phase 22: instructional guides (how pilots learn
-- to do a specific task — mining, quantum travel, docking, combat, ...),
-- sourced from creator-submitted YouTube tutorials and structured by a local
-- LLM extraction pass (see apps/admin/src/import-youtube-guide.ts).
--
-- No entities.type migration needed: guides follow the same pattern already
-- used by ship/weapon/manufacturer (type='item', attributes.category='<leaf>')
-- confirmed live (ship_carrack/manufacturer_gold_horizon are both type='item').
-- This migration only adds the 'guide' leaf category (+ its own top-level
-- group, distinct from 'mechanic' which explains a system rather than
-- teaching a walkthrough) so it shows up correctly in the categories tree,
-- counts, and public /v1/categories.

INSERT INTO categories (slug, display_name, parent_slug, is_group, sort_order) VALUES
  ('grp_guides', 'Guides & Tutorials', NULL, true, 70)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, display_name, parent_slug, is_group, sort_order, description) VALUES
  ('guide', 'Guide', 'grp_guides', false, 71,
   'Step-by-step task walkthroughs for pilots (mining, quantum travel, docking, combat, ...), extracted from creator-submitted YouTube tutorials. Community-sourced — confidence never exceeds ''community'' since accuracy depends on both the original creator and automated extraction.')
ON CONFLICT (slug) DO NOTHING;
