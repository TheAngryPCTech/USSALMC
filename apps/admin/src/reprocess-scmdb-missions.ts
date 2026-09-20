// reprocess-scmdb-missions.ts — Phase 24 follow-up: restructure the 1,733
// quest_scmdb_* entities imported by import-scmdb-missions.ts. User feedback
// on the first pass: (1) real data (Requirements/Combat text) was stored as
// raw semi-structured blobs instead of clean fields, (2) entities had zero
// `relations` linking them to the rest of the KB, (3) `summary` was always
// null so listings/search showed no description, and (4) several ambiguous
// list-column values got stored under honest-but-unhelpful `*_raw` names
// that then leaked into the reader-facing page as if they were understood
// facts (fixed separately in entity.php to never show `_raw` fields, but
// the fields themselves are cleaned up here too rather than left dangling).
//
// Reprocesses IN PLACE from data already captured in `attributes.tabs` —
// does NOT re-visit scmdb.net. Parses real, literal text into fields; never
// invents a value a mission's text doesn't contain (same discipline as the
// original import).
//
// Usage: tsx src/reprocess-scmdb-missions.ts [--limit N]

import { query } from '../../api/src/db.js';
import { getEntity, upsertEntity } from '../../api/src/entity-repo.js';

const line = (s = '') => console.log(s);

// Star systems that already have a real `location_<slug>` entity in the KB
// (confirmed live, not guessed — see decisions-log.md) — "Multi" (a mission
// spawnable in more than one system) intentionally has no single target.
const SYSTEM_TO_LOCATION_ID: Record<string, string> = {
  Pyro: 'location_pyro',
  Nyx: 'location_nyx',
  Stanton: 'location_stanton',
};

function linesOf(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

function valueAfter(lines: string[], label: string, offset = 1): string | null {
  const i = lines.indexOf(label);
  if (i === -1 || i + offset >= lines.length) return null;
  return lines[i + offset];
}

function yesNoAfter(lines: string[], label: string): boolean | null {
  const v = valueAfter(lines, label);
  if (v === 'Yes') return true;
  if (v === 'No') return false;
  return null;
}

interface ParsedRequirements {
  standing_min_rank: string | null;
  standing_min_xp: number | null;
  standing_max_rank: string | null;
  standing_max_xp: number | null;
  shareable_to_rank: string | null;
  shareable: boolean | null;
  once_only: boolean | null;
  reaccept_after_abandon: boolean | null;
  reaccept_after_fail: boolean | null;
  cooldown: string | null;
  available_locations: string[];
}

function parseRequirements(text: string | undefined): ParsedRequirements {
  const out: ParsedRequirements = {
    standing_min_rank: null, standing_min_xp: null,
    standing_max_rank: null, standing_max_xp: null,
    shareable_to_rank: null, shareable: null,
    once_only: null, reaccept_after_abandon: null, reaccept_after_fail: null,
    cooldown: null, available_locations: [],
  };
  if (!text) return out;
  const lines = linesOf(text);

  const minI = lines.indexOf('MIN:');
  if (minI !== -1) {
    out.standing_min_rank = lines[minI + 1] ?? null;
    const xp = lines[minI + 2];
    if (xp) out.standing_min_xp = parseInt(xp.replace(/[^\d]/g, ''), 10) || 0;
  }
  const maxI = lines.indexOf('MAX:');
  if (maxI !== -1) {
    out.standing_max_rank = lines[maxI + 1] ?? null;
    const xp = lines[maxI + 2];
    if (xp) out.standing_max_xp = parseInt(xp.replace(/[^\d]/g, ''), 10) || 0;
  }
  out.shareable_to_rank = valueAfter(lines, 'SHAREABLE TO:');
  out.shareable = yesNoAfter(lines, 'SHAREABLE');
  out.once_only = yesNoAfter(lines, 'ONCE ONLY');
  out.reaccept_after_abandon = yesNoAfter(lines, 'RE-ACCEPT AFTER ABANDON');
  out.reaccept_after_fail = yesNoAfter(lines, 'RE-ACCEPT AFTER FAIL');
  const cooldownI = lines.indexOf('COOLDOWN');
  if (cooldownI !== -1) out.cooldown = lines[cooldownI + 1] ?? null;

  // "AVAILABLE AT" (fixed location list) or "AVAILABLE IN" (a region) or
  // "SPAWN AREA" (a system-wide note) — whichever appears, collect the
  // location-ish lines until the next ALL-CAPS section header.
  const headerRe = /^[A-Z][A-Z .()'-]{2,}:?$/;
  for (const startLabel of ['AVAILABLE AT', 'AVAILABLE IN', 'SPAWN AREA']) {
    const i = lines.indexOf(startLabel);
    if (i === -1) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (headerRe.test(l) || l === 'SHAREABLE' || l === 'LOCATION VARIANTS' || /^LOCATION VARIANTS/.test(l)) break;
      if (/^(Mission can only|No specific location|Estimated minimum|Cooldown after)/.test(l)) continue;
      if (/^\d+$/.test(l) || l === '▸' || l === '→') continue;
      out.available_locations.push(l);
    }
  }
  out.available_locations = Array.from(new Set(out.available_locations));
  return out;
}

function parseTopShips(communityText: string | undefined): string[] {
  if (!communityText) return [];
  const lines = linesOf(communityText);
  const i = lines.indexOf('TOP SHIPS');
  if (i === -1) return [];
  const ships: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^Sign in to contribute/.test(lines[j])) break;
    if (/^\d+$/.test(lines[j])) continue; // the "N" usage-count line after each ship name
    ships.push(lines[j]);
  }
  return ships;
}

