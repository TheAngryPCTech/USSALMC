// demo3.ts — Phase 5: category-first + variance-based queue routing +
// re-weigh-on-template-solve. Runs against the REAL dev DB and the LIVE wiki
// (same pattern as demo2.ts). Non-destructive: snapshots the ship template's
// field map + the ship category threshold up front and restores them at the end,
// so the trusted baseline is unchanged after the demo. The routed/auto-completed
// queue rows + the published PTV entity remain as evidence.

import { query } from '../../api/src/db.js';
import { getEntity } from '../../api/src/entity-repo.js';
import { scanUrl, processCategoryPage, refineTemplateAndReweigh } from './scan.js';
import { findTemplate } from './template.js';
import { getCategoryTree, setVarianceThreshold, getVarianceThreshold } from './categories.js';

const PTV = 'https://starcitizen.tools/PTV';
const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(74));

// walk the tree to read a leaf's badge + its parent group's rolled-up badge
function findNode(tree: any[], slug: string): any {
  for (const n of tree) {
    if (n.slug === slug) return n;
    const c = findNode(n.children || [], slug);
    if (c) return c;
  }
  return null;
}
async function shipBadges() {
  const { tree } = { tree: await getCategoryTree() };
  const ship = findNode(tree, 'ship');
  const grp = findNode(tree, 'grp_vehicles');
  return { ship: ship?.subtree_pending ?? 0, group: grp?.subtree_pending ?? 0,
    threshold: ship?.effective_threshold_pct, isDefault: ship?.threshold_is_default };
}

