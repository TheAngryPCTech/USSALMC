// demo.ts — end-to-end Phase 2 demonstration driving the REAL admin API,
// exactly as the browser UI would. Scans a real Star Citizen Wiki ship page,
// simulates the reviewer's checklist selections, saves a template, then applies
// it automatically to more ship pages.

const ADMIN = `http://127.0.0.1:${process.env.ADMIN_PORT || 4000}`;
const SEED = 'https://starcitizen.tools/Carrack';

const post = (p: string, b: any) => fetch(ADMIN + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const get = (p: string) => fetch(ADMIN + p).then(r => r.json());
const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(72));

// Fields a human reviewer would keep for a ship, mapped in plain language.
// These are the *labels* the extractor surfaces; we pick a realistic subset.
const KEEP: Record<string, { field_name: string; target: string; relation_type?: string }> = {
  'type': { field_name: 'craft_type', target: 'attribute' },
  'career': { field_name: 'career', target: 'attribute' },
  'role': { field_name: 'role', target: 'attribute' },
  'size': { field_name: 'size_class', target: 'attribute' },
  'model': { field_name: 'manufacturer', target: 'relation', relation_type: 'manufactured_by' },
  'crew': { field_name: 'crew', target: 'attribute' },
  'cargo': { field_name: 'cargo_capacity', target: 'attribute' },
  'summary': { field_name: 'summary', target: 'summary' },
};

async function main() {
  hr(); line('PHASE 2 DEMO — admin scraper end-to-end against Star Citizen Wiki'); hr();

  // ---- STEP 1: SCAN the seed ship page ----
  line(`\n[1] SCAN  ${SEED}`);
  const scan = await post('/admin/scan', { url: SEED });
  line(`    robots: ${scan.robots_ok ? 'ALLOWED' : 'BLOCKED'} | category detected: ${scan.category} | mode: ${scan.mode}`);
  line(`    title: ${scan.title} | candidates: ${scan.candidates.length}`);
  line(`    plain-language checklist (first rows a reviewer sees — no selectors/JSON):`);
  line(`    CHK  FIELD                     WHERE            VALUE`);
  for (const c of scan.candidates.slice(0, 12)) {
    if (c.kind === 'image') continue;
    line(`    [${c.defaultChecked ? 'x' : ' '}]  ${String(c.label).padEnd(24).slice(0,24)} ${String(c.where).padEnd(15)} ${(c.value ?? '(null)').slice(0,32)}`);
  }
  const imgCount = scan.candidates.filter((c: any) => c.kind === 'image').length;
  line(`    (+ ${imgCount} image candidates with thumbnails + primary/gallery selectors)`);

  // ---- STEP 2: reviewer selections -> CONFIRM (saves template + publishes) ----
  line(`\n[2] REVIEW + CONFIRM  (simulating the reviewer's checklist choices)`);
  const byLabel = new Map<string, any>();
  for (const c of scan.candidates) if (c.kind !== 'image') byLabel.set(String(c.label).toLowerCase(), c);
  const selections: any[] = [];
  for (const [label, map] of Object.entries(KEEP)) {
    const c = byLabel.get(label);
    if (c) selections.push({ key: c.key, ...map });
  }
  // keep the primary image too
  const primary = scan.candidates.find((c: any) => c.kind === 'image' && c.role === 'primary');
  if (primary) selections.push({ key: primary.key, field_name: 'primary_image', target: 'image', role: 'primary' });
  line(`    reviewer kept ${selections.length} fields: ${selections.map(s => s.field_name).join(', ')}`);

  const confirm = await post('/admin/confirm', { url: SEED, selections });
  if (confirm.error) { line('    ERROR: ' + JSON.stringify(confirm.error)); process.exit(1); }
  line(`    -> template saved: ${confirm.template_id}`);
  line(`    -> published entity: ${confirm.entity_id} (queue #${confirm.queue_id})`);
  line(`    -> diff vs live: ${JSON.stringify(confirm.diff).slice(0, 120)}`);
  if (confirm.link_suggestions.length) line(`    -> link suggestions: ${JSON.stringify(confirm.link_suggestions)}`);

  // show the published entity via the Phase-1 API-shaped fetch (admin queue item)
  const qi = await get(`/admin/queue/${confirm.queue_id}`);
  line(`    -> stored attributes: ${JSON.stringify(qi.proposed.attributes)}`);
  line(`    -> relations: ${JSON.stringify(qi.proposed.relations)} (manufacturer auto-linked if it existed)`);

  // ---- STEP 3: APPLY template to the rest of the category automatically ----
  line(`\n[3] APPLY TEMPLATE to more ship pages automatically`);
  const applied = await post('/admin/apply-category', { url: SEED, category: 'ship', maxPages: 3 });
  if (applied.error) { line('    ERROR: ' + JSON.stringify(applied.error)); process.exit(1); }
  line(`    template: ${applied.template_id}`);
  for (const p of applied.processed) {
    line(`    - ${p.url.replace(/^https?:\/\/[^/]+\//, '').padEnd(28)} ${String(p.status).padEnd(18)} fields ${p.matched}/${p.expected} ${p.entity_id || ''}`);
  }

  // ---- STEP 4: verify published entities exist with real data + ai_context ----
  line(`\n[4] VERIFY published ship entities (via review queue + published rows)`);
  const published = await get('/admin/queue?status=published');
  for (const it of published.items.slice(0, 5)) {
    line(`    ✓ ${it.entity_id.padEnd(28)} ${it.auto_published ? '(auto-published)' : '(reviewed)'}  from ${it.source_url.replace(/^https?:\/\/[^/]+\//,'')}`);
  }

  hr(); line('DEMO COMPLETE'); hr();
}
main().catch((e) => { console.error(e); process.exit(1); });
export {};
