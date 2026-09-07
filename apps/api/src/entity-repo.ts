// entity-repo.ts — persistence + the create/update pipeline that always
// regenerates ai_context and the embedding when an entity changes.

import { query } from './db.js';
import type { Entity, EntityType } from './types.js';
import { generateAiContext } from './ai-context.js';
import { embed, toVectorLiteral } from './embeddings.js';

const COLUMNS = `
  id, type, name, aliases, summary, body, attributes, relations, images,
  source, game_version, status, freshness_class, ai_context, embedding_id,
  created_at, updated_at`;

function rowToEntity(r: any): Entity {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    aliases: r.aliases ?? [],
    summary: r.summary,
    body: r.body,
    attributes: r.attributes ?? {},
    relations: r.relations ?? [],
    images: r.images ?? [],
    source: r.source ?? { origin: null, url: null, confidence: null, last_verified: null },
    game_version: r.game_version,
    status: r.status,
    freshness_class: r.freshness_class,
    ai_context: r.ai_context,
    embedding_id: r.embedding_id,
    created_at: r.created_at?.toISOString?.() ?? r.created_at,
    updated_at: r.updated_at?.toISOString?.() ?? r.updated_at,
  };
}

export async function getEntity(id: string): Promise<Entity | null> {
  const res = await query(`SELECT ${COLUMNS} FROM entities WHERE id = $1`, [id]);
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

export async function listEntities(opts: {
  type?: string; queryText?: string; version?: string; limit?: number; offset?: number;
  includeRemoved?: boolean;
}): Promise<{ items: Entity[]; total: number }> {
  const where: string[] = [];
  const params: any[] = [];
  if (!opts.includeRemoved) where.push(`status <> 'removed'`);
  if (opts.type) { params.push(opts.type); where.push(`type = $${params.length}`); }
  if (opts.version) { params.push(opts.version); where.push(`game_version = $${params.length}`); }
  if (opts.queryText) {
    params.push(`%${opts.queryText.toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${params.length} OR lower(coalesce(summary,'')) LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const totalRes = await query(`SELECT count(*)::int AS n FROM entities ${whereSql}`, params);
  const listRes = await query(
    `SELECT ${COLUMNS} FROM entities ${whereSql} ORDER BY name LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: listRes.rows.map(rowToEntity), total: totalRes.rows[0].n };
}

// Resolve display names for a set of relation target ids.
async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const res = await query(`SELECT id, name FROM entities WHERE id = ANY($1)`, [ids]);
  for (const r of res.rows) map.set(r.id, r.name);
  return map;
}

export interface UpsertInput {
  id: string;
  type: EntityType;
  name: string;
  aliases?: string[];
  summary?: string | null;
  body?: string | null;
  attributes?: Record<string, unknown>;
  relations?: { type: string; target_id: string }[];
  images?: any[];
  source?: Entity['source'];
  game_version?: string | null;
  status?: Entity['status'];
  freshness_class?: Entity['freshness_class'];
}

/**
 * Insert or update an entity, ALWAYS regenerating ai_context + embedding.
 * This is the single publish path so ai_context can never drift.
 */
export async function upsertEntity(input: UpsertInput): Promise<Entity> {
  const entity: Entity = {
    id: input.id,
    type: input.type,
    name: input.name,
    aliases: input.aliases ?? [],
    summary: input.summary ?? null,
    body: input.body ?? null,
    attributes: input.attributes ?? {},
    relations: input.relations ?? [],
    images: input.images ?? [],
    source: input.source ?? { origin: null, url: null, confidence: null, last_verified: null },
    game_version: input.game_version ?? null,
    status: input.status ?? 'current',
    freshness_class: input.freshness_class ?? (input.type === 'trade_route' ? 'volatile' : 'static'),
    ai_context: null,
    embedding_id: null,
  };

  // 1. regenerate ai_context from structured fields (relations resolved by name)
  const nameMap = await resolveNames(entity.relations.map((r) => r.target_id));
  entity.ai_context = generateAiContext(entity, nameMap);

  // 2. regenerate embedding from the ai_context text
  const embeddingId = `emb_${entity.id}`;
  const { vector, provider } = await embed(entity.ai_context);
  entity.embedding_id = embeddingId;

  // 3. persist entity
  await query(
    `INSERT INTO entities
       (id, type, name, aliases, summary, body, attributes, relations, images,
        source, game_version, status, freshness_class, ai_context, embedding_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
     ON CONFLICT (id) DO UPDATE SET
       type=EXCLUDED.type, name=EXCLUDED.name, aliases=EXCLUDED.aliases,
       summary=EXCLUDED.summary, body=EXCLUDED.body, attributes=EXCLUDED.attributes,
       relations=EXCLUDED.relations, images=EXCLUDED.images, source=EXCLUDED.source,
       game_version=EXCLUDED.game_version, status=EXCLUDED.status,
       freshness_class=EXCLUDED.freshness_class, ai_context=EXCLUDED.ai_context,
       embedding_id=EXCLUDED.embedding_id, updated_at=now()`,
    [
      entity.id, entity.type, entity.name, JSON.stringify(entity.aliases),
      entity.summary, entity.body, JSON.stringify(entity.attributes),
      JSON.stringify(entity.relations), JSON.stringify(entity.images),
      JSON.stringify(entity.source), entity.game_version, entity.status,
      entity.freshness_class, entity.ai_context, entity.embedding_id,
    ],
  );

  // 4. persist embedding
  await query(
    `INSERT INTO embeddings (id, entity_id, vector, provider, source_text)
     VALUES ($1,$2,$3::vector,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       vector=EXCLUDED.vector, provider=EXCLUDED.provider,
       source_text=EXCLUDED.source_text, created_at=now()`,
    [embeddingId, entity.id, toVectorLiteral(vector), provider, entity.ai_context],
  );

  return entity;
}

export async function getRelations(id: string): Promise<
  { relation: string; entity: Pick<Entity, 'id' | 'name' | 'type'> }[]
> {
  const ent = await getEntity(id);
  if (!ent) return [];
  const ids = ent.relations.map((r) => r.target_id);
  const names = await resolveNames(ids);
  const typeRes = ids.length
    ? await query(`SELECT id, type FROM entities WHERE id = ANY($1)`, [ids])
    : { rows: [] as any[] };
  const typeMap = new Map<string, string>(typeRes.rows.map((r: any) => [r.id, r.type]));
  return ent.relations.map((r) => ({
    relation: r.type,
    entity: {
      id: r.target_id,
      name: names.get(r.target_id) ?? r.target_id,
      type: (typeMap.get(r.target_id) as any) ?? null,
    },
  }));
}
