// ai-context.ts — deterministically build the /ai-context prose paragraph for an
// entity from its STRUCTURED fields, resolving relation target IDs to names.
// Never hand-written; always regenerated when the entity changes.

import type { Entity } from './types.js';

const REL_PHRASES: Record<string, string> = {
  manufactured_by: 'manufactured by',
  made_by: 'made by',
  operated_by: 'operated by',
  located_in: 'located in',
  part_of: 'part of',
  uses: 'uses',
  used_by: 'used by',
  variant_of: 'a variant of',
  succeeds: 'succeeds',
  related_to: 'related to',
  sells: 'sells',
  produces: 'produces',
};

function humanizeRelType(t: string): string {
  return REL_PHRASES[t] ?? t.replace(/_/g, ' ');
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * @param entity the entity being described
 * @param nameById resolver: relation target id -> display name (falls back to id)
 */
export function generateAiContext(
  entity: Entity,
  nameById: Map<string, string>,
): string {
  const parts: string[] = [];
  const typeLabel = entity.type.replace(/_/g, ' ');

  // Opening: name (aliases) is a <type>.
  let opening = `${entity.name}`;
  if (entity.aliases && entity.aliases.length) {
    opening += ` (also known as ${joinList(entity.aliases)})`;
  }
  opening += ` is a ${typeLabel} in Star Citizen`;
  if (entity.game_version) opening += ` (as of ${entity.game_version})`;
  opening += '.';
  parts.push(opening);

  // Summary, verbatim if present.
  if (entity.summary) parts.push(entity.summary.trim().replace(/\s+/g, ' '));

  // Relations resolved inline by name, grouped by relation type.
  if (entity.relations && entity.relations.length) {
    const byType = new Map<string, string[]>();
    for (const r of entity.relations) {
      const label = nameById.get(r.target_id) ?? r.target_id;
      const arr = byType.get(r.type) ?? [];
      arr.push(label);
      byType.set(r.type, arr);
    }
    const clauses: string[] = [];
    for (const [rtype, names] of byType) {
      clauses.push(`${humanizeRelType(rtype)} ${joinList(names)}`);
    }
    if (clauses.length) {
      parts.push(`It is ${joinList(clauses)}.`);
    }
  }

  // Selected notable attributes (flat scalars only, keep it readable).
  if (entity.attributes && typeof entity.attributes === 'object') {
    const attrClauses: string[] = [];
    for (const [k, v] of Object.entries(entity.attributes)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object') continue;
      attrClauses.push(`${k.replace(/_/g, ' ')} is ${v}`);
      if (attrClauses.length >= 6) break;
    }
    if (attrClauses.length) {
      parts.push(`Its ${joinList(attrClauses)}.`);
    }
  }

  // Provenance sentence — confidence + source + freshness, always surfaced.
  const conf = entity.source?.confidence ?? 'unverified';
  const provBits: string[] = [`This information is ${conf}`];
  if (entity.source?.origin) provBits.push(`sourced from ${entity.source.origin}`);
  if (entity.source?.last_verified) provBits.push(`last verified ${entity.source.last_verified}`);
  if (entity.freshness_class === 'volatile') {
    provBits.push('and is volatile (subject to frequent change)');
  }
  parts.push(provBits.join(', ') + '.');

  return parts.join(' ');
}
