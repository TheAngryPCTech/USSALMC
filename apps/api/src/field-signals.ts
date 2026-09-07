// field-signals.ts — field-level corroboration (green "confirm") and
// correction (red "flag") signals submitted from a live wiki page. Confirms
// are a simple count; flags land in field_corrections for admin review.
// Rate limiting mirrors the Phase 3 trade-submission pattern (per submitter).

import { query } from './db.js';

const RATE_MAX = parseInt(process.env.WIKI_SIGNAL_RATE_LIMIT_PER_MIN || '10', 10);

async function checkRate(submittedBy: string, ip: string | null): Promise<boolean> {
  const res = await query(
    `SELECT count(*)::int AS n FROM wiki_signal_events
     WHERE submitted_by = $1 AND action <> 'rate_limited' AND created_at > now() - interval '1 minute'`,
    [submittedBy],
  );
  const blocked = (res.rows[0]?.n ?? 0) >= RATE_MAX;
  if (blocked) {
    await query(
      `INSERT INTO wiki_signal_events (submitted_by, ip, action) VALUES ($1,$2,'rate_limited')`,
      [submittedBy, ip],
    );
  }
  return blocked;
}

export interface ConfirmInput {
  entityId: string; fieldName: string; currentValue: string | null;
  submittedBy: string; ip: string | null;
}

export async function confirmField(input: ConfirmInput) {
  if (await checkRate(input.submittedBy, input.ip)) {
    return { outcome: 'rate_limited' as const, message: `Rate limit exceeded (${RATE_MAX}/min).` };
  }
  const res = await query(
    `INSERT INTO field_confirmations (entity_id, field_name, current_value, submitted_by, ip)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
    [input.entityId, input.fieldName, input.currentValue, input.submittedBy, input.ip],
  );
  await query(
    `INSERT INTO wiki_signal_events (submitted_by, ip, entity_id, field_name, action)
     VALUES ($1,$2,$3,$4,'confirm')`,
    [input.submittedBy, input.ip, input.entityId, input.fieldName],
  );
  return { outcome: 'confirmed' as const, id: res.rows[0].id, created_at: res.rows[0].created_at };
}

export interface FlagInput {
  entityId: string; fieldName: string; currentValue: string | null;
  suggestedValue: string; note: string | null; submittedBy: string; ip: string | null;
}

export async function flagField(input: FlagInput) {
  if (await checkRate(input.submittedBy, input.ip)) {
    return { outcome: 'rate_limited' as const, message: `Rate limit exceeded (${RATE_MAX}/min).` };
  }
  const res = await query(
    `INSERT INTO field_corrections (entity_id, field_name, current_value, suggested_value, note, submitted_by, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, created_at`,
    [input.entityId, input.fieldName, input.currentValue, input.suggestedValue, input.note, input.submittedBy, input.ip],
  );
  await query(
    `INSERT INTO wiki_signal_events (submitted_by, ip, entity_id, field_name, action)
     VALUES ($1,$2,$3,$4,'flag')`,
    [input.submittedBy, input.ip, input.entityId, input.fieldName],
  );
  return { outcome: 'flagged' as const, id: res.rows[0].id, status: res.rows[0].status, created_at: res.rows[0].created_at };
}
