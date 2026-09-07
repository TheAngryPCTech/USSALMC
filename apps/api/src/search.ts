// search.ts — hybrid keyword (Postgres FTS) + semantic (pgvector cosine) search.
// Scores are combined; results merged by entity id.

import { query } from './db.js';
import { embed, toVectorLiteral } from './embeddings.js';

export interface SearchHit {
  id: string;
  name: string;
  type: string;
  summary: string | null;
  keyword_score: number;
  semantic_score: number;
  score: number;
}

export async function hybridSearch(q: string, limit = 10): Promise<SearchHit[]> {
  const hits = new Map<string, SearchHit>();

  // 1. keyword (full-text) search
  const kw = await query(
    `SELECT id, name, type, summary,
            ts_rank(
              to_tsvector('english',
                coalesce(name,'')||' '||coalesce(summary,'')||' '||
                coalesce(body,'')||' '||coalesce(ai_context,'')),
              plainto_tsquery('english', $1)) AS rank
     FROM entities
     WHERE to_tsvector('english',
             coalesce(name,'')||' '||coalesce(summary,'')||' '||
             coalesce(body,'')||' '||coalesce(ai_context,''))
           @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC LIMIT $2`,
    [q, limit],
  );
  let maxRank = 0;
  for (const r of kw.rows) maxRank = Math.max(maxRank, Number(r.rank));
  for (const r of kw.rows) {
    const ks = maxRank > 0 ? Number(r.rank) / maxRank : 0;
    hits.set(r.id, {
      id: r.id, name: r.name, type: r.type, summary: r.summary,
      keyword_score: ks, semantic_score: 0, score: 0,
    });
  }

  // 2. semantic (vector cosine) search
  const { vector } = await embed(q);
  const vec = await query(
    `SELECT e.id, e.name, e.type, e.summary,
            1 - (emb.vector <=> $1::vector) AS similarity
     FROM embeddings emb
     JOIN entities e ON e.id = emb.entity_id
     ORDER BY emb.vector <=> $1::vector ASC
     LIMIT $2`,
    [toVectorLiteral(vector), limit],
  );
  for (const r of vec.rows) {
    const ss = Math.max(0, Number(r.similarity));
    const existing = hits.get(r.id);
    if (existing) {
      existing.semantic_score = ss;
    } else {
      hits.set(r.id, {
        id: r.id, name: r.name, type: r.type, summary: r.summary,
        keyword_score: 0, semantic_score: ss, score: 0,
      });
    }
  }

  // 3. combine (weighted): keyword 0.4, semantic 0.6
  const out = Array.from(hits.values()).map((h) => ({
    ...h,
    score: 0.4 * h.keyword_score + 0.6 * h.semantic_score,
  }));
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
