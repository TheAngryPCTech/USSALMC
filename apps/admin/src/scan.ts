// scan.ts — high-level operations the admin API exposes:
//  scanUrl     : fetch + robots + extract + (template match?) -> candidate list
//  confirmScan : reviewer selections -> save template -> draft -> diff -> queue
//  applyToCategory : run a saved template across other category pages
// Builds the target entity id as <category>_<slug>.

import type { UpsertInput } from '../../api/src/entity-repo.js';
import { fetchPage, discoverCategoryPages } from './fetcher.js';
import { extract, type ExtractionResult, type FieldCandidate } from './extractor.js';
import {
  guessCategory, findTemplate, findTemplateById, templateMatchesPage, domainOf,
  buildTemplateFromSelections, applyTemplate, saveTemplate, computeVariance,
  type ScrapeTemplate, type TemplateFieldRule, type VarianceResult,
} from './template.js';
import { resolveLink } from './linker.js';
import { getVarianceThreshold } from './categories.js';
import {
  diffAgainstLive, enqueue, publishQueueItem, autoCompleteQueueItem,
  updateQueueVariance, markMismatch, logScrape, onTemplateChanged, getQueueItem,
} from './pipeline.js';
import { query } from '../../api/src/db.js';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}
function entityIdFor(category: string, title: string): string {
  const typePrefix = category === 'ship' ? 'ship'
    : category === 'manufacturer' ? 'manufacturer'
    : category === 'weapon' ? 'item'
    : category;
  return `${typePrefix}_${slugify(title)}`;
}
function entityTypeFor(category: string): UpsertInput['type'] {
  if (category === 'location') return 'location';
  if (category === 'commodity') return 'commodity';
  return 'item'; // ship/manufacturer/weapon modeled as item in Phase 1
}

export interface ScanResponse {
  source_url: string;
  domain: string;
  category: string | null;
  title: string | null;
  description: string | null;
  robots_ok: boolean;
  content_signal?: string | null;
  template: { id: string; auto_publish: boolean; clean_streak: number; matched: boolean; reason: string } | null;
  mode: 'template_confirm' | 'full_review' | 'blocked' | 'no_category';
  candidates: FieldCandidate[];
  blocked_reason?: string;
  // variance of THIS page vs the category's current template (null if no template
  // yet). `variance_high` = exceeds the category's threshold -> would route to the
  // queue for manual review even if the category is otherwise trusted.
  variance?: VarianceResult | null;
  variance_threshold_pct?: number | null;
  variance_high?: boolean;
}

export async function scanUrl(url: string): Promise<ScanResponse> {
  const domain = domainOf(url);
  const fetched = await fetchPage(url);
  await logScrape(url, 'scan', { status: fetched.status });
  if (!fetched.ok) {
    return { source_url: url, domain, category: null, title: null, description: null,
      robots_ok: !fetched.blocked, mode: 'blocked', template: null, candidates: [], blocked_reason: fetched.blocked || `HTTP ${fetched.status}` };
  }
  const ex = extract(fetched.html, url);
  // CATEGORY FIRST: assign the page a category immediately from its own signals,
  // before deciding how it will be processed. This label sticks to the resulting
  // queue item / entity regardless of what happens next.
  const category = guessCategory(ex);
  if (!category) {
    return { source_url: url, domain, category: null, title: ex.title, description: ex.description,
      robots_ok: true, mode: 'no_category', template: null, candidates: ex.candidates };
  }
  const tpl = await findTemplate(category, domain);
  let templateInfo: ScanResponse['template'] = null;
  let mode: ScanResponse['mode'] = 'full_review';
  let variance: VarianceResult | null = null;
  let thresholdPct: number | null = null;
  let varianceHigh = false;
  if (tpl) {
    const m = templateMatchesPage(tpl, ex);
    templateInfo = { id: tpl.id, auto_publish: tpl.auto_publish, clean_streak: tpl.clean_streak, matched: m.matches, reason: m.reason };
    if (m.matches) mode = 'template_confirm';
    // VARIANCE CHECK: with the category known, compare this page's fields to the
    // category's current template. High variance would route to the queue even
    // for a trusted category.
    variance = computeVariance(tpl, ex);
    const thr = await getVarianceThreshold(category);
    thresholdPct = thr.pct;
    varianceHigh = variance.variance_pct > thr.pct;
  }
  return { source_url: url, domain, category, title: ex.title, description: ex.description,
    robots_ok: true, mode, template: templateInfo, candidates: ex.candidates,
    variance, variance_threshold_pct: thresholdPct, variance_high: varianceHigh };
}

