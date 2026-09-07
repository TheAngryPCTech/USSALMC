// demo.ts — Phase 3 end-to-end demonstration through the REAL trade-submit app
// (web form endpoint + bot-style command endpoint), which forward to the core
// /v1/trade-routes/{submit,confirm} endpoints. Nothing here touches the DB
// directly except read-only verification at the end.

const TS = `http://127.0.0.1:${process.env.TRADE_SUBMIT_PORT || 5000}`;
const post = (p: string, b: any) => fetch(TS + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, data: await r.json() }));
const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(74));
const j = (o: any) => JSON.stringify(o);

async function main() {
  hr(); line('PHASE 3 DEMO — trade route submissions, corroboration, history, abuse'); hr();

  // Use a distinct route so the demo is repeatable regardless of prior seed data.
  const COMMO = 'laranite';       // lowercase on purpose -> should normalize to "Laranite" entity
  const FROM = 'area 18';         // spaced on purpose  -> should normalize to "Area18" entity
  const TO = 'Baijini Point';     // no entity exists   -> kept as text, no dup created

  // ---- 1. WEB FORM submission (new route, community confidence) ----
  line('\n[1] WEB FORM submit — new route (expect: created, confidence=community)');
  const s1 = await post('/submit', { commodity: COMMO, origin: FROM, destination: TO, buy: 2650, sell: 3120, account: 'pilot_alice' });
  const id = s1.data.id;
  line(`    HTTP ${s1.status} | outcome=${s1.data.outcome} confidence=${s1.data.confidence} count=${s1.data.corroboration_count} id=${id}`);
  line(`    normalization:`);
  line(`      commodity "${COMMO}" -> "${s1.data.normalization.commodity.canonical}" (entity=${s1.data.normalization.commodity.entity_id}, ${s1.data.normalization.commodity.decision} ${s1.data.normalization.commodity.score.toFixed(2)})`);
  line(`      origin    "${FROM}" -> "${s1.data.normalization.from.canonical}" (entity=${s1.data.normalization.from.entity_id}, ${s1.data.normalization.from.decision} ${s1.data.normalization.from.score.toFixed(2)})`);
  line(`      dest      "${TO}" -> "${s1.data.normalization.to.canonical}" (entity=${s1.data.normalization.to.entity_id ?? 'null — kept as text, no dup'}, ${s1.data.normalization.to.decision})`);
  line(`    note: ${s1.data.note}`);

  // ---- 2. BOT COMMAND submission, matching price, DIFFERENT account -> corroborate ----
  line('\n[2] BOT COMMAND submit — matching price, independent account (expect: corroborated, confidence steps up)');
  const cmd = `!trade submit ${COMMO} "${FROM}" "${TO}" 2660 3115`;   // within 5% tolerance
  line(`    command: ${cmd}   (account: pilot_bob)`);
  const s2 = await post('/command', { text: cmd, account: 'pilot_bob' });
  line(`    HTTP ${s2.status} | parsed.ok=${s2.data.parsed.ok}`);
  line(`    outcome=${s2.data.result.outcome} confidence=${s2.data.result.confidence} count=${s2.data.result.corroboration_count} history_len=${s2.data.result.history_len}`);
  line(`    bot reply_text: ${s2.data.reply_text}`);

  // ---- 3. CONFLICTING price, third account -> supersede, keep old in history ----
  line('\n[3] WEB FORM submit — CONFLICTING price (expect: conflict-superseded, old value preserved in history)');
  const s3 = await post('/submit', { commodity: COMMO, origin: FROM, destination: TO, buy: 2650, sell: 4500, account: 'pilot_carol' });
  line(`    HTTP ${s3.status} | outcome=${s3.data.outcome} confidence=${s3.data.confidence} count=${s3.data.corroboration_count} history_len=${s3.data.history_len}`);
  line(`    note: ${s3.data.note}`);

  // ---- 4. Show the full row incl. price_history (the proof old values are kept) ----
  line('\n[4] VERIFY stored row + price_history — see the psql dump printed after this demo');
  line(`    (route id = ${id}; step [3] reported history_len=${s3.data.history_len})`);

  // ---- 5. ABUSE: self-corroboration + implausible price ----
  line('\n[5] ABUSE PATTERNS (expect: flagged for manual review, not auto-trusted)');
  line('    5a. same account (pilot_alice) re-reports its own route with matching price:');
  const a1 = await post('/submit', { commodity: COMMO, origin: FROM, destination: TO, buy: 2650, sell: 4500, account: 'pilot_alice' });
  line(`        outcome=${a1.data.outcome} flagged=${a1.data.flagged} reason="${a1.data.flag_reason}"`);
  line('    5b. brand-new route with implausible sell price:');
  const a2 = await post('/submit', { commodity: 'Quantanium', origin: 'Area18', destination: 'Everus Harbor', buy: 100, sell: 99999999, account: 'pilot_mallory' });
  line(`        outcome=${a2.data.outcome} flagged=${a2.data.flagged} reason="${a2.data.flag_reason}"`);
  line('    5c. sell < buy (swapped/bogus):');
  const a3 = await post('/submit', { commodity: 'Agricium', origin: 'Area18', destination: 'Port Tressler', buy: 5000, sell: 100, account: 'pilot_mallory' });
  line(`        outcome=${a3.data.outcome} flagged=${a3.data.flagged} reason="${a3.data.flag_reason}"`);

  // ---- 6. RATE LIMIT: one account spams quickly ----
  line('\n[6] RATE LIMIT (per account) — pilot_spammer fires 7 quick submissions (limit=5/min)');
  let limited = 0, accepted = 0;
  for (let i = 0; i < 7; i++) {
    const r = await post('/submit', { commodity: 'Titanium', origin: 'Area18', destination: `Stop${i}`, buy: 100 + i, sell: 200 + i, account: 'pilot_spammer' });
    if (r.status === 429 || r.data.outcome === 'rate_limited') limited++; else accepted++;
  }
  line(`    accepted=${accepted} rate_limited=${limited}`);

  // ---- 7. CONFIRM steps to top of ladder ----
  line('\n[7] CONFIRM (explicit vouch) — steps confidence to "confirmed"');
  const c = await post(`/confirm/${id}`, { account: 'moderator_dan' });
  line(`    HTTP ${c.status} | status=${c.data.status} confidence=${c.data.confidence} confirmations=${c.data.confirmations}`);

  // ---- 8. Bad command parsing (proves the parser is bot-ready) ----
  line('\n[8] COMMAND PARSER robustness (bot-ready):');
  for (const t of ['!trade submit Laranite Area18 2650', '!trade blah', '!trade submit Laranite Area18 "Port Tressler" 2650 3120']) {
    const r = await post('/command', { text: t, account: 'pilot_test' });
    line(`    "${t}"  -> HTTP ${r.status} ${r.data.parsed ? 'parsed.ok=' + r.data.parsed.ok : ''} ${r.data.error ? '(' + r.data.error.message + ')' : '(accepted)'}`);
  }

  hr(); line('DEMO COMPLETE'); hr();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
export {};
