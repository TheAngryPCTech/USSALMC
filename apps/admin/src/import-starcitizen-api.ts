// import-starcitizen-api.ts — bulk import from the (unofficial, ToS-permitted)
// StarCitizen-API community service (https://starcitizen-api.com) into the
// core knowledge base. Separate from the starcitizen.tools scraper pipeline
// (scan.ts/bulk-import.ts) — this is a small, structured JSON API, not HTML
// extraction, so it needs none of that pipeline's template/variance machinery.
//
// Uses `cache` mode exclusively (unlimited per the API's own docs; `live`
// mode is capped at 1000 req/day site-wide and shared with the portal's
// RSI-verification checks) — nothing here is time-sensitive.
//
// Usage: tsx src/import-starcitizen-api.ts --systems --tunnels --species
//        --affiliations --roadmap --ships   (any subset, or --all)
//
// Org entities are NOT bulk-imported here by design — an org is only added to
// the knowledge base when a member actually verifies through the portal (see
// apps/wordpress-portal-plugin/inc/rsi-verify.php + POST /v1/organizations/submit),
// not speculatively for every org that exists.

import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';
import type { Entity } from '../../api/src/types.js';
import { downloadAndStoreImage } from './media-store.js';

const line = (s = '') => console.log(s);

function apiKey(): string {
  const k = process.env.STARCITIZEN_API_KEY;
  if (!k) throw new Error('STARCITIZEN_API_KEY not set.');
  return k;
}