// A reviewer selection referencing a candidate by its key.
export interface Selection {
  key: string;
  field_name: string;
  target: TemplateFieldRule['target'];
  role?: 'primary' | 'gallery';
  relation_type?: string;
}

// Turn an extraction + reviewer selections into a full entity draft, resolving
// links. Missing -> null (never guessed).
async function buildDraft(
  ex: ExtractionResult, selections: Selection[], category: string, sourceUrl: string,
): Promise<{ draft: UpsertInput; linkSuggestions: any[] }> {
  const byKey = new Map(ex.candidates.map((c) => [c.key, c]));
  const attributes: Record<string, unknown> = {};
  const images: any[] = [];
  const relations: { type: string; target_id: string }[] = [];
  const linkSuggestions: any[] = [];
  let summary: string | null = ex.description ?? null;
  const entityType = entityTypeFor(category);
  const id = entityIdFor(category, ex.title || 'unknown');

  for (const s of selections) {
    const c = byKey.get(s.key);
    if (!c) continue;
    if (s.target === 'ignore') continue;
    if (c.kind === 'image' && c.imageUrl) {
      images.push({
        url: c.imageUrl, caption: null, role: s.role || c.role || 'gallery',
        added_by: 'scraper', source_url: sourceUrl,
        license_note: 'REVIEW REQUIRED: scraped image, likely copyrighted (wiki/official).',
      });
      continue;
    }
    if (c.value == null) { attributes[s.field_name] = null; continue; } // honest null
    if (s.target === 'summary') { summary = c.value; continue; }
    if (s.target === 'relation') {
      const link = await resolveLink(c.value, s.relation_type || 'related_to', id);
      if (link.decision === 'auto' && link.target_id) {
        relations.push({ type: link.relation_type, target_id: link.target_id });
      } else {
        // fuzzy or none -> keep as attribute text, surface suggestion if fuzzy
        attributes[s.field_name] = c.value;
        if (link.decision === 'suggest') linkSuggestions.push({ field: s.field_name, ...link });
      }
      continue;
    }
    attributes[s.field_name] = c.value; // default: attribute
  }

  const draft: UpsertInput = {
    id, type: entityType, name: ex.title || id,
    aliases: [], summary, body: null, attributes, relations,
    images,
    source: {
      origin: domainOf(sourceUrl), url: sourceUrl,
      confidence: 'community', last_verified: new Date().toISOString().slice(0, 10),
    },
    game_version: (attributes['version'] as string) || (attributes['flight_ready_in'] as string) || null,
    status: 'current',
    freshness_class: category === 'trade_route' ? 'volatile' : 'static',
  };
  return { draft, linkSuggestions };
}

export interface ConfirmResult {
  template_id: string; queue_id: number; entity_id: string;
  diff: any; link_suggestions: any[]; published: boolean; auto_publish_now_on: boolean;
  batch_id: string; category: string;
}

