// import-scmdb-signatures.ts — Phase 23: enrich existing `commodity` entities
// with real mining scan-signature values from SCMDB
// (https://scmdb.net/?page=mine — unofficial fan project, unaffiliated with
// CIG/RSI; robots.txt checked: `Allow: /` for pages, but explicitly
// `Disallow: /data/` — the site's own comment says those are "machine-
// consumed via fetch() from the SPA", i.e. meant for the page's own
// client-side code, not a bot fetching them directly. Respected literally:
// this NEVER fetches /data/*.json itself — it renders the real page with a
// real browser (Playwright) and reads only what the page displays, exactly
// like a human visitor's browser would, same as the SPA's own intended use.
//
// Data shape (confirmed live via rendered DOM, not guessed): each named ore
// has a base scan-signature value; the tool displays that base multiplied by
// 1x/2x/3x/... up to a per-ore cap (tied to its rarity tier). Three generic
// bands (ROC Mineables / FPS Mineables / Salvage) aren't tied to one specific
// ore — skipped here since there's no single corresponding commodity entity
// to enrich (enrichment-only, same rule as enrichShips()/import-uex-*.ts:
// never creates a new entity on a miss).
//
// Usage: tsx src/import-scmdb-signatures.ts

import { chromium } from 'playwright';
import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';

const line = (s = '') => console.log(s);
const nowIso = () => new Date().toISOString();

// A handful of known spelling differences between SCMDB and our existing
// wiki-scraped commodity names — never guessed, checked live against the DB
// (`Aluminium` on SCMDB vs `Aluminum` here; `Ice` has no commodity entity at
// all in our KB, so it's simply skipped, not fabricated).
const NAME_ALIASES: Record<string, string> = {
  aluminium: 'aluminum',
};

function normName(s: string): string {
  const n = s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return NAME_ALIASES[n] ?? n;
}

interface ScannedOre {
  name: string;
  values: number[];
}

const GENERIC_BANDS = new Set(['rocmineables', 'fpsmineables', 'salvage']);

async function scrapeSignatureTable(): Promise<ScannedOre[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: process.env.SCRAPER_USER_AGENT || 'USSALMC-Bot/0.1 (+respect-robots)' });
    await page.goto('https://scmdb.net/?page=mine&sig=', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);

    // Open the "Scan Signature Identifier" tool panel if it isn't already.
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const btn = all.find((el) => el.children.length === 0 && el.textContent?.trim() === 'Scan Signature Identifier');
      if (btn) (btn.closest('button') || btn).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(800);
    // Ensure the chart itself is expanded (idempotent: only clicks if it currently reads "Show").
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const toggle = all.find((el) => el.children.length === 0 && /show signature chart/i.test(el.textContent || ''));
      if (toggle) (toggle.closest('button') || toggle).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(800);

    const leaves: string[] = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const marker = all.find((el) => el.children.length === 0 && /scan value/i.test(el.textContent || ''));
      if (!marker) return [];
      let container: Element = marker;
      for (let i = 0; i < 8 && container.parentElement; i++) {
        container = container.parentElement;
        if (container.querySelectorAll('button, span, div').length > 200) break;
      }
      return Array.from(container.querySelectorAll('*'))
        .filter((el) => el.children.length === 0 && el.textContent?.trim())
        .map((el) => el.textContent!.trim());
    });

    // Parse the flat leaf-text sequence back into { name, values[] } rows: a
    // non-numeric leaf starts a new ore; numeric (comma-formatted) leaves
    // that follow are its values, until the next non-numeric leaf.
    const numberRe = /^\d{1,3}(,\d{3})*$/;
    const rows: ScannedOre[] = [];
    let current: ScannedOre | null = null;
    for (const leaf of leaves) {
      if (numberRe.test(leaf)) {
        if (current) current.values.push(parseInt(leaf.replace(/,/g, ''), 10));
      } else if (
        !/scan|exact match|hide signature|show signature|no selection|click a row|^[0-9]+k$|^▾$|^✕$|^\|$/i.test(leaf)
      ) {
        current = { name: leaf, values: [] };
        rows.push(current);
      }
    }
    return rows.filter((r) => r.values.length > 0);
  } finally {
    await browser.close();
  }
}

async function main() {
  line('=== import-scmdb-signatures ===');
  line('[scrape] rendering https://scmdb.net/?page=mine&sig= with a real browser...');
  const rows = await scrapeSignatureTable();
  line(`[scrape] found ${rows.length} rows`);

  const existing = await query(
    `SELECT id, name FROM entities WHERE COALESCE(attributes->>'category', type) = 'commodity' AND status <> 'removed'`,
  );
  const byNorm = new Map<string, string>();
  for (const r of existing.rows as any[]) byNorm.set(normName(r.name), r.id);

  let matched = 0;
  const unmatched: string[] = [];
  const skippedGeneric: string[] = [];

  for (const row of rows) {
    const norm = normName(row.name);
    if (GENERIC_BANDS.has(norm)) { skippedGeneric.push(row.name); continue; }
    const ourId = byNorm.get(norm);
    if (!ourId) { unmatched.push(row.name); continue; }
    const ent = await getEntity(ourId);
    if (!ent) continue;

    await upsertEntity({
      id: ent.id, type: ent.type, name: ent.name, aliases: ent.aliases,
      summary: ent.summary, body: ent.body,
      attributes: {
        ...ent.attributes,
        scan_signatures: { base: row.values[0], values: row.values },
      },
      relations: ent.relations, images: ent.images,
      source: { origin: 'scmdb.net', url: 'https://scmdb.net/?page=mine&sig=', confidence: 'community', last_verified: nowIso() },
      game_version: ent.game_version, status: ent.status, freshness_class: ent.freshness_class,
    });
    matched++;
  }

  line(`[done] enriched ${matched} existing commodity entities with scan-signature data`);
  if (skippedGeneric.length) line(`  skipped (generic band, not a single commodity): ${skippedGeneric.join(', ')}`);
  if (unmatched.length) line(`  unmatched (no corresponding commodity entity, NOT created): ${unmatched.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
