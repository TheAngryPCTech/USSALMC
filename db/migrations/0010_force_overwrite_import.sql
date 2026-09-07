-- 0010_force_overwrite_import.sql — support for the connector's one-time
-- --force-overwrite bulk import (Phase 9): track which entities have ever
-- been manually edited by an admin (so a force-overwrite can distinguish
-- "clean" scraper-only entities from ones that had human edits clobbered),
-- extend the existing entity_audit_log so a force-overwrite can snapshot the
-- pre-overwrite state the same way soft/hard-delete already do, and add
-- resumable job/progress tables so a multi-day rate-limited bulk pull can
-- pick back up where it left off across process restarts.

-- Set ONLY by the manual-edit surface (entities-admin.ts), never by the
-- normal scraper publish path (upsertEntity does not reference this column
-- at all, by design — so ordinary connector runs cannot change it either
-- way). This is the signal the force-overwrite job checks before clobbering.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS edited_by_admin BOOLEAN NOT NULL DEFAULT false;

-- Reuse the existing snapshot-before-destructive-change mechanism (Phase 7)
-- for the new "about to be overwritten by a force-overwrite import" case.
ALTER TABLE entity_audit_log DROP CONSTRAINT IF EXISTS entity_audit_log_action_check;
ALTER TABLE entity_audit_log ADD CONSTRAINT entity_audit_log_action_check
  CHECK (action IN ('soft_delete', 'restore', 'hard_delete', 'connector_force_overwrite'));

-- One row per bulk-import invocation-series, keyed by a stable job_key so
-- re-running the same logical job (same categories, same purpose) resumes
-- instead of starting over. `summary` holds running per-category totals so a
-- final report can be produced even if the process exits mid-run.
CREATE TABLE IF NOT EXISTS bulk_import_jobs (
  id           BIGSERIAL PRIMARY KEY,
  job_key      TEXT NOT NULL UNIQUE,
  categories   JSONB NOT NULL,
  force_overwrite BOOLEAN NOT NULL DEFAULT false,
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'paused_rate_limit', 'done', 'error')),
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per URL the job has finished with (done/skipped/error), so a
-- resumed run can skip already-processed pages instead of re-fetching them
-- (which would both waste the daily fetch budget and be pointless work).
CREATE TABLE IF NOT EXISTS bulk_import_progress (
  job_id       BIGINT NOT NULL REFERENCES bulk_import_jobs(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  url          TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('done', 'skipped', 'error')),
  outcome      TEXT CHECK (outcome IN ('created', 'overwritten_clean', 'overwritten_manual', NULL)),
  entity_id    TEXT,
  note         TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, url)
);