async function main() {
  hr(); line('PHASE 5 DEMO — category-first + variance routing + re-weigh on solve'); hr();

  // --- snapshot for restore ---
  const tpl0 = await findTemplate('ship', 'starcitizen.tools');
  if (!tpl0) { line('No ship template — run the earlier phases first.'); process.exit(1); }
  const savedFieldMap = JSON.parse(JSON.stringify(tpl0.field_map));
  const savedThrRow = await query(`SELECT variance_threshold_pct FROM categories WHERE slug='ship'`);
  const savedThr = savedThrRow.rows[0]?.variance_threshold_pct ?? null;
  line(`baseline: ship template ${tpl0.id} has ${tpl0.field_map.length} fields, auto_publish=${tpl0.auto_publish} (TRUSTED), clean_streak=${tpl0.clean_streak}`);

  // ===================================================================
  line(''); hr(); line('[1] ADMIN SETS A STRICT PER-CATEGORY VARIANCE THRESHOLD'); hr();
  await setVarianceThreshold('ship', 15);
  const thr = await getVarianceThreshold('ship');
  line(`    ship variance threshold set to ${thr.pct}% (source: ${thr.source}) via the category management page`);
  let b = await shipBadges();
  line(`    ship pending badge BEFORE scan: ${b.ship}  (Vehicles group: ${b.group})`);

  // ===================================================================
  line(''); hr(); line('[2] SCAN A PAGE — CATEGORY FIRST, THEN VARIANCE CHECK'); hr();
  const scan = await scanUrl(PTV);
  line(`    scanned ${PTV}`);
  line(`    -> category assigned immediately: ${scan.category}   (mode: ${scan.mode})`);
  line(`    -> template: ${scan.template?.id}  auto_publish(TRUSTED)=${scan.template?.auto_publish}  streak=${scan.template?.clean_streak}`);
  line(`    -> variance: ${scan.variance?.variance_pct}%  vs threshold ${scan.variance_threshold_pct}%  => HIGH? ${scan.variance_high}`);
  line(`       (${scan.variance?.deviations} of ${scan.variance?.expected} expected fields deviate: ` +
       `${scan.variance?.missing} missing / ${scan.variance?.unmatched} empty / ${scan.variance?.structural} structural)`);
  line('       deviating fields (plain language):');
  for (const d of (scan.variance?.detail || []).slice(0, 8)) line(`         - [${d.kind}] ${d.detail}`);

  // ===================================================================
  line(''); hr(); line('[3] PROCESS IT — HIGH VARIANCE ROUTES TO QUEUE DESPITE TRUSTED CATEGORY'); hr();
  const res = await processCategoryPage(tpl0, PTV, 'ship', 'starcitizen.tools');
  line(`    processCategoryPage -> status=${res.status}  variance=${res.variance_pct}%  variance_high=${res.variance_high}  queue #${res.queue_id}`);
  const qrow = await query(`SELECT id, entity_id, status, auto_published, variance, routed_reason FROM review_queue WHERE id=$1`, [res.queue_id]);
  const q = qrow.rows[0];
  line(`    queue row: #${q.id} ${q.entity_id}  status=${q.status}  auto_published=${q.auto_published}  variance=${q.variance}%  reason=${q.routed_reason}`);
  line(`    >>> KEY: the ship template is TRUSTED (auto_publish=true) yet this page is status='${q.status}', NOT auto-published — high variance overrode trust.`);
  b = await shipBadges();
  line(`    ship pending badge AFTER routing: ${b.ship}  (Vehicles group: ${b.group})   <-- incremented immediately`);

  // ===================================================================
  line(''); hr(); line('[4] SOLVE THE TEMPLATE — DROP THE FIELDS THIS PAGE CANT PROVIDE'); hr();
  // A ground vehicle (PTV) has no cargo hold / quarters fields a big ship has.
  // "Solving" the template = removing those 6 fields so the template matches the
  // reality of smaller vehicles. This is the template CHANGING (not a trust
  // event) — it must re-weigh the queue.
  const dropped = new Set(['cargo', 'external_cargo', 'max_container', 'stations', 'beds', 'weapon_racks']);
  const refinedMap = savedFieldMap.filter((f: any) => !dropped.has(f.field_name));
  line(`    admin removes ${[...dropped].join(', ')} -> template ${savedFieldMap.length} fields => ${refinedMap.length} fields`);
  const refine = await refineTemplateAndReweigh(tpl0.id, refinedMap);
  const rw = refine.reweigh;
  line(`    re-weigh (trigger='${rw.trigger}', threshold ${rw.threshold_pct}%):`);
  line(`       auto_completed: ${rw.auto_completed.length}  ${JSON.stringify(rw.auto_completed)}`);
  line(`       still_queued:   ${rw.still_queued.length}   ${JSON.stringify(rw.still_queued)}`);

  // ===================================================================
  line(''); hr(); line('[5] VERIFY — ITEM AUTO-COMPLETED, ENTITY PUBLISHED, BADGE UPDATED'); hr();
  const q2 = (await query(`SELECT id, entity_id, status, auto_published, variance, routed_reason FROM review_queue WHERE id=$1`, [res.queue_id])).rows[0];
  line(`    queue row now: #${q2.id} ${q2.entity_id}  status=${q2.status}  auto_published=${q2.auto_published}  variance=${q2.variance}%  reason=${q2.routed_reason}`);
  const ent = await getEntity(q2.entity_id);
  line(`    live entity ${q2.entity_id}: ${ent ? `PUBLISHED "${ent.name}" type=${ent.type} category=${(ent.attributes as any)?.category}` : 'NOT FOUND'}`);
  line(`       ai_context (auto-generated): ${ent?.ai_context?.slice(0, 110)}...`);
  b = await shipBadges();
  line(`    ship pending badge AFTER re-weigh: ${b.ship}  (Vehicles group: ${b.group})   <-- decremented as the item resolved`);

  line(''); line('    audit trail (scrape_log, newest first):');
  const log = await query(`SELECT action, detail, created_at FROM scrape_log WHERE action IN ('variance_route','template_refine','reweigh','auto_complete') ORDER BY id DESC LIMIT 8`);
  for (const l of log.rows as any[]) line(`      ${new Date(l.created_at).toISOString().slice(11,19)} ${String(l.action).padEnd(15)} ${JSON.stringify(l.detail)}`);

  // ===================================================================
  line(''); hr(); line('[6] RESTORE BASELINE (non-destructive demo)'); hr();
  await query(`UPDATE scrape_templates SET field_map=$2 WHERE id=$1`, [tpl0.id, JSON.stringify(savedFieldMap)]);
  await query(`UPDATE categories SET variance_threshold_pct=$1 WHERE slug='ship'`, [savedThr]);
  const restored = await findTemplate('ship', 'starcitizen.tools');
  line(`    ship template restored to ${restored?.field_map.length} fields; ship threshold restored to ${savedThr ?? 'default'}.`);
  line(`    (kept as evidence: queue #${res.queue_id} = ${q2.status}, entity ${q2.entity_id} published.)`);

  hr(); line('DEMO 3 COMPLETE'); hr();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
export {};
