// pipeline.ts — the diff -> review -> publish flow, trust-threshold streak,
// and scrape logging. Publishing writes into the Phase 1 schema via upsertEntity.

import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity, type UpsertInput } from '../../api/src/entity-repo.js';

const TRUST_THRESHOLD = 3; // clean confirms in a row before auto-publish

// Re-weigh hook: registered by scan.ts so pipeline can trigger a queue re-weigh
// when a template becomes trusted (streak crosses the threshold) WITHOUT importing
// scan.ts (which would create a cycle: scan already imports pipeline).
export type ReweighHook = (templateId: string, trigger: string) => Promise<void>;
let reweighHook: ReweighHook | null = null;
export function onTemplateChanged(fn: ReweighHook) { reweighHook = fn; }

export async function logScrape(sourceUrl: string | null, action: string, detail: any = {}) {
  await query(`INSERT INTO scrape_log (source_url, action, detail) VALUES ($1,$2,$3)`,
    [sourceUrl, action, JSON.stringify(detail)]).catch(() => {});
}

// field-level diff of a proposed draft against the current live entity
export async function diffAgainstLive(entityId: string, proposed: UpsertInput): Promise<Record<string, { from: any; to: any }>> {
  const live = await getEntity(entityId);
  const diff: Record<string, { from: any; to: any }> = {};
  const fields: (keyof UpsertInput)[] = ['name', 'summary', 'game_version', 'status'];
  for (const f of fields) {
    const before = live ? (live as any)[f] ?? null : null;
    const after = (proposed as any)[f] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) diff[f as string] = { from: before, to: after };
  }
  // attribute-level diff
  const beforeAttrs = live?.attributes ?? {};
  const afterAttrs = proposed.attributes ?? {};
  for (const k of new Set([...Object.keys(beforeAttrs), ...Object.keys(afterAttrs)])) {
    const b = (beforeAttrs as any)[k] ?? null;
    const a = (afterAttrs as any)[k] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) diff[`attributes.${k}`] = { from: b, to: a };
  }
  if ((live?.images?.length ?? 0) !== (proposed.images?.length ?? 0)) {
    diff['images'] = { from: live?.images?.length ?? 0, to: proposed.images?.length ?? 0 };
  }
  return diff;
}

export interface QueueItem {
  id: number; source_url: string; domain: string; category: string;
  template_id: string | null; entity_id: string; proposed: UpsertInput;
  diff: any; link_suggestions: any[]; status: string; note: string | null;
  auto_published: boolean;
  variance: number | null; variance_detail: any | null; extraction: any | null;
  routed_reason: string | null;
}

