// import-uex-trade-routes.ts — imports real computed buy/sell trade routes
// from UEX Corp (https://uexcorp.space — unofficial fan project, unaffiliated
// with CIG/RSI; same ToS clearance as the commodity/ticker integrations this
// session) into the knowledge base as `trade_route` entities.
//
// Unlike commodity enrichment (which only ever merges attributes onto an
// EXISTING wiki-scraped entity), trade routes have no prior source to merge
// into — nothing scraped a "route" before this. So this importer CREATES
// entities, one per real UEX route, using UEX's own numeric route `id` in
// the entity id (`trade_route_uex_<id>`) so re-running this script upserts
// the same rows instead of duplicating them.
//
// Scope: for each of our existing commodity_* entities that has a real
// uex_commodity_id (from import-uex-commodities.ts), fetch
// GET /commodities_routes?id_commodity=<id> — the endpoint requires exactly
// one commodity per call (confirmed live: no bulk/all-commodities mode) —
// keep only PROFITABLE real routes (profit > 0; UEX returns every terminal
// pair including plenty of negative-margin ones, which aren't a "trade
// route" anyone would actually run), sorted by UEX's own `score` ranking,
// and take the top N per commodity so the KB doesn't fill up with thousands
// of near-duplicate low-value combinations.
//
// Trade route data is volatile per the cross-phase rule: every route carries
// its own `uex_last_updated` (from the route's `date_added`) and is stored
// with freshness_class='volatile', confidence='community' (UEX is an
// unofficial, community-maintained source, same framing used everywhere
// else this session) — never presented as a confirmed, current fact.
//
// Usage: tsx src/import-uex-trade-routes.ts [--top=3]

import { query } from '../../api/src/db.js';
import { upsertEntity } from '../../api/src/entity-repo.js';

const line = (s = '') => console.log(s);

function apiKey(): string {
  const k = process.env.UEX_API_KEY;
  if (!k) throw new Error('UEX_API_KEY not set.');
  return k;
}

const TOP_N = (() => {
  const arg = process.argv.find((a) => a.startsWith('--top='));
  const n = arg ? parseInt(arg.split('=')[1], 10) : 3;
  return Number.isFinite(n) && n > 0 ? n : 3;
})();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function fetchRoutesForCommodity(idCommodity: number): Promise<any[]> {
  const res = await fetch(`https://uexcorp.space/api/2.0/commodities_routes?id_commodity=${idCommodity}`, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`UEX API HTTP ${res.status} for id_commodity=${idCommodity}`);
  const body: any = await res.json();
  if (!Array.isArray(body?.data)) return [];
  return body.data;
}

function locationLabel(system: string | null, planet: string | null, terminal: string | null): string {
  return [system, planet, terminal].filter(Boolean).join(' › ');
}

