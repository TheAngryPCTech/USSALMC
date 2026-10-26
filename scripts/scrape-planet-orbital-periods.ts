// scrape-planet-orbital-periods.ts — real orbital period ("Orbital period"
// infobox field, in SED / Standard Earth Days) for the 9 Stanton + Pyro
// planets, reusing the admin scraper's real fetch pipeline (robots-checked,
// polite rate limit, logged to scrape_log). Powers real-time orbital motion
// in the 3D explorer's system view — moons have NO documented orbital
// period on starcitizen.tools (checked Daymar and Yela; neither lists
// one), so they are deliberately NOT covered here; animating them would
// mean fabricating a rate. See CLAUDE.md Decisions Log, 2026-10-25.
//
// Run: tsx scripts/scrape-planet-orbital-periods.ts

import { fetchPage } from '../apps/admin/src/fetcher.js';
import { query, pool } from '../apps/api/src/db.js';
import { upsertEntity } from '../apps/api/src/entity-repo.js';

const PLANETS: { id: string; url: string }[] = [
  { id: 'location_hurston', url: 'https://starcitizen.tools/Hurston' },
  { id: 'location_crusader', url: 'https://starcitizen.tools/Crusader' },
  { id: 'location_arccorp_planet', url: 'https://starcitizen.tools/ArcCorp_(planet)' },
  { id: 'location_microtech', url: 'https://starcitizen.tools/MicroTech_(planet)' },
  { id: 'location_pyro_i', url: 'https://starcitizen.tools/Pyro_I' },
  { id: 'location_monox', url: 'https://starcitizen.tools/Monox' },
  { id: 'location_bloom', url: 'https://starcitizen.tools/Bloom' },
  { id: 'location_pyro_v', url: 'https://starcitizen.tools/Pyro_V' },
  { id: 'location_terminus', url: 'https://starcitizen.tools/Terminus' },
];

function extractOrbitalPeriodSed(html: string): number | null {
  const m = html.match(
    /Orbital period<\/dt><dd class="t-infobox-item-content">([\d,.]+)\s*SED<\/dd>/i,
  );
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  let updated = 0, notFound = 0, failed = 0;
  for (const { id, url } of PLANETS) {
    const res = await fetchPage(url);
    if (!res.ok) { console.log(`  FAILED ${id} <- ${url} (${res.blocked ?? res.status})`); failed++; continue; }
    const sed = extractOrbitalPeriodSed(res.html);
    if (sed === null) { console.log(`  NOT FOUND ${id} <- ${url}`); notFound++; continue; }
    const full = await query(`SELECT * FROM entities WHERE id=$1`, [id]);
    if (!full.rows.length) { console.log(`  NO KB ENTITY ${id}`); notFound++; continue; }
    const r: any = full.rows[0];
    const attributes = { ...(r.attributes ?? {}), orbital_period_sed: sed };
    await upsertEntity({
      id: r.id, type: r.type, name: r.name, aliases: r.aliases,
      summary: r.summary, body: r.body, attributes,
      relations: r.relations, images: r.images, source: r.source,
      game_version: r.game_version, status: r.status, freshness_class: r.freshness_class,
    });
    console.log(`  ${id} -> ${sed} SED`);
    updated++;
  }
  console.log(`\nDone. Updated ${updated}. Not found: ${notFound}. Fetch failed: ${failed}.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
