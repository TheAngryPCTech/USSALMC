// fetcher.ts — polite fetching with robots enforcement, plus category/sitemap
// discovery for applying a template across a whole category.

import { checkRobots } from './robots.js';
import { logScrape } from './pipeline.js';

const UA = process.env.SCRAPER_USER_AGENT || 'USSALMC-Bot/0.1 (+reference; respect-robots)';
let lastFetch = 0;
const MIN_GAP_MS = 1000; // polite: >=1s between requests to same process

async function polite() {
  const wait = lastFetch + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
}

export interface FetchResult { ok: boolean; status: number; html: string; blocked?: string; }

export async function fetchPage(url: string): Promise<FetchResult> {
  const verdict = await checkRobots(url, UA);
  if (!verdict.allowed) {
    await logScrape(url, 'robots_block', { reason: verdict.reason });
    return { ok: false, status: 0, html: '', blocked: verdict.reason };
  }
  await polite();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  return { ok: res.ok, status: res.status, html };
}

export function getUA() { return UA; }

// Wiki maintenance/meta categories — never useful for discovering content pages.
const MAINTENANCE_CAT = /^(pages (using|with|needing)|articles? (with|needing)|all articles|stubs?$|.*\bstubs$|hidden categor|maintenance|tracking categor|commons |cs1 )/i;

// Which wiki-category names look like the content type we confirmed. Mirrors
// guessCategory()'s keywords so "Guns" beats "Behring Applied Technology"
// (the manufacturer category) when discovering siblings for a weapon template.
const CATEGORY_HINTS: Record<string, RegExp> = {
  ship: /ship|vehicle/i,
  manufacturer: /manufactur|corporat|compan/i,
  weapon: /weapon|gun|cannon|repeater|gatling|missile|torpedo|turret/i,
  commodity: /commodit/i,
  location: /location|planet|moon|station|city|outpost|landing zone/i,
};

// Discover other pages in the same category. For MediaWiki sites we use the API
// (category members). `pageCategories` — the seed page's OWN wiki categories
// (e.g. from the saved template's match signals) — are tried first, since the
// wiki's real category name ("Guns") rarely matches our internal slug ("weapon").
export async function discoverCategoryPages(
  seedUrl: string, category: string, limit = 10, pageCategories: string[] = [],
): Promise<string[]> {
  const u = new URL(seedUrl);
  const origin = `${u.protocol}//${u.host}`;

  async function membersOf(catName: string): Promise<string[]> {
    // probe with a high cmlimit so broad content categories ("Guns", "Ships")
    // out-count narrow ones ("Behring Applied Technology") when we pick below
    const probe = Math.min(500, Math.max(limit * 3, 200));
    const api = `${origin}/api.php?action=query&format=json&list=categorymembers&cmtitle=Category:${encodeURIComponent(catName)}&cmlimit=${probe}&cmtype=page`;
    const r = await fetch(api, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const d: any = await r.json();
    return (d?.query?.categorymembers || [])
      .filter((m: any) => (m.ns ?? 0) === 0)
      .map((m: any) => `${origin}/${encodeURIComponent(m.title.replace(/ /g, '_'))}`)
      .filter((x: string) => x !== seedUrl);
  }

  // Candidate category names, in priority order: the seed page's real wiki
  // categories (minus maintenance noise), then legacy name guesses as fallback.
  const guesses = [
    category === 'ship' ? 'Ships' : category === 'manufacturer' ? 'Manufacturers'
      : category === 'weapon' ? 'Ship weapons'
      : category.charAt(0).toUpperCase() + category.slice(1) + 's',
  ];
  const candidates = [
    ...pageCategories.filter((c) => !MAINTENANCE_CAT.test(c)),
    ...guesses,
  ];

  const seen = new Set<string>();
  // Rank candidates: categories whose NAME matches the confirmed content type
  // (e.g. "Guns" for weapon) are tried first; member count only breaks ties
  // within a tier. Pure count would wrongly pick big manufacturer categories.
  const hint = CATEGORY_HINTS[category];
  const tierOf = (c: string) => (hint && hint.test(c) ? 0 : 1);
  let bestCat: string | null = null;
  let best: string[] = [];
  let bestTier = 99;
  for (const catName of candidates) {
    try {
      const tier = tierOf(catName);
      if (tier > bestTier) continue; // already have a better-tier hit
      const found = await membersOf(catName);
      if (!found.length) continue;
      if (tier < bestTier || found.length > best.length) {
        best = found; bestCat = catName; bestTier = tier;
      }
    } catch { /* try next candidate */ }
  }
  if (bestCat) {
    await logScrape(seedUrl, 'discover', { via: `Category:${bestCat}`, found: best.length });
    for (const f of best) seen.add(f);
  }
  return [...seen].slice(0, limit);
}
