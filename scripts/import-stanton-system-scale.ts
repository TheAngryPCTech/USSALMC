// import-stanton-system-scale.ts — one-time import of real intra-system
// planet/moon positions from a user-provided, manually retrieved NAS
// export ("Stanton-3D-System-Coordinates.md" — a static snapshot, never
// scraped by this project, and NOT a live source like Pyro's sheet sync).
// Matches by exact name only against this project's Stanton reference
// roster (REFERENCE_SYSTEMS in apps/api/src/planetary-atlas.ts) — the
// export's Lagrange-station/outpost rows are intentionally skipped; this
// is for the 4 planets + 12 moons only. See CLAUDE.md Decisions Log,
// 2026-10-25.
//
// Run: tsx scripts/import-stanton-system-scale.ts <path-to-export.md>

import { readFileSync } from 'fs';
import { pool, query } from '../apps/api/src/db.js';
import { upsertEntity } from '../apps/api/src/entity-repo.js';

const STANTON_BODY_NAMES = new Set([
  'Hurston', 'Arial', 'Aberdeen', 'Magda', 'Ita',
  'Crusader', 'Cellin', 'Daymar', 'Yela',
  'ArcCorp', 'Lyria', 'Wala',
  'microTech', 'Calliope', 'Clio', 'Euterpe',
]);

interface Parsed { name: string; x: number; y: number }

function parse(path: string): Parsed[] {
  const text = readFileSync(path, 'utf8');
  const blocks = text.split(/^### /m).slice(1);
  const records: Parsed[] = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^(.+?)\s+—\s+/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    if (!STANTON_BODY_NAMES.has(name)) continue;
    const xyz = block.match(
      /Map XYZ \(source metres\):\*\*\s*X\s*(-?[\d.]+);\s*Y\s*(-?[\d.]+)/,
    );
    if (!xyz) continue;
    records.push({
      name,
      x: parseFloat(xyz[1]) / 1000, // metres -> km, matching Pyro sync's units
      y: parseFloat(xyz[2]) / 1000,
    });
  }
  return records;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx scripts/import-stanton-system-scale.ts <path-to-export.md>');
    process.exit(1);
  }
  const records = parse(path);
  console.log(`Parsed ${records.length} Stanton body records (of ${STANTON_BODY_NAMES.size} expected).`);

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
    if (ids.length > 1) { ambiguous++; continue; }
    const id = ids[0];
    const full = await query(`SELECT * FROM entities WHERE id=$1`, [id]);
    const r: any = full.rows[0];
    const attributes = {
      ...(r.attributes ?? {}),
      real_system_position: { x: rec.x, y: rec.y },
    };
    await upsertEntity({
      id: r.id, type: r.type, name: r.name, aliases: r.aliases,
      summary: r.summary, body: r.body, attributes,
      relations: r.relations, images: r.images, source: r.source,
      game_version: r.game_version, status: r.status, freshness_class: r.freshness_class,
    });
    console.log(`  ${rec.name} -> ${id} (${rec.x.toFixed(1)}km, ${rec.y.toFixed(1)}km)`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} entities. Ambiguous: ${ambiguous}. Unmatched: ${unmatched}.`);
  console.log('Note: no real body radius available in this export (Stanton bodies keep their schematic sphere size).');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
