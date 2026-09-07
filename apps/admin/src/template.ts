// template.ts — recognize a page's category, generalize a reviewer's selections
// into a reusable template (keyed by category + domain, matching by label text /
// structural role, not CSS paths), and apply a template to a new extraction.

import { query } from '../../api/src/db.js';
import type { FieldCandidate, ExtractionResult } from './extractor.js';

export interface TemplateFieldRule {
  field_name: string;         // canonical entity field / attribute key
  match_by: 'label_text' | 'structural_role';
  label: string;              // the human label to match (case-insensitive)
  where: string;              // expected plain-language location
  is_image: boolean;
  role?: 'primary' | 'gallery';
  target: 'summary' | 'attribute' | 'image' | 'relation' | 'ignore';
  relation_type?: string;     // if target=relation
}

export interface ScrapeTemplate {
  id: string;
  category: string;
  domain: string;
  entity_type: string;
  field_map: TemplateFieldRule[];
  match_signals: { categories?: string[]; title_patterns?: string[]; label_hints?: string[] };
  clean_streak: number;
  auto_publish: boolean;
}

export function domainOf(url: string): string {
  return new URL(url).host;
}

// Guess the category slug from a page's categories. Order matters: check the
// more specific "... manufacturers" / "... weapons" BEFORE the generic ship
// pattern, since a manufacturer page carries categories like "Ship manufacturers".
export function guessCategory(ex: ExtractionResult): string | null {
  const cats = ex.categories.map((c) => c.toLowerCase());
  if (cats.some((c) => /manufacturer|corporation|\bcompan(y|ies)\b/.test(c))) return 'manufacturer';
  if (cats.some((c) => /weapons?\b/.test(c))) return 'weapon';
  if (cats.some((c) => /commodit/.test(c))) return 'commodity';
  if (cats.some((c) => /locations?|planets?|moons?|stations?|landing zone|cities|outposts?/.test(c))) return 'location';
  if (cats.some((c) => c === 'ships' || /\bships?\b/.test(c) || /vehicles?/.test(c))) return 'ship';
  return null;
}

export async function findTemplate(category: string, domain: string): Promise<ScrapeTemplate | null> {
  const res = await query(`SELECT * FROM scrape_templates WHERE category=$1 AND domain=$2`, [category, domain]);
  if (!res.rows[0]) return null;
  const r: any = res.rows[0];
  return {
    id: r.id, category: r.category, domain: r.domain, entity_type: r.entity_type,
    field_map: r.field_map, match_signals: r.match_signals,
    clean_streak: r.clean_streak, auto_publish: r.auto_publish,
  };
}

export async function findTemplateById(id: string): Promise<ScrapeTemplate | null> {
  const res = await query(`SELECT * FROM scrape_templates WHERE id=$1`, [id]);
  if (!res.rows[0]) return null;
  const r: any = res.rows[0];
  return {
    id: r.id, category: r.category, domain: r.domain, entity_type: r.entity_type,
    field_map: r.field_map, match_signals: r.match_signals,
    clean_streak: r.clean_streak, auto_publish: r.auto_publish,
  };
}

// Does a freshly-extracted page match this template's category signals?
export function templateMatchesPage(tpl: ScrapeTemplate, ex: ExtractionResult): { matches: boolean; score: number; reason: string } {
  const sig = tpl.match_signals || {};
  const pageCats = new Set(ex.categories.map((c) => c.toLowerCase()));
  let hits = 0;
  const wantCats = (sig.categories || []).map((c) => c.toLowerCase());
  for (const c of wantCats) if (pageCats.has(c)) hits++;
  const labelSet = new Set(ex.candidates.map((c) => c.label.toLowerCase()));
  let labelHits = 0;
  for (const l of (sig.label_hints || [])) if (labelSet.has(l.toLowerCase())) labelHits++;
  const catScore = wantCats.length ? hits / wantCats.length : 0;
  const labelScore = (sig.label_hints || []).length ? labelHits / sig.label_hints!.length : 0;
  const score = 0.6 * catScore + 0.4 * labelScore;
  return {
    matches: score >= 0.4,
    score,
    reason: `matched ${hits}/${wantCats.length} categories and ${labelHits}/${(sig.label_hints || []).length} key fields`,
  };
}

