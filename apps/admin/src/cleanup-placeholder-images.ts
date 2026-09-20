// cleanup-placeholder-images.ts — removes the wiki's own generic "no image
// available" filler graphics from entities.images across the whole KB.
//
// Found while fixing species images (Kr'Thak's page had no real concept art,
// so starcitizen.tools shows "Placeholderv2.png" — a blank filler graphic —
// instead; the scraper's extractor can't tell that apart from a real photo,
// it just grabs whatever image sits in the infobox). That same graphic slipped
// through the ORIGINAL wiki scrape's admin review too, across 461 entities
// (locations, commodities, manufacturers, weapons, ships) — reported by the
// user after the species fix. This is a one-time cleanup for the existing
// backlog; the root-cause fix (filtering `/placeholder/i` before storing) is
// already in import-species-images.ts and should be applied to the main
// scraper's image-selection path too so this doesn't recur.
//
// Deliberately scoped to LITERAL "no image" filler graphics only:
//   - starcitizen.tools' own "Placeholderv2.png" (any thumb size)
//   - any URL containing "coming soon" / "comingsoon"
// NOT touched: RSI's own "NotSignedOff_*" roadmap screenshots (140 entities)
// — those are real, if preliminary/unofficial, dev screenshots RSI actually
// published, not a blank "missing image" graphic. Removing those would be a
// separate, much bigger judgment call the user hasn't asked for.
//
// Per-entity, per-image: removes ONLY the matching image object(s) from the
// array, leaving any other real image(s) on the same entity untouched (some
// ships have exactly this mix — 1 real photo + 1 placeholder). Uses a direct
// SQL update rather than the full upsertEntity pipeline: images don't feed
// ai_context or the embedding, so there's nothing to regenerate, and doing
// 461 embedding recomputations for a pure image-array cleanup would be pure
// waste.
//
// Usage: tsx src/cleanup-placeholder-images.ts

import { query } from '../../api/src/db.js';

const line = (s = '') => console.log(s);

function isPlaceholderImage(img: any): boolean {
  const url = typeof img?.url === 'string' ? img.url : '';
  return /placeholder/i.test(url) || /coming.?soon/i.test(url);
}

async function main() {
  line('=== cleanup-placeholder-images ===');
  const res = await query(
    `SELECT id, name, images FROM entities WHERE images::text ILIKE '%placeholder%' OR images::text ILIKE '%coming%soon%'`,
  );
  line(`[scan] ${res.rows.length} entities carrying at least one placeholder-looking image`);

  let entitiesCleaned = 0;
  let imagesRemoved = 0;
  let leftWithZeroImages = 0;

  for (const row of res.rows as any[]) {
    const before: any[] = Array.isArray(row.images) ? row.images : [];
    const after = before.filter((img) => !isPlaceholderImage(img));
    const removed = before.length - after.length;
    if (removed === 0) continue; // matched the text search but not the precise per-image check

    await query(`UPDATE entities SET images = $1 WHERE id = $2`, [JSON.stringify(after), row.id]);
    entitiesCleaned++;
    imagesRemoved += removed;
    if (after.length === 0) leftWithZeroImages++;
  }

  line(`[cleanup] ${entitiesCleaned} entities updated, ${imagesRemoved} placeholder image(s) removed`);
  line(`[cleanup] ${leftWithZeroImages} entities now have 0 images (had ONLY a placeholder before — honest, not a fabricated fallback)`);
  line('=== done ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
