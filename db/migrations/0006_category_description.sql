-- 0006_category_description.sql — Phase 6: category management.
-- Adds an editable description to categories so the admin can rename + describe
-- + reparent categories from the management page. Idempotent.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT;
