// download-existing-images.ts — one-time backfill: self-hosts every entity
// image already in the KB that still points at an external host (every
// image scraped before media-store.ts existed — the entire KB as of this
// script's first run). Same reasoning as media-store.ts: we don't control
// starcitizen.tools or robertsspaceindustries.com, so we can't guarantee
// those URLs keep working — already caught two real cases of them being
// outright wrong this session (docs/schema.md Phase 13, Phase 17).
//
// Idempotent in two layers: an image never self-hosted gets the full
// downloadAndStoreImage() treatment (display copy + full-size original when
// derivable). An image already self-hosted by an earlier run of this script
// — before the two-tier url/full_url design existed — gets ONLY a
// lightweight downloadFullSizeOnly() pass using its preserved original_url,
// rather than re-downloading the display copy it already has. Re-running
// this script after everything's already backfilled touches nothing.
//
// A download failure leaves that field UNCHANGED (still pointing externally,
// or still missing full_url) rather than dropping it or storing a broken
// local reference — a failed download is no worse than the status quo, never
// worse.
//
// Direct SQL update per entity, not the full upsertEntity pipeline: images
// don't feed ai_context or the embedding, so there's nothing to regenerate
// for a pure image-array edit (same reasoning as cleanup-placeholder-images.ts).
//
// Usage: tsx src/download-existing-images.ts

import { query } from '../../api/src/db.js';
import { downloadAndStoreImage, downloadFullSizeOnly, isSelfHosted } from './media-store.js';

const line = (s = '') => console.log(s);

// Modest concurrency — polite to the two external hosts without taking
// forever across ~2,300+ images; images aren't html pages, so the stricter
// 1-req/sec html-scrape rate limit (fetcher.ts) doesn't apply here, but an
// unbounded Promise.all across the whole KB at once would still be rude.
const CONCURRENCY = 6;

async function processInBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function main() {
  line('=== download-existing-images ===');
  const res = await query(`SELECT id, images FROM entities WHERE jsonb_array_length(images) > 0`);
  line(`[scan] ${res.rows.length} entities with at least one image`);

  let imagesSeen = 0;
  let displayDownloaded = 0;
  let fullBackfilled = 0;
  let fullUnavailable = 0;
  let fullyUpToDate = 0;
  let failed = 0;
  const failures: string[] = [];
  let entitiesUpdated = 0;

  const rows = res.rows as { id: string; images: any[] }[];
  await processInBatches(rows, CONCURRENCY, async (row) => {
    let changed = false;
    const next = [];
    for (const img of row.images) {
      imagesSeen++;
      const url = typeof img?.url === 'string' ? img.url : '';
      const hasFullUrl = typeof img?.full_url === 'string' && img.full_url !== '';

      if (url && isSelfHosted(url)) {
        // Already has the display copy — only missing piece (if any) is the
        // separate full-size original, added after this ran the first time.
        if (hasFullUrl || !img.original_url) {
          fullyUpToDate++;
          next.push(img);
          continue;
        }
        const fullUrl = await downloadFullSizeOnly(img.original_url);
        if (fullUrl) {
          fullBackfilled++;
          changed = true;
          next.push({ ...img, full_url: fullUrl });
        } else {
          fullUnavailable++; // not derivable (e.g. RSI CDN source) — expected, not a failure
          next.push(img);
        }
        continue;
      }

      if (!url) { next.push(img); continue; }

      const stored = await downloadAndStoreImage(url);
      if (!stored) {
        failed++;
        failures.push(`${row.id}: ${url}`);
        next.push(img); // unchanged — still externally hosted, not worse than before
        continue;
      }
      displayDownloaded++;
      changed = true;
      next.push({
        ...img,
        url: stored.localUrl,
        original_url: img.original_url ?? stored.originalUrl,
        full_url: stored.fullUrl ?? img.full_url ?? null,
      });
    }
    if (changed) {
      await query(`UPDATE entities SET images = $1 WHERE id = $2`, [JSON.stringify(next), row.id]);
      entitiesUpdated++;
    }
  });

  line(`[images] ${imagesSeen} seen, ${displayDownloaded} display copies newly downloaded, ${fullBackfilled} full-size originals backfilled, ${fullUnavailable} had no separate full-size available, ${fullyUpToDate} already fully up to date, ${failed} failed`);
  line(`[entities] ${entitiesUpdated} entities updated`);
  if (failures.length) {
    line(`[failed] first ${Math.min(25, failures.length)} of ${failures.length}:`);
    for (const f of failures.slice(0, 25)) line(`  ${f}`);
  }
  line('=== done ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
