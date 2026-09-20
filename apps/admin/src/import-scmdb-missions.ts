// import-scmdb-missions.ts — Phase 24: import the full mission/contract
// database from SCMDB (https://scmdb.net/ — unofficial fan project,
// unaffiliated with CIG/RSI) as `quest` entities. Per the user's explicit
// instruction, this is done "as a site visitor": SCMDB has no API, and its
// robots.txt (checked, same as Phase 23) disallows `/data/`/`/data-nda/`
// while allowing normal pages — so this ONLY ever renders real pages with a
// real browser (Playwright) and reads what's displayed, exactly like a
// human visitor's browser, never fetching /data/ directly.
//
// Two real phases, one script:
//   1. LIST — the mission table (`Table` view) is a virtualized scroll list
//      (~1,733 rows in a `.contract-table-body` of ~62,000px, only ~20 DOM
//      nodes rendered at once) — scrolled in small increments, accumulating
//      every unique `/?m=<id>` row's 17 table-cell values into a Map keyed
//      by mission id, confirmed live (not guessed) via direct DOM inspection.
//   2. DETAIL — for each collected id, visits `/?m=<id>` and reads whatever
//      tabs actually exist for that mission (`.detail-tabs` children —
//      Overview/Combat/Requirements/Calculator/Community; not every mission
//      has Combat, some may have others) generically, keyed by tab name, so
//      nothing is hand-modeled per mission type. Overview's text becomes the
//      entity `body` (the actual narrative flavor text).
//
// Resumable: skips any mission id whose entity already exists (re-run to
// pick up where an interrupted run left off, or to add newly-released
// missions later without re-fetching everything).
//
// Runs entirely inside the `admin` container (unlike import-youtube-guide.ts,
// Playwright has no loopback-only constraint — only needs normal internet
// access — so there's no reason to split extraction/storage like that one).
//
// Usage: tsx src/import-scmdb-missions.ts [--limit N] [--concurrency N]

import { chromium, type Page } from 'playwright';
import { query } from '../../api/src/db.js';
import { upsertEntity } from '../../api/src/entity-repo.js';

const line = (s = '') => console.log(s);
const nowIso = () => new Date().toISOString();

async function openTableView(page: Page) {
  await page.goto('https://scmdb.net/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const btn = all.find((el) => el.children.length === 0 && el.textContent?.trim() === 'Table');
    if (btn) (btn.closest('button') || btn).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(1000);
}

interface ListRow {
  scmdbId: string;
  cells: string[]; // raw text of each of the 17 .table-cell nodes, in order
}

async function scrapeMissionList(page: Page): Promise<Map<string, ListRow>> {
  await openTableView(page);
  const rows = new Map<string, ListRow>();
  const { scrollHeight, clientHeight } = await page.evaluate(() => {
    const el = document.querySelector('.contract-table-body')!;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  const step = Math.floor(clientHeight * 0.35);
  for (let pos = 0; pos <= scrollHeight + step; pos += step) {
    await page.evaluate((p) => {
      const el = document.querySelector('.contract-table-body');
      if (el) el.scrollTop = p;
    }, pos);
    await page.waitForTimeout(150);
    const batch = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a.table-row[href^="/?m="]')).map((a) => ({
        href: a.getAttribute('href') || '',
        cells: Array.from(a.querySelectorAll(':scope > .table-cell')).map((c) => (c.textContent || '').trim()),
      }));
    });
    for (const b of batch) {
      const id = b.href.replace('/?m=', '');
      if (id && !rows.has(id)) rows.set(id, { scmdbId: id, cells: b.cells });
    }
  }
  return rows;
}

interface DetailData {
  title: string;
  templateKey: string | null;
  faction: string;
  tabs: Record<string, string>;
}

