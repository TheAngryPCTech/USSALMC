// bulk-import.ts — the connector's one-time --force-overwrite bulk import.
//
// This is a SEPARATE, explicit-only entry point. It does not change the
// existing scan/confirm/category-batch pipeline (scan.ts's normal path is
// untouched) — ordinary incremental scraping still respects manual edits by
// routing anything that isn't a trusted, low-variance auto-publish into the
// review queue exactly as it always has. This script exists only for a
// one-time bulk pull where the operator has explicitly decided prior
// (possibly manually-edited) entities should be overwritten wholesale.
//
// Usage (must be passed on the invocation itself — never left as a .env
// default, so a future scheduled/accidental re-run can't silently repeat a
// full overwrite):
//   tsx src/bulk-import.ts --force-overwrite --categories=ship,manufacturer,weapon,location,commodity [--job-key=initial_force_pull] [--max-per-category=500]
//
// Resumable: re-running with the same --job-key skips URLs already recorded
// in bulk_import_progress, so hitting the rolling 40/min · 500/day fetch cap
// (apps/admin/src/rate-limit.ts) just pauses the job — a later invocation
// continues where it left off, never re-fetching or re-overwriting a page
// that already completed in an earlier run.

import { scanUrl, confirmScan, entityIdFor, entityTypeFor, buildTemplateDraft, type Selection } from './scan.js';
import { findTemplate, applyTemplate, templateMatchesPage, type ScrapeTemplate } from './template.js';
import { fetchPage } from './fetcher.js';
import { extract } from './extractor.js';
import { logScrape } from './pipeline.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';
import { query, pool } from '../../api/src/db.js';
import { loadBulkImportRateLimitConfig, acquireBulkImportSlot } from './rate-limit.js';

const DOMAIN = 'starcitizen.tools';
const line = (s = '') => console.log(s);

// The wiki's real umbrella category name per resource type (confirmed live
// via the MediaWiki API before writing this — several of these do NOT match
// the internal category slug, e.g. weapons live under "Guns").
const BROAD_CATEGORY: Record<string, string> = {
  ship: 'Ships', manufacturer: 'Companies', weapon: 'Guns',
  location: 'Locations', commodity: 'Commodities', quest: 'Contracts',
};

// One representative real page per category, used only to build a field
// template when the category doesn't have one saved yet (ship already does).
const SEED_PAGES: Record<string, string> = {
  manufacturer: 'https://starcitizen.tools/Anvil_Aerospace',
  weapon: "https://starcitizen.tools/'WAR'_Cannon",
  location: 'https://starcitizen.tools/Area18',
  commodity: 'https://starcitizen.tools/Agricium',
};

// Real side-info-box labels selected from inspecting each seed page live
// (never a guess — only fields that actually exist on the real page).
const ATTRIBUTE_LABELS: Record<string, string[]> = {
  manufacturer: ['Industry', 'Products', 'Race', 'Headquarters', 'Founder', 'Founded', 'Manufacturer code', 'Portfolio'],
  weapon: ['Manufacturer', 'Size', 'Type', 'Damage', 'DPS', 'Fire rate', 'Fire mode', 'Range', 'Speed', 'Health',
    'EM signature', 'IR signature', 'Distortion', 'Resistance', 'Class name', 'Classification', 'Version'],
  location: ['Location', 'Type', 'Classification', 'Habitability', 'Affiliation', 'Shops', 'Services', 'Founded'],
  commodity: ['Type', 'Rarity', 'Acquisition', 'Refinable', 'Signature', 'Instability', 'Resistance', 'Quality'],
};

function attrKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Ensure a category has a saved template, building one from a real seed page
// if it doesn't (mirrors the quest-panel work last session: seed-confirm,
// then solve match_signals down to the one category every real page of this
// type actually carries, since a fresh seed's full category list is usually
// too narrow/specific to match siblings).
async function ensureTemplate(category: string): Promise<ScrapeTemplate> {
  const existing = await findTemplate(category, DOMAIN);
  if (existing) {
    line(`  [${category}] using existing template ${existing.id} (${existing.field_map.length} fields)`);
    return existing;
  }
  const seedUrl = SEED_PAGES[category];
  if (!seedUrl) throw new Error(`No seed page configured to build a "${category}" template.`);
  const scan = await scanUrl(seedUrl);
  if (scan.category !== category) {
    throw new Error(`Seed page category mismatch for "${category}": guessCategory() said "${scan.category}" for ${seedUrl}.`);
  }
  const wantLabels = new Set((ATTRIBUTE_LABELS[category] || []).map((l) => l.toLowerCase()));
  const selections: Selection[] = [];
  for (const c of scan.candidates) {
    if (c.kind === 'field' && c.key === 'summary') selections.push({ key: c.key, field_name: 'summary', target: 'summary' });
  }
  for (const c of scan.candidates) {
    if (c.kind === 'field' && c.key !== 'summary' && wantLabels.has(c.label.toLowerCase())) {
      selections.push({ key: c.key, field_name: attrKey(c.label), target: 'attribute' });
    }
  }
  let imgCount = 0;
  for (const c of scan.candidates) {
    if (c.kind === 'image' && imgCount < 2) {
      selections.push({ key: c.key, field_name: `image_${imgCount + 1}`, target: 'image', role: imgCount === 0 ? 'primary' : 'gallery' });
      imgCount++;
    }
  }
  line(`  [${category}] building template from ${seedUrl}: ${selections.length} fields selected from ${scan.candidates.length} real candidates`);
  // maxPages=0: confirmScan's auto-continue batch does nothing (our own loop
  // below covers the whole category); this call's only job is to save the
  // template and publish the seed page itself as a normal new entity.
  const confirmed = await confirmScan(seedUrl, selections, category, 0);
  line(`  [${category}] seed entity published: ${confirmed.entity_id}`);
  await query(`UPDATE scrape_templates SET match_signals=$2, updated_at=now() WHERE id=$1`,
    [confirmed.template_id, JSON.stringify({ categories: [BROAD_CATEGORY[category]], label_hints: [] })]);
  line(`  [${category}] match_signals solved to ["${BROAD_CATEGORY[category]}"]`);
  const tpl = await findTemplate(category, DOMAIN);
  if (!tpl) throw new Error(`template vanished for ${category} right after saving it`);
  return tpl;
}

async function categoryMembers(categoryName: string, limit: number): Promise<string[]> {
  const api = `https://${DOMAIN}/api.php?action=query&format=json&list=categorymembers&cmtitle=${encodeURIComponent(`Category:${categoryName}`)}&cmlimit=${Math.min(500, limit)}&cmtype=page`;
  const res = await fetch(api, { headers: { 'User-Agent': process.env.SCRAPER_USER_AGENT || 'USSALMC-Bot/0.1 (+reference; respect-robots)' } });
  if (!res.ok) return [];
  const d: any = await res.json();
  return (d?.query?.categorymembers || [])
    .filter((m: any) => (m.ns ?? 0) === 0)
    .map((m: any) => `https://${DOMAIN}/${encodeURIComponent(String(m.title).replace(/ /g, '_'))}`);
}

interface JobRow { id: number; job_key: string; }

async function ensureJob(jobKey: string, categories: string[], forceOverwrite: boolean): Promise<JobRow> {
  const res = await query<JobRow>(
    `INSERT INTO bulk_import_jobs (job_key, categories, force_overwrite, status)
     VALUES ($1, $2, $3, 'running')
     ON CONFLICT (job_key) DO UPDATE SET status='running', updated_at=now()
     RETURNING id, job_key`,
    [jobKey, JSON.stringify(categories), forceOverwrite],
  );
  return res.rows[0];
}

