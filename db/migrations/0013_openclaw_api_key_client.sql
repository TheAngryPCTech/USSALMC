-- 0013_openclaw_api_key_client.sql — Phase 21: add 'openclaw' as a valid
-- api_keys client. Backs the OpenClaw MCP server (apps/openclaw-mcp) that
-- gives the user's already-running local OpenClaw agent (angrydaemon,
-- ollama/qwen3.6:27b) real read-only tools over the knowledge base —
-- one MCP server, one key, reused across every channel that agent is
-- connected to (Discord already; Twitch the moment it's enabled), rather
-- than a separate 'discord'/'twitch' bot key per channel. The existing
-- 'discord'/'twitch' client values from Phase 1 assumed separate bot
-- codebases per channel; this is a single unified gateway instead, so it
-- gets its own identity rather than overloading either of those.

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_client_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_client_check
  CHECK (client IN ('wiki','mobile','desktop','discord','twitch','portal','openclaw'));