async function main() {
  line('=== import-uex-trade-routes ===');
  line(`[config] top ${TOP_N} profitable routes per commodity`);

  const existing = await query(
    `SELECT id, name, attributes->>'uex_commodity_id' AS cid FROM entities
     WHERE type = 'commodity' AND status <> 'removed' AND attributes ? 'uex_commodity_id'`,
  );
  const commodities = (existing.rows as any[]).filter((r) => r.cid);
  line(`[kb] ${commodities.length} commodity entities with a real UEX commodity id`);

  let totalRoutesSeen = 0;
  let created = 0;
  let updated = 0;
  let skippedNoProfit = 0;
  const perCommodityCounts: Record<string, number> = {};
  // UEX's top-N ranking per commodity shifts between runs as prices change —
  // a route that was top-3 last run can fall out of it this run. Upserting
  // only ever ADDS/updates; without tracking which ids are still current and
  // deleting the rest, stale routes accumulate in the KB forever and get
  // displayed as if current (real bug caught while building the trade-routes
  // browse page: 271 entities existed when only 213 should have, from
  // rankings shifting across three earlier runs this session).
  const keptIds = new Set<string>();

  for (const c of commodities) {
    const idCommodity = parseInt(c.cid, 10);
    let routes: any[];
    try {
      routes = await fetchRoutesForCommodity(idCommodity);
    } catch (e: any) {
      line(`[skip] ${c.name}: ${e.message}`);
      continue;
    }
    totalRoutesSeen += routes.length;

    const profitable = routes.filter((r) => Number(r.profit) > 0);
    skippedNoProfit += routes.length - profitable.length;
    profitable.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const top = profitable.slice(0, TOP_N);
    perCommodityCounts[c.name] = top.length;

    for (const r of top) {
      const id = `trade_route_uex_${r.id}`;
      keptIds.add(id);
      const originLoc = locationLabel(r.origin_star_system_name, r.origin_planet_name, r.origin_terminal_name);
      const destLoc = locationLabel(r.destination_star_system_name, r.destination_planet_name, r.destination_terminal_name);
      const buyPrice = Number(r.price_origin) || 0;
      const sellPrice = Number(r.price_destination) || 0;
      const scuReachable = Number(r.scu_reachable) || 0;
      // UEX's own `profit`/`investment` fields are TOTALS for the whole
      // reachable run (price diff x scu_reachable) — confirmed live against
      // two real routes (e.g. 218 aUEC/SCU x 250,000 SCU = 54,500,000, exactly
      // UEX's reported `profit`) — NOT a per-SCU figure despite reading like
      // one at a glance. Compute the genuine per-unit profit ourselves
      // (sell - buy) and keep both, clearly labeled, so neither this
      // importer nor a future reader repeats that mistake.
      const profitPerScu = sellPrice - buyPrice;
      const profitTotal = Number(r.profit) || 0;
      const margin = Number(r.price_margin) || 0;
      const roi = Number(r.price_roi) || 0;
      const name = `${c.name}: ${r.origin_terminal_name} → ${r.destination_terminal_name}`;
      const summary =
        `Buy ${c.name} at ${originLoc} for ${buyPrice.toLocaleString()} aUEC/SCU and sell at ${destLoc} ` +
        `for ${sellPrice.toLocaleString()} aUEC/SCU — a real profit of ${profitPerScu.toLocaleString()} aUEC per SCU ` +
        `(margin ${margin.toFixed(1)}%, ROI ${roi.toFixed(1)}%), or ${profitTotal.toLocaleString()} aUEC total across the ` +
        `${scuReachable.toLocaleString()} SCU this route can currently move.`;

      const attributes: Record<string, unknown> = {
        category: 'trade_route',
        commodity_name: c.name,
        commodity_entity_id: c.id,
        // Separate location components (not just the concatenated *_location
        // strings below) so the trade-routes browse page can group/sort by
        // System -> Planet -> Terminal hierarchically without fragile string
        // parsing — see docs/schema.md Phase 20.
        origin_star_system: r.origin_star_system_name || null,
        origin_planet: r.origin_planet_name || null,
        origin_terminal: r.origin_terminal_name,
        origin_location: originLoc,
        destination_star_system: r.destination_star_system_name || null,
        destination_planet: r.destination_planet_name || null,
        destination_terminal: r.destination_terminal_name,
        destination_location: destLoc,
        buy_price: buyPrice || null,
        sell_price: sellPrice || null,
        profit_per_scu: profitPerScu,
        profit_total: profitTotal,
        margin_pct: margin,
        roi_pct: roi,
        distance: Number(r.distance) || null,
        score: Number(r.score) || null,
        investment_total: Number(r.investment) || null,
        scu_reachable: scuReachable || null,
        uex_route_id: r.id,
        uex_last_updated: r.date_added ? new Date(Number(r.date_added) * 1000).toISOString() : null,
      };

      const existingRow = await query(`SELECT id FROM entities WHERE id = $1`, [id]);
      const isNew = existingRow.rows.length === 0;

      await upsertEntity({
        id,
        type: 'trade_route',
        name,
        aliases: [],
        summary,
        body: null,
        attributes,
        relations: [],
        images: [],
        source: {
          origin: 'uex_corp',
          url: `https://uexcorp.space/commodities/info/name/${slugify(c.name).replace(/_/g, '-')}/`,
          confidence: 'community',
          last_verified: new Date().toISOString().slice(0, 10),
        },
        game_version: r.game_version_destination || r.game_version_origin || null,
        status: 'current',
        freshness_class: 'volatile',
      });
      if (isNew) created++; else updated++;
    }
    // Stay well inside UEX's 120/min rate limit across ~120 sequential calls.
    await new Promise((res) => setTimeout(res, 550));
  }

  // Prune stale routes: anything still in the DB from a previous run whose
  // ranking no longer holds up. Scoped to trade_route entities only, and
  // only ones NOT in this run's keptIds — never touches any other type.
  const existingIds = await query(`SELECT id FROM entities WHERE type = 'trade_route'`);
  const staleIds = (existingIds.rows as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !keptIds.has(id));
  if (staleIds.length) {
    await query(`DELETE FROM entities WHERE id = ANY($1::text[])`, [staleIds]);
  }

  line(`[routes] ${totalRoutesSeen} real routes seen across ${commodities.length} commodities`);
  line(`[routes] ${skippedNoProfit} unprofitable (profit <= 0) skipped, never imported`);
  line(`[routes] ${created} created, ${updated} updated (top ${TOP_N} by UEX's own score per commodity)`);
  line(`[routes] ${staleIds.length} stale routes pruned (no longer in the current top ${TOP_N} for their commodity)`);
  const withRoutes = Object.values(perCommodityCounts).filter((n) => n > 0).length;
  line(`[routes] ${withRoutes}/${commodities.length} commodities had at least one profitable route`);
  line('=== done ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
