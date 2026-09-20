// import-species-images.ts — backfills real photos/concept art for the 6
// `species` entities imported from StarCitizen-API, whose `/starmap/species`
// endpoint only ever returns `{code, id, name}` — no image field exists on
// that source at all (confirmed live; there's no per-species detail endpoint
// either). Checked UEX Corp's API too: no species/race endpoint exists there
// (only factions/organizations, which are player-org data, not lore races).
//
// starcitizen.tools — the same wiki this project already scrapes ships/
// commodities/weapons from, ToS-cleared once for the whole domain earlier
// this session — has real concept-art photos on each species' own page.
// This reuses the exact same scrape pipeline (fetcher.ts's robots-checked,
// rate-limited fetchPage() + extractor.ts's structural image detection) as
// the original wiki scrape, not a new one-off HTML parser.
//
// Enrichment-only, same rule as every other importer this session: matches
// each of our 6 EXISTING species entities to its real starcitizen.tools page
// by name, merges ONLY `images` (never touches summary/body/attributes),
// never creates a new entity. Skips an entity that already has an image
// (idempotent re-run).
//
// Usage: tsx src/import-species-images.ts

import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';
import { fetchPage } from './fetcher.js';
import { extract } from './extractor.js';
import { logScrape } from './pipeline.js';
import { downloadAndStoreImage } from './media-store.js';

const line = (s = '') => console.log(s);

// Real starcitizen.tools page slugs for each species entity id — verified
// live (all 6 returned HTTP 200) before writing this list; never guessed.
const SPECIES_PAGES: Record<string, string> = {
  lore_species_human: 'Human',
  lore_species_banu: 'Banu',
  lore_species_xi_an: "Xi'An",
  lore_species_tevarin: 'Tevarin',
  lore_species_kr_thak: "Kr'Thak",
  lore_species_vanduul: 'Vanduul',
};

async function main() {
  line('=== import-species-images ===');
  let enriched = 0;
  let skippedHasImages = 0;
  let skippedNoImage = 0;
  let skippedNotFound = 0;
  let blocked = 0;

  for (const [id, pageTitle] of Object.entries(SPECIES_PAGES)) {
    const ent = await getEntity(id);
    if (!ent) { line(`[skip] ${id}: not found in KB`); skippedNotFound++; continue; }
    if (Array.isArray(ent.images) && ent.images.length > 0) {
      line(`[skip] ${ent.name}: already has ${ent.images.length} image(s)`);
      skippedHasImages++;
      continue;
    }

    const url = `https://starcitizen.tools/${encodeURIComponent(pageTitle).replace(/%20/g, '_')}`;
    const res = await fetchPage(url);
    if (!res.ok) {
      line(`[blocked] ${ent.name}: ${res.blocked || `HTTP ${res.status}`}`);
      blocked++;
      continue;
    }

    const ex = extract(res.html, url);
    // Some pages (e.g. Kr'Thak) have no real concept art yet and the wiki
    // shows its own generic "no image available" placeholder graphic instead
    // — confirmed by inspection, not a guess. Storing that as if it were a
    // real species photo would misrepresent missing data as real content,
    // exactly what the never-guess-a-missing-field rule exists to prevent.
    const isPlaceholderGraphic = (u: string) => /placeholder/i.test(u);
    const imageCandidates = ex.candidates.filter(
      (c) => c.kind === 'image' && c.imageUrl && !isPlaceholderGraphic(c.imageUrl),
    );
    if (imageCandidates.length === 0) {
      line(`[skip] ${ent.name}: no images found on ${url}`);
      skippedNoImage++;
      continue;
    }

    // Primary (infobox portrait) first if the extractor found one, then a
    // handful of gallery concept-art shots — same cap style as the original
    // scraper, not every image on the page.
    const primary = imageCandidates.find((c) => c.role === 'primary') ?? imageCandidates[0];
    const gallery = imageCandidates.filter((c) => c !== primary).slice(0, 4);
    const images = [];
    for (const c of [primary, ...gallery]) {
      const stored = await downloadAndStoreImage(c.imageUrl!);
      images.push({
        url: stored?.localUrl ?? c.imageUrl!,
        original_url: c.imageUrl!,
        full_url: stored?.fullUrl ?? null,
        caption: null,
        role: c === primary ? 'primary' : 'gallery',
        added_by: 'scraper',
        source_url: url,
        license_note: 'REVIEW REQUIRED: scraped image, likely copyrighted (wiki/official).',
      });
    }

    await upsertEntity({
      id: ent.id, type: ent.type, name: ent.name, aliases: ent.aliases,
      summary: ent.summary, body: ent.body, attributes: ent.attributes,
      relations: ent.relations, images, source: ent.source,
      game_version: ent.game_version, status: ent.status, freshness_class: ent.freshness_class,
    });
    await logScrape(url, 'species_image_enrich', { entity_id: ent.id, image_count: images.length });
    line(`[ok] ${ent.name}: added ${images.length} image(s) from ${url}`);
    enriched++;
  }

  line(`[species] ${enriched} enriched, ${skippedHasImages} already had images, ${skippedNoImage} had none on the page, ${blocked} robots-blocked, ${skippedNotFound} not found`);
  line('=== done ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
