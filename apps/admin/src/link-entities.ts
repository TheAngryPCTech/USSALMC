// link-entities.ts — Phase 25: retroactive cross-linking pass over the KB.
// Nearly every category except quest (just linked, Phase 24 follow-up) and
// jump_point (linked at import time by importTunnels()) has zero
// `relations` — confirmed live via a full category breakdown before writing
// any code. This is a first pass at the highest-confidence, most valuable
// links, not a claim of covering every possible relationship in the KB:
//
//   ship/weapon  -> manufacturer   (bidirectional)
//   trade_route  -> commodity, origin/destination star_system
//
// Every link here is resolved from data ALREADY present and trustworthy in
// the KB (a manufacturer_code exact match, an existing commodity_entity_id,
// an exact star_system name) or via the project's own existing fuzzy-match
// helper (linker.ts's resolveLink(), already used at scrape time) — nothing
// here is invented; entities that don't resolve confidently are left
// unlinked rather than guessed.
//
// Usage: tsx src/link-entities.ts [--only ships|weapons|trade-routes]

import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';
import { resolveLink } from './linker.js';

const line = (s = '') => console.log(s);

function addRelation(existing: { type: string; target_id: string }[], type: string, targetId: string) {
  if (existing.some((r) => r.type === type && r.target_id === targetId)) return existing;
  return [...existing, { type, target_id: targetId }];
}

async function reciprocate(targetId: string, type: string, backTargetId: string) {
  const ent = await getEntity(targetId);
  if (!ent) return;
  const newRelations = addRelation(ent.relations, type, backTargetId);
  if (newRelations.length === ent.relations.length) return; // already had it
  await upsertEntity({ ...ent, relations: newRelations });
}

async function linkShipsAndWeaponsToManufacturers() {
  const mfrs = await query(
    `SELECT id, name, attributes->>'manufacturer_code' AS code FROM entities WHERE attributes->>'category' = 'manufacturer'`,
  );
  const byCode = new Map<string, { id: string; name: string }>();
  for (const m of mfrs.rows as any[]) if (m.code) byCode.set(m.code.toUpperCase(), { id: m.id, name: m.name });

  const items = await query(
    `SELECT id, attributes->>'class_name' AS class_name, attributes->>'manufactured_by' AS manufactured_by
     FROM entities WHERE attributes->>'category' IN ('ship', 'weapon') AND jsonb_array_length(relations) = 0`,
  );

  let linked = 0, skipped = 0;
  for (const row of items.rows as any[]) {
    let target: { id: string; name: string } | null = null;

    // 1) class_name prefix ("AEGS_Sabre" -> "AEGS") against a manufacturer's own code — exact, highest confidence.
    if (row.class_name) {
      const prefix = row.class_name.split('_')[0]?.toUpperCase();
      if (prefix && byCode.has(prefix)) target = byCode.get(prefix)!;
    }
    // 2) fall back to fuzzy name matching on manufactured_by (works for weapons, which store a clean name there).
    if (!target && row.manufactured_by) {
      const resolved = await resolveLink(row.manufactured_by, 'manufactured_by', row.id);
      if (resolved.decision === 'auto' && resolved.target_id) target = { id: resolved.target_id, name: resolved.target_name! };
    }
    if (!target) { skipped++; continue; }

    const ent = await getEntity(row.id);
    if (!ent) continue;
    await upsertEntity({ ...ent, relations: addRelation(ent.relations, 'manufactured_by', target.id) });
    await reciprocate(target.id, 'manufactures', row.id);
    linked++;
  }
  line(`[ship/weapon -> manufacturer] linked ${linked}, skipped (no confident match) ${skipped}`);
}

async function linkTradeRoutes() {
  const systems = await query(`SELECT id, name FROM entities WHERE attributes->>'category' = 'star_system'`);
  const systemByName = new Map<string, string>();
  for (const s of systems.rows as any[]) systemByName.set(s.name.toLowerCase(), s.id);

  const routes = await query(
    `SELECT id, attributes FROM entities WHERE type = 'trade_route' AND jsonb_array_length(relations) = 0`,
  );

  let linked = 0;
  for (const row of routes.rows as any[]) {
    const attrs = row.attributes || {};
    const relations: { type: string; target_id: string }[] = [];
    if (attrs.commodity_entity_id) relations.push({ type: 'trades', target_id: attrs.commodity_entity_id });
    const originSys = attrs.origin_star_system ? systemByName.get(String(attrs.origin_star_system).toLowerCase()) : null;
    if (originSys) relations.push({ type: 'origin_system', target_id: originSys });
    const destSys = attrs.destination_star_system ? systemByName.get(String(attrs.destination_star_system).toLowerCase()) : null;
    if (destSys) relations.push({ type: 'destination_system', target_id: destSys });
    if (!relations.length) continue;

    const ent = await getEntity(row.id);
    if (!ent) continue;
    await upsertEntity({ ...ent, relations });
    linked++;
    // Reciprocate onto the commodity/system side too, so e.g. a system page can show its trade routes.
    if (attrs.commodity_entity_id) await reciprocate(attrs.commodity_entity_id, 'traded_via', row.id);
  }
  line(`[trade_route -> commodity/star_system] linked ${linked}`);
}

async function main() {
  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg !== -1 ? process.argv[onlyArg + 1] : null;

  line('=== link-entities ===');
  if (!only || only === 'ships' || only === 'weapons') await linkShipsAndWeaponsToManufacturers();
  if (!only || only === 'trade-routes') await linkTradeRoutes();
  line('[done]');
}

main().catch((e) => { console.error(e); process.exit(1); });
