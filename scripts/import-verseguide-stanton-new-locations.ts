// import-verseguide-stanton-new-locations.ts — create new KB location
// entities for every VerseGuide Stanton export record that has NO existing
// matching entity (caves, wrecks, mining POIs, etc. — tracked individually
// by VerseGuide at finer granularity than this KB previously was). Pairs
// with import-verseguide-stanton-coordinates.ts, which only patches
// EXISTING entities; this script only CREATES entities that don't exist,
// so re-running either script is safe and idempotent.
//
// Body/parent is set via a real `located_in` relation, resolved by exact
// name against existing type='location' entities (the 4 planets + 12
// moons already in the KB). A record whose body section has no exact KB
// match (the small Lagrange-point sub-sections) is created unparented
// rather than guessed at.
//
// Run: tsx scripts/import-verseguide-stanton-new-locations.ts <path-to-export.md>

import { readFileSync } from 'fs';
import { pool, query } from '../apps/api/src/db.js';
import { upsertEntity } from '../apps/api/src/entity-repo.js';

interface Parsed {
  name: string;
  body: string;
  latitude: number | null;
  longitude: number | null;
  type: string | null;
  sourceUrl: string | null;
}

function parse(path: string): Parsed[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const records: Parsed[] = [];
  let currentBody: string | null = null;
  let cur: Partial<Parsed> | null = null;

  const flush = () => {
    if (cur && cur.name && cur.body) records.push(cur as Parsed);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const bodyMatch = line.match(/^## (.+)$/);
    if (bodyMatch && !/^(Reading|Coverage|Contents)/.test(bodyMatch[1])) {
      flush();
      currentBody = bodyMatch[1].trim();
      continue;
    }
    const locMatch = line.match(/^### (.+)$/);
    if (locMatch) {
      flush();
      cur = { name: locMatch[1].trim(), body: currentBody ?? undefined, latitude: null, longitude: null, type: null, sourceUrl: null };
      continue;
    }
    if (cur) {
      const lat = line.match(/^\s*-\s+\*\*Latitude:\*\*\s*(-?[\d.]+)/);
      if (lat) { cur.latitude = parseFloat(lat[1]); continue; }
      const lon = line.match(/^\s*-\s+\*\*Longitude:\*\*\s*(-?[\d.]+)/);
      if (lon) { cur.longitude = parseFloat(lon[1]); continue; }
      const type = line.match(/^\s*-\s+\*\*Type:\*\*\s*(.+)$/);
      if (type) { cur.type = type[1].trim(); continue; }
      const src = line.match(/^\s*-\s+\*\*Source:\*\*\s*\[[^\]]*\]\(([^)]+)\)/);
      if (src) { cur.sourceUrl = src[1].trim(); continue; }
    }
  }
  flush();
  return records;
}

function slugify(name: string): string {
  return 'location_' + name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx scripts/import-verseguide-stanton-new-locations.ts <path-to-export.md>');
    process.exit(1);
  }
  const records = parse(path);
  console.log(`Parsed ${records.length} total records from the export.`);

  const existing = await query<{ id: string; name: string }>(`SELECT id, name FROM entities WHERE type='location'`);
  const nameIndex = new Map<string, string[]>();
  const existingIds = new Set<string>();
  for (const row of existing.rows) {
    existingIds.add(row.id);
    const key = row.name.trim().toLowerCase();
    nameIndex.set(key, [...(nameIndex.get(key) ?? []), row.id]);
  }

  let created = 0, skippedExisting = 0, unparented = 0;
  const usedIds = new Set<string>();
  for (const rec of records) {
    const existingMatch = nameIndex.get(rec.name.trim().toLowerCase());
    if (existingMatch && existingMatch.length >= 1) { skippedExisting++; continue; } // already in the KB

    let id = slugify(rec.name);
    while (existingIds.has(id) || usedIds.has(id)) id += '_2';
    usedIds.add(id);

    const bodyIds = nameIndex.get(rec.body.trim().toLowerCase());
    const relations: { type: string; target_id: string }[] = [];
    if (bodyIds && bodyIds.length === 1) {
      relations.push({ type: 'located_in', target_id: bodyIds[0] });
    } else {
      unparented++;
    }

    const attributes: Record<string, any> = { category: 'location' };
    if (rec.type) attributes.subtype = rec.type;
    if (rec.latitude !== null && rec.longitude !== null) {
      attributes.surface_coordinates = {
        latitude: -rec.latitude, // VerseGuide: negative latitude = north; this KB: north-positive
        longitude: rec.longitude,
        units: 'degrees',
      };
    }

    await upsertEntity({
      id,
      type: 'location',
      name: rec.name,
      aliases: [],
      summary: null,
      body: null,
      attributes,
      relations,
      images: [],
      source: {
        origin: 'VerseGuide (user-provided export)',
        url: rec.sourceUrl,
        confidence: 'community',
        last_verified: new Date().toISOString().slice(0, 10),
      },
      game_version: null,
      status: 'current',
      freshness_class: null,
    });
    created++;
    if (created % 100 === 0) console.log(`  ...${created} created`);
  }

  console.log(`\nDone. Created ${created} new location entities (${unparented} without a resolved parent body). Skipped ${skippedExisting} that already existed in the KB.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