// Reviewer confirms selections on the seed page -> save/update template, draft,
// diff, enqueue, publish (first confirm always goes through review UI).
// `categoryOverride` lets the reviewer pick the category when auto-detect is
// unsure (e.g. manufacturer/weapon pages whose categories aren't ship-like).
export async function confirmScan(url: string, selections: Selection[], categoryOverride?: string, maxPages = 50): Promise<ConfirmResult> {
  const domain = domainOf(url);
  const fetched = await fetchPage(url);
  if (!fetched.ok) throw new Error(fetched.blocked || `fetch failed HTTP ${fetched.status}`);
  const ex = extract(fetched.html, url);
  const category = (categoryOverride && categoryOverride.trim()) || guessCategory(ex);
  if (!category) throw new Error('Could not determine the category for this page — pick one from the Category dropdown and confirm again.');
  const entityType = entityTypeFor(category);

  // 1. generalize + save template
  const tplDraft = buildTemplateFromSelections(category, domain, entityType, ex, selections);
  const saved = await saveTemplate(tplDraft);
  await logScrape(url, 'confirm', { template_id: saved.id, fields: selections.length });

  // 2. build entity draft + 3. diff + 4. enqueue + 5. publish (reviewer confirmed)
  const { draft, linkSuggestions } = await buildDraft(ex, selections, category, url);
  const diff = await diffAgainstLive(draft.id, draft);
  const queueId = await enqueue({
    sourceUrl: url, domain, category, templateId: saved.id, entityId: draft.id,
    proposed: draft, diff, linkSuggestions, note: 'seed confirm',
  });
  const { autoPublishNowOn } = await publishQueueItem(queueId, { edited: false });

  // 6. AUTO-CONTINUE: immediately kick off the category batch in the background
  // (this is the bug fix — confirming a template now triggers the rest of the
  // category automatically instead of waiting for a manual "apply" click).
  const batchId = startCategoryBatch(url, category, domain, saved.id, maxPages, url);
  await logScrape(url, 'batch_start', { template_id: saved.id, batch_id: batchId, category });

  return {
    template_id: saved.id, queue_id: queueId, entity_id: draft.id,
    diff, link_suggestions: linkSuggestions, published: true, auto_publish_now_on: autoPublishNowOn,
    batch_id: batchId, category,
  };
}

export interface ApplyResult {
  template_id: string; category: string; domain: string;
  processed: { url: string; entity_id: string | null; status: string; matched: number; expected: number; queue_id?: number; auto_published?: boolean; note?: string; variance_pct?: number | null; variance_high?: boolean }[];
}

type ProcessedPage = ApplyResult['processed'][number];

// Shared draft builder: turn an applied-template result into a full entity draft
// (resolving relation links, stamping the category so it sticks in the tree).
// Used by processCategoryPage AND the re-weigh path so a re-weighed item is
// published from the CURRENT template's extraction, not a stale draft.
async function buildTemplateDraft(
  tpl: ScrapeTemplate, ex: ExtractionResult, category: string, domain: string, url: string,
  applied: ReturnType<typeof applyTemplate>,
): Promise<{ draft: UpsertInput; linkSuggestions: any[] }> {
  const id = entityIdFor(category, ex.title || 'unknown');
  const relations: { type: string; target_id: string }[] = [];
  const linkSuggestions: any[] = [];
  for (const rc of applied.relationCandidates) {
    const link = await resolveLink(rc.text, rc.relation_type, id);
    if (link.decision === 'auto' && link.target_id) relations.push({ type: link.relation_type, target_id: link.target_id });
    else if (link.decision === 'suggest') linkSuggestions.push({ ...link });
    else applied.attributes[rc.relation_type] = rc.text;
  }
  const draft: UpsertInput = {
    id, type: entityTypeFor(category), name: ex.title || id, aliases: [],
    summary: applied.summary ?? ex.description ?? null, body: null,
    // stamp the category onto the entity too, so it sticks in the tree/preview.
    attributes: { ...applied.attributes, category },
    relations, images: applied.images,
    source: { origin: domain, url, confidence: 'community', last_verified: new Date().toISOString().slice(0, 10) },
    game_version: (applied.attributes['version'] as string) || null,
    status: 'current', freshness_class: 'static',
  };
  return { draft, linkSuggestions };
}

