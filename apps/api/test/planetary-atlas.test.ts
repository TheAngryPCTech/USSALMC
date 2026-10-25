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
test("both complete reference systems exist even when the KB has no body articles", () => {
  const nodes = projectPlanetaryAtlas([]);
  assert.equal(nodes.filter((n) => n.kind === "system").length, 2);
  assert.equal(nodes.filter((n) => n.kind === "planet").length, 9);
  assert.equal(nodes.filter((n) => n.kind === "moon").length, 19);
  const expected = {
    Hurston: ["Arial", "Aberdeen", "Magda", "Ita"],
    Crusader: ["Cellin", "Daymar", "Yela"],
    ArcCorp: ["Lyria", "Wala"],
    microTech: ["Calliope", "Clio", "Euterpe"],
    "Pyro V": ["Ignis", "Vatra", "Adir", "Fairo", "Fuego", "Vuur", "Pyro IV"],
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