async function alreadyProcessed(jobId: number, url: string): Promise<boolean> {
  const res = await query(`SELECT 1 FROM bulk_import_progress WHERE job_id=$1 AND url=$2`, [jobId, url]);
  return (res.rowCount ?? 0) > 0;
}

async function recordProgress(jobId: number, category: string, url: string, status: string, outcome: string | null, entityId: string | null, note: string | null) {
  await query(
    `INSERT INTO bulk_import_progress (job_id, category, url, status, outcome, entity_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (job_id, url) DO NOTHING`,
    [jobId, category, url, status, outcome, entityId, note],
  );
}

async function snapshotBeforeOverwrite(entity: any, jobKey: string) {
  await query(
    `INSERT INTO entity_audit_log (entity_id, action, snapshot, performed_by) VALUES ($1,'connector_force_overwrite',$2,$3)`,
    [entity.id, JSON.stringify(entity), `bulk_import:${jobKey}`],
  );
}

// Process one page under force-overwrite semantics: skip the review-queue /
// trust-threshold routing entirely (that's the normal-run behavior, left
// untouched in scan.ts) and instead: if the target entity already exists,
// snapshot it into entity_audit_log first (recoverable), then upsert
// unconditionally — including over prior manual admin edits. Soft-deleted
// entities are the one thing this refuses to touch (force-overwrite is about
// refreshing content, not silently resurrecting something an admin removed).
async function processForceOverwrite(
  tpl: ScrapeTemplate, url: string, category: string, jobId: number, jobKey: string,
): Promise<{ status: string; outcome: string | null; entityId: string | null }> {
  const fetched = await fetchPage(url);
  await logScrape(url, 'bulk_import_fetch', { category, status: fetched.status });
  if (!fetched.ok) {
    await recordProgress(jobId, category, url, 'error', null, null, fetched.blocked || `HTTP ${fetched.status}`);
    return { status: 'error', outcome: null, entityId: null };
  }
  const ex = extract(fetched.html, url);
  const m = templateMatchesPage(tpl, ex);
  if (!m.matches) {
    await recordProgress(jobId, category, url, 'skipped', null, null, `template mismatch: ${m.reason}`);
    return { status: 'skipped', outcome: null, entityId: null };
  }
  const applied = applyTemplate(tpl, ex, url);
  if (applied.matchedCount === 0) {
    await recordProgress(jobId, category, url, 'skipped', null, null, 'no fields matched on page');
    return { status: 'skipped', outcome: null, entityId: null };
  }
  const id = entityIdFor(category, ex.title || 'unknown');
  const existing = await getEntity(id);
  if (existing && existing.status === 'removed') {
    await recordProgress(jobId, category, url, 'skipped', null, id, 'entity is soft-deleted; force-overwrite does not resurrect removed entities');
    return { status: 'skipped', outcome: null, entityId: id };
  }
  const { draft } = await buildTemplateDraft(tpl, ex, category, DOMAIN, url, applied);
  let outcome: 'created' | 'overwritten_clean' | 'overwritten_manual';
  if (!existing) {
    outcome = 'created';
  } else {
    await snapshotBeforeOverwrite(existing, jobKey); // requirement 1: recoverable, not lost
    outcome = existing.edited_by_admin ? 'overwritten_manual' : 'overwritten_clean';
  }
  await upsertEntity(draft); // requirement 3: always regenerates ai_context + embedding
  await recordProgress(jobId, category, url, 'done', outcome, id, null);
  return { status: 'done', outcome, entityId: id };
}

