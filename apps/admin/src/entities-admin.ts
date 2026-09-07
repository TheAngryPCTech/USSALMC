// entities-admin.ts — manual categorization + cross-linking of EXISTING saved
// entities. Every mutation goes through the Phase 1 upsertEntity publish path, so
// ai_context and the embedding are regenerated automatically after each change.

import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';
import type { Entity } from '../../api/src/types.js';

// Semantic categories the reviewer can assign. Each maps to a canonical DB
// `type` (the entities.type CHECK only allows the 9 base types); ship/
// manufacturer/weapon are stored as type=item with the finer category kept in
// attributes.category (matches the Phase 1/2 modeling decision).
export const CATEGORIES = [
  'ship', 'manufacturer', 'weapon', 'item', 'location', 'commodity',
  'npc', 'mechanic', 'quest', 'lore', 'patch_note', 'trade_route',
] as const;
export type Category = typeof CATEGORIES[number];

// Common relation types offered in the UI (free-text also allowed).
export const RELATION_TYPES = [
  'manufactured_by', 'made_by', 'operated_by', 'located_in', 'part_of',
  'uses', 'used_by', 'variant_of', 'succeeds', 'sells', 'produces', 'related_to',
];

export function categoryToType(category: string): Entity['type'] {
  switch (category) {
    case 'location': return 'location';
    case 'commodity': return 'commodity';
    case 'npc': return 'npc';
    case 'mechanic': return 'mechanic';
    case 'quest': return 'quest';
    case 'lore': return 'lore';
    case 'patch_note': return 'patch_note';
    case 'trade_route': return 'trade_route';
    // ship / manufacturer / weapon / item all live under the generic 'item' type
    default: return 'item';
  }
}

// Derive the display category: explicit attributes.category if set, else infer
// from the base type.
export function entityCategory(e: Entity): string {
  const c = (e.attributes && (e.attributes as any).category) as string | undefined;
  return c || e.type;
}

// republish an entity through the canonical upsert path (regenerates ai_context+embedding)
async function republish(e: Entity) {
  await upsertEntity({
    id: e.id, type: e.type, name: e.name, aliases: e.aliases, summary: e.summary,
    body: e.body, attributes: e.attributes, relations: e.relations, images: e.images,
    source: e.source, game_version: e.game_version, status: e.status, freshness_class: e.freshness_class,
  });
}

export interface EntityListRow {
  id: string; name: string; type: string; category: string; status: string;
  aliases: string[]; relation_count: number;
}

