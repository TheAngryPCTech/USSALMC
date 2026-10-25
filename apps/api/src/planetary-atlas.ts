// Read-only spatial projection. No positions are inferred from entity names,
// prose or generic x/y/z fields (which may be galactic, not surface coordinates).
import { query } from "./db.js";
export interface AtlasRecord {
  id: string;
  name: string;
  type: string;
  summary: string | null;
  attributes: Record<string, any>;
  relations: { type: string; target_id: string }[];
  images: any;
  source: any;
  game_version: string | null;
}
export type AtlasKind = "system" | "planet" | "moon" | "body" | "location";
export interface AtlasPlace {
  id: string;
  name: string;
  kind: AtlasKind;
  parent_id: string | null;
  body_id: string | null;
  system_id: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  image: { url: string; caption: string | null } | null;
  summary: string | null;
  services: string[];
  confidence: string | null;
  game_version: string | null;
  source: {
    origin: string | null;
    url: string | null;
    last_verified: string | null;
  };
  hierarchy_source:
    "knowledge_base" | "stanton_reference" | "pyro_reference" | null;
  reference_only?: boolean;
}
// Complete factual body rosters displayed by the two public survey indexes.
// Names/parentage only: no coordinates, radii, terrain or orbital data copied.
const REFERENCE_SYSTEMS = [
  {
    name: "Stanton",
    key: "stanton",
    planets: [
      {
        name: "Hurston",
        aliases: [],
        moons: ["Arial", "Aberdeen", "Magda", "Ita"],
      },
      { name: "Crusader", aliases: [], moons: ["Cellin", "Daymar", "Yela"] },
      {
        name: "ArcCorp",
        aliases: ["ArcCorp (planet)"],
        moons: ["Lyria", "Wala"],
      },
      {
        name: "microTech",
        aliases: ["MicroTech (planet)"],
        moons: ["Calliope", "Clio", "Euterpe"],
      },
    ],
  },
  {
    name: "Pyro",
    key: "pyro",
    planets: [
      { name: "Pyro I", aliases: [], moons: [] },
      { name: "Monox", aliases: ["Pyro II", "Monox (planet)"], moons: [] },
      { name: "Bloom", aliases: ["Pyro III", "Bloom (planet)"], moons: [] },
      {
        name: "Pyro V",
        aliases: [],
        moons: ["Ignis", "Vatra", "Adir", "Fairo", "Fuego", "Vuur", "Pyro IV"],
      },
      {
        name: "Terminus",
        aliases: ["Pyro VI", "Terminus (planet)"],
        moons: [],
      },
    ],
  },
];
function number(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    !(
      typeof value === "string" &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
    )
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function image(images: any): AtlasPlace["image"] {
  if (!Array.isArray(images)) return null;
  const valid = images.filter((i) => {
    if (typeof i?.url !== "string") return false;
    try {
      const u = new URL(i.url);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  });
  const chosen = valid.find((i) => i.role === "primary") ?? valid[0];
  return chosen
    ? {
        url: chosen.url,
        caption: typeof chosen.caption === "string" ? chosen.caption : null,
      }
    : null;
}
export function projectPlanetaryAtlas(rows: AtlasRecord[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byName = new Map<string, AtlasRecord[]>();
  for (const r of rows) {
    const name = r.name.trim().toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), r]);
  }
  const referenceNames = new Map<string, string>();
  // An ambiguous name is never resolved to the first match.
  function resolve(v: unknown): string | null {
    if (typeof v !== "string" || !v.trim()) return null;
    if (byId.has(v)) return v;
    const named = byName.get(v.trim().toLowerCase());
    return named?.length === 1
      ? named[0].id
      : named?.length
        ? null
        : (referenceNames.get(v.trim().toLowerCase()) ?? null);
  }
  const nodes: AtlasPlace[] = rows.map((r) => {
    const a =
      r.attributes && typeof r.attributes === "object" ? r.attributes : {};
    const rawKind = String(a.atlas_kind ?? a.body_type ?? a.type ?? "")
      .toLowerCase()
      .trim();
    let kind: AtlasKind =
      a.category === "star_system" || rawKind === "system"
        ? "system"
        : a.category === "planet" || rawKind === "planet"
          ? "planet"
          : a.category === "moon" ||
              ["moon", "natural satellite"].includes(rawKind)
            ? "moon"
            : rawKind === "body"
              ? "body"
              : "location";
    let parent = resolve(
      a.parent_entity_id ??
        a.parent_id ??
        a.body_entity_id ??
        a.body_id ??
        a.planet_entity_id ??
        a.moon ??
        a.planet ??
        a.celestial_body,
    );
    if (!parent)
      for (const rel of Array.isArray(r.relations) ? r.relations : []) {
        if (
          ["located_in", "part_of", "orbits"].includes(rel.type) &&
          byId.has(rel.target_id)
        ) {
          parent = rel.target_id;
          break;
        }
      }
    // The wiki importer has an explicit "Stanton system — On Arial" field.
    // Match its entire recorded body name, not arbitrary words from prose.
    if (!parent && typeof a.location === "string") {
      const m = a.location.match(/^(.+?)\s+[—–]\s+On\s+(.+)$/i);
      if (m) parent = resolve(m[2]);
    }
    let system = resolve(a.star_system_id ?? a.star_system ?? a.system_id);
    const coord = a.surface_coordinates ?? a.coordinates;
    const lat = number(coord?.latitude ?? coord?.lat ?? a.latitude);
    const lon = number(coord?.longitude ?? coord?.lon ?? a.longitude);
    const units = coord?.units ?? a.coordinate_units;
    const coordinates =
      lat !== null &&
      lon !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      (!units || units === "degrees")
        ? { latitude: lat, longitude: lon }
        : null;
    const services = new Set<string>();
    const allowed = [
      "trading",
      "mining",
      "refinery",
      "refueling",
      "repair",
      "restock",
      "medical",
      "habitation",
    ];
    for (const key of allowed) {
      const value = a.services?.[key] ?? a[key] ?? a["has_" + key];
      if (
        value === true ||
        value === 1 ||
        (typeof value === "string" &&
          ["yes", "true"].includes(value.toLowerCase()))
      )
        services.add(key);
    }
    if (Array.isArray(a.services))
      for (const key of a.services)
        if (allowed.includes(key)) services.add(key);
    const src = r.source ?? {};
    return {
      id: r.id,
      name: r.name,
      kind,
      parent_id: parent === r.id ? null : parent,
      body_id: null,
      system_id: system === r.id ? null : system,
      coordinates,
      image: image(r.images),
      summary: typeof r.summary === "string" ? r.summary : null,
      services: [...services],
      confidence: typeof src.confidence === "string" ? src.confidence : null,
      game_version: r.game_version ?? null,
      source: {
        origin: src.hidden ? null : (src.origin ?? null),
        url: src.hidden ? null : (src.url ?? null),
        last_verified: src.last_verified ?? null,
      },
      hierarchy_source: parent || system ? "knowledge_base" : null,
    };
  });
  // Reference-only nodes fill missing catalogue entries without pretending
  // that a KB article or a survey position exists for them.
  for (const catalogue of REFERENCE_SYSTEMS) {
    const sourceUrl = `https://survey.cstone.space/Systems/${catalogue.name}/`;
    const hierarchy = `${catalogue.key}_reference` as
      "stanton_reference" | "pyro_reference";
    function ensure(
      name: string,
      kind: AtlasKind,
      parentId: string | null,
      systemId: string | null,
      aliases: string[] = [],
    ) {
      const resolved = [name, ...aliases].map(resolve).find(Boolean);
      let node = resolved ? nodes.find((n) => n.id === resolved) : undefined;
      if (!node) {
        let id = `atlas_reference_${catalogue.key}_${kind === "system" ? "root" : name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
        // Preserve the existing public reference ID for backwards-compatible links.
        if (kind === "system") id = `atlas_reference_${catalogue.key}`;
        while (nodes.some((n) => n.id === id)) id += "_ref";
        node = {
          id,
          name,
          kind,
          parent_id: parentId,
          body_id: null,
          system_id: systemId,
          coordinates: null,
          image: null,
          summary: null,
          services: [],
          confidence: null,
          game_version: null,
          source: {
            origin: `${catalogue.name} reference body catalogue`,
            url: sourceUrl,
            last_verified: null,
          },
          hierarchy_source: hierarchy,
          reference_only: true,
        };
        nodes.push(node);
      } else {
        node.kind = kind;
        if (!node.parent_id && parentId) {
          node.parent_id = parentId;
          node.hierarchy_source = hierarchy;
        }
        node.system_id ??= systemId;
      }
      for (const label of [name, ...aliases])
        referenceNames.set(label.toLowerCase(), node.id);
      return node;
    }
    const system = ensure(catalogue.name, "system", null, null);
    for (const planet of catalogue.planets) {
      const p = ensure(
        planet.name,
        "planet",
        system.id,
        system.id,
        planet.aliases,
      );
      for (const name of planet.moons) ensure(name, "moon", p.id, system.id);
    }
  }
  // Resolve explicit references again now that missing named worlds exist.
  for (const node of nodes) {
    const original = byId.get(node.id);
    if (!original) continue;
    const a = original.attributes ?? {};
    if (!node.parent_id) {
      let parent = resolve(
        a.parent_entity_id ??
          a.parent_id ??
          a.body_entity_id ??
          a.body_id ??
          a.planet_entity_id ??
          a.moon ??
          a.planet ??
          a.celestial_body,
      );
      if (!parent && typeof a.location === "string") {
        const match = a.location.match(/^(.+?)\s+[—–]\s+On\s+(.+)$/i);
        if (match) parent = resolve(match[2]);
      }
      if (parent && parent !== node.id) {
        node.parent_id = parent;
        node.hierarchy_source = "knowledge_base";
      }
    }
    node.system_id ??= resolve(
      a.star_system_id ?? a.star_system ?? a.system_id,
    );
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    let current: AtlasPlace | undefined = n;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!n.body_id && ["planet", "moon", "body"].includes(current.kind))
        n.body_id = current.id;
      if (current.kind === "system") {
        n.system_id = current.id;
        break;
      }
      current = current.parent_id ? nodeById.get(current.parent_id) : undefined;
    }
    if (n.system_id && nodeById.get(n.system_id)?.kind !== "system")
      n.system_id = null;
  }
  return nodes;
}
export async function getPlanetaryAtlas() {
  const result =
    await query<AtlasRecord>(`SELECT id,name,type,summary,attributes,relations,images,source,game_version
    FROM entities WHERE status <> 'removed' AND (type='location' OR attributes->>'category' IN ('star_system','planet','moon'))
    ORDER BY name,id LIMIT 10001`);
  const truncated = result.rows.length > 10000;
  const nodes = projectPlanetaryAtlas(result.rows.slice(0, 10000));
  return {
    nodes,
    truncated,
    coordinate_convention:
      "latitude/longitude in degrees; north positive; east positive",
    geometry: "schematic",
    terrain: "illustrative",
    reference_hierarchy_url: "https://survey.cstone.space/Systems/Stanton/",
    reference_hierarchy_urls: REFERENCE_SYSTEMS.map(
      (s) => `https://survey.cstone.space/Systems/${s.name}/`,
    ),
  };
}
