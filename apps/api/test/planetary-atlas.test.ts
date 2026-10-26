import test from "node:test";
import assert from "node:assert/strict";
import {
  projectPlanetaryAtlas,
  type AtlasRecord,
} from "../src/planetary-atlas.js";
const row = (
  id: string,
  name: string,
  attributes: Record<string, any> = {},
  extra: Partial<AtlasRecord> = {},
): AtlasRecord => ({
  id,
  name,
  type: "location",
  summary: null,
  attributes,
  relations: [],
  images: [],
  source: {},
  game_version: null,
  ...extra,
});
test("reference parentage places Bezdek on Arial, not Hurston; never invents surface coordinates", () => {
  const nodes = projectPlanetaryAtlas([
    row("hurston", "Hurston"),
    row("arial", "Arial"),
    row("bezdek", "HDMS-Bezdek", { location: "Stanton system — On Arial" }),
  ]);
  const b = nodes.find((n) => n.id === "bezdek")!;
  assert.equal(b.body_id, "arial");
  assert.equal(b.system_id, "atlas_reference_stanton");
  assert.equal(b.coordinates, null);
  assert.equal(nodes.find((n) => n.id === "arial")?.parent_id, "hurston");
});
test("Lagrange stations resolve to their planet via '... from <planet>' phrasing", () => {
  const nodes = projectPlanetaryAtlas([
    row("crusader", "Crusader"),
    row("cru_l1", "CRU-L1 Ambitious Dream Station", {
      location: "Stanton system — Sunward from Crusader",
    }),
    row("cru_l4", "CRU-L4 Shallow Fields Station", {
      location: "Stanton system — -60° from Crusader",
    }),
    row("arc_l3", "ARC-L3 Modern Express Station", {
      location: "Stanton system — 180° from ArcCorp (planet)",
    }),
  ]);
  const l1 = nodes.find((n) => n.id === "cru_l1")!;
  assert.equal(l1.body_id, "crusader");
  assert.equal(l1.system_id, "atlas_reference_stanton");
  assert.equal(l1.lagrange_point, "L1");
  assert.equal(nodes.find((n) => n.id === "cru_l4")?.lagrange_point, "L4");
  const l3 = nodes.find((n) => n.id === "arc_l3")!;
  assert.equal(l3.lagrange_point, "L3");
  // "ArcCorp (planet)" is only a KB alias for the planet; it should still
  // resolve to the real ArcCorp reference node, not go unassigned.
  assert.ok(l3.body_id);
});
test("accepts zero degrees but rejects malformed/out-of-range/radian/galactic coordinates", () => {
  for (const coordinates of [
    { latitude: "", longitude: 0 },
    { latitude: null, longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 1, longitude: 2, units: "radians" },
  ])
    assert.equal(
      projectPlanetaryAtlas([row("a", "A", { coordinates })])[0].coordinates,
      null,
    );
  assert.deepEqual(
    projectPlanetaryAtlas([
      row("a", "A", { coordinates: { latitude: "0", longitude: 0 } }),
    ])[0].coordinates,
    { latitude: 0, longitude: 0 },
  );
  assert.equal(
    projectPlanetaryAtlas([
      row("a", "A", { position: { x: 100, y: 200, z: 300 } }),
    ])[0].coordinates,
    null,
  );
});
test("ambiguous parent names remain unassigned, relation cycles terminate", () => {
  const nodes = projectPlanetaryAtlas([
    row("p1", "Same"),
    row("p2", "Same"),
    row("a", "A", { planet: "Same" }),
    row("b", "B", {}, { relations: [{ type: "located_in", target_id: "c" }] }),
    row("c", "C", {}, { relations: [{ type: "located_in", target_id: "b" }] }),
  ]);
  assert.equal(nodes.find((n) => n.id === "a")?.parent_id, null);
  assert.equal(nodes.find((n) => n.id === "b")?.body_id, null);
});
test("uses explicit hierarchy/services; hides private provenance; validates image types", () => {
  const nodes = projectPlanetaryAtlas([
    row("system", "Example", { category: "star_system" }),
    row("body", "World", { atlas_kind: "planet", parent_id: "system" }),
    row(
      "place",
      "Place",
      {
        body_id: "body",
        latitude: 12,
        longitude: -45,
        services: { trading: true, mining: false },
      },
      {
        source: {
          hidden: true,
          origin: "private",
          url: "https://example.com/private",
          confidence: "community",
        },
        images: [
          { url: 42 },
          { url: "file:///etc/passwd" },
          { url: "https://example.com/gallery.jpg" },
          { url: "https://example.com/primary.jpg", role: "primary" },
        ],
      },
    ),
  ]);
  const n = nodes.find((n) => n.id === "place")!;
  assert.equal(n.body_id, "body");
  assert.equal(n.system_id, "system");
  assert.deepEqual(n.services, ["trading"]);
  assert.equal(n.source.url, null);
  assert.equal(n.source.origin, null);
  assert.equal(n.image?.url, "https://example.com/primary.jpg");
});
test("all complete reference systems exist even when the KB has no body articles", () => {
  const nodes = projectPlanetaryAtlas([]);
  assert.equal(nodes.filter((n) => n.kind === "system").length, 3);
  assert.equal(nodes.filter((n) => n.kind === "planet").length, 10);
  assert.equal(nodes.filter((n) => n.kind === "moon").length, 19);
  const expected = {
    Hurston: ["Arial", "Aberdeen", "Magda", "Ita"],
    Crusader: ["Cellin", "Daymar", "Yela"],
    ArcCorp: ["Lyria", "Wala"],
    microTech: ["Calliope", "Clio", "Euterpe"],
    "Pyro V": ["Ignis", "Vatra", "Adir", "Fairo", "Fuego", "Vuur", "Pyro IV"],
    Delamar: [],
  };
  for (const [name, moons] of Object.entries(expected)) {
    const body = nodes.find((n) => n.name === name)!;
    assert.ok(body);
    assert.deepEqual(
      nodes
        .filter((n) => n.parent_id === body.id)
        .map((n) => n.name)
        .sort(),
      [...moons].sort(),
    );
  }
  for (const node of nodes) {
    assert.equal(node.reference_only, true);
    assert.equal(node.coordinates, null);
  }
});
test("Pyro aliases reuse KB bodies, and locations can attach to reference-only moons", () => {
  const nodes = projectPlanetaryAtlas([
    row("monox_kb", "Pyro II"),
    row("camp", "Example recorded camp", {
      location: "Pyro system — On Fuego",
    }),
  ]);
  assert.equal(nodes.filter((n) => n.id === "monox_kb").length, 1);
  assert.equal(
    nodes.find((n) => n.name === "Monox"),
    undefined,
  );
  assert.equal(
    nodes.find((n) => n.id === "monox_kb")?.system_id,
    "atlas_reference_pyro",
  );
  const fuego = nodes.find((n) => n.name === "Fuego")!;
  assert.equal(nodes.find((n) => n.id === "camp")?.body_id, fuego.id);
  assert.equal(
    nodes.find((n) => n.id === "camp")?.system_id,
    "atlas_reference_pyro",
  );
});
test("reference planets/moons carry a distance-order orbit_index for schematic layout", () => {
  const nodes = projectPlanetaryAtlas([]);
  const hurston = nodes.find((n) => n.name === "Hurston")!;
  const crusader = nodes.find((n) => n.name === "Crusader")!;
  const microTech = nodes.find((n) => n.name === "microTech")!;
  assert.equal(hurston.orbit_index, 0);
  assert.equal(crusader.orbit_index, 1);
  assert.equal(microTech.orbit_index, 3);
  const arial = nodes.find((n) => n.name === "Arial")!;
  const ita = nodes.find((n) => n.name === "Ita")!;
  assert.equal(arial.orbit_index, 0);
  assert.equal(ita.orbit_index, 3);
  const pyroI = nodes.find((n) => n.name === "Pyro I")!;
  const terminus = nodes.find((n) => n.name === "Terminus")!;
  assert.equal(pyroI.orbit_index, 0);
  assert.equal(terminus.orbit_index, 4);
});
test("only Stanton/Pyro/Nyx are implemented; other star-system KB entries are not", () => {
  // Terra is a long-announced, not-yet-live lore system — a stable example
  // of a star-system KB row that should stay unimplemented, unlike Nyx
  // (live since Alpha 4.4, 2025-11-19: jump points to Pyro/Stanton, Delamar
  // and Levski flyable/landable) which is now a REFERENCE_SYSTEMS entry.
  const nodes = projectPlanetaryAtlas([
    row("terra", "Terra", { category: "star_system" }),
    row("nyx", "Nyx", { category: "star_system" }),
  ]);
  assert.equal(nodes.find((n) => n.id === "terra")?.kind, "system");
  assert.equal(nodes.find((n) => n.id === "terra")?.implemented, false);
  assert.equal(nodes.find((n) => n.id === "nyx")?.implemented, true);
  assert.equal(
    nodes.find((n) => n.id === "atlas_reference_stanton")?.implemented,
    true,
  );
  assert.equal(
    nodes.find((n) => n.id === "atlas_reference_pyro")?.implemented,
    true,
  );
});
test("Nyx reference catalogue reuses the existing Delamar KB entry and parents it", () => {
  const nodes = projectPlanetaryAtlas([
    row("location_nyx", "Nyx", { category: "star_system" }),
    row("location_delamar", "Delamar", {}),
  ]);
  const delamar = nodes.find((n) => n.id === "location_delamar")!;
  assert.equal(delamar.kind, "planet");
  assert.equal(delamar.parent_id, "location_nyx");
  assert.equal(delamar.system_id, "location_nyx");
});
