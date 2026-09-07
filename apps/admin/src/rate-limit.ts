// rate-limit.ts — rolling-window fetch budget for the connector's one-time
// --force-overwrite bulk import specifically. Does NOT touch the scraper's
// existing flat 1-second politeness gap (fetcher.ts) used by ordinary
// scan/confirm/category-batch runs — that default behavior is unchanged.

import { query } from '../../api/src/db.js';

export interface RateLimitConfig { perMin: number; perDay: number; }

export function loadBulkImportRateLimitConfig(): RateLimitConfig {
  return {
    perMin: parseInt(process.env.SCRAPER_BULK_IMPORT_RATE_PER_MIN || '40', 10),
    perDay: parseInt(process.env.SCRAPER_BULK_IMPORT_RATE_PER_DAY || '500', 10),
  };
}

async function countSinceMinutes(minutesAgo: number): Promise<number> {
  const res = await query(
    `SELECT count(*)::int AS n FROM scrape_log
     WHERE action = 'bulk_import_fetch' AND created_at >= now() - ($1::text || ' minutes')::interval`,
    [minutesAgo],
  );
  return res.rows[0].n;
}

export type SlotResult = { allowed: true } | { allowed: false; reason: 'daily_cap' };

// Call BEFORE each page fetch the bulk-import job wants to make. Sleeps as
// needed to respect the per-minute pace (rolling window, not a fixed bucket);
// returns allowed:false once the rolling 24h cap is hit — the caller should
// pause the whole job at that point, not busy-wait for it to clear.
export async function acquireBulkImportSlot(cfg: RateLimitConfig): Promise<SlotResult> {
  for (;;) {
    const dayCount = await countSinceMinutes(24 * 60);
    if (dayCount >= cfg.perDay) return { allowed: false, reason: 'daily_cap' };
    const minCount = await countSinceMinutes(1);
    if (minCount < cfg.perMin) return { allowed: true };
    await new Promise((r) => setTimeout(r, 1500));
  }
}
