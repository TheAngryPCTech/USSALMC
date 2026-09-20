// import-uex-commodities.ts — enriches existing `commodity` entities in the
// knowledge base with real per-terminal trade data from UEX Corp
// (https://uexcorp.space — unofficial fan project, unaffiliated with
// CIG/RSI; ToS checked before building any UEX integration this session: no
// restriction on automated access, redistribution, or caching).
//
// Enrichment-only, same as enrichShips() in import-starcitizen-api.ts: matches
// UEX commodities against our EXISTING wiki-scraped commodity_* entities by
// normalized name and merges real trade attributes into `attributes` —
// never touches summary/body/images, never creates a new entity on a miss
// (avoids duplicate/fuzzy-matched entities). Real commodity trade data is
// volatile per the cross-phase rule, so every merged field carries its own
// `uex_last_updated` timestamp rather than being presented as a flat,
// undated fact.
//
// Usage: tsx src/import-uex-commodities.ts

import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';

const line = (s = '') => console.log(s);

function apiKey(): string {
  const k = process.env.UEX_API_KEY;
  if (!k) throw new Error('UEX_API_KEY not set.');
  return k;
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

interface UexAgg {
  name: string;
  idCommodity: number | null;
  bestSellPrice: number | null; bestSellTerminal: string | null; bestSellTerminalId: number | null;
  bestBuyPrice: number | null; bestBuyTerminal: string | null; bestBuyTerminalId: number | null;
  terminalCount: number;
  lastModified: number; // unix seconds, max across all rows for this commodity
}

async function fetchUexAggregates(): Promise<Map<string, UexAgg>> {
  const res = await fetch(`https://uexcorp.space/api/2.0/commodities_prices_all`, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`UEX API HTTP ${res.status}`);
  const body: any = await res.json();
  if (!Array.isArray(body?.data)) throw new Error('UEX API returned no data array.');

  const agg = new Map<string, UexAgg>();
  for (const row of body.data) {
    const name = row.commodity_name;
    if (!name) continue;
    const key = normName(name);
    let a = agg.get(key);
    if (!a) {
      a = { name, idCommodity: null, bestSellPrice: null, bestSellTerminal: null, bestSellTerminalId: null, bestBuyPrice: null, bestBuyTerminal: null, bestBuyTerminalId: null, terminalCount: 0, lastModified: 0 };
      agg.set(key, a);
    }
    a.idCommodity = Number(row.id_commodity) || a.idCommodity;
    a.terminalCount++;
    a.lastModified = Math.max(a.lastModified, Number(row.date_modified) || 0);
    // Best SELL = highest real price a terminal is actively paying (status_sell=1).
    const sell = Number(row.price_sell) || 0;
    if (row.status_sell && sell > 0 && (a.bestSellPrice === null || sell > a.bestSellPrice)) {
      a.bestSellPrice = sell;
      a.bestSellTerminal = row.terminal_name ?? null;
      a.bestSellTerminalId = Number(row.id_terminal) || null;
    }
    // Best BUY = lowest real price a terminal is actively charging (status_buy=1).
    const buy = Number(row.price_buy) || 0;
    if (row.status_buy && buy > 0 && (a.bestBuyPrice === null || buy < a.bestBuyPrice)) {
      a.bestBuyPrice = buy;
      a.bestBuyTerminal = row.terminal_name ?? null;
      a.bestBuyTerminalId = Number(row.id_terminal) || null;
    }
  }
  return agg;
}

async function main() {
  line('=== import-uex-commodities ===');
  const uex = await fetchUexAggregates();
  line(`[uex] ${uex.size} distinct real commodities from commodities_prices_all`);

  const existing = await query(
    `SELECT id, name FROM entities WHERE COALESCE(attributes->>'category', type) = 'commodity' AND status <> 'removed'`,
  );
  line(`[kb] ${existing.rows.length} existing commodity entities`);

  let matched = 0;
  const unmatched: string[] = [];
  for (const row of existing.rows as any[]) {
    const a = uex.get(normName(row.name));
    if (!a) { unmatched.push(row.name); continue; }
    const ent = await getEntity(row.id);
    if (!ent) continue;
    const mergedAttributes: Record<string, unknown> = {
      ...ent.attributes,
      uex_commodity_id: a.idCommodity,
      uex_best_sell_price: a.bestSellPrice,
      uex_best_sell_terminal: a.bestSellTerminal,
      uex_best_sell_terminal_id: a.bestSellTerminalId,
      uex_best_buy_price: a.bestBuyPrice,
      uex_best_buy_terminal: a.bestBuyTerminal,
      uex_best_buy_terminal_id: a.bestBuyTerminalId,
      uex_terminal_count: a.terminalCount,
      uex_last_updated: a.lastModified ? new Date(a.lastModified * 1000).toISOString() : null,
    };
    await upsertEntity({
      id: ent.id, type: ent.type, name: ent.name, aliases: ent.aliases,
      summary: ent.summary, body: ent.body, attributes: mergedAttributes,
      relations: ent.relations, images: ent.images, source: ent.source,
      game_version: ent.game_version, status: ent.status, freshness_class: ent.freshness_class,
    });
    matched++;
  }
  line(`[commodities] enriched ${matched} existing entities; ${unmatched.length} had no UEX match (left untouched)`);
  if (unmatched.length) line(`  no UEX match: ${unmatched.slice(0, 25).join(', ')}${unmatched.length > 25 ? ', ...' : ''}`);

  const uexOnly: string[] = [];
  const existingNorm = new Set((existing.rows as any[]).map((r) => normName(r.name)));
  for (const [key, a] of uex) {
    if (!existingNorm.has(key)) uexOnly.push(a.name);
  }
  line(`[commodities] ${uexOnly.length} real UEX commodities have no KB entity at all (not created — enrichment only, per the same rule as ship import)`);
  if (uexOnly.length) line(`  UEX-only: ${uexOnly.slice(0, 25).join(', ')}${uexOnly.length > 25 ? ', ...' : ''}`);

  line('=== done ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
