// scrape-missing-stanton-pyro-bodies.ts — real starcitizen.tools scrape for
// the planet/moon articles the original bulk import never fetched (found by
// cross-checking REFERENCE_SYSTEMS in apps/api/src/planetary-atlas.ts against
// what's actually in the KB — see CLAUDE.md decisions log). Reuses the exact
// same fetch -> extract -> match saved template -> apply -> upsert pipeline
// as apps/admin/src/bulk-import.ts's force-overwrite path (same robots.txt/
// rate-limit handling via fetchPage/publicFetch), just targeted at specific
// known-missing URLs instead of crawling a whole category.
//
// Run: tsx scripts/scrape-missing-stanton-pyro-bodies.ts

import { fetchPage } from '../apps/admin/src/fetcher.js';
import { extract } from '../apps/admin/src/extractor.js';
import { findTemplate, applyTemplate } from '../apps/admin/src/template.js';
import { buildTemplateDraft, entityIdFor } from '../apps/admin/src/scan.js';
import { logScrape } from '../apps/admin/src/pipeline.js';
import { getEntity, upsertEntity } from '../apps/api/src/entity-repo.js';
import { pool } from '../apps/api/src/db.js';

const DOMAIN = 'starcitizen.tools';
const CATEGORY = 'location';

const TARGET_URLS = [
  'https://starcitizen.tools/Yela',
  'https://starcitizen.tools/Lyria',
  'https://starcitizen.tools/Wala',
  'https://starcitizen.tools/Magda',
  'https://starcitizen.tools/Pyro_I',
  'https://starcitizen.tools/Monox',
  'https://starcitizen.tools/Pyro_V',
  'https://starcitizen.tools/Terminus',
  'https://starcitizen.tools/Vatra',
  'https://starcitizen.tools/Vuur',
  'https://starcitizen.tools/Pyro_IV',
];

async function main() {
  const tpl = await findTemplate(CATEGORY, DOMAIN);
  if (!tpl) throw new Error(`No saved "${CATEGORY}" template for ${DOMAIN} — run the normal bulk import first.`);
  console.log(`Using template ${tpl.id} (${tpl.field_map.length} fields).`);

  for (const url of TARGET_URLS) {
    const fetched = await fetchPage(url);
    await logScrape(url, 'bulk_import_fetch', { category: CATEGORY, status: fetched.status });
    if (!fetched.ok) {
      console.log(`  SKIP ${url} -> fetch failed: ${fetched.blocked || `HTTP ${fetched.status}`}`);
      continue;
    }
    const ex = extract(fetched.html, url);
    // These URLs are manually curated (cross-checked against
    // REFERENCE_SYSTEMS), not an open crawl, so the template's broad
    // category gate (which expects "Locations" and would reject a page
    // wiki-categorized as "Moons"/"Planets") is skipped here. The field-map
    // match below is the real safety net: a page with no matching fields
    // is still skipped, not force-published empty.
    const applied = applyTemplate(tpl, ex, url);
    if (applied.matchedCount === 0) {
      console.log(`  SKIP ${url} -> no fields matched on page`);
      continue;
    }
    const id = entityIdFor(CATEGORY, ex.title || 'unknown');
    const existing = await getEntity(id);
    if (existing && existing.status === 'removed') {
      console.log(`  SKIP ${url} -> ${id} is soft-deleted, not resurrecting`);
      continue;
    }
    const { draft } = await buildTemplateDraft(tpl, ex, CATEGORY, DOMAIN, url, applied);
    await upsertEntity(draft);
    console.log(`  ${existing ? 'UPDATED' : 'CREATED'} ${id} <- ${url} (${applied.matchedCount} fields)`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
