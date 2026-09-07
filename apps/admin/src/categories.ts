// categories.ts — the category/subcategory taxonomy (migrations 0005/0006) that
// the admin renders as an editable tree: create/rename/describe/reparent/delete
// nodes, per-category variance-threshold config, live pending-item badges, and
// entity counts for category-based browsing. Leaf slugs match the flat category
// slugs that templates + entities.attributes.category already use, so the tree is
// a display layer over the existing model — it never moves entity data.

import { query } from '../../api/src/db.js';
import { CATEGORIES } from './entities-admin.js';

// Configurable default variance threshold (% of expected template fields that
// may deviate before a page is routed to the queue instead of auto-processed).
export function defaultVarianceThresholdPct(): number {
  const raw = parseFloat(process.env.SCRAPER_VARIANCE_THRESHOLD_PCT || '40');
  return Number.isFinite(raw) ? raw : 40;
}

export interface CategoryRow {
  slug: string;
  display_name: string;
  parent_slug: string | null;
  is_group: boolean;
  variance_threshold_pct: number | null; // null = use default
  description: string | null;
  sort_order: number;
}

function rowToCategory(r: any): CategoryRow {
  return {
    slug: r.slug, display_name: r.display_name, parent_slug: r.parent_slug,
    is_group: r.is_group,
    variance_threshold_pct: r.variance_threshold_pct === null || r.variance_threshold_pct === undefined ? null : Number(r.variance_threshold_pct),
    description: r.description ?? null,
    sort_order: r.sort_order,
  };
}

const SEL = `slug, display_name, parent_slug, is_group, variance_threshold_pct, description, sort_order`;

// Resolve the effective variance threshold for a leaf category: the per-category
// override if set, else the configured default. Safe for unknown categories.
export async function getVarianceThreshold(category: string): Promise<{ pct: number; source: 'category' | 'default' }> {
  const res = await query(`SELECT variance_threshold_pct FROM categories WHERE slug=$1`, [category]);
  const v = res.rows[0]?.variance_threshold_pct;
  if (v !== null && v !== undefined) return { pct: Number(v), source: 'category' };
  return { pct: defaultVarianceThresholdPct(), source: 'default' };
}

export interface CategoryTreeNode extends CategoryRow {
  pending_count: number;    // this node's own pending queue items (leaf only)
  subtree_pending: number;  // this node + all descendants
  entity_count: number;     // published entities whose category == this leaf slug
  subtree_entities: number; // this node + all descendants
  effective_threshold_pct: number;
  threshold_is_default: boolean;
  has_template: boolean;    // a scrape_template exists for this leaf
  children: CategoryTreeNode[];
}

// Build the full taxonomy tree with per-node pending-item + entity counts.
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const catRes = await query(`SELECT ${SEL} FROM categories ORDER BY sort_order, display_name`);
  const pendRes = await query(
    `SELECT category, count(*)::int AS n FROM review_queue WHERE status='pending' GROUP BY category`);
  // entity count keyed by the entity's display category (attributes.category
  // when set, else base type) — matches how listEntitiesForAdmin derives it.
  const entRes = await query(
    `SELECT COALESCE(attributes->>'category', type) AS category, count(*)::int AS n
     FROM entities GROUP BY COALESCE(attributes->>'category', type)`);
  const tplRes = await query(`SELECT DISTINCT category FROM scrape_templates`);
  const pending = new Map<string, number>();
  for (const r of pendRes.rows as any[]) if (r.category) pending.set(r.category, r.n);
  const entities = new Map<string, number>();
  for (const r of entRes.rows as any[]) if (r.category) entities.set(r.category, r.n);
  const templated = new Set<string>((tplRes.rows as any[]).map((r) => r.category));

  const def = defaultVarianceThresholdPct();
  const nodes = new Map<string, CategoryTreeNode>();
  for (const r of catRes.rows as any[]) {
    const base = rowToCategory(r);
    const override = base.variance_threshold_pct;
    nodes.set(r.slug, {
      ...base,
      pending_count: base.is_group ? 0 : (pending.get(r.slug) ?? 0),
      subtree_pending: 0,
      entity_count: base.is_group ? 0 : (entities.get(r.slug) ?? 0),
      subtree_entities: 0,
      effective_threshold_pct: override === null ? def : override,
      threshold_is_default: override === null,
      has_template: templated.has(r.slug),
      children: [],
    });
  }
  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parent_slug && nodes.has(node.parent_slug)) nodes.get(node.parent_slug)!.children.push(node);
    else roots.push(node);
  }
  const rollup = (n: CategoryTreeNode): { p: number; e: number } => {
    let p = n.pending_count, e = n.entity_count;
    for (const c of n.children) { const s = rollup(c); p += s.p; e += s.e; }
    n.subtree_pending = p; n.subtree_entities = e;
    return { p, e };
  };
  for (const r of roots) rollup(r);
  return roots;
}

// Flat list (for pickers / the management table).
export async function listCategories(): Promise<CategoryRow[]> {
  const res = await query(`SELECT ${SEL} FROM categories ORDER BY sort_order, display_name`);
  return (res.rows as any[]).map(rowToCategory);
}

// Update a category's variance threshold from the management page. Pass null to
// clear the override (revert to the configured default). Groups can't have a
// threshold (they aren't real entity categories with templates).
export async function setVarianceThreshold(slug: string, pct: number | null): Promise<CategoryRow> {
  const cat = await query(`SELECT is_group FROM categories WHERE slug=$1`, [slug]);
  if (!cat.rows[0]) throw new Error(`Unknown category "${slug}"`);
  if (cat.rows[0].is_group && pct !== null) throw new Error(`"${slug}" is a grouping node — set thresholds on leaf categories.`);
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
    throw new Error('Variance threshold must be a percentage between 0 and 100.');
  }
  const res = await query(
    `UPDATE categories SET variance_threshold_pct=$2, updated_at=now() WHERE slug=$1 RETURNING ${SEL}`,
    [slug, pct]);
  return rowToCategory(res.rows[0]);
}

