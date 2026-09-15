-- 0011_trade_route_verified_submitter.sql — Phase 10: track whether a trade
-- route's current data came from (or was corroborated by) an RSI-handle-
-- verified WordPress account. Enables a trust boost (skip straight to
-- 'corroborated' confidence on first submission, per the existing confidence
-- ladder in trade-submissions.ts) without inventing a new confidence value —
-- the ladder stays community -> corroborated -> confirmed. This is purely
-- additive metadata for transparency (per the cross-phase rule: never present
-- something as more trustworthy than it actually is without saying why).

ALTER TABLE trade_route_submissions
  ADD COLUMN IF NOT EXISTS rsi_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rsi_verified_handle TEXT; -- the verified RSI handle, when rsi_verified=true
