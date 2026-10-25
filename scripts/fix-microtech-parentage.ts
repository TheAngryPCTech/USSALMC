// fix-microtech-parentage.ts — one-off fix: the KB never had a location
// entity for the microTech PLANET itself (only `manufacturer_microtech`,
// the company), unlike Hurston/Crusader/ArcCorp which all have a real
// `location_*` row. That gap left every microTech-body location from the
// VerseGuide import (including MIC-L1..L5) unparented. Creates
// `location_microtech` (same minimal shape as the other three planets)
// and re-parents every VerseGuide record whose body was "microTech" or
// "MIC L<1-5>" to it, by exact name match only.
//
// Run: tsx scripts/fix-microtech-parentage.ts <path-to-export.md>

import { readFileSync } from 'fs';
import { pool, query } from '../apps/api/src/db.js';
import { upsertEntity } from '../apps/api/src/entity-repo.js';

function parseNamesForMicrotech(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const names: string[] = [];
  let currentBody: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const bodyMatch = line.match(/^## (.+)$/);
    if (bodyMatch && !/^(Reading|Coverage|Contents)/.test(bodyMatch[1])) {
      currentBody = bodyMatch[1].trim();
      continue;
    }
    const locMatch = line.match(/^### (.+)$/);
    if (locMatch && currentBody && (currentBody === 'microTech' || /^MIC L[1-5]$/.test(currentBody))) {
      names.push(locMatch[1].trim());
    }
  }
  return names;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx scripts/fix-microtech-parentage.ts <path-to-export.md>');
    process.exit(1);
  }

  const existingPlanet = await query(`SELECT id FROM entities WHERE id='location_microtech'`);
  if (existingPlanet.rows.length === 0) {
    await upsertEntity({
      id: 'location_microtech',
      type: 'location',
      name: 'microTech',
      aliases: [],
      summary: null,
      body: null,
      attributes: { category: 'location' },
      relations: [],
      images: [],
      source: { origin: null, url: null, confidence: null, last_verified: null },
      game_version: null,
      status: 'current',
      freshness_class: null,
    });
    console.log('Created location_microtech.');
  } else {
    console.log('location_microtech already exists.');
  }

  const names = parseNamesForMicrotech(path);
  console.log(`${names.length} VerseGuide records belong under microTech/MIC-L*.`);

  let fixed = 0, alreadyParented = 0, notFound = 0;
  for (const name of names) {
    const res = await query(`SELECT * FROM entities WHERE type='location' AND lower(name)=lower($1)`, [name]);
    if (res.rows.length !== 1) { notFound++; continue; }
    const r: any = res.rows[0];
    const relations = Array.isArray(r.relations) ? r.relations : [];
    if (relations.some((rel: any) => rel.type === 'located_in')) { alreadyParented++; continue; }
    await upsertEntity({
      id: r.id, type: r.type, name: r.name, aliases: r.aliases,
      summary: r.summary, body: r.body, attributes: r.attributes,
      relations: [...relations, { type: 'located_in', target_id: 'location_microtech' }],
      images: r.images, source: r.source,
      game_version: r.game_version, status: r.status, freshness_class: r.freshness_class,
    });
    fixed++;
  }

  console.log(`\nDone. Re-parented ${fixed} entities to microTech. Already parented: ${alreadyParented}. Not found (name mismatch): ${notFound}.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
