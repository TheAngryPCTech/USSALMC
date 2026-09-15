-- 0012_portal_api_key_client.sql — Phase 10: add 'portal' as a valid api_keys
-- client, distinct from 'wiki'. The portal plugin's existing read-only widgets
-- keep using the shared wiki key, but its new gated trade-submission path
-- (which asserts rsi_verified=true on POST /v1/trade-routes/submit) needs its
-- OWN key so the API can tell "this really is the RSI-verification-gated
-- portal code" apart from any other caller holding the shared wiki key (which
-- includes the fully anonymous, no-login trade-submit app) — otherwise any
-- client could just claim rsi_verified:true and get an unearned trust boost.

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_client_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_client_check
  CHECK (client IN ('wiki','mobile','desktop','discord','twitch','portal'));
