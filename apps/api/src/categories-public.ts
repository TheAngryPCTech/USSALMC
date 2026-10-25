// categories-public.ts — public category index (GET /v1/categories).
//
// Built over the same `categories` taxonomy table the admin category manager
// uses (see apps/admin/src/categories.ts), but reshaped for public consumers:
// the admin tree's root nodes are internal-organization-only grouping labels
// (`is_group=true`: Vehicles, Organizations, ...) that don't correspond to any
// entity's category and are never shown here. Instead, the entity-bearing leaf
// categories directly under a group (ship, weapon, manufacturer, ...) are
// promoted to be the public "top-level" categories; any admin-created
// categories nested under one of THOSE (a real subcategory) stay nested in
// `subcategories`, per the existing tree, exactly as they are for every other
// category.
//
// Entry counts and the tree shape are cheap to get slightly stale, so they're
// cached in-process for API_CATEGORIES_CACHE_TTL_SEC. trade_route is the one
// volatile exception (per the cross-phase rule: trade data always shows its
// own current freshness) — its `freshness` is recomputed on every call,
// bypassing the cache entirely, same spirit as GET /v1/trade-routes.

import { config } from './config.js';
import { query } from './db.js';

export interface PublicCategoryNode {
  image?: { url: string; entity_id: string; entity_name: string } | null;
  slug: string;
  display_name: string;
  description: string | null;
  // null for trade_route (it reports `freshness` instead — see below).
  entry_count: number | null;
  subcategory_count: number;
  subcategories: PublicCategoryNode[];
  // Only ever set for trade_route today; present (possibly null) on every
  // node so consumers don't have to special-case the key's existence.
  freshness: { last_verified: string | null; last_verified_age_minutes: number | null } | null;
}

interface CategoryRow {
  slug: string;
  display_name: string;
  parent_slug: string | null;
  is_group: boolean;
  description: string | null;
  sort_order: number;
}

const TRADE_ROUTE_SLUG = 'trade_route';

async function buildTree(): Promise<PublicCategoryNode[]> {
  const catRes = await query(
    `SELECT slug, display_name, parent_slug, is_group, description, sort_order
     FROM categories ORDER BY sort_order, display_name`,
  );
  const rows = catRes.rows as CategoryRow[];

  // Entity counts, keyed the same way the admin tree keys them: the entity's
  // attributes.category when set, else its base type. Removed entities are
  // excluded (they're never served on the public API either).
  const entRes = await query(
    `SELECT COALESCE(attributes->>'category', type) AS category, count(*)::int AS n
     FROM entities WHERE status <> 'removed' GROUP BY COALESCE(attributes->>'category', type)`,
  );
  const entityCounts = new Map<string, number>();
  for (const r of entRes.rows as any[]) if (r.category) entityCounts.set(r.category, r.n);

  // One relevant image per taxonomy leaf, chosen from actual public entities.
  // Select primary images first; retain provenance for captions/accessibility.
  const imageRes = await query(`
    SELECT DISTINCT ON (COALESCE(e.attributes->>'category', e.type))
      COALESCE(e.attributes->>'category', e.type) AS category,
      e.id, e.name, image->>'url' AS url
    FROM entities e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.images) = 'array' THEN e.images ELSE '[]'::jsonb END
    ) image
    WHERE e.status <> 'removed' AND jsonb_typeof(image->'url') = 'string'
      AND image->>'url' ~ '^https?://'
    ORDER BY COALESCE(e.attributes->>'category', e.type),
      (image->>'role' = 'primary') DESC NULLS LAST, e.updated_at DESC, e.id, image->>'url'
  `);
  const images = new Map(imageRes.rows.map((r: any) => [r.category,
    { url: r.url, entity_id: r.id, entity_name: r.name }]));

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const nodes = new Map<string, PublicCategoryNode>();
  for (const r of rows) {
    if (r.is_group) continue; // grouping nodes are internal-only, never public
    nodes.set(r.slug, {
      image: images.get(r.slug) ?? null,
      slug: r.slug,
      display_name: r.display_name,
      description: r.description ?? null,
      entry_count: r.slug === TRADE_ROUTE_SLUG ? null : (entityCounts.get(r.slug) ?? 0),
      subcategory_count: 0,
      subcategories: [],
      freshness: null,
    });
  }

  const roots: PublicCategoryNode[] = [];
  for (const r of rows) {
    if (r.is_group) continue;
    const node = nodes.get(r.slug)!;
    const parent = r.parent_slug ? bySlug.get(r.parent_slug) : undefined;
    // A group parent (or no parent) means this leaf IS a public top-level
    // category. Only a non-group parent makes it a real nested subcategory.
    if (parent && !parent.is_group) {
      nodes.get(parent.slug)!.subcategories.push(node);
    } else {
      roots.push(node);
    }
  }
  function inheritImage(n: PublicCategoryNode): void {
    for (const child of n.subcategories) inheritImage(child);
    n.subcategory_count = n.subcategories.length;
    n.image ??= n.subcategories.find(child => child.image)?.image ?? null;
  }
  for (const n of roots) inheritImage(n);
  roots.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return roots;
}

async function tradeRouteFreshness(): Promise<{ last_verified: string | null; last_verified_age_minutes: number | null }> {
  // Mirrors GET /v1/trade-routes' own filter (status='confirmed') so the
  // freshness shown here matches what a visitor actually sees on that listing.
  const res = await query(
    `SELECT max(last_verified) AS lv FROM trade_route_submissions WHERE status = 'confirmed'`,
  );
  const raw = res.rows[0]?.lv;
  if (!raw) return { last_verified: null, last_verified_age_minutes: null };
  const lv = new Date(raw);
  return {
    last_verified: lv.toISOString(),
    last_verified_age_minutes: Math.round((Date.now() - lv.getTime()) / 60000),
  };
}

function withFreshness(list: PublicCategoryNode[], freshness: PublicCategoryNode['freshness']): PublicCategoryNode[] {
  return list.map((n) => ({
    ...n,
    freshness: n.slug === TRADE_ROUTE_SLUG ? freshness : n.freshness,
    subcategories: withFreshness(n.subcategories, freshness),
  }));
}

let cache: { at: number; tree: PublicCategoryNode[] } | null = null;

export async function getPublicCategories(): Promise<PublicCategoryNode[]> {
  const ttlMs = config.api.categoriesCacheTtlSec * 1000;
  const now = Date.now();
  if (!cache || now - cache.at > ttlMs) {
    cache = { at: now, tree: await buildTree() };
  }
  const freshness = await tradeRouteFreshness();
  return withFreshness(cache.tree, freshness);
}
