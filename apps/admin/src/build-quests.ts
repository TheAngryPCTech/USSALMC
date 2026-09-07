// build-quests.ts — one-time-per-environment backfill: scan starcitizen.tools'
// real "Contracts" category (the site's actual mission/quest content — there is
// no "Missions"/"Quests" category there; confirmed live via the MediaWiki API
// before this was written) and publish real quest entities through the normal
// scrape pipeline (confirm seed -> category batch -> reviewer-confirm each
// matching page), so the Active Contracts wiki panel has real data to show.
// Idempotent: entity ids are deterministic (quest_<slug>) and upsertEntity is
// ON CONFLICT DO UPDATE, so re-running just refreshes updated_at + content.
// Run: tsx src/build-quests.ts   (inside the admin container, real dev DB)

import { confirmScan, getBatch, processCategoryPage } from './scan.js';
import { findTemplate } from './template.js';
import { publishQueueItem, getQueueItem } from './pipeline.js';
import { query } from '../../api/src/db.js';

const SEED = 'https://starcitizen.tools/A_Call_to_Arms';
const TEMPLATE_ID = 'tpl_quest_starcitizen_tools_v1';
const line = (s = '') => console.log(s);

async function reviewerConfirmIfPending(queueId: number | undefined): Promise<void> {
  if (!queueId) return;
  const item = await getQueueItem(queueId);
  if (!item || item.status !== 'pending') return; // already published/auto_completed
  const res = await publishQueueItem(queueId, { edited: false });
  line(`    reviewer-confirmed queue #${queueId} -> ${res.entityId} (auto_publish now ${res.autoPublishNowOn})`);
}

async function main() {
  line('=== build-quests: seed confirm on ' + SEED + ' ===');
  const confirmed = await confirmScan(
    SEED,
    [{ key: 'summary', field_name: 'summary', target: 'summary' }],
    undefined, // let guessCategory() auto-detect -> 'quest'
    12,        // batch size: enough real Contract pages for >=5 published + trust streak
  );
  line(`category=${confirmed.category} template=${confirmed.template_id} seed entity=${confirmed.entity_id} published=${confirmed.published}`);

  // The seed page's own wiki categories include narrow faction-specific ones
  // ("Civilian Defense Force contracts") that most OTHER Contract pages don't
  // share, so a match_signals snapshot taken straight from the seed is too
  // strict for the category as a whole. SOLVE the template (same move as the
  // ship-category precedent, Phase 5) down to the one category every real
  // Contract page actually carries. The batch's per-page loop re-reads the
  // template on each iteration, so this takes effect for pages not yet processed.
  await query(`UPDATE scrape_templates SET match_signals=$2, updated_at=now() WHERE id=$1`,
    [TEMPLATE_ID, JSON.stringify({ categories: ['Contracts'], label_hints: [] })]);
  line('match_signals solved to ["Contracts"] (the category every real Contract page carries).');

  let batch = getBatch(confirmed.batch_id);
  while (batch && batch.status !== 'done' && batch.status !== 'error') {
    await new Promise((r) => setTimeout(r, 1000));
    batch = getBatch(confirmed.batch_id);
  }
  if (!batch || batch.status === 'error') { line(`batch error: ${batch?.error}`); process.exit(1); }
  line(`batch done: ${batch.processed_count}/${batch.total} pages processed`);

  const stillMismatched: string[] = [];
  for (const r of batch.results) {
    line(`  ${r.status.padEnd(20)} ${r.entity_id ?? '(none)'}  ${r.url}`);
    if (r.status === 'queued_for_review') await reviewerConfirmIfPending(r.queue_id);
    else if (r.status === 'mismatch') stillMismatched.push(r.url); // e.g. processed before the solve landed
  }

  // Retry any page that mismatched before the match_signals fix landed, now
  // against the corrected template.
  if (stillMismatched.length) {
    const tpl = await findTemplate('quest', 'starcitizen.tools');
    if (tpl) {
      line(`retrying ${stillMismatched.length} page(s) against the solved template...`);
      for (const url of stillMismatched) {
        const res = await processCategoryPage(tpl, url, 'quest', 'starcitizen.tools');
        line(`  ${res.status.padEnd(20)} ${res.entity_id ?? '(none)'}  ${url}`);
        if (res.status === 'queued_for_review') await reviewerConfirmIfPending(res.queue_id);
      }
    }
  }

  const published = await query(
    `SELECT id, name, updated_at, source->>'confidence' AS confidence
     FROM entities WHERE type='quest' ORDER BY updated_at DESC`,
  );
  line('');
  line(`=== ${published.rows.length} published quest entities (most recent first) ===`);
  for (const r of published.rows as any[]) {
    line(`  ${r.id.padEnd(45)} ${r.confidence.padEnd(10)} ${r.updated_at.toISOString()}  ${r.name}`);
  }
  await import('../../api/src/db.js').then(({ pool }) => pool.end());
}

main().catch((e) => { console.error(e); process.exit(1); });