// Process a SINGLE discovered page through a saved template: match -> apply ->
// resolve links -> diff -> VARIANCE CHECK -> enqueue (review) or auto-publish if
// the template has earned trust AND this page's variance is within threshold.
// Shared by the manual apply and the auto batch runner so both paths behave
// identically. High variance overrides trust: a page that doesn't match the
// template well enough is queued for manual review even for a trusted category.
export async function processCategoryPage(
  tpl: ScrapeTemplate, url: string, category: string, domain: string,
): Promise<ProcessedPage> {
  const fetched = await fetchPage(url);
  await logScrape(url, 'apply', { template_id: tpl.id, status: fetched.status });
  if (!fetched.ok) {
    return { url, entity_id: null, status: 'fetch_failed', matched: 0, expected: 0, note: fetched.blocked };
  }
  const ex = extract(fetched.html, url);
  const m = templateMatchesPage(tpl, ex);
  if (!m.matches) {
    const qid = await enqueue({ sourceUrl: url, domain, category, templateId: tpl.id,
      entityId: entityIdFor(category, ex.title || 'unknown'), proposed: {} as any, diff: {}, linkSuggestions: [],
      status: 'mismatch', note: `template mismatch: ${m.reason}`, extraction: ex, routedReason: 'category_mismatch' });
    await markMismatch(qid, `template mismatch: ${m.reason}`);
    return { url, entity_id: null, status: 'mismatch', matched: 0, expected: tpl.field_map.length, queue_id: qid, note: m.reason };
  }
  const applied = applyTemplate(tpl, ex, url);
  if (applied.matchedCount === 0) {
    const qid = await enqueue({ sourceUrl: url, domain, category, templateId: tpl.id,
      entityId: entityIdFor(category, ex.title || 'unknown'), proposed: {} as any, diff: {}, linkSuggestions: [],
      status: 'mismatch', note: 'no fields matched on page', extraction: ex, routedReason: 'no_fields_matched' });
    await markMismatch(qid, 'no fields matched on page');
    return { url, entity_id: null, status: 'mismatch', matched: 0, expected: applied.expectedCount, queue_id: qid };
  }
  const id = entityIdFor(category, ex.title || 'unknown');
  const { draft, linkSuggestions } = await buildTemplateDraft(tpl, ex, category, domain, url, applied);
  const diff = await diffAgainstLive(id, draft);

  // VARIANCE CHECK against the category's current template + threshold.
  const variance = computeVariance(tpl, ex);
  const thr = await getVarianceThreshold(category);
  const varianceHigh = variance.variance_pct > thr.pct;

  const qid = await enqueue({ sourceUrl: url, domain, category, templateId: tpl.id,
    entityId: id, proposed: draft, diff, linkSuggestions,
    variance: variance.variance_pct, varianceDetail: variance, extraction: ex,
    routedReason: varianceHigh ? 'high_variance' : (tpl.auto_publish ? 'auto_publish' : 'awaiting_trust') });

  // HIGH variance overrides trust: this specific page doesn't match the template
  // well enough to publish blindly, so it sits in the queue for manual review
  // even when the category is already trusted ("too many variables changed").
  if (varianceHigh) {
    await logScrape(url, 'variance_route', { entity_id: id, variance: variance.variance_pct, threshold: thr.pct, template_id: tpl.id });
    return { url, entity_id: id, status: 'queued_high_variance', matched: applied.matchedCount, expected: applied.expectedCount, queue_id: qid, variance_pct: variance.variance_pct, variance_high: true };
  }
  // LOW variance: proceed per the category's current mode.
  if (tpl.auto_publish) {
    await publishQueueItem(qid, { edited: false, autoPublished: true });
    return { url, entity_id: id, status: 'auto_published', matched: applied.matchedCount, expected: applied.expectedCount, queue_id: qid, auto_published: true, variance_pct: variance.variance_pct, variance_high: false };
  }
  return { url, entity_id: id, status: 'queued_for_review', matched: applied.matchedCount, expected: applied.expectedCount, queue_id: qid, variance_pct: variance.variance_pct, variance_high: false };
}

// Apply a saved template to other pages in the category (discovered via API).
export async function applyToCategory(seedUrl: string, category: string, maxPages = 3): Promise<ApplyResult> {
  const domain = domainOf(seedUrl);
  const tpl = await findTemplate(category, domain);
  if (!tpl) throw new Error(`No template for ${category} @ ${domain}`);
  const pages = await discoverCategoryPages(seedUrl, category, maxPages, tpl.match_signals?.categories || []);
  const processed: ProcessedPage[] = [];
  for (const url of pages.slice(0, maxPages)) {
    processed.push(await processCategoryPage(tpl, url, category, domain));
  }
  return { template_id: tpl.id, category, domain, processed };
}

