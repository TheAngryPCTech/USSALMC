// import-uex-weapon-prices.ts — enriches existing `weapon` items in the
// knowledge base with real shop pricing from UEX Corp (https://uexcorp.space
// — unofficial fan project, unaffiliated with CIG/RSI; same ToS clearance as
// every other UEX integration this session).
//
// Weapons are NOT commodities (bulk tradeable raw goods, sold by SCU) — they
// are shop-purchased equipment, sold per-unit. UEX tracks them on a
// completely separate feed (`items_prices_all`, not `commodities_prices_all`)
// with a different shape (no status_buy/status_sell flags; price_buy is what
// a player PAYS to acquire it, price_sell is what a shop pays to buy it
// back). This importer keeps that distinction: it never touches
// `attributes.category` (stays 'weapon') and never writes into the
// commodity-only code paths (the `uex_*` fields it adds are the same
// vocabulary as the commodity importer, but the entity_page template
// already treats `uex_*` as generic for any non-commodity entity — see the
// "LAST OBSERVED" fix in docs/decisions-log.md).
//
// Enrichment-only, same rule as commodity/ship enrichment: matches UEX items
// against EXISTING wiki-scraped weapon entities by normalized name — never
// creates a new entity on a miss, never touches existing summary/body/images.
//
// Usage: tsx src/import-uex-weapon-prices.ts

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

interface UexItemAgg {
  name: string;
  idItem: number | null;
  bestBuyPrice: number | null; bestBuyTerminal: string | null; bestBuyTerminalId: number | null;
  bestSellPrice: number | null; bestSellTerminal: string | null; bestSellTerminalId: number | null;
  terminalCount: number;
  lastModified: number;
}

async function fetchUexItemAggregates(): Promise<Map<string, UexItemAgg>> {
  const res = await fetch(`https://uexcorp.space/api/2.0/items_prices_all`, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`UEX API HTTP ${res.status}`);
  const body: any = await res.json();
  if (!Array.isArray(body?.data)) throw new Error('UEX API returned no data array.');

  const agg = new Map<string, UexItemAgg>();
  for (const row of body.data) {
    const name = row.item_name;
    if (!name) continue;
    const key = normName(name);
    let a = agg.get(key);
    if (!a) {
      a = { name, idItem: null, bestBuyPrice: null, bestBuyTerminal: null, bestBuyTerminalId: null, bestSellPrice: null, bestSellTerminal: null, bestSellTerminalId: null, terminalCount: 0, lastModified: 0 };
      agg.set(key, a);
    }
    a.idItem = Number(row.id_item) || a.idItem;
    a.terminalCount++;
    a.lastModified = Math.max(a.lastModified, Number(row.date_modified) || 0);
    // No status_buy/status_sell flags on this feed (unlike commodities) — a
    // positive price IS the "actively available" signal here.
    const buy = Number(row.price_buy) || 0;
    if (buy > 0 && (a.bestBuyPrice === null || buy < a.bestBuyPrice)) {
      a.bestBuyPrice = buy;
      a.bestBuyTerminal = row.terminal_name ?? null;
      a.bestBuyTerminalId = Number(row.id_terminal) || null;
    }
    const sell = Number(row.price_sell) || 0;
    if (sell > 0 && (a.bestSellPrice === null || sell > a.bestSellPrice)) {
      a.bestSellPrice = sell;
      a.bestSellTerminal = row.terminal_name ?? null;
      a.bestSellTerminalId = Number(row.id_terminal) || null;
    }
  }
  return agg;
}

async function main() {
  line('=== import-uex-weapon-prices ===');
  const uex = await fetchUexItemAggregates();
  line(`[uex] ${uex.size} distinct real shop items from items_prices_all`);

  const existing = await query(
    `SELECT id, name FROM entities WHERE COALESCE(attributes->>'category', type) = 'weapon' AND status <> 'removed'`,
  );
  line(`[kb] ${existing.rows.length} existing weapon entities`);

  let matched = 0;
  const unmatched: string[] = [];
  for (const row of existing.rows as any[]) {
    const a = uex.get(normName(row.name));
    if (!a) { unmatched.push(row.name); continue; }
    const ent = await getEntity(row.id);
    if (!ent) continue;
    const mergedAttributes: Record<string, unknown> = {
      ...ent.attributes,
      uex_item_id: a.idItem,
      uex_best_buy_price: a.bestBuyPrice,
      uex_best_buy_terminal: a.bestBuyTerminal,
      uex_best_buy_terminal_id: a.bestBuyTerminalId,
      uex_best_sell_price: a.bestSellPrice,
      uex_best_sell_terminal: a.bestSellTerminal,
      uex_best_sell_terminal_id: a.bestSellTerminalId,
      uex_terminal_count: a.terminalCount,
      uex_last_updated: a.lastModified ? new Date(a.lastModified * 1000).toISOString() : null,
    };
    await upsertEntity({
      // freshness_class intentionally left as ent.freshness_class (not
      // forced to 'volatile') to match the existing commodity importer's
      // behavior exactly — both carry equally volatile UEX price data today;
      // changing that classification site-wide is a separate decision, not
      // something to do inconsistently one entity type at a time.
      id: ent.id, type: ent.type, name: ent.name, aliases: ent.aliases,
      summary: ent.summary, body: ent.body, attributes: mergedAttributes,
      relations: ent.relations, images: ent.images, source: ent.source,
      game_version: ent.game_version, status: ent.status, freshness_class: ent.freshness_class,
    });
    matched++;
  }
  line(`[weapons] enriched ${matched} existing entities with real shop prices; ${unmatched.length} had no UEX match (left untouched)`);
  if (unmatched.length) line(`  no UEX match: ${unmatched.slice(0, 25).join(', ')}${unmatched.length > 25 ? ', ...' : ''}`);
  line('=== done ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