// Generalize the reviewer's confirmed candidate selections into a template.
export function buildTemplateFromSelections(
  category: string, domain: string, entityType: string,
  ex: ExtractionResult,
  selections: { key: string; field_name: string; target: TemplateFieldRule['target']; role?: 'primary'|'gallery'; relation_type?: string }[],
): Omit<ScrapeTemplate, 'id' | 'clean_streak' | 'auto_publish'> {
  const byKey = new Map(ex.candidates.map((c) => [c.key, c]));
  const field_map: TemplateFieldRule[] = [];
  for (const s of selections) {
    const cand = byKey.get(s.key);
    if (!cand) continue;
    field_map.push({
      field_name: s.field_name,
      match_by: cand.kind === 'image' ? 'structural_role' : 'label_text',
      label: cand.label.replace(/^Image:\s*/, '').replace(/^Section:\s*/, ''),
      where: cand.where,
      is_image: cand.kind === 'image',
      role: s.role ?? cand.role,
      target: s.target,
      relation_type: s.relation_type,
    });
  }
  // match signals: the page's spec-bearing categories + a few strong label hints
  const label_hints = field_map.filter((f) => !f.is_image && f.target === 'attribute').slice(0, 6).map((f) => f.label);
  return {
    category, domain, entity_type: entityType,
    field_map,
    match_signals: { categories: ex.categories, label_hints },
  };
}

// Apply a template to a new extraction. Returns a partial entity draft plus a
// list of fields the template expected but couldn't find (missing -> null).
export interface AppliedDraft {
  summary: string | null;
  attributes: Record<string, unknown>;
  images: any[];
  relationCandidates: { relation_type: string; text: string }[];
  matchedCount: number;
  expectedCount: number;
  missing: string[];
}

export function applyTemplate(tpl: ScrapeTemplate, ex: ExtractionResult, sourceUrl: string): AppliedDraft {
  const byLabel = new Map<string, FieldCandidate>();
  for (const c of ex.candidates) {
    const key = c.label.replace(/^Image:\s*/, '').replace(/^Section:\s*/, '').toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, c);
  }
  const draft: AppliedDraft = {
    summary: null, attributes: {}, images: [], relationCandidates: [],
    matchedCount: 0, expectedCount: 0, missing: [],
  };
  for (const rule of tpl.field_map) {
    if (rule.target === 'ignore') continue;
    draft.expectedCount++;
    if (rule.is_image) {
      // pick the first image candidate matching the requested role
      const img = ex.candidates.find((c) => c.kind === 'image' && (c.role === rule.role || !rule.role));
      if (img?.imageUrl) {
        draft.images.push({
          url: img.imageUrl, caption: null, role: rule.role || 'gallery',
          added_by: 'scraper', source_url: sourceUrl,
          license_note: 'REVIEW REQUIRED: scraped image, likely copyrighted (wiki/official).',
        });
        draft.matchedCount++;
      } else { draft.missing.push(rule.field_name); }
      continue;
    }
    const cand = byLabel.get(rule.label.toLowerCase());
    if (!cand || cand.value == null) { draft.missing.push(rule.field_name); continue; }
    draft.matchedCount++;
    if (rule.target === 'summary') draft.summary = cand.value;
    else if (rule.target === 'attribute') draft.attributes[rule.field_name] = cand.value;
    else if (rule.target === 'relation') draft.relationCandidates.push({ relation_type: rule.relation_type || 'related_to', text: cand.value });
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Variance: with the category already known, measure how well THIS page's
// detected fields line up with the category's CURRENT template. A field
// "deviates" when it is missing (template expects it, page doesn't have it),
// unmatched (present on the page but empty/null), or structurally different
// (present but in a different structural place than the template expects — e.g.
// the template learned a spec from the "Side info box" and the page only has it
// buried in "Body text"). Variance is the percentage of expected template
// fields that deviate; 0 = a perfect structural match, 100 = nothing lines up.
// This is deliberately independent of templateMatchesPage() (which is a coarse
// category-signal gate): variance judges THIS specific page against the
// template even for a category the template is already trusted to auto-publish.
// ---------------------------------------------------------------------------
export interface VarianceDeviation {
  field_name: string;
  label: string;
  kind: 'missing' | 'unmatched' | 'structural';
  detail: string;             // plain-language reason (no selectors)
}
export interface VarianceResult {
  expected: number;           // expected (non-ignore) template fields
  deviations: number;         // missing + unmatched + structural
  missing: number;
  unmatched: number;
  structural: number;
  variance_pct: number;       // round(deviations / expected * 100); 0 if expected==0
  detail: VarianceDeviation[];
}

export function computeVariance(tpl: ScrapeTemplate, ex: ExtractionResult): VarianceResult {
  const byLabel = new Map<string, FieldCandidate>();
  for (const c of ex.candidates) {
    const key = c.label.replace(/^Image:\s*/, '').replace(/^Section:\s*/, '').toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, c);
  }
  const detail: VarianceDeviation[] = [];
  let expected = 0, missing = 0, unmatched = 0, structural = 0;
  for (const rule of tpl.field_map) {
    if (rule.target === 'ignore') continue;
    expected++;
    if (rule.is_image) {
      const img = ex.candidates.find((c) => c.kind === 'image' && (c.role === rule.role || !rule.role));
      if (!img?.imageUrl) {
        missing++;
        detail.push({ field_name: rule.field_name, label: rule.label, kind: 'missing',
          detail: `Expected ${rule.role || 'an'} image but the page has none matching.` });
      }
      continue;
    }
    const cand = byLabel.get(rule.label.toLowerCase());
    if (!cand) {
      missing++;
      detail.push({ field_name: rule.field_name, label: rule.label, kind: 'missing',
        detail: `The template expects a "${rule.label}" field but this page doesn't have one.` });
      continue;
    }
    if (cand.value == null || cand.value === '') {
      unmatched++;
      detail.push({ field_name: rule.field_name, label: rule.label, kind: 'unmatched',
        detail: `"${rule.label}" is present on the page but empty.` });
      continue;
    }
    // structurally different: the template learned this field from one place
    // (e.g. the side info box) but the page presents it somewhere else.
    if (rule.where && cand.where && rule.where !== cand.where) {
      structural++;
      detail.push({ field_name: rule.field_name, label: rule.label, kind: 'structural',
        detail: `"${rule.label}" is expected in the ${rule.where} but this page has it in the ${cand.where}.` });
    }
  }
  const deviations = missing + unmatched + structural;
  const variance_pct = expected === 0 ? 0 : Math.round((deviations / expected) * 100);
  return { expected, deviations, missing, unmatched, structural, variance_pct, detail };
}

