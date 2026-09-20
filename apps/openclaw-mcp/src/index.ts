// index.ts — MCP stdio server exposing the USSALMC knowledge base
// (read-only) as tools for a local OpenClaw AI agent. Runs on the HOST
// (spawned directly by OpenClaw via its mcp.servers config — see
// docs/deployment.md Phase 21), talking to the core API over its published
// localhost port, same as any other client. Authenticates as the dedicated
// 'openclaw' api_keys client (migration 0013) — never the wiki key, so this
// surface can be revoked/rate-limited independently of the WordPress site.
//
// Every tool response carries confidence/source/freshness through untouched
// (never stripped or summarized away) — per the project's own cross-phase
// rule ("nothing gets presented as confirmed unless it actually is", "trade
// data is volatile, last_verified always surfaced"), the agent answering a
// Discord/Twitch user needs that same data to avoid stating community-
// sourced or stale info as settled fact.

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const API_BASE = (process.env.USSALMC_API_BASE || 'http://localhost:8090').replace(/\/+$/, '');
const API_KEY = process.env.USSALMC_API_KEY;
if (!API_KEY) {
  console.error('[ussalmc-mcp] USSALMC_API_KEY not set — refusing to start with no credentials.');
  process.exit(1);
}

async function apiGet(path: string): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

const server = new McpServer({ name: 'ussalmc', version: '0.1.0' });

server.tool(
  'ussalmc_search',
  'Hybrid keyword+semantic search over the USSA Lore Master Core (Star Citizen knowledge base — ships, commodities, weapons, locations, manufacturers, roadmap, trade routes, and more). Returns entity summaries with confidence and source. CHECK THIS FIRST for any name that could plausibly be a Star Citizen term — including ones that also have an unrelated real-world meaning, like "gold", "titanium", "hydrogen", "quantanium", "reclaimer", "constellation". Do not assume real-world meaning just because the user\'s phrasing sounds generic (e.g. "where can I sell gold" is ambiguous — check here before answering as if it meant real-world bullion). If a real match comes back, prefer it over general knowledge; only fall back to general/real-world knowledge once this search comes back empty or clearly irrelevant.',
  { query: z.string().describe('Search text, e.g. "carrack cargo capacity" or "gold best sell price"'), limit: z.number().int().min(1).max(25).optional() },
  async ({ query, limit }) => {
    const res = await apiGet(`/v1/search?q=${encodeURIComponent(query)}&limit=${limit ?? 10}`);
    if (!res.ok) return errorResult(res.body?.error?.message || `search failed (HTTP ${res.status})`);
    return textResult(res.body);
  },
);

server.tool(
  'ussalmc_get_entity',
  'REQUIRES a real id copied verbatim from a ussalmc_search or ussalmc_entities_by_category result (e.g. "ship_carrack", "commodity_gold", "trade_route_uex_654") — NEVER guess, construct, or invent an id from a plain name. A bare number (e.g. "8600", "3585") is NEVER a valid id here — if someone gives you a raw mining scan number, that is ussalmc_identify_signature\'s job, not this tool\'s. If you do not already have a confirmed id in hand, call ussalmc_search first. Returns full attributes, images, relations, confidence, source, and (for commodities) live UEX trade data with its own freshness age. NEVER state a price or trade fact from this without also conveying how old it is (the *_last_updated / age fields) — it changes constantly.',
  { id: z.string().describe('An exact entity id previously returned by ussalmc_search, e.g. "commodity_gold" — not a plain name like "gold" or "Gold".') },
  async ({ id }) => {
    const res = await apiGet(`/v1/entities/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      return errorResult(`No entity exists with id "${id}". Do not guess ids — call ussalmc_search with the plain name first, then reuse the exact "id" field from a result.`);
    }
    if (!res.ok) return errorResult(res.body?.error?.message || `entity lookup failed (HTTP ${res.status})`);
    return textResult(res.body);
  },
);

server.tool(
  'ussalmc_list_categories',
  'List every real category in the knowledge base with live entry counts (Ship, Commodity, Weapon, Location, Manufacturer, Star System, Roadmap Item, Trade route, ...). Use this to know what topics actually exist before claiming something isn\'t tracked.',
  {},
  async () => {
    const res = await apiGet('/v1/categories');
    if (!res.ok) return errorResult(res.body?.error?.message || `categories fetch failed (HTTP ${res.status})`);
    return textResult(res.body);
  },
);

server.tool(
  'ussalmc_entities_by_category',
  'List entities in one category (e.g. "ship", "commodity", "weapon", "trade_route", "guide", "quest") — use ussalmc_list_categories first to see real category slugs and counts. Paginated. Category "guide" holds step-by-step task walkthroughs (mining, quantum travel, docking, combat, ...) sourced from creator YouTube tutorials — use it whenever someone asks how to DO something, not just what something IS. Category "quest" holds 1,700+ real mission/contract templates (bounty hunting, cargo delivery, salvage, maintenance, ...) with reward aUEC, XP, standing requirements, legality, and community difficulty/satisfaction — use it (or ussalmc_search) whenever someone asks about missions, contracts, bounties, or "what can I do for money/rep".',
  { category: z.string(), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() },
  async ({ category, limit, offset }) => {
    const res = await apiGet(`/v1/entities?category=${encodeURIComponent(category)}&limit=${limit ?? 25}&offset=${offset ?? 0}`);
    if (!res.ok) return errorResult(res.body?.error?.message || `list failed (HTTP ${res.status})`);
    return textResult(res.body);
  },
);

server.tool(
  'ussalmc_identify_signature',
  '"Sig Ident" — use this whenever a pilot says they scanned a rock/deposit while mining and got a signature/scan number/reading and wants to know what ore it is (e.g. "I scanned a rock and got 8600, what is it?", "what ore is signature 3585?"). Turns that raw scan number into the actual ore name. Accepts an exact number (e.g. "8600"), a "~number" for ±10% tolerance (e.g. "~8600") if the reading might be approximate, or a "min-max" range (e.g. "8000-9000"). Do NOT call ussalmc_get_entity with a raw scan number as if it were an entity id — a bare number like "8600" or "3585" is a scan signature, not an entity id; use this tool instead. A signature can match multiple ores if their value bands overlap; return every match, don\'t just pick one. Values come from a community site (scmdb.net), never confidence "confirmed".',
  { q: z.string().describe('A scan value: "8600", "~8600", or "8000-9000"') },
  async ({ q }) => {
    const res = await apiGet(`/v1/mining/signature?q=${encodeURIComponent(q)}`);
    if (!res.ok) return errorResult(res.body?.error?.message || `signature lookup failed (HTTP ${res.status})`);
    return textResult(res.body);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[ussalmc-mcp] connected, base =', API_BASE);