export async function enqueue(params: {
  sourceUrl: string; domain: string; category: string; templateId: string | null;
  entityId: string; proposed: UpsertInput; diff: any; linkSuggestions: any[];
  status?: string; note?: string;
  // variance-flow additions: the extraction snapshot lets the queue be
  // re-weighed against an updated template later WITHOUT re-fetching the page.
  variance?: number | null; varianceDetail?: any | null; extraction?: any | null;
  routedReason?: string | null;
}): Promise<number> {
  const res = await query(
    `INSERT INTO review_queue
       (source_url, domain, category, template_id, entity_id, proposed, diff, link_suggestions, status, note,
        variance, variance_detail, extraction, routed_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [params.sourceUrl, params.domain, params.category, params.templateId, params.entityId,
     JSON.stringify(params.proposed), JSON.stringify(params.diff),
     JSON.stringify(params.linkSuggestions), params.status ?? 'pending', params.note ?? null,
     params.variance ?? null,
     params.varianceDetail != null ? JSON.stringify(params.varianceDetail) : null,
     params.extraction != null ? JSON.stringify(params.extraction) : null,
     params.routedReason ?? null],
  );
  return res.rows[0].id;
}

// Update just the variance snapshot on a queued item (used by re-weigh so the
// stored numbers + badges stay honest even when the item doesn't auto-complete).
export async function updateQueueVariance(
  id: number, variance: number, detail: any, routedReason: string | null,
): Promise<void> {
  await query(
    `UPDATE review_queue SET variance=$2, variance_detail=$3, routed_reason=$4 WHERE id=$1`,
    [id, variance, JSON.stringify(detail), routedReason]);
}

export async function getQueueItem(id: number): Promise<QueueItem | null> {
  const res = await query(`SELECT * FROM review_queue WHERE id=$1`, [id]);
  return res.rows[0] ? (res.rows[0] as any) : null;
}

// Publish a queued item into the live schema. `edited` = reviewer changed
// something (resets the streak); clean confirm advances it.
export async function publishQueueItem(id: number, opts: { edited: boolean; autoPublished?: boolean } = { edited: false }): Promise<{ entityId: string; autoPublishNowOn: boolean }> {
  const item = await getQueueItem(id);
  if (!item) throw new Error(`queue item ${id} not found`);
  const proposed: UpsertInput = item.proposed;
  await upsertEntity(proposed);
  await query(`UPDATE review_queue SET status='published', published_at=now(), auto_published=$2 WHERE id=$1`,
    [id, opts.autoPublished ?? false]);
  await logScrape(item.source_url, 'publish', { entity_id: item.entity_id, edited: opts.edited, auto: opts.autoPublished ?? false });

  // trust streak update on the (category, domain) template
  let autoPublishNowOn = false;
  if (item.template_id) {
    if (opts.edited) {
      await query(`UPDATE scrape_templates SET clean_streak=0, auto_publish=false, updated_at=now() WHERE id=$1`, [item.template_id]);
    } else {
      const before = await query(`SELECT auto_publish FROM scrape_templates WHERE id=$1`, [item.template_id]);
      const wasTrusted = before.rows[0]?.auto_publish ?? false;
      const res = await query(
        `UPDATE scrape_templates SET clean_streak=clean_streak+1,
           auto_publish = (clean_streak+1 >= $2), updated_at=now()
         WHERE id=$1 RETURNING clean_streak, auto_publish`,
        [item.template_id, TRUST_THRESHOLD],
      );
      autoPublishNowOn = res.rows[0]?.auto_publish ?? false;
      // Trust threshold JUST crossed -> re-weigh this template's queue: any
      // already-queued item now within variance auto-completes. Same mechanism
      // as re-weigh-on-template-solve (both are "template changed, re-judge the
      // queue"). Fire-and-forget so publish returns promptly.
      if (!wasTrusted && autoPublishNowOn && reweighHook) {
        reweighHook(item.template_id, 'trust_threshold_crossed').catch(() => {});
      }
    }
  }
  return { entityId: item.entity_id, autoPublishNowOn };
}

// Auto-complete a queued item through the SAME publish path + audit logging used
// by the trust-threshold fix. Used by re-weigh when a queued item now falls
// within the variance threshold under the current template. Marks the row
// 'auto_completed' (distinct from a manual 'published') and does NOT touch the
// trust streak (re-weigh is a template-level event, not a reviewer confirm).
export async function autoCompleteQueueItem(id: number, reason: string): Promise<{ entityId: string }> {
  const item = await getQueueItem(id);
  if (!item) throw new Error(`queue item ${id} not found`);
  await upsertEntity(item.proposed);
  await query(
    `UPDATE review_queue SET status='auto_completed', published_at=now(), auto_published=true, routed_reason=$2 WHERE id=$1`,
    [id, reason]);
  await logScrape(item.source_url, 'auto_complete', { entity_id: item.entity_id, queue_id: id, reason, variance: item.variance });
  return { entityId: item.entity_id };
}

export async function markMismatch(id: number, note: string) {
  await query(`UPDATE review_queue SET status='mismatch', note=$2 WHERE id=$1`, [id, note]);
  const item = await getQueueItem(id);
  await logScrape(item?.source_url ?? null, 'mismatch', { entity_id: item?.entity_id, note });
  // any mismatch also breaks the streak for safety
  if (item?.template_id) {
    await query(`UPDATE scrape_templates SET clean_streak=0, auto_publish=false, updated_at=now() WHERE id=$1`, [item.template_id]);
  }
}

export { TRUST_THRESHOLD };
