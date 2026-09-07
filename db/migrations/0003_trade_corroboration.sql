-- 0003_trade_corroboration.sql — Phase 3: trade-route submission intelligence.
-- Enhances the existing trade_route_submissions table (from 0001) with
-- normalization, a confidence ladder, corroboration, price history, and abuse
-- flagging. Adds an events table used for per-account rate limiting + abuse
-- detection. Nothing from 0001/0002 is dropped.

-- --- confidence ladder + corroboration + history on the existing table ---
ALTER TABLE trade_route_submissions
  ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'community'
    CHECK (confidence IN ('community','corroborated','confirmed')),
  ADD COLUMN IF NOT EXISTS corroboration_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS submitter_account TEXT,          -- the reporting user/handle
  ADD COLUMN IF NOT EXISTS contributor_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS price_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT,
  -- normalized identity (matched against existing entities; no duplicates created)
  ADD COLUMN IF NOT EXISTS commodity_entity_id TEXT,
  ADD COLUMN IF NOT EXISTS from_entity_id TEXT,
  ADD COLUMN IF NOT EXISTS to_entity_id TEXT,
  ADD COLUMN IF NOT EXISTS route_key TEXT;                  -- normalized commodity|from|to

CREATE INDEX IF NOT EXISTS idx_tr_route_key ON trade_route_submissions (route_key);
CREATE INDEX IF NOT EXISTS idx_tr_account   ON trade_route_submissions (submitter_account);

-- price_history entries look like:
--   { buy_price, sell_price, profit_per_unit, account, reported_at, event }
--   event ∈ 'initial' | 'corroboration' | 'conflict-superseded'

-- --- per-account event log for rate limiting + abuse detection ---
CREATE TABLE IF NOT EXISTS trade_submission_events (
  id          BIGSERIAL PRIMARY KEY,
  account     TEXT,                 -- reporting user handle (NOT the API client)
  client      TEXT,                 -- API client key used (wiki/mobile/...)
  ip          TEXT,
  route_key   TEXT,
  submission_id TEXT,
  action      TEXT NOT NULL,        -- 'submit'|'corroborate'|'conflict'|'flag_abuse'|'rate_limited'|'confirm'
  buy_price   NUMERIC,
  sell_price  NUMERIC,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tse_account ON trade_submission_events (account, created_at);
CREATE INDEX IF NOT EXISTS idx_tse_route   ON trade_submission_events (route_key, created_at);
