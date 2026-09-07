-- 0008_field_corrections.sql — field-level corroboration (green confirm) and
-- correction (red flag) signals submitted from the live wiki, plus the review
-- queue for corrections and a rate-limit/abuse event log (mirrors the Phase 3
-- trade_submission_events pattern for the same purpose, scoped to this feature).

-- A "confirm" is a lightweight corroboration signal: no review needed, just a
-- count of people who vouched for the field's current value.
CREATE TABLE IF NOT EXISTS field_confirmations (
  id            BIGSERIAL PRIMARY KEY,
  entity_id     TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  field_name    TEXT NOT NULL,       -- 'name' | 'summary' | 'body' | 'attr:<key>'
  current_value TEXT,                -- value at the time it was confirmed (for context)
  submitted_by  TEXT NOT NULL DEFAULT 'anonymous',   -- WP username, or 'anonymous'
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_field_confirmations_entity ON field_confirmations (entity_id, field_name);

-- A "flag" is a proposed correction: sits in review until an admin accepts or
-- rejects it. Accepting applies suggested_value to the entity.
CREATE TABLE IF NOT EXISTS field_corrections (
  id              BIGSERIAL PRIMARY KEY,
  entity_id       TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  field_name      TEXT NOT NULL,
  current_value   TEXT,
  suggested_value TEXT NOT NULL,
  note            TEXT,
  submitted_by    TEXT NOT NULL DEFAULT 'anonymous',
  ip              TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_field_corrections_status ON field_corrections (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_corrections_entity ON field_corrections (entity_id);

-- Per-account/IP audit for rate limiting confirm/flag submissions, mirroring
-- trade_submission_events (Phase 3) for the same abuse-prevention reason.
CREATE TABLE IF NOT EXISTS wiki_signal_events (
  id           BIGSERIAL PRIMARY KEY,
  submitted_by TEXT NOT NULL,
  ip           TEXT,
  entity_id    TEXT,
  field_name   TEXT,
  action       TEXT NOT NULL CHECK (action IN ('confirm', 'flag', 'rate_limited')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wiki_signal_events_who ON wiki_signal_events (submitted_by, created_at DESC);
