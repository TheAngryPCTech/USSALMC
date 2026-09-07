// regenerate.ts — re-run the ai_context + embedding pipeline for every entity.
// Use after bulk edits, an embedding-model change, or when relations were created
// before their targets existed (so relation names now resolve correctly).
// Run: tsx scripts/regenerate.ts

import { pool, query } from '../apps/api/src/db.js';
import { upsertEntity } from '../apps/api/src/entity-repo.js';

async function main() {
  const res = await query(`SELECT id FROM entities ORDER BY id`);
  console.log(`Regenerating ai_context + embeddings for ${res.rows.length} entities...`);
  for (const { id } of res.rows) {
    const full = await query(`SELECT * FROM entities WHERE id=$1`, [id]);
    const r: any = full.rows[0];
    await upsertEntity({
      id: r.id, type: r.type, name: r.name, aliases: r.aliases,
      summary: r.summary, body: r.body, attributes: r.attributes,
      relations: r.relations, images: r.images, source: r.source,
      game_version: r.game_version, status: r.status, freshness_class: r.freshness_class,
    });
    console.log(`  regenerated ${id}`);
  }
  await pool.end();
  console.log('Regeneration complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