async function scrapeMissionDetail(page: Page, scmdbId: string): Promise<DetailData | null> {
  await page.goto(`https://scmdb.net/?m=${scmdbId}`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(700);

  const header = await page.evaluate(() => {
    const h2 = document.querySelector('.detail-title') as HTMLElement | null;
    const faction = document.querySelector('.detail-faction') as HTMLElement | null;
    if (!h2) return null;
    return { title: h2.innerText.trim(), templateKey: h2.getAttribute('title'), faction: faction?.innerText.trim() || '' };
  });
  if (!header) return null;

  const tabNames: string[] = await page.evaluate(() => {
    const el = document.querySelector('.detail-tabs');
    return el ? Array.from(el.children).map((c) => (c.textContent || '').trim()) : [];
  });

  const tabs: Record<string, string> = {};
  for (const tabName of tabNames) {
    if (tabName.toLowerCase() === 'calculator') continue; // interactive tool, not a stored fact
    await page.evaluate((name) => {
      const el = document.querySelector('.detail-tabs');
      const btn = el && Array.from(el.children).find((c) => (c.textContent || '').trim() === name);
      if (btn) (btn as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, tabName);
    await page.waitForTimeout(350);
    const text = await page.evaluate(() => (document.querySelector('.detail-body') as HTMLElement | null)?.innerText.trim() || '');
    tabs[tabName] = text;
  }

  return { title: header.title, templateKey: header.templateKey, faction: header.faction, tabs };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

function parseNumber(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function existingIds(): Promise<Set<string>> {
  const res = await query(`SELECT attributes->>'scmdb_id' AS id FROM entities WHERE attributes->>'scmdb_id' IS NOT NULL`);
  return new Set((res.rows as any[]).map((r) => r.id));
}

function parseArgs(argv: string[]) {
  const out: { limit?: number; concurrency: number } = { concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = parseInt(argv[++i], 10);
    if (argv[i] === '--concurrency') out.concurrency = parseInt(argv[++i], 10);
  }
  return out;
}

async function main() {
  const { limit, concurrency } = parseArgs(process.argv.slice(2));
  line('=== import-scmdb-missions ===');

  const browser = await chromium.launch();
  const listPage = await browser.newPage({ userAgent: process.env.SCRAPER_USER_AGENT || 'USSALMC-Bot/0.1 (+respect-robots)' });
  line('[list] scrolling the virtualized mission table...');
  const rows = await scrapeMissionList(listPage);
  await listPage.close();
  line(`[list] collected ${rows.size} unique missions`);

  const already = await existingIds();
  line(`[list] ${already.size} already imported, skipping those`);
  let todo = Array.from(rows.keys()).filter((id) => !already.has(id));
  if (limit) todo = todo.slice(0, limit);
  line(`[detail] fetching ${todo.length} mission detail pages (concurrency=${concurrency})...`);

  let done = 0, failed = 0;
  const worker = async (workerId: number) => {
    const page = await browser.newPage({ userAgent: process.env.SCRAPER_USER_AGENT || 'USSALMC-Bot/0.1 (+respect-robots)' });
    while (todo.length) {
      const id = todo.pop();
      if (!id) break;
      try {
        const detail = await scrapeMissionDetail(page, id);
        if (!detail) { failed++; continue; }
        const row = rows.get(id)!.cells;
        const [system, , faction, missionType, tagsRaw, inoutRaw, legalRaw, healthRaw, baseXpRaw, rewardRaw, bpRaw, bpDeltaRaw, checkRaw, uecHrRaw, repHrRaw, commDiffRaw, commSatRaw] = row;

        const entityId = `quest_scmdb_${id}`;
        await upsertEntity({
          id: entityId,
          type: 'quest',
          name: detail.title,
          summary: null,
          body: detail.tabs['Overview'] || null,
          attributes: {
            category: 'quest',
            scmdb_id: id,
            scmdb_template_key: detail.templateKey,
            faction: detail.faction || faction || null,
            star_system: system || null,
            mission_type: missionType || null,
            tags_raw: tagsRaw || null,
            inout_raw: inoutRaw || null,
            is_legal: legalRaw === '✓' ? true : legalRaw === '✗' ? false : null,
            health_raw: healthRaw || null,
            base_xp: parseNumber(baseXpRaw),
            reward_auec: parseNumber(rewardRaw),
            bp_col_raw: bpRaw || null,
            bp_delta_col_raw: bpDeltaRaw || null,
            check_col_raw: checkRaw || null,
            est_uec_per_hour: parseNumber(uecHrRaw),
            est_rep_per_hour: parseNumber(repHrRaw),
            community_difficulty: parseNumber(commDiffRaw),
            community_satisfaction: parseNumber(commSatRaw),
            tabs: detail.tabs,
          },
          source: { origin: 'scmdb.net', url: `https://scmdb.net/?m=${id}`, confidence: 'community', last_verified: nowIso() },
          game_version: null, // not reliably shown per-mission on the site — never guessed
        });
        done++;
        if (done % 25 === 0) line(`[detail] ${done}/${todo.length + done} done (${failed} failed) — worker ${workerId} last: ${entityId}`);
      } catch (e: any) {
        failed++;
        line(`[detail] FAILED ${id}: ${e.message}`);
      }
    }
    await page.close();
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  await browser.close();

  line('');
  line(`[done] imported ${done} missions, ${failed} failed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