async function scapiGet(path: string): Promise<any> {
  const url = `https://api.starcitizen-api.com/${apiKey()}/v1/cache${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`StarCitizen-API HTTP ${res.status} for ${path}`);
  const body: any = await res.json();
  if (!body.success) throw new Error(`StarCitizen-API error for ${path}: ${body.message}`);
  return body.data;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}

const nowIso = () => new Date().toISOString();

// Per cross-phase rule: real, present-tense provenance — never fabricated.
function sourceOf(url: string | null) {
  return { origin: 'starcitizen-api', url, confidence: 'confirmed' as const, last_verified: nowIso() };
}

const LICENSE_NOTE = 'REVIEW REQUIRED: scraped image, likely copyrighted (RSI/CIG).';

// ---- Starmap: systems (also returns an sc_api numeric id -> our entity id
// map, needed by importTunnels to resolve entry/exit references) ----
async function importSystems(): Promise<Map<number, string>> {
  const systems = await scapiGet('/starmap/systems');
  const idMap = new Map<number, string>();
  for (const s of systems) {
    const entityId = `location_${slugify(s.name)}`;
    idMap.set(s.id, entityId);
    const rawThumb: string | undefined = s.thumbnail?.images?.post;
    const stored = rawThumb ? await downloadAndStoreImage(rawThumb) : null;
    await upsertEntity({
      id: entityId, type: 'location', name: s.name,
      summary: null,
      body: s.description || null,
      attributes: {
        category: 'star_system', sc_api_id: s.id, code: s.code, status: s.status,
        danger: s.aggregated_danger, economy: s.aggregated_economy,
        population: s.aggregated_population, size: s.aggregated_size,
        affiliations: (s.affiliation || []).map((a: any) => a.name),
        position: { x: s.position_x, y: s.position_y, z: s.position_z },
      },
      images: rawThumb
        ? [{
            url: stored?.localUrl ?? rawThumb, original_url: rawThumb, full_url: stored?.fullUrl ?? null,
            role: 'primary', added_by: 'connector', source_url: s.info_url ?? null, license_note: LICENSE_NOTE,
          }]
        : [],
      source: sourceOf(s.info_url ?? null),
      game_version: null,
    });
  }
  line(`[systems] upserted ${systems.length}`);
  return idMap;
}

// ---- Starmap: tunnels (jump points). Relations reference system entities by
// the id map from importSystems — run systems first (main() enforces order).
async function importTunnels(systemIdMap: Map<number, string>) {
  const tunnels = await scapiGet('/starmap/tunnels');
  let missingEndpoint = 0;
  for (const t of tunnels) {
    if (!t) continue;
    // entry_id/exit_id are jump-point OBJECT ids, a different id space from
    // star systems — the actual system reference is nested one level down.
    const fromId = systemIdMap.get(t.entry?.star_system_id);
    const toId = systemIdMap.get(t.exit?.star_system_id);
    if (!fromId || !toId) missingEndpoint++;
    const relations: { type: string; target_id: string }[] = [];
    if (fromId) relations.push({ type: 'connects_from', target_id: fromId });
    if (toId) relations.push({ type: 'connects_to', target_id: toId });
    const name = t.name || t.entry?.designation || `${t.entry?.code ?? '?'} → ${t.exit?.code ?? '?'}`;
    await upsertEntity({
      id: `location_jump_${t.id}`, type: 'location', name,
      summary: null, body: null,
      attributes: {
        category: 'jump_point', sc_api_id: t.id, direction: t.direction, size: t.size,
        entry_code: t.entry?.code ?? null, exit_code: t.exit?.code ?? null,
        entry_distance: t.entry?.distance ?? null, exit_distance: t.exit?.distance ?? null,
      },
      relations,
      source: sourceOf(null),
      game_version: null,
    });
  }
  line(`[tunnels] upserted ${tunnels.length} (${missingEndpoint} missing an endpoint system match — pass --systems in the same run if this is unexpectedly high)`);
}

async function importSpecies() {
  const species = await scapiGet('/starmap/species');
  for (const sp of species) {
    await upsertEntity({
      id: `lore_species_${slugify(sp.name)}`, type: 'lore', name: sp.name,
      summary: null, body: null,
      attributes: { category: 'species', sc_api_id: sp.id, code: sp.code },
      source: sourceOf(null), game_version: null,
    });
  }
  line(`[species] upserted ${species.length}`);
}

async function importAffiliations() {
  const affs = await scapiGet('/starmap/affiliations');
  for (const a of affs) {
    await upsertEntity({
      id: `lore_affiliation_${slugify(a.name)}`, type: 'lore', name: a.name,
      summary: null, body: null,
      attributes: { category: 'affiliation', sc_api_id: a.id, code: a.code, color: a.color },
      source: sourceOf(null), game_version: null,
    });
  }
  line(`[affiliations] upserted ${affs.length}`);
}

// ---- Roadmap: releases, each with nested `cards` (the actual deliverables) ----
// card.thumbnail is a nested RSI media object ({ id, urls: { rect, large,
// source, square } }), not a plain URL string — the schema's images[].url
// field must be a string (docs/schema.md). An earlier version of this
// importer stored the raw object directly, which passed upsertEntity/the API
// fine (attributes/images are just JSONB, no shape validation there) but
// crashed the WHOLE wiki category listing for every visitor the moment PHP
// tried to esc_url() a non-string value — a fatal type error mid-render,
// not a graceful per-card failure. Extract a real string URL here instead.
// A previous fix here (see docs/decisions-log.md) extracted a string out of
// the nested { urls: {...} } object but assumed that string was already a
// complete URL. Checked live: the VAST MAJORITY of roadmap cards (925 of
// 1,069 today) actually return a site-RELATIVE path here (e.g.
// "/media/1w9r0ekh3lj0er/hub_large/HelmetPolish.jpg"), only a minority (144)
// return a full "https://media.robertsspaceindustries.com/..." URL — two
// different real shapes from the same API field, not a hypothetical. A
// relative path stored as-is 404s in the browser (no host to resolve
// against) — confirmed by testing the exact broken URL live, then confirmed
// the fix by testing "https://robertsspaceindustries.com" + that same path
// returns a real 200. This is RSI's own public roadmap media host (the same
// origin family the absolute URLs already point at), not a new site being
// scraped — the API just sometimes hands back its path relative to it.
function resolveThumbUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return `https://robertsspaceindustries.com${u}`;
  return null; // unrecognized shape — never guess further
}

function roadmapThumbnailUrl(thumbnail: any): string | null {
  if (typeof thumbnail === 'string') return resolveThumbUrl(thumbnail);
  return (
    resolveThumbUrl(thumbnail?.urls?.large) ??
    resolveThumbUrl(thumbnail?.urls?.rect) ??
    resolveThumbUrl(thumbnail?.urls?.square) ??
    resolveThumbUrl(thumbnail?.urls?.source) ??
    null
  );
}

async function importRoadmap() {
  const releases = await scapiGet('/roadmap/starcitizen');
  let n = 0;
  for (const rel of releases) {
    for (const card of rel.cards || []) {
      const thumbUrl = roadmapThumbnailUrl(card.thumbnail);
      const stored = thumbUrl ? await downloadAndStoreImage(thumbUrl) : null;
      await upsertEntity({
        id: `patch_note_roadmap_${slugify(card.name)}_${card.id}`, type: 'patch_note', name: card.name,
        summary: null,
        body: card.description || card.body || null,
        attributes: {
          category: 'roadmap', sc_api_id: card.id, release: rel.name,
          category_name: card.category_name ?? null, status: card.status ?? null,
          scheduled_at: card.scheduled_at ?? null, released: !!card.released,
          url_slug: card.url_slug ?? null, // real URL pattern unconfirmed — never guess one
        },
        images: thumbUrl
          ? [{
              url: stored?.localUrl ?? thumbUrl, original_url: thumbUrl, full_url: stored?.fullUrl ?? null,
              role: 'primary', added_by: 'connector', source_url: null, license_note: LICENSE_NOTE,
            }]
          : [],
        source: sourceOf(null), // no confirmed direct URL for a single card — see url_slug attribute
        game_version: null,
      });
      n++;
    }
  }
  line(`[roadmap] upserted ${n} cards across ${releases.length} releases`);
}