export async function saveTemplate(t: Omit<ScrapeTemplate, 'id' | 'clean_streak' | 'auto_publish'>): Promise<ScrapeTemplate> {
  const slug = t.category.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const id = `tpl_${slug}_${t.domain.replace(/[^a-z0-9]+/gi, '_')}_v1`;
  await query(
    `INSERT INTO scrape_templates (id, category, domain, entity_type, field_map, match_signals, clean_streak, auto_publish)
     VALUES ($1,$2,$3,$4,$5,$6,0,false)
     ON CONFLICT (category, domain) DO UPDATE SET
       entity_type=EXCLUDED.entity_type, field_map=EXCLUDED.field_map,
       match_signals=EXCLUDED.match_signals, updated_at=now()`,
    [id, t.category, t.domain, t.entity_type, JSON.stringify(t.field_map), JSON.stringify(t.match_signals)],
  );
  return { ...t, id, clean_streak: 0, auto_publish: false };
}

// Refine an existing template's field map from the category management page
// (admin "solves"/improves the template). This is NOT a reviewer confirm, so it
// deliberately does NOT reset the trust streak — it only changes what the
// template expects. Returns the updated template; the caller re-weighs the
// queue against it. `field_map` fully replaces the existing map.
export async function refineTemplateFields(id: string, field_map: TemplateFieldRule[]): Promise<ScrapeTemplate> {
  const res = await query(
    `UPDATE scrape_templates SET field_map=$2, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(field_map)]);
  if (!res.rows[0]) throw new Error(`No template ${id}`);
  const r: any = res.rows[0];
  return {
    id: r.id, category: r.category, domain: r.domain, entity_type: r.entity_type,
    field_map: r.field_map, match_signals: r.match_signals,
    clean_streak: r.clean_streak, auto_publish: r.auto_publish,
  };
}