// Search/browse existing entities. `q` matches id, name, or any alias.
// By default excludes removed entities (matches the public API's behavior);
// pass includeRemoved to see them (the admin "Removed" filter uses this).
export async function listEntitiesForAdmin(q: string | undefined, limit = 100, includeRemoved = false): Promise<EntityListRow[]> {
  const params: any[] = [];
  const clauses: string[] = [];
  if (!includeRemoved) clauses.push(`status <> 'removed'`);
  if (q && q.trim()) {
    params.push(`%${q.toLowerCase().trim()}%`);
    clauses.push(`(lower(id) LIKE $${params.length} OR lower(name) LIKE $${params.length} OR lower(aliases::text) LIKE $${params.length})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const res = await query(
    `SELECT id, name, type, status, aliases, attributes->>'category' AS category,
            jsonb_array_length(relations) AS relation_count
     FROM entities ${where} ORDER BY name LIMIT ${Math.min(limit, 500)}`,
    params,
  );
  return res.rows.map((r: any) => ({
    id: r.id, name: r.name, type: r.type, status: r.status,
    category: r.category || r.type, aliases: r.aliases || [],
    relation_count: r.relation_count ?? 0,
  }));
}

// Full entity with relation targets resolved to display names, for the editor.
export async function getEntityForAdmin(id: string) {
  const e = await getEntity(id);
  if (!e) return null;
  const ids = e.relations.map((r) => r.target_id);
  const names = new Map<string, { name: string; type: string }>();
  if (ids.length) {
    const res = await query(`SELECT id, name, type FROM entities WHERE id = ANY($1)`, [ids]);
    for (const r of res.rows as any[]) names.set(r.id, { name: r.name, type: r.type });
  }
  return {
    id: e.id, name: e.name, type: e.type, category: entityCategory(e),
    aliases: e.aliases, summary: e.summary, body: e.body,
    attributes: e.attributes ?? {}, images: e.images ?? [],
    source: e.source ?? { origin: null, url: null, confidence: null, last_verified: null },
    game_version: e.game_version, status: e.status, freshness_class: e.freshness_class,
    ai_context: e.ai_context,
    relations: e.relations.map((r) => ({
      type: r.type, target_id: r.target_id,
      target_name: names.get(r.target_id)?.name ?? r.target_id,
      target_type: names.get(r.target_id)?.type ?? null,
      broken: !names.has(r.target_id),   // target no longer exists
    })),
  };
}

// Change an entity's category (sets base type + attributes.category), republish.
// Accepts the 12 canonical categories OR any leaf slug defined in the taxonomy
// (categories table, is_group=false) so admin-created subcategories are usable.
export async function setCategory(id: string, category: string) {
  const e = await getEntity(id);
  if (!e) throw new Error(`No entity ${id}`);
  if (!(await isAssignableCategory(category))) throw new Error(`Unknown category "${category}"`);
  e.type = categoryToType(category);
  e.attributes = { ...(e.attributes || {}), category };
  await republish(e);
  return getEntityForAdmin(id);
}

// A category is assignable if it's one of the canonical 12 or a non-group leaf
// in the taxonomy table.
export async function isAssignableCategory(category: string): Promise<boolean> {
  if (CATEGORIES.includes(category as Category)) return true;
  const r = await query(`SELECT is_group FROM categories WHERE slug=$1`, [category]);
  return !!r.rows[0] && r.rows[0].is_group === false;
}

// Full field-level edit. Applies only the provided keys, then republishes
// through upsertEntity (regenerates ai_context + embedding). This is the single
// UI edit path — no raw-JSON editing. `category` (when provided) also sets the
// base type. Attributes/images/relations/source fully replace when provided.
export interface EntityPatch {
  name?: string;
  summary?: string | null;
  body?: string | null;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  images?: any[];
  relations?: { type: string; target_id: string }[];
  source?: Partial<Entity['source']> & { hidden?: boolean };
  game_version?: string | null;
  status?: Entity['status'];
  category?: string;
}

export async function updateEntity(id: string, patch: EntityPatch) {
  const e = await getEntity(id);
  if (!e) throw new Error(`No entity ${id}`);

  if (patch.name !== undefined) {
    if (!String(patch.name).trim()) throw new Error('Name cannot be empty.');
    e.name = String(patch.name).trim();
  }
  if (patch.summary !== undefined) e.summary = patch.summary === '' ? null : patch.summary;
  if (patch.body !== undefined) e.body = patch.body === '' ? null : patch.body;
  if (patch.aliases !== undefined) {
    e.aliases = (patch.aliases || []).map((a) => String(a).trim()).filter(Boolean);
  }
  if (patch.attributes !== undefined) e.attributes = { ...patch.attributes };
  if (patch.images !== undefined) e.images = patch.images || [];
  if (patch.relations !== undefined) {
    // validate targets exist (never point at a non-entity)
    for (const r of patch.relations) {
      if (!r.type || !r.target_id) throw new Error('Each relation needs a type and a target.');
      if (r.target_id === id) throw new Error('An entity cannot link to itself.');
      const t = await getEntity(r.target_id);
      if (!t) throw new Error(`Target entity ${r.target_id} does not exist.`);
    }
    e.relations = patch.relations;
  }
  if (patch.source !== undefined) {
    e.source = { ...e.source, ...patch.source } as any;
  }
  if (patch.game_version !== undefined) e.game_version = patch.game_version === '' ? null : patch.game_version;
  if (patch.status !== undefined) e.status = patch.status;
  if (patch.category !== undefined) {
    if (!(await isAssignableCategory(patch.category))) throw new Error(`Unknown category "${patch.category}"`);
    e.type = categoryToType(patch.category);
    e.attributes = { ...(e.attributes || {}), category: patch.category };
  }
  await republish(e);
  return getEntityForAdmin(id);
}

// Add a cross-link relation (dedupes identical type+target).
export async function addRelation(id: string, relationType: string, targetId: string) {
  const e = await getEntity(id);
  if (!e) throw new Error(`No entity ${id}`);
  if (!relationType || !targetId) throw new Error('relation_type and target_id required');
  if (targetId === id) throw new Error('An entity cannot link to itself.');
  const target = await getEntity(targetId);
  if (!target) throw new Error(`Target entity ${targetId} does not exist — link only to real entities.`);
  const exists = e.relations.some((r) => r.type === relationType && r.target_id === targetId);
  if (!exists) e.relations = [...e.relations, { type: relationType, target_id: targetId }];
  await republish(e);
  return getEntityForAdmin(id);
}

// Remove a cross-link relation.
export async function removeRelation(id: string, relationType: string, targetId: string) {
  const e = await getEntity(id);
  if (!e) throw new Error(`No entity ${id}`);
  e.relations = e.relations.filter((r) => !(r.type === relationType && r.target_id === targetId));
  await republish(e);
  return getEntityForAdmin(id);
}

// =====================================================================
// Tiered delete: soft-delete ("Remove entry") vs hard-delete, both audited.
// Soft-delete just sets status='removed' (the public API, WordPress
// rendering, /ai-context, and category counts all read status through the
// same public entity-repo path, so this alone hides it everywhere). Hard
// delete actually removes the row (and its embedding, via ON DELETE CASCADE).
// Every state-changing action snapshots the entity into entity_audit_log
// FIRST, so nothing is lost even on a hard delete.
// =====================================================================

async function snapshotAudit(e: Entity, action: 'soft_delete' | 'restore' | 'hard_delete', performedBy: string | null) {
  await query(
    `INSERT INTO entity_audit_log (entity_id, action, snapshot, performed_by) VALUES ($1,$2,$3,$4)`,
    [e.id, action, JSON.stringify(e), performedBy],
  );
}

export async function softDeleteEntity(id: string, performedBy: string | null) {
  const e = await getEntity(id);
  if (!e) throw new Error(`No entity ${id}`);
  await snapshotAudit(e, 'soft_delete', performedBy);
  e.status = 'removed';
  await republish(e);
  return getEntityForAdmin(id);
}

export async function restoreEntity(id: string, performedBy: string | null) {
  const e = await getEntity(id);
  if (!e) throw new Error(`No entity ${id}`);
  if (e.status !== 'removed') throw new Error(`Entity ${id} is not removed.`);
  await snapshotAudit(e, 'restore', performedBy);
  e.status = 'current';
  await republish(e);
  return getEntityForAdmin(id);
}

// Hard-delete friction is enforced by the caller (server.ts) based on role:
// super_admin needs only a single boolean confirmation; admin must type the
// entity's exact name. This function itself just does the (audited) deletion.
export async function hardDeleteEntity(id: string, performedBy: string | null) {
  const e = await getEntity(id);
  if (!e) throw new Error(`No entity ${id}`);
  await snapshotAudit(e, 'hard_delete', performedBy);
  await query(`DELETE FROM entities WHERE id=$1`, [id]); // cascades to embeddings
  return { id, deleted: true };
}

export async function getEntityAuditLog(id: string) {
  const res = await query(
    `SELECT id, action, snapshot, performed_by, created_at FROM entity_audit_log WHERE entity_id=$1 ORDER BY id DESC LIMIT 50`,
    [id],
  );
  return res.rows;
}

// =====================================================================
// Field-level corroboration (green confirm) + corrections (red flag) queue.
// Confirms/flags themselves are submitted publicly (POST /v1/entities/:id/
// fields/{confirm,flag}, apps/api/src/field-signals.ts); this is the
// admin-side view + accept/reject workflow.
// =====================================================================

export async function listFieldConfirmations(entityId: string) {
  const res = await query(
    `SELECT id, field_name, current_value, submitted_by, created_at
     FROM field_confirmations WHERE entity_id=$1 ORDER BY id DESC LIMIT 200`,
    [entityId],
  );
  return res.rows;
}

export async function listCorrections(status?: string) {
  const res = status
    ? await query(
        `SELECT c.id, c.entity_id, e.name AS entity_name, c.field_name, c.current_value, c.suggested_value,
                c.note, c.submitted_by, c.status, c.reviewed_by, c.reviewed_at, c.created_at
         FROM field_corrections c LEFT JOIN entities e ON e.id = c.entity_id
         WHERE c.status=$1 ORDER BY c.id DESC LIMIT 200`,
        [status],
      )
    : await query(
        `SELECT c.id, c.entity_id, e.name AS entity_name, c.field_name, c.current_value, c.suggested_value,
                c.note, c.submitted_by, c.status, c.reviewed_by, c.reviewed_at, c.created_at
         FROM field_corrections c LEFT JOIN entities e ON e.id = c.entity_id
         ORDER BY c.id DESC LIMIT 200`,
      );
  return res.rows;
}

// Apply a field_name ('name'|'summary'|'body'|'attr:<key>') + value onto an
// entity patch, matching the encoding used by the wiki's confirm/flag buttons.
function applyFieldToPatch(e: Entity, fieldName: string, value: string): EntityPatch {
  if (fieldName.startsWith('attr:')) {
    const key = fieldName.slice('attr:'.length);
    return { attributes: { ...(e.attributes || {}), [key]: value } };
  }
  if (fieldName === 'name' || fieldName === 'summary' || fieldName === 'body') {
    return { [fieldName]: value } as EntityPatch;
  }
  throw new Error(`Unknown field "${fieldName}" — cannot apply correction.`);
}

export async function acceptCorrection(id: number, reviewedBy: string | null) {
  const res = await query(`SELECT * FROM field_corrections WHERE id=$1`, [id]);
  const row = res.rows[0];
  if (!row) throw new Error(`No correction ${id}`);
  if (row.status !== 'pending') throw new Error(`Correction ${id} is already ${row.status}.`);
  const e = await getEntity(row.entity_id);
  if (!e) throw new Error(`Entity ${row.entity_id} no longer exists.`);
  const patch = applyFieldToPatch(e, row.field_name, row.suggested_value);
  await updateEntity(row.entity_id, patch); // regenerates ai_context + embedding
  await query(
    `UPDATE field_corrections SET status='accepted', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [id, reviewedBy],
  );
  return { id, status: 'accepted', entity_id: row.entity_id, field_name: row.field_name, submitted_by: row.submitted_by, reviewed_by: reviewedBy };
}

export async function rejectCorrection(id: number, reviewedBy: string | null) {
  const res = await query(`SELECT id, status, entity_id, field_name, submitted_by FROM field_corrections WHERE id=$1`, [id]);
  const row = res.rows[0];
  if (!row) throw new Error(`No correction ${id}`);
  if (row.status !== 'pending') throw new Error(`Correction ${id} is already ${row.status}.`);
  await query(
    `UPDATE field_corrections SET status='rejected', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [id, reviewedBy],
  );
  return { id, status: 'rejected', entity_id: row.entity_id, field_name: row.field_name, submitted_by: row.submitted_by, reviewed_by: reviewedBy };
}