// ---- re-weigh a category's queue against its CURRENT template ----
// One mechanism, two triggers: the trust threshold being crossed (from
// publishQueueItem) AND an admin refining/solving the template (from the
// category management page). Both mean "the template changed — re-judge the
// queue". For every item still pending under this template, recompute variance
// from the STORED extraction snapshot (no re-fetch) against the current
// template. Items now within threshold auto-complete via the same
// auto-complete/publish pipeline + audit logging as the trust-threshold fix;
// items still over threshold stay queued. Auto-complete requires the template to
// be trusted (auto_publish) — otherwise low-variance items follow the category's
// current mode and remain for manual confirm, exactly as they would at scan time.
export interface ReweighResult {
  template_id: string; category: string; domain: string;
  threshold_pct: number; trigger: string;
  auto_completed: { queue_id: number; entity_id: string; variance_pct: number }[];
  still_queued: { queue_id: number; entity_id: string; variance_pct: number }[];
  skipped: { queue_id: number; entity_id: string; reason: string }[];
}

export async function reweighCategoryQueue(templateId: string, trigger = 'template_changed'): Promise<ReweighResult> {
  const tpl = await findTemplateById(templateId);
  if (!tpl) throw new Error(`No template ${templateId}`);
  const thr = await getVarianceThreshold(tpl.category);
  const result: ReweighResult = {
    template_id: tpl.id, category: tpl.category, domain: tpl.domain,
    threshold_pct: thr.pct, trigger, auto_completed: [], still_queued: [], skipped: [],
  };
  // pending items for this template, oldest first (stable resolution order)
  const res = await query(
    `SELECT id FROM review_queue WHERE template_id=$1 AND status='pending' ORDER BY id ASC`, [templateId]);
  for (const row of res.rows as any[]) {
    const item = await getQueueItem(row.id);
    if (!item) continue;
    const ex = item.extraction as ExtractionResult | null;
    if (!ex || !Array.isArray((ex as any).candidates)) {
      // no snapshot to re-judge against (e.g. legacy mismatch row) — leave it
      result.skipped.push({ queue_id: row.id, entity_id: item.entity_id, reason: 'no extraction snapshot' });
      continue;
    }
    const variance = computeVariance(tpl, ex);
    const high = variance.variance_pct > thr.pct;
    // keep the stored variance honest even if we don't resolve it
    await updateQueueVariance(row.id, variance.variance_pct,
      variance, high ? 'high_variance' : (tpl.auto_publish ? 'reweigh_within_threshold' : 'awaiting_trust'));
    if (high) {
      result.still_queued.push({ queue_id: row.id, entity_id: item.entity_id, variance_pct: variance.variance_pct });
      continue;
    }
    // within threshold now. Rebuild the draft from the CURRENT template so the
    // published entity reflects the refined field map, then auto-complete — but
    // only if the category is trusted; otherwise it follows manual-confirm mode.
    if (!tpl.auto_publish) {
      result.still_queued.push({ queue_id: row.id, entity_id: item.entity_id, variance_pct: variance.variance_pct });
      continue;
    }
    const applied = applyTemplate(tpl, ex, item.source_url);
    const { draft } = await buildTemplateDraft(tpl, ex, tpl.category, tpl.domain, item.source_url, applied);
    const freshDiff = await diffAgainstLive(draft.id, draft);
    await query(`UPDATE review_queue SET proposed=$2, diff=$3 WHERE id=$1`,
      [row.id, JSON.stringify(draft), JSON.stringify(freshDiff)]);
    await autoCompleteQueueItem(row.id, `${trigger}: variance ${variance.variance_pct}% <= threshold ${thr.pct}%`);
    result.auto_completed.push({ queue_id: row.id, entity_id: draft.id, variance_pct: variance.variance_pct });
  }
  await logScrape(null, 'reweigh', {
    template_id: tpl.id, category: tpl.category, trigger, threshold: thr.pct,
    auto_completed: result.auto_completed.length, still_queued: result.still_queued.length,
  });
  return result;
}