// ---- structural CRUD (the "category management" the admin page needs) ----

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

// A slug that collides with a leaf's canonical entity category (ship, weapon…)
// must stay a real leaf so templates/entities keep lining up; guard against a
// user turning one into a group or deleting it.
function isCanonicalLeaf(slug: string): boolean {
  return (CATEGORIES as readonly string[]).includes(slug);
}

// Create a new category or subcategory. `parent_slug` null = top-level.
// `is_group=true` makes a grouping branch (no template/threshold/entities of its
// own). A non-group leaf becomes assignable to entities.
export async function createCategory(input: {
  display_name: string; parent_slug?: string | null; is_group?: boolean;
  slug?: string; description?: string | null;
}): Promise<CategoryRow> {
  const display = (input.display_name || '').trim();
  if (!display) throw new Error('A display name is required.');
  const slug = (input.slug && slugify(input.slug)) || slugify(display);
  if (!slug) throw new Error('Could not derive a slug from the name — use letters/numbers.');
  const exists = await query(`SELECT 1 FROM categories WHERE slug=$1`, [slug]);
  if (exists.rows[0]) throw new Error(`A category with slug "${slug}" already exists.`);
  let parent: string | null = input.parent_slug ?? null;
  if (parent) {
    const p = await query(`SELECT is_group FROM categories WHERE slug=$1`, [parent]);
    if (!p.rows[0]) throw new Error(`Parent "${parent}" does not exist.`);
  }
  // place it after the current max sort_order so it lands at the end
  const ord = await query(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM categories`);
  const res = await query(
    `INSERT INTO categories (slug, display_name, parent_slug, is_group, description, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${SEL}`,
    [slug, display, parent, !!input.is_group, input.description ?? null, ord.rows[0].n]);
  return rowToCategory(res.rows[0]);
}

// Would setting `child`'s parent to `newParent` create a cycle? (newParent is a
// descendant of child, or is child itself.)
async function wouldCycle(child: string, newParent: string | null): Promise<boolean> {
  if (!newParent) return false;
  if (newParent === child) return true;
  const all = await query(`SELECT slug, parent_slug FROM categories`);
  const parentOf = new Map<string, string | null>((all.rows as any[]).map((r) => [r.slug, r.parent_slug]));
  let cur: string | null = newParent;
  const seen = new Set<string>();
  while (cur) {
    if (cur === child) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

// Update a category's name / description / parent (reparent). Every field is
// optional; only provided keys change. Reparent guards against cycles.
export async function updateCategory(slug: string, patch: {
  display_name?: string; description?: string | null; parent_slug?: string | null;
}): Promise<CategoryRow> {
  const cur = await query(`SELECT ${SEL} FROM categories WHERE slug=$1`, [slug]);
  if (!cur.rows[0]) throw new Error(`Unknown category "${slug}"`);
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.display_name !== undefined) {
    const dn = patch.display_name.trim();
    if (!dn) throw new Error('Display name cannot be empty.');
    params.push(dn); sets.push(`display_name=$${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description === null ? null : String(patch.description));
    sets.push(`description=$${params.length}`);
  }
  if (patch.parent_slug !== undefined) {
    const np = patch.parent_slug === '' ? null : patch.parent_slug;
    if (np) {
      const p = await query(`SELECT 1 FROM categories WHERE slug=$1`, [np]);
      if (!p.rows[0]) throw new Error(`Parent "${np}" does not exist.`);
    }
    if (await wouldCycle(slug, np ?? null)) throw new Error('That move would create a cycle (a category cannot be nested under its own descendant).');
    params.push(np ?? null); sets.push(`parent_slug=$${params.length}`);
  }
  if (!sets.length) return rowToCategory(cur.rows[0]);
  params.push(slug);
  const res = await query(
    `UPDATE categories SET ${sets.join(', ')}, updated_at=now() WHERE slug=$${params.length} RETURNING ${SEL}`,
    params);
  return rowToCategory(res.rows[0]);
}

// Delete a category. Refuses canonical leaves (ship/weapon/…) and non-empty
// nodes (children or assigned entities) so the taxonomy can't be orphaned.
export async function deleteCategory(slug: string): Promise<{ deleted: string }> {
  const cur = await query(`SELECT is_group FROM categories WHERE slug=$1`, [slug]);
  if (!cur.rows[0]) throw new Error(`Unknown category "${slug}"`);
  if (isCanonicalLeaf(slug)) throw new Error(`"${slug}" is a built-in category and can't be deleted.`);
  const kids = await query(`SELECT count(*)::int AS n FROM categories WHERE parent_slug=$1`, [slug]);
  if (kids.rows[0].n > 0) throw new Error(`"${slug}" still has ${kids.rows[0].n} subcategor${kids.rows[0].n === 1 ? 'y' : 'ies'} — move or delete them first.`);
  const ents = await query(
    `SELECT count(*)::int AS n FROM entities WHERE COALESCE(attributes->>'category', type)=$1`, [slug]);
  if (ents.rows[0].n > 0) throw new Error(`"${slug}" still has ${ents.rows[0].n} entit${ents.rows[0].n === 1 ? 'y' : 'ies'} assigned — reassign them first.`);
  await query(`DELETE FROM categories WHERE slug=$1`, [slug]);
  return { deleted: slug };
}
