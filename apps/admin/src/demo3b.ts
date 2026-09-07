// demo3b.ts — prove the OTHER trigger of the same re-weigh mechanism:
// crossing the TRUST THRESHOLD (not editing the template) also re-weighs the
// category queue and auto-completes items now within variance. Uses real code
// paths (publishQueueItem -> onTemplateChanged hook -> reweighCategoryQueue ->
// autoCompleteQueueItem) on scratch fixtures, cleaned up at the end.
import './scan.js'; // registers the onTemplateChanged re-weigh hook (side effect)
import { query } from '../../api/src/db.js';
import { getEntity } from '../../api/src/entity-repo.js';
import { enqueue, publishQueueItem } from './pipeline.js';

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(74));
const TPL = 'tpl_demo_trustcross_v1';
const DOM = 'demo.invalid';

// a minimal 2-field template + a matching extraction snapshot that scores 0% variance
const FIELD_MAP = [
  { field_name: 'role', match_by: 'label_text', label: 'Role', where: 'Side info box', is_image: false, target: 'attribute' },
  { field_name: 'summary', match_by: 'label_text', label: 'Summary', where: 'Body text', is_image: false, target: 'summary' },
];
const EX = {
  title: 'Demo Widget', description: 'A demo widget.', categories: ['Demo'], jsonLd: null,
  candidates: [
    { key: 'role', label: 'Role', value: 'utility', where: 'Side info box', defaultChecked: true, kind: 'field' },
    { key: 'summary', label: 'Summary', value: 'A demo widget for the trust-cross test.', where: 'Body text', defaultChecked: true, kind: 'field' },
  ],
};
const DRAFT = {
  id: 'item_demo_widget', type: 'item', name: 'Demo Widget', aliases: [],
  summary: 'A demo widget for the trust-cross test.', body: null,
  attributes: { role: 'utility', category: 'item' }, relations: [], images: [],
  source: { origin: DOM, url: 'https://demo.invalid/w', confidence: 'community', last_verified: '2026-09-06' },
  game_version: null, status: 'current', freshness_class: 'static',
};

async function cleanup() {
  await query(`DELETE FROM review_queue WHERE template_id=$1`, [TPL]);
  await query(`DELETE FROM scrape_templates WHERE id=$1`, [TPL]);
  await query(`DELETE FROM entities WHERE id='item_demo_widget'`);
  await query(`DELETE FROM embeddings WHERE entity_id='item_demo_widget'`).catch(() => {});
}

async function main() {
  hr(); line('DEMO 3b — TRUST-THRESHOLD CROSSING re-weighs the queue (same mechanism)'); hr();
  await cleanup();

  // scratch template: NOT trusted yet, streak 2 (one clean confirm from crossing at 3)
  await query(
    `INSERT INTO scrape_templates (id, category, domain, entity_type, field_map, match_signals, clean_streak, auto_publish)
     VALUES ($1,'item',$2,'item',$3,'{}'::jsonb,2,false)`,
    [TPL, DOM, JSON.stringify(FIELD_MAP)]);
  line(`    scratch template ${TPL}: clean_streak=2, auto_publish=false (NOT trusted)`);

  // Queue TWO items under it while it's untrusted:
  //  A) a LOW-variance item (0% — matches the template) -> should auto-complete on trust cross
  //  B) a driver item we approve cleanly to push the streak 2 -> 3 (crosses)
  const lowId = await enqueue({
    sourceUrl: 'https://demo.invalid/w', domain: DOM, category: 'item', templateId: TPL,
    entityId: 'item_demo_widget', proposed: DRAFT as any, diff: {}, linkSuggestions: [],
    variance: 0, varianceDetail: { variance_pct: 0 }, extraction: EX as any, routedReason: 'awaiting_trust',
  });
  line(`    queued LOW-variance item #${lowId} (item_demo_widget) status=pending while untrusted`);

  const driverId = await enqueue({
    sourceUrl: 'https://demo.invalid/driver', domain: DOM, category: 'item', templateId: TPL,
    entityId: 'item_demo_driver', proposed: { ...DRAFT, id: 'item_demo_driver', name: 'Demo Driver' } as any,
    diff: {}, linkSuggestions: [], extraction: EX as any,
  });

  let low = (await query(`SELECT status FROM review_queue WHERE id=$1`, [lowId])).rows[0];
  line(`    BEFORE: low-variance item #${lowId} status=${low.status}, entity published? ${(await getEntity('item_demo_widget')) ? 'yes' : 'no'}`);

  hr(); line('    Approve the driver item cleanly -> streak 2 -> 3 -> auto_publish flips ON -> hook fires'); hr();
  const r = await publishQueueItem(driverId, { edited: false });
  line(`    publish driver #${driverId}: autoPublishNowOn=${r.autoPublishNowOn}`);
  // hook is fire-and-forget; give it a moment to finish the re-weigh
  await new Promise((res) => setTimeout(res, 1500));

  const tpl = (await query(`SELECT clean_streak, auto_publish FROM scrape_templates WHERE id=$1`, [TPL])).rows[0];
  low = (await query(`SELECT status, auto_published, routed_reason FROM review_queue WHERE id=$1`, [lowId])).rows[0];
  line('');
  line(`    AFTER: template clean_streak=${tpl.clean_streak} auto_publish=${tpl.auto_publish} (now TRUSTED)`);
  line(`    AFTER: low-variance item #${lowId} status=${low.status} auto_published=${low.auto_published} reason=${low.routed_reason}`);
  line(`    AFTER: entity item_demo_widget published? ${(await getEntity('item_demo_widget')) ? 'YES' : 'no'}`);
  line('');
  line(`    >>> Crossing the trust threshold retroactively auto-completed the already-queued`);
  line(`        low-variance item — same reweighCategoryQueue() the template-solve path uses.`);

  const log = await query(`SELECT action, detail FROM scrape_log WHERE action IN ('reweigh','auto_complete') ORDER BY id DESC LIMIT 4`);
  line(''); line('    audit trail:');
  for (const l of log.rows as any[]) line(`      ${String(l.action).padEnd(14)} ${JSON.stringify(l.detail)}`);

  hr(); line('    cleanup scratch fixtures'); hr();
  await cleanup();
  line('    removed scratch template, queue rows, and entity.');
  hr(); line('DEMO 3b COMPLETE'); hr();
  process.exit(0);
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
export {};