async function summarize(jobId: number): Promise<{ rows: { category: string; outcome: string; n: number }[]; totals: Record<string, number> }> {
  const res = await query(
    `SELECT category, outcome, count(*)::int AS n FROM bulk_import_progress
     WHERE job_id=$1 AND outcome IS NOT NULL GROUP BY category, outcome ORDER BY category, outcome`,
    [jobId],
  );
  const totals: Record<string, number> = { created: 0, overwritten_clean: 0, overwritten_manual: 0 };
  for (const r of res.rows as any[]) totals[r.outcome] = (totals[r.outcome] || 0) + r.n;
  return { rows: res.rows as any, totals };
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Requirement 4: force-overwrite must be passed explicitly on THIS
  // invocation — never read as a persistent .env default.
  if (args['force-overwrite'] !== true) {
    console.error('Refusing to run: pass --force-overwrite explicitly on this invocation (not a .env default) to authorize overwriting existing entities, including manually-edited ones.');
    console.error('Usage: tsx src/bulk-import.ts --force-overwrite --categories=ship,manufacturer,weapon,location,commodity [--job-key=initial_force_pull] [--max-per-category=500]');
    process.exit(1);
  }
  const categories = String(args['categories'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!categories.length) { console.error('--categories=a,b,c is required.'); process.exit(1); }
  const jobKey = String(args['job-key'] || 'initial_force_pull');
  const maxPerCategory = parseInt(String(args['max-per-category'] || '500'), 10);
  const rateCfg = loadBulkImportRateLimitConfig();

  line(`=== bulk-import --force-overwrite: job="${jobKey}" categories=[${categories.join(', ')}] rate=${rateCfg.perMin}/min,${rateCfg.perDay}/day ===`);
  const job = await ensureJob(jobKey, categories, true);

  let dailyCapHit = false;
  for (const category of categories) {
    if (dailyCapHit) break;
    if (!BROAD_CATEGORY[category]) { line(`  [${category}] no known wiki category name — skipping.`); continue; }
    const tpl = await ensureTemplate(category);
    const broad = BROAD_CATEGORY[category];
    const pages = await categoryMembers(broad, maxPerCategory);
    line(`[${category}] Category:${broad} — ${pages.length} real pages discovered`);
    let done = 0, skipped = 0, errors = 0;
    for (const url of pages.slice(0, maxPerCategory)) {
      if (await alreadyProcessed(job.id, url)) continue; // resume: skip work already done in an earlier invocation
      const slot = await acquireBulkImportSlot(rateCfg);
      if (!slot.allowed) {
        line(`  [${category}] daily fetch cap (${rateCfg.perDay}) reached — pausing job.`);
        dailyCapHit = true;
        break;
      }
      const res = await processForceOverwrite(tpl, url, category, job.id, jobKey);
      if (res.status === 'done') done++; else if (res.status === 'skipped') skipped++; else errors++;
    }
    line(`  [${category}] this run: ${done} written, ${skipped} skipped, ${errors} errors`);
    const { totals: runningTotals } = await summarize(job.id);
    await query(`UPDATE bulk_import_jobs SET summary=$2, updated_at=now() WHERE id=$1`, [job.id, JSON.stringify(runningTotals)]);
  }

  await query(`UPDATE bulk_import_jobs SET status=$2, updated_at=now() WHERE id=$1`,
    [job.id, dailyCapHit ? 'paused_rate_limit' : 'done']);

  const { rows, totals } = await summarize(job.id);
  line('');
  line(`=== summary (job "${jobKey}", ${dailyCapHit ? 'PAUSED at daily rate cap — resume by re-running the same command' : 'COMPLETE'}) ===`);
  line(`created: ${totals.created}   overwritten (clean, no prior manual edits): ${totals.overwritten_clean}   overwritten (HAD manual edits): ${totals.overwritten_manual}`);
  line('by category:');
  for (const r of rows) line(`  ${r.category.padEnd(14)} ${r.outcome.padEnd(20)} ${r.n}`);

  if (totals.overwritten_manual > 0) {
    const manual = await query(
      `SELECT entity_id, url FROM bulk_import_progress WHERE job_id=$1 AND outcome='overwritten_manual' ORDER BY processed_at`,
      [job.id],
    );
    line('');
    line('entities that HAD manual edits overwritten (worth reviewing — prior values are recoverable via entity_audit_log):');
    for (const r of manual.rows as any[]) line(`  ${r.entity_id}  <-  ${r.url}`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
