// import-verseguide-stanton-coordinates.ts — one-off import of real Stanton
// surface coordinates from a user-supplied VerseGuide export (a manually
// retrieved markdown file, never scraped by this project — see
// docs/decisions-log.md). Matches each record to an EXISTING KB location
// entity by exact name only; nothing is invented, and unmatched records
// (the vast majority — VerseGuide tracks individual caves/wrecks/etc. at a
// finer granularity than this KB does) are skipped, not guessed at.
//
// VerseGuide's displayed latitude uses NEGATIVE latitude for positive local
// Z/north (stated in the export's own header). This KB's convention
// (docs/api.md) is north-positive, so latitude is negated on the way in;
// longitude is unchanged.
//
// Run: tsx scripts/import-verseguide-stanton-coordinates.ts <path-to-export.md>

import { readFileSync } from 'fs';
import { pool, query } from '../apps/api/src/db.js';
import { upsertEntity } from '../apps/api/src/entity-repo.js';

interface Parsed {
  name: string;
  body: string;
  latitude: number;
  longitude: number;
}

function parse(path: string): Parsed[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const records: Parsed[] = [];
  let currentBody: string | null = null;
  let cur: Partial<Parsed> | null = null;

  const flush = () => {
    if (cur && cur.name && cur.body && typeof cur.latitude === 'number' && typeof cur.longitude === 'number') {
      records.push(cur as Parsed);
    }
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
      cur = { name: locMatch[1].trim(), body: currentBody ?? undefined };
      continue;
    }
    if (cur) {
      const lat = line.match(/^\s*-\s+\*\*Latitude:\*\*\s*(-?[\d.]+)/);
      if (lat) { cur.latitude = parseFloat(lat[1]); continue; }
      const lon = line.match(/^\s*-\s+\*\*Longitude:\*\*\s*(-?[\d.]+)/);
      if (lon) { cur.longitude = parseFloat(lon[1]); continue; }
    }
  }
  flush();
  return records;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx scripts/import-verseguide-stanton-coordinates.ts <path-to-export.md>');
    process.exit(1);
  }
  const records = parse(path);
  console.log(`Parsed ${records.length} records with lat/long from the export.`);

  const nameIndex = new Map<string, string[]>();
  const kb = await query<{ id: string; name: string }>(`SELECT id, name FROM entities WHERE type='location'`);
  for (const row of kb.rows) {
    const key = row.name.trim().toLowerCase();
    nameIndex.set(key, [...(nameIndex.get(key) ?? []), row.id]);
  }

  let updated = 0, ambiguous = 0, unmatched = 0;
  for (const rec of records) {
    const ids = nameIndex.get(rec.name.trim().toLowerCase());
    if (!ids || ids.length === 0) { unmatched++; continue; }
    if (ids.length > 1) { ambiguous++; continue; } // never guess which one
    const id = ids[0];
    const full = await query(`SELECT * FROM entities WHERE id=$1`, [id]);
    const r: any = full.rows[0];
    const attributes = {
      ...(r.attributes ?? {}),
      surface_coordinates: {
        latitude: -rec.latitude, // VerseGuide: negative latitude = north; this KB: north-positive
        longitude: rec.longitude,
        units: 'degrees',
      },
    };
    await upsertEntity({
      id: r.id, type: r.type, name: r.name, aliases: r.aliases,
      summary: r.summary, body: r.body, attributes,
      relations: r.relations, images: r.images, source: r.source,
      game_version: r.game_version, status: r.status, freshness_class: r.freshness_class,
    });
    console.log(`  ${rec.name} -> ${id} (${attributes.surface_coordinates.latitude}, ${attributes.surface_coordinates.longitude})`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} entities. Ambiguous (same name, multiple entities, skipped): ${ambiguous}. Unmatched (no KB entity, skipped): ${unmatched}.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
