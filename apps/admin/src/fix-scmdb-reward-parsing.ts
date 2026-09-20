// fix-scmdb-reward-parsing.ts — one-off fix for a real bug found while
// verifying Phase 24 data: import-scmdb-missions.ts's parseNumber() stripped
// ALL non-digit characters from a table cell's raw text, so a mission whose
// reward cell shows a stacked second line (a FEE, e.g. Tracker License
// certifications charge an application fee) got its two numbers
// concatenated into one garbage value — confirmed live: "Tracker Beginner's
// Permit Certification" stored reward_auec=397501000 when the real page
// shows REWARD 39,750 aUEC / FEE -1,000 aUEC ("39750"+"1000" concatenated).
//
// Re-visits just the affected mission ids (implausibly large reward_auec —
// real aUEC rewards for these procedural contracts don't reach 7+ digits)
// and re-derives reward_auec (+ a new fee_auec when present) from the
// Overview tab's own "REWARD\n<n> aUEC" / "FEE\n<n> aUEC" lines with an
// anchored regex instead of blind digit-stripping. Only touches these two
// fields — does not re-run the rest of the Phase 24 reprocessing.
//
// Usage: tsx src/fix-scmdb-reward-parsing.ts [--threshold 1000000]

import { chromium } from 'playwright';
import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';

const line = (s = '') => console.log(s);

function parseRewardAndFee(overviewText: string): { reward: number | null; fee: number | null } {
  const rewardMatch = overviewText.match(/REWARD\s*\n\s*([\d,]+)\s*aUEC/i);
  const feeMatch = overviewText.match(/FEE\s*\n\s*-?([\d,]+)\s*aUEC/i);
  return {
    reward: rewardMatch ? parseInt(rewardMatch[1].replace(/,/g, ''), 10) : null,
    fee: feeMatch ? parseInt(feeMatch[1].replace(/,/g, ''), 10) : null,
  };
}

async function main() {
  const thresholdArg = process.argv.indexOf('--threshold');
  const threshold = thresholdArg !== -1 ? parseInt(process.argv[thresholdArg + 1], 10) : 1_000_000;

  line('=== fix-scmdb-reward-parsing ===');
  const res = await query(
    `SELECT id, attributes->>'scmdb_id' AS scmdb_id, attributes->>'reward_auec' AS reward
     FROM entities
     WHERE attributes->>'scmdb_id' IS NOT NULL AND (attributes->>'reward_auec')::bigint > $1
     ORDER BY (attributes->>'reward_auec')::bigint`,
    [threshold],
  );
  const rows = res.rows as { id: string; scmdb_id: string; reward: string }[];
  line(`[fix] ${rows.length} entities with reward_auec > ${threshold} to re-check`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: process.env.SCRAPER_USER_AGENT || 'USSALMC-Bot/0.1 (+respect-robots)' });

  let fixed = 0, unchanged = 0;
  for (const row of rows) {
    await page.goto(`https://scmdb.net/?m=${row.scmdb_id}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(500);
    const overviewText: string = await page.evaluate(() => (document.querySelector('.detail-body') as HTMLElement | null)?.innerText || '');
    const { reward, fee } = parseRewardAndFee(overviewText);

    if (reward === null) {
      line(`[fix] ${row.id}: could not find a REWARD line at all — leaving as-is for manual review`);
      continue;
    }
    if (String(reward) === row.reward) {
      unchanged++;
      continue;
    }

    const ent = await getEntity(row.id);
    if (!ent) continue;
    await upsertEntity({
      id: ent.id, type: ent.type, name: ent.name, aliases: ent.aliases,
      summary: ent.summary, body: ent.body,
      attributes: { ...ent.attributes, reward_auec: reward, fee_auec: fee },
      relations: ent.relations, images: ent.images,
      source: ent.source, game_version: ent.game_version, status: ent.status, freshness_class: ent.freshness_class,
    });
    line(`[fix] ${row.id}: ${row.reward} -> ${reward}${fee !== null ? ` (fee: ${fee})` : ''}`);
    fixed++;
  }
  await browser.close();

  line('');
  line(`[done] fixed ${fixed}, already-correct/unchanged ${unchanged}, total checked ${rows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
