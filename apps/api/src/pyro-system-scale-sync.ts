// pyro-system-scale-sync.ts — live sync of real intra-system position/
// radius data for Pyro's planets and moons, from a user-provided public
// read-only Google Sheet ("Murphy's Navigation Tool", Nav Database tab).
// Runs every 30 minutes (wired in index.ts). Stanton's equivalent data has
// no live source — see scripts/import-stanton-system-scale.ts, a one-time
// import from a static NAS export. See CLAUDE.md Decisions Log, 2026-10-25.
//
// Matches by exact name only against this project's own Pyro reference
// roster (planetary-atlas.ts REFERENCE_SYSTEMS) — the sheet also lists
// ~590 Pyro surface POIs we deliberately ignore here; this sync is for
// system-scale body position/radius only, not surface locations.
import { query } from './db.js';
import { upsertEntity } from './entity-repo.js';

const SHEET_ID = '1aGJ0_49ve1NKf0GvSteSt3-a4jSxnj2snHmTDwKTBgs';
const SHEET_TAB = 'Nav Database';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

// Pyro's full planet/moon roster (must match REFERENCE_SYSTEMS in
// planetary-atlas.ts) — the only names this sync is allowed to touch.
const PYRO_BODY_NAMES = new Set([
  'Pyro I', 'Monox', 'Bloom', 'Pyro V', 'Terminus',
  'Ignis', 'Vatra', 'Adir', 'Fairo', 'Fuego', 'Vuur', 'Pyro IV',
]);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export interface PyroSyncResult {
  ok: boolean;
  matched: number;
  skipped: number;
  error?: string;
}

export async function syncPyroSystemScale(): Promise<PyroSyncResult> {
  let res: Response;
  try {
    res = await fetch(CSV_URL, {
      headers: { 'User-Agent': 'USSALMC-Bot/0.1 (+system-scale-sync; readonly public sheet)' },
    });
  } catch (e: any) {
    await logSync('error', { message: e?.message ?? String(e) });
    return { ok: false, matched: 0, skipped: 0, error: e?.message ?? String(e) };
  }
  if (!res.ok) {
    const msg = `HTTP ${res.status}`;
    await logSync('error', { message: msg });
    return { ok: false, matched: 0, skipped: 0, error: msg };
  }
  const text = await res.text();
  const lines = text.split('\n').filter((l) => l.trim());
  let matched = 0, skipped = 0;

  const existing = await query<{ id: string; name: string }>(
    `SELECT id, name FROM entities WHERE type='location'`,
  );
  const nameIndex = new Map<string, string[]>();
  for (const row of existing.rows) {
    const key = row.name.trim().toLowerCase();
    nameIndex.set(key, [...(nameIndex.get(key) ?? []), row.id]);
  }

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const name = (cols[3] ?? '').trim();
    if (!PYRO_BODY_NAMES.has(name)) continue;
    const x = Number(cols[5]), y = Number(cols[6]);
    const radius = cols[14] ? Number(cols[14]) : null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) { skipped++; continue; }

    const ids = nameIndex.get(name.toLowerCase());
    if (!ids || ids.length !== 1) { skipped++; continue; } // no match or ambiguous — never guess
    const full = await query(`SELECT * FROM entities WHERE id=$1`, [ids[0]]);
    const r: any = full.rows[0];
    const attributes = {
      ...(r.attributes ?? {}),
      real_system_position: { x, y },
      real_position_recorded_at: new Date().toISOString(),
      ...(radius !== null && Number.isFinite(radius) ? { real_body_radius_km: radius } : {}),
    };
    await upsertEntity({
      id: r.id, type: r.type, name: r.name, aliases: r.aliases,
      summary: r.summary, body: r.body, attributes,
      relations: r.relations, images: r.images, source: r.source,
      game_version: r.game_version, status: r.status, freshness_class: r.freshness_class,
    });
    matched++;
  }

  await logSync('ok', { matched, skipped, source: SHEET_TAB });
  return { ok: true, matched, skipped };
}

async function logSync(status: 'ok' | 'error', detail: Record<string, unknown>) {
  try {
    await query(
      `INSERT INTO scrape_log (source_url, action, detail) VALUES ($1, $2, $3)`,
      [CSV_URL, 'pyro_system_scale_sync_' + status, JSON.stringify(detail)],
    );
  } catch {
    // Logging failure must never break the sync itself.
  }
}
