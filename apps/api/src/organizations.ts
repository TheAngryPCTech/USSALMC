// organizations.ts — behind POST /v1/organizations/submit. An org is added to
// the knowledge base ONLY when a member actually verifies their RSI handle
// through the portal (never bulk-imported speculatively — see
// apps/admin/src/import-starcitizen-api.ts, which deliberately skips orgs).
// Deliberately stores only factual/structured org metadata (name, sid,
// archetype, commitment, focus, banner/logo) — never the org's own
// member-authored charter/manifesto/headline text or member roster, which
// are out of scope for a lore knowledge base and raise both privacy
// (other members' identities) and reproduction concerns.

import { query } from './db.js';
import { upsertEntity } from './entity-repo.js';
import type { Entity } from './types.js';

export interface OrganizationSubmitInput {
  sid: string;
  name: string;
  archetype?: string | null;
  commitment?: string | null;
  focus_primary?: string | null;
  focus_secondary?: string | null;
  banner?: string | null;
  logo?: string | null;
  url?: string | null;
  // The verified member reporting this org, for provenance only (never a
  // membership relation — we don't model WordPress users as KB entities).
  verified_by_handle?: string | null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}

export async function submitOrganization(inp: OrganizationSubmitInput): Promise<Entity> {
  const id = `item_org_${slugify(inp.sid)}`;
  const images = [];
  if (inp.banner) images.push({ url: inp.banner, role: 'primary', added_by: 'connector', source_url: inp.url ?? null, license_note: 'REVIEW REQUIRED: scraped image, likely copyrighted (RSI/CIG or the org).' });
  if (inp.logo) images.push({ url: inp.logo, role: 'gallery', added_by: 'connector', source_url: inp.url ?? null, license_note: 'REVIEW REQUIRED: scraped image, likely copyrighted (RSI/CIG or the org).' });

  return upsertEntity({
    id, type: 'item', name: inp.name,
    summary: null, body: null,
    attributes: {
      category: 'organization', sid: inp.sid,
      archetype: inp.archetype ?? null, commitment: inp.commitment ?? null,
      focus_primary: inp.focus_primary ?? null, focus_secondary: inp.focus_secondary ?? null,
      added_via_verification_by: inp.verified_by_handle ?? null,
    },
    images,
    // 'community' (not 'confirmed'): this arrives via a member's own
    // self-reported verification event, not an admin-reviewed scrape.
    source: { origin: 'starcitizen-api', url: inp.url ?? null, confidence: 'community', last_verified: new Date().toISOString() },
    game_version: null,
  });
}

export async function organizationExists(sid: string): Promise<boolean> {
  const id = `item_org_${slugify(sid)}`;
  const res = await query(`SELECT 1 FROM entities WHERE id=$1 AND status <> 'removed'`, [id]);
  return !!res.rows[0];
}
