// demo2.ts — demonstrate trust threshold (auto-publish after clean streak) and
// cross-category linking, then verify entities landed in the Phase 1 schema.
const ADMIN = `http://127.0.0.1:${process.env.ADMIN_PORT || 4000}`;
const post = (p: string, b: any) => fetch(ADMIN + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const get = (p: string) => fetch(ADMIN + p).then(r => r.json());
const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(72));

async function main() {
  // ---- CROSS-CATEGORY LINKING (direct against the real Phase-1 Anvil entity) ----
  hr(); line('[A] CROSS-CATEGORY LINKING against existing entities'); hr();
  const { resolveLink } = await import('./linker.js');
  for (const t of ['Anvil Aerospace', 'Anvil Aerospaces', 'ANVL Carrack', 'Drake Interplanetary']) {
    const r = await resolveLink(t, 'manufactured_by', 'item');
    line(`    "${t.padEnd(20)}" -> ${r.decision.toUpperCase().padEnd(8)} ${r.target_id ? `${r.target_id} (${r.target_name}) score=${r.score.toFixed(2)}` : `score=${r.score.toFixed(2)}`}`);
  }
  line('    (auto>=0.9 links a relation; 0.5-0.9 suggests; <0.5 stays text — no guessing)');

  // ---- TRUST THRESHOLD ----
  hr(); line('[B] TRUST THRESHOLD — approve queued ships cleanly to earn auto-publish'); hr();
  let tpls = await get('/admin/templates');
  const t0 = tpls.items.find((t: any) => t.category === 'ship');
  line(`    start: template ${t0.id} clean_streak=${t0.clean_streak} auto_publish=${t0.auto_publish}`);

  const pending = await get('/admin/queue?status=pending');
  line(`    ${pending.items.length} ship drafts pending review; approving them cleanly (no edits)...`);
  for (const it of pending.items) {
    const r = await post(`/admin/queue/${it.id}/publish`, { edited: false });
    line(`      approved #${it.id} ${it.entity_id} -> published; auto_publish_now_on=${r.autoPublishNowOn}`);
  }
  tpls = await get('/admin/templates');
  const t1 = tpls.items.find((t: any) => t.category === 'ship');
  line(`    now: template ${t1.id} clean_streak=${t1.clean_streak} auto_publish=${t1.auto_publish}`);

  // ---- RE-APPLY: with auto_publish ON, more pages publish straight through ----
  hr(); line('[C] RE-APPLY template — auto-publish should now skip the review screen'); hr();
  const applied = await post('/admin/apply-category', { url: 'https://starcitizen.tools/Carrack', category: 'ship', maxPages: 5 });
  for (const p of applied.processed) {
    line(`    - ${p.url.replace(/^https?:\/\/[^/]+\//,'').padEnd(24)} ${String(p.status).padEnd(18)} ${p.entity_id || ''}`);
  }

  // ---- VERIFY in the Phase 1 schema, with generated ai_context ----
  hr(); line('[D] VERIFY entities landed in Phase-1 DB with auto-generated ai_context'); hr();
  const { query } = await import('../../api/src/db.js');
  const rows = await query(`SELECT id, name, type, jsonb_array_length(images) AS imgs, left(ai_context, 130) AS ctx FROM entities WHERE id LIKE 'ship_%' ORDER BY id`);
  for (const r of rows.rows as any[]) {
    line(`    ${r.id.padEnd(16)} "${r.name}" imgs=${r.imgs}`);
    line(`        ai_context: ${r.ctx}...`);
  }
  const log = await get('/admin/log');
  line(`\n    scrape_log entries (source URL + action + ts, newest first):`);
  for (const l of log.items.slice(0, 8)) line(`      ${new Date(l.created_at).toISOString().slice(11,19)} ${String(l.action).padEnd(14)} ${(l.source_url||'').replace(/^https?:\/\/[^/]+\//,'')}`);
  hr(); line('DEMO 2 COMPLETE'); hr();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
export {};