// Strip the trailing "REWARD\n...\nBLUEPRINT REWARDS\n..." block scmdb
// appends to the Overview tab's text — that's already captured cleanly in
// attributes.reward_auec; leaving it in `body` was pure duplication.
function cleanOverviewBody(overview: string | undefined): { body: string | null; blueprintRewardOptions: string[] } {
  if (!overview) return { body: null, blueprintRewardOptions: [] };
  const rewardIdx = overview.indexOf('\nREWARD\n');
  const narrative = rewardIdx === -1 ? overview : overview.slice(0, rewardIdx);
  const blueprintRewardOptions: string[] = [];
  const bpIdx = overview.indexOf('BLUEPRINT REWARDS');
  if (bpIdx !== -1) {
    const tail = linesOf(overview.slice(bpIdx));
    // Item names sit between the icon lines; keep anything that isn't a
    // known label/icon/percentage line.
    for (const l of tail) {
      if (/^(BLUEPRINT REWARDS|BP_REWARDS_|\d+% chance|\d+ of \d+|⚒|🔧)/.test(l)) continue;
      if (l.length > 1) blueprintRewardOptions.push(l);
    }
  }
  return { body: narrative.trim() || null, blueprintRewardOptions };
}

function makeSummary(body: string | null): string | null {
  if (!body) return null;
  // Skip short header-like lines (e.g. a company name on its own line, "> About the job <")
  // in favor of the first paragraph that actually reads like a sentence.
  const paragraphs = body.split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const firstReal = paragraphs.find((p) => p.length >= 30 && !/^>.*<$/.test(p)) ?? paragraphs[0];
  if (!firstReal) return null;
  return firstReal.length > 220 ? firstReal.slice(0, 217).trimEnd() + '...' : firstReal;
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;

  line('=== reprocess-scmdb-missions ===');
  const res = await query(`SELECT id FROM entities WHERE attributes->>'scmdb_id' IS NOT NULL ORDER BY id`);
  let ids = (res.rows as any[]).map((r) => r.id as string);
  if (limit) ids = ids.slice(0, limit);
  line(`[reprocess] ${ids.length} quest_scmdb_* entities to update`);

  let done = 0;
  for (const id of ids) {
    const ent = await getEntity(id);
    if (!ent) continue;
    const attrs: any = ent.attributes || {};
    const tabs: Record<string, string> = attrs.tabs || {};

    const { body, blueprintRewardOptions } = cleanOverviewBody(tabs['Overview']);
    const requirements = parseRequirements(tabs['Requirements']);
    const topShips = parseTopShips(tabs['Community']);
    const combatNotes = tabs['Combat'] || null;

    const relations: { type: string; target_id: string }[] = [];
    const sysLocId = attrs.star_system ? SYSTEM_TO_LOCATION_ID[attrs.star_system] : null;
    if (sysLocId) relations.push({ type: 'located_in', target_id: sysLocId });

    const newAttributes: Record<string, unknown> = {
      category: 'quest',
      scmdb_id: attrs.scmdb_id,
      scmdb_template_key: attrs.scmdb_template_key ?? null,
      faction: attrs.faction ?? null,
      star_system: attrs.star_system ?? null,
      mission_type: attrs.mission_type ?? null,
      is_legal: attrs.is_legal ?? null,
      base_xp: attrs.base_xp ?? null,
      reward_auec: attrs.reward_auec ?? null,
      blueprint_reward_options: blueprintRewardOptions,
      est_uec_per_hour: attrs.est_uec_per_hour ?? null,
      est_rep_per_hour: attrs.est_rep_per_hour ?? null,
      community_difficulty: attrs.community_difficulty ?? null,
      community_satisfaction: attrs.community_satisfaction ?? null,
      top_ships: topShips,
      combat_notes: combatNotes,
      ...requirements,
      // Dropped vs. the original import: tags_raw, inout_raw, health_raw,
      // bp_col_raw, bp_delta_col_raw, check_col_raw, and the raw `tabs` blob
      // itself — either fully superseded by the clean fields above, or (for
      // the handful whose exact meaning was never confidently determined)
      // dropped rather than shown to a reader under a meaningless label.
    };

    await upsertEntity({
      id: ent.id,
      type: ent.type,
      name: ent.name,
      aliases: ent.aliases,
      summary: makeSummary(body),
      body,
      attributes: newAttributes,
      relations,
      images: ent.images,
      source: ent.source,
      game_version: ent.game_version,
      status: ent.status,
      freshness_class: ent.freshness_class,
    });
    done++;
    if (done % 100 === 0) line(`[reprocess] ${done}/${ids.length}`);
  }
  line('');
  line(`[done] reprocessed ${done} entities`);
}

main().catch((e) => { console.error(e); process.exit(1); });