// ---- Ships: ENRICH existing ship_* entities (matched by normalized name)
// with structured stats. Never creates a new ship entity on a miss — this is
// supplementing the 236 already scraped from starcitizen.tools, not a second
// ship-creation path (avoids duplicate/fuzzy-matched entities). ----
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function enrichShips() {
  const ships = await scapiGet('/ships');
  const existing = await query(
    `SELECT id, name FROM entities WHERE COALESCE(attributes->>'category', type) = 'ship' AND status <> 'removed'`,
  );
  const byNorm = new Map<string, string>();
  for (const r of existing.rows as any[]) byNorm.set(normName(r.name), r.id);

  let matched = 0;
  const unmatched: string[] = [];
  for (const sh of ships) {
    if (!sh || !sh.name) continue;
    const ourId = byNorm.get(normName(sh.name));
    if (!ourId) { unmatched.push(sh.name); continue; }
    const ent = await getEntity(ourId);
    if (!ent) continue;
    const mergedAttributes: Record<string, unknown> = {
      ...ent.attributes,
      sc_api_id: sh.id,
      afterburner_speed: sh.afterburner_speed ?? null,
      scm_speed: sh.scm_speed ?? null,
      cargo_capacity: sh.cargocapacity ?? null,
      mass: sh.mass ?? null,
      length: sh.length ?? null,
      beam: sh.beam ?? null,
      height: sh.height ?? null,
      min_crew: sh.min_crew ?? null,
      max_crew: sh.max_crew ?? null,
      price_usd: sh.price ?? null,
      production_status: sh.production_status ?? null,
      production_note: sh.production_note ?? null,
    };
    await upsertEntity({
      id: ent.id, type: ent.type, name: ent.name, aliases: ent.aliases,
      summary: ent.summary, body: ent.body, attributes: mergedAttributes,
      relations: ent.relations, images: ent.images, source: ent.source,
      game_version: ent.game_version, status: ent.status, freshness_class: ent.freshness_class,
    });
    matched++;
  }
  line(`[ships] enriched ${matched} existing entities; ${unmatched.length} StarCitizen-API ships had no name match in the KB (not created — enrichment only)`);
  if (unmatched.length) line(`  unmatched: ${unmatched.slice(0, 25).join(', ')}${unmatched.length > 25 ? ', ...' : ''}`);
}

function parseArgs(argv: string[]) {
  const out: Record<string, boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)$/);
    if (m) out[m[1]] = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = args['all'] === true;
  const wantSystems = all || args['systems'] === true;
  const wantTunnels = all || args['tunnels'] === true;
  const wantSpecies = all || args['species'] === true;
  const wantAffiliations = all || args['affiliations'] === true;
  const wantRoadmap = all || args['roadmap'] === true;
  const wantShips = all || args['ships'] === true;

  if (!wantSystems && !wantTunnels && !wantSpecies && !wantAffiliations && !wantRoadmap && !wantShips) {
    console.error('Nothing to do. Usage: tsx src/import-starcitizen-api.ts --systems --tunnels --species --affiliations --roadmap --ships (any subset, or --all)');
    process.exit(1);
  }

  line('=== import-starcitizen-api ===');
  let systemIdMap: Map<number, string> | null = null;
  if (wantSystems) systemIdMap = await importSystems();
  if (wantTunnels) {
    if (!systemIdMap) {
      // tunnels reference systems by sc_api_id — resolve from already-imported
      // entities' attributes instead of re-fetching, if systems weren't
      // requested in this same run.
      const rows = await query(`SELECT id, attributes->>'sc_api_id' AS sc_api_id FROM entities WHERE attributes->>'category' = 'star_system'`);
      systemIdMap = new Map((rows.rows as any[]).filter((r) => r.sc_api_id).map((r) => [Number(r.sc_api_id), r.id]));
      if (systemIdMap.size === 0) line('[tunnels] WARNING: no star_system entities found yet — pass --systems too, or run it first, or every tunnel will be missing its endpoint relations.');
    }
    await importTunnels(systemIdMap);
  }
  if (wantSpecies) await importSpecies();
  if (wantAffiliations) await importAffiliations();
  if (wantRoadmap) await importRoadmap();
  if (wantShips) await enrichShips();
  line('=== done ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
