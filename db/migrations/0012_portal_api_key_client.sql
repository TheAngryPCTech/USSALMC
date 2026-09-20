-- 0012_portal_api_key_client.sql — Phase 10: add 'portal' as a valid api_keys
-- client, distinct from 'wiki'. The portal plugin's existing read-only widgets
-- keep using the shared wiki key, but its new gated trade-submission path
-- (which asserts rsi_verified=true on POST /v1/trade-routes/submit) needs its
-- OWN key so the API can tell "this really is the RSI-verification-gated
-- portal code" apart from any other caller holding the shared wiki key (which
-- includes the fully anonymous, no-login trade-submit app) — otherwise any
-- client could just claim rsi_verified:true and get an unearned trust boost.

-- NOTE: migrations replay in full on every container start (no per-migration
-- applied-tracking), so this list must stay a superset of every client any
-- later migration adds too (0013 adds 'openclaw') — otherwise, once real rows
-- exist with a later client value, THIS migration's replay fails outright
-- re-narrowing the constraint out from under them (hit live 2026-09-19: 0012
-- started failing the moment an 'openclaw' row existed, silently blocking
-- every migration after it, including 0014, from ever running again).
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_client_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_client_check
  CHECK (client IN ('wiki','mobile','desktop','discord','twitch','portal','openclaw'));
