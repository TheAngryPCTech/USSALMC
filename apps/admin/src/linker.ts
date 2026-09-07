// linker.ts — cross-category entity linking. When an extracted text value looks
// like an existing entity in ANOTHER category, propose a relation instead of
// flat text. High confidence -> auto-link; fuzzy -> suggestion; none -> text.

import { query } from '../../api/src/db.js';

export interface LinkResult {
  text: string;
  relation_type: string;
  decision: 'auto' | 'suggest' | 'none';
  target_id?: string;
  target_name?: string;
  score: number;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// tiny token-overlap similarity (0..1)
function similarity(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

export async function resolveLink(
  text: string, relationType: string, excludeId?: string,
): Promise<LinkResult> {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  if (!cleanText) return { text, relation_type: relationType, decision: 'none', score: 0 };

  // Candidate pool: all entities except the one being built (self). We match
  // across ALL types on purpose — "category" here is semantic (ship vs
  // manufacturer), which in Phase 1 can share the same DB `type` (item).
  const res = await query(
    `SELECT id, name, type, aliases FROM entities ${excludeId ? 'WHERE id <> $1' : ''}`,
    excludeId ? [excludeId] : [],
  );

  let best: { id: string; name: string; score: number } | null = null;
  for (const r of res.rows as any[]) {
    const names = [r.name, ...(r.aliases || [])];
    let s = 0;
    for (const n of names) {
      s = Math.max(s, similarity(cleanText, n));
      if (norm(cleanText) === norm(n)) s = 1;
    }
    if (!best || s > best.score) best = { id: r.id, name: r.name, score: s };
  }

  if (best && best.score >= 0.9) {
    return { text: cleanText, relation_type: relationType, decision: 'auto', target_id: best.id, target_name: best.name, score: best.score };
  }
  if (best && best.score >= 0.5) {
    return { text: cleanText, relation_type: relationType, decision: 'suggest', target_id: best.id, target_name: best.name, score: best.score };
  }
  return { text: cleanText, relation_type: relationType, decision: 'none', score: best?.score ?? 0 };
}