// Register the re-weigh hook so pipeline.publishQueueItem can trigger it when the
// trust threshold is crossed, without importing scan.ts (avoids an import cycle).
onTemplateChanged((templateId, trigger) => reweighCategoryQueue(templateId, trigger).then(() => {}));

// Refine/solve a template's field map from the category management page, then
// re-weigh its queue against the updated template. Same mechanism as the
// trust-threshold crossing; both re-judge the queue when the template changes.
export async function refineTemplateAndReweigh(templateId: string, fieldMap: TemplateFieldRule[]): Promise<{ template_id: string; reweigh: ReweighResult }> {
  const { refineTemplateFields } = await import('./template.js');
  const tpl = await refineTemplateFields(templateId, fieldMap);
  await logScrape(null, 'template_refine', { template_id: tpl.id, category: tpl.category, fields: fieldMap.length });
  const reweigh = await reweighCategoryQueue(tpl.id, 'template_solved');
  return { template_id: tpl.id, reweigh };
}
// The auto-continue after a template is confirmed runs here so the confirm
// request returns immediately while the batch proceeds; the UI polls progress.
export interface BatchProgress {
  batch_id: string;
  template_id: string;
  category: string;
  domain: string;
  seed_url: string;
  total: number;
  processed_count: number;
  current_url: string | null;
  status: 'discovering' | 'running' | 'done' | 'error';
  started_at: string;
  finished_at: string | null;
  results: ProcessedPage[];
  error?: string;
}

const batches = new Map<string, BatchProgress>();

export function getBatch(id: string): BatchProgress | null {
  return batches.get(id) ?? null;
}
export function getBatchForTemplate(templateId: string): BatchProgress | null {
  let latest: BatchProgress | null = null;
  for (const b of batches.values()) {
    if (b.template_id === templateId) {
      if (!latest || b.started_at > latest.started_at) latest = b;
    }
  }
  return latest;
}

// Kick off the auto batch for a just-confirmed template. Returns the batch id
// immediately; processing continues in the background. `excludeUrl` is the seed
// page (already published by confirm), so we don't reprocess it.
export function startCategoryBatch(
  seedUrl: string, category: string, domain: string, templateId: string,
  maxPages: number, excludeUrl: string,
): string {
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const progress: BatchProgress = {
    batch_id: batchId, template_id: templateId, category, domain, seed_url: seedUrl,
    total: 0, processed_count: 0, current_url: null, status: 'discovering',
    started_at: new Date().toISOString(), finished_at: null, results: [],
  };
  batches.set(batchId, progress);

  // run detached (no await) — the caller returns to the admin right away
  (async () => {
    try {
      const tpl = await findTemplate(category, domain);
      if (!tpl) { progress.status = 'error'; progress.error = `No template for ${category} @ ${domain}`; progress.finished_at = new Date().toISOString(); return; }
      let pages = await discoverCategoryPages(seedUrl, category, maxPages + 1, tpl.match_signals?.categories || []);
      pages = pages.filter((u) => u !== excludeUrl).slice(0, maxPages);
      progress.total = pages.length;
      progress.status = 'running';
      for (const url of pages) {
        progress.current_url = url;
        // re-read the template each iteration so an auto_publish flip mid-batch
        // (once the trust threshold is crossed) takes effect for later pages
        const fresh = await findTemplate(category, domain);
        const res = await processCategoryPage(fresh ?? tpl, url, category, domain);
        progress.results.push(res);
        progress.processed_count += 1;
      }
      progress.current_url = null;
      progress.status = 'done';
      progress.finished_at = new Date().toISOString();
    } catch (e: any) {
      progress.status = 'error';
      progress.error = e?.message ?? String(e);
      progress.finished_at = new Date().toISOString();
    }
  })();

  return batchId;
}
