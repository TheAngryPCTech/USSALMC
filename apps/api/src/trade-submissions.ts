// trade-submissions.ts — submission intelligence behind POST /v1/trade-routes/submit
// and /confirm. Handles: name normalization against existing entities (fuzzy,
// no duplicates), the confidence ladder (community -> corroborated -> confirmed),
// auto-corroboration within a time window, price history (never discards older
// values), per-account rate limiting, and abuse flagging.

import { query } from './db.js';

// ---- config (from env, with sane dev defaults) ----
const WINDOW_MIN = parseInt(process.env.TRADE_CORROBORATION_WINDOW_MIN || '120', 10);
const PRICE_TOLERANCE = parseFloat(process.env.TRADE_PRICE_TOLERANCE || '0.05'); // 5%
const RATE_MAX = parseInt(process.env.TRADE_RATE_LIMIT_PER_MIN || '5', 10);      // submissions/min/account
const MAX_PRICE = parseFloat(process.env.TRADE_MAX_PLAUSIBLE_PRICE || '10000000'); // aUEC/unit sanity ceiling

// ---- fuzzy name matching (same approach as Phase 2 linker) ----
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function similarity(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

export interface NameMatch {
  input: string;
  canonical: string;        // resolved display name (or cleaned input if no match)
  entity_id: string | null; // matched existing entity id, or null (no dup created)
  decision: 'auto' | 'suggest' | 'none';
  score: number;
}

// Normalize a commodity/location name against existing entities of given types.
export async function normalizeName(input: string, types: string[]): Promise<NameMatch> {
  const cleaned = (input || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { input, canonical: cleaned, entity_id: null, decision: 'none', score: 0 };
  const res = await query(
    `SELECT id, name, aliases FROM entities WHERE type = ANY($1)`, [types],
  );
  let best: { id: string; name: string; score: number } | null = null;
  for (const r of res.rows as any[]) {
    const names = [r.name, ...(r.aliases || [])];
    let s = 0;
    for (const n of names) {
      s = Math.max(s, similarity(cleaned, n));
      if (norm(cleaned) === norm(n)) s = 1;
    }
    if (!best || s > best.score) best = { id: r.id, name: r.name, score: s };
  }
  if (best && best.score >= 0.9) return { input, canonical: best.name, entity_id: best.id, decision: 'auto', score: best.score };
  if (best && best.score >= 0.5) return { input, canonical: best.name, entity_id: best.id, decision: 'suggest', score: best.score };
  // no confident match: keep the cleaned text, create NO new entity
  return { input, canonical: cleaned, entity_id: null, decision: 'none', score: best?.score ?? 0 };
}

export function routeKey(commodity: string, from: string, to: string): string {
  return [norm(commodity), norm(from), norm(to)].join('|');
}

function pricesMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  if (a === 0 && b === 0) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= PRICE_TOLERANCE;
}

// ---- rate limiting + abuse checks ----
export interface AbuseVerdict { rateLimited: boolean; flagged: boolean; reasons: string[]; }

export async function checkAbuse(account: string | null, buy: number | null, sell: number | null,
  existing: any | null): Promise<AbuseVerdict> {
  const reasons: string[] = [];
  let rateLimited = false;
  let flagged = false;

  // 1. per-account rate limit (submissions in the last minute)
  if (account) {
    const r = await query(
      `SELECT count(*)::int AS n FROM trade_submission_events
       WHERE account=$1 AND action IN ('submit','corroborate','conflict') AND created_at > now() - interval '1 minute'`,
      [account],
    );
    if (r.rows[0].n >= RATE_MAX) { rateLimited = true; reasons.push(`rate limit: >${RATE_MAX} submissions/min for account ${account}`); }
  }

  // 2. implausible prices
  if (buy != null && (buy < 0 || buy > MAX_PRICE)) { flagged = true; reasons.push(`implausible buy price ${buy}`); }
  if (sell != null && (sell < 0 || sell > MAX_PRICE)) { flagged = true; reasons.push(`implausible sell price ${sell}`); }
  if (buy != null && sell != null && sell < buy) { flagged = true; reasons.push(`sell (${sell}) below buy (${buy}) — likely swapped/bogus`); }

  // 3. self-corroboration: same account trying to corroborate a route it already reported
  if (existing && account) {
    const contributors: string[] = existing.contributor_accounts || [];
    if (contributors.includes(account)) {
      flagged = true;
      reasons.push(`self-corroboration: account ${account} already reported this route — not auto-trusted`);
    }
  }
  return { rateLimited, flagged, reasons };
}

async function logEvent(e: {
  account: string | null; client: string | null; ip: string | null; route_key: string;
  submission_id: string | null; action: string; buy: number | null; sell: number | null; detail?: any;
}) {
  await query(
    `INSERT INTO trade_submission_events (account, client, ip, route_key, submission_id, action, buy_price, sell_price, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.account, e.client, e.ip, e.route_key, e.submission_id, e.action, e.buy, e.sell, JSON.stringify(e.detail ?? {})],
  ).catch(() => {});
}

export interface SubmitInput {
  commodity: string; from_location: string; to_location: string;
  buy_price: number | null; sell_price: number | null;
  account: string | null; client: string | null; ip: string | null;
}

export interface SubmitOutcome {
  id: string;
  route_key: string;
  outcome: 'created' | 'corroborated' | 'conflict-superseded' | 'rate_limited';
  confidence: string;
  corroboration_count: number;
  profit_per_unit: number | null;
  last_verified: string | null;
  flagged: boolean;
  flag_reason: string | null;
  normalization: { commodity: NameMatch; from: NameMatch; to: NameMatch };
  history_len: number;
  note: string;
}

function stepUp(conf: string): string {
  if (conf === 'community') return 'corroborated';
  if (conf === 'corroborated') return 'confirmed';
  return 'confirmed';
}

// The single entry point used by POST /v1/trade-routes/submit.
export async function submitTradeRoute(inp: SubmitInput): Promise<SubmitOutcome> {
  // 1. normalize names against existing entities (no duplicates created)
  const commodity = await normalizeName(inp.commodity, ['commodity']);
  const from = await normalizeName(inp.from_location, ['location']);
  const to = await normalizeName(inp.to_location, ['location']);
  const rkey = routeKey(commodity.canonical, from.canonical, to.canonical);
  const buy = inp.buy_price;
  const sell = inp.sell_price;
  const profit = (buy != null && sell != null) ? sell - buy : null;
  const now = new Date().toISOString();

  // 2. find an existing recent submission for this normalized route
  const existRes = await query(
    `SELECT * FROM trade_route_submissions
     WHERE route_key=$1 AND updated_at > now() - ($2 || ' minutes')::interval
     ORDER BY updated_at DESC LIMIT 1`,
    [rkey, String(WINDOW_MIN)],
  );
  const existing = existRes.rows[0] || null;

  // 3. rate-limit / abuse checks
  const abuse = await checkAbuse(inp.account, buy, sell, existing);
  if (abuse.rateLimited) {
    await logEvent({ account: inp.account, client: inp.client, ip: inp.ip, route_key: rkey,
      submission_id: existing?.id ?? null, action: 'rate_limited', buy, sell, detail: { reasons: abuse.reasons } });
    return {
      id: existing?.id ?? '', route_key: rkey, outcome: 'rate_limited',
      confidence: existing?.confidence ?? 'community', corroboration_count: existing?.corroboration_count ?? 0,
      profit_per_unit: profit, last_verified: existing?.last_verified ?? null,
      flagged: true, flag_reason: abuse.reasons.join('; '),
      normalization: { commodity, from, to }, history_len: (existing?.price_history?.length ?? 0),
      note: 'Rate limit exceeded — submission not accepted; try again shortly.',
    };
  }

  // ---- NEW ROUTE ----
  if (!existing) {
    const seq = await query(`SELECT count(*)::int AS n FROM trade_route_submissions`);
    const id = `trade_route_${String(seq.rows[0].n + 1).padStart(4, '0')}`;
    const history = [{ buy_price: buy, sell_price: sell, profit_per_unit: profit, account: inp.account, reported_at: now, event: 'initial' }];
    const flagged = abuse.flagged;
    await query(
      `INSERT INTO trade_route_submissions
        (id, commodity, from_location, to_location, buy_price, sell_price, profit_per_unit,
         submitted_by, status, confirmations, last_verified, confidence, corroboration_count,
         submitter_account, contributor_accounts, price_history, flagged, flag_reason,
         commodity_entity_id, from_entity_id, to_entity_id, route_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,now(),'community',1,
         $9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, commodity.canonical, from.canonical, to.canonical, buy, sell, profit,
       inp.client, inp.account, JSON.stringify(inp.account ? [inp.account] : []),
       JSON.stringify(history), flagged, flagged ? abuse.reasons.join('; ') : null,
       commodity.entity_id, from.entity_id, to.entity_id, rkey],
    );
    await logEvent({ account: inp.account, client: inp.client, ip: inp.ip, route_key: rkey,
      submission_id: id, action: flagged ? 'flag_abuse' : 'submit', buy, sell, detail: { reasons: abuse.reasons } });
    return {
      id, route_key: rkey, outcome: 'created', confidence: 'community', corroboration_count: 1,
      profit_per_unit: profit, last_verified: now, flagged, flag_reason: flagged ? abuse.reasons.join('; ') : null,
      normalization: { commodity, from, to }, history_len: 1,
      note: flagged ? 'Submission stored but FLAGGED for manual review (see flag_reason).' : 'New community submission recorded.',
    };
  }

  // ---- EXISTING ROUTE: corroborate or conflict ----
  const priceOk = pricesMatch(buy, existing.buy_price != null ? Number(existing.buy_price) : null)
    && pricesMatch(sell, existing.sell_price != null ? Number(existing.sell_price) : null);
  const contributors: string[] = existing.contributor_accounts || [];
  const selfRepeat = inp.account != null && contributors.includes(inp.account);
  const history = Array.isArray(existing.price_history) ? [...existing.price_history] : [];

  if (priceOk && !selfRepeat && !abuse.flagged) {
    // AUTO-CORROBORATE: step confidence up, bump last_verified, keep history
    const newCount = (existing.corroboration_count || 1) + 1;
    const newConf = stepUp(existing.confidence || 'community');
    history.push({ buy_price: buy, sell_price: sell, profit_per_unit: profit, account: inp.account, reported_at: now, event: 'corroboration' });
    const newContrib = inp.account ? [...new Set([...contributors, inp.account])] : contributors;
    await query(
      `UPDATE trade_route_submissions
       SET corroboration_count=$2, confidence=$3, last_verified=now(), updated_at=now(),
           buy_price=$4, sell_price=$5, profit_per_unit=$6,
           contributor_accounts=$7, price_history=$8
       WHERE id=$1`,
      [existing.id, newCount, newConf, buy, sell, profit, JSON.stringify(newContrib), JSON.stringify(history)],
    );
    await logEvent({ account: inp.account, client: inp.client, ip: inp.ip, route_key: rkey,
      submission_id: existing.id, action: 'corroborate', buy, sell, detail: { new_confidence: newConf, count: newCount } });
    return {
      id: existing.id, route_key: rkey, outcome: 'corroborated', confidence: newConf, corroboration_count: newCount,
      profit_per_unit: profit, last_verified: now, flagged: existing.flagged, flag_reason: existing.flag_reason,
      normalization: { commodity, from, to }, history_len: history.length,
      note: `Corroborated by an independent report — confidence stepped up to "${newConf}".`,
    };
  }

  // CONFLICT (different price) or self-repeat/abuse: preserve old value in history,
  // do NOT step confidence up; if self-repeat/abuse, flag for review.
  const flaggedNow = selfRepeat || abuse.flagged;
  const flagReasons = [...abuse.reasons];
  if (selfRepeat) flagReasons.push(`self-corroboration by ${inp.account}`);

  if (!priceOk) {
    // supersede: archive the previous current value, then set new current
    history.push({
      buy_price: existing.buy_price != null ? Number(existing.buy_price) : null,
      sell_price: existing.sell_price != null ? Number(existing.sell_price) : null,
      profit_per_unit: existing.profit_per_unit != null ? Number(existing.profit_per_unit) : null,
      account: existing.submitter_account, reported_at: (existing.updated_at ?? existing.created_at), event: 'conflict-superseded',
    });
    history.push({ buy_price: buy, sell_price: sell, profit_per_unit: profit, account: inp.account, reported_at: now, event: 'conflict-new' });
    // conflicting price resets confidence to community (fresh disagreement)
    const newContrib = inp.account ? [...new Set([...contributors, inp.account])] : contributors;
    await query(
      `UPDATE trade_route_submissions
       SET buy_price=$2, sell_price=$3, profit_per_unit=$4, confidence='community',
           corroboration_count=1, last_verified=now(), updated_at=now(),
           contributor_accounts=$5, price_history=$6, flagged=$7,
           flag_reason=COALESCE($8, flag_reason)
       WHERE id=$1`,
      [existing.id, buy, sell, profit, JSON.stringify(newContrib), JSON.stringify(history),
       flaggedNow, flaggedNow ? flagReasons.join('; ') : null],
    );
    await logEvent({ account: inp.account, client: inp.client, ip: inp.ip, route_key: rkey,
      submission_id: existing.id, action: 'conflict', buy, sell, detail: { superseded: true, reasons: flagReasons } });
    return {
      id: existing.id, route_key: rkey, outcome: 'conflict-superseded', confidence: 'community', corroboration_count: 1,
      profit_per_unit: profit, last_verified: now, flagged: flaggedNow, flag_reason: flaggedNow ? flagReasons.join('; ') : existing.flag_reason,
      normalization: { commodity, from, to }, history_len: history.length,
      note: 'Conflicting price reported — previous value preserved in history; confidence reset to "community" pending fresh corroboration.',
    };
  }

  // self-repeat with matching price: record, flag, do NOT step up
  history.push({ buy_price: buy, sell_price: sell, profit_per_unit: profit, account: inp.account, reported_at: now, event: 'self-repeat-ignored' });
  await query(
    `UPDATE trade_route_submissions
     SET price_history=$2, flagged=true, flag_reason=COALESCE($3, flag_reason), updated_at=now()
     WHERE id=$1`,
    [existing.id, JSON.stringify(history), flagReasons.join('; ')],
  );
  await logEvent({ account: inp.account, client: inp.client, ip: inp.ip, route_key: rkey,
    submission_id: existing.id, action: 'flag_abuse', buy, sell, detail: { reasons: flagReasons } });
  return {
    id: existing.id, route_key: rkey, outcome: 'corroborated', confidence: existing.confidence, corroboration_count: existing.corroboration_count,
    profit_per_unit: existing.profit_per_unit != null ? Number(existing.profit_per_unit) : null,
    last_verified: existing.last_verified, flagged: true, flag_reason: flagReasons.join('; '),
    normalization: { commodity, from, to }, history_len: history.length,
    note: 'Repeat report from the same account ignored for confidence and FLAGGED (self-corroboration).',
  };
}

export { WINDOW_MIN, RATE_MAX, PRICE_TOLERANCE, MAX_PRICE };
