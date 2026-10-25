import test from "node:test";
import assert from "node:assert/strict";
import {
  ancestors,
  filterPlaces,
  surfacePoint,
} from "../assets/js/planetary-model.js";
test("surface points use north/east positive degrees and accept zero", () => {
  assert.deepEqual(surfacePoint({ latitude: 0, longitude: 0 }, 2), [0, 0, 2]);
  assert.ok(
    Math.abs(surfacePoint({ latitude: 90, longitude: 0 }, 2)[1] - 2) < 1e-8,
  );
  assert.ok(
    Math.abs(surfacePoint({ latitude: 0, longitude: 90 }, 2)[0] - 2) < 1e-8,
  );
  for (const coordinates of [
    null,
    {},
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: NaN },
    { latitude: "0", longitude: 0 },
  ])
    assert.equal(surfacePoint(coordinates), null);
});
test("the full ancestry is retained and cycles terminate", () => {
  const nodes = [
    { id: "stanton", name: "Stanton" },
    { id: "hurston", name: "Hurston", parent_id: "stanton" },
    { id: "arial", name: "Arial", parent_id: "hurston" },
    { id: "bezdek", name: "HDMS-Bezdek", parent_id: "arial" },
  ];
  assert.deepEqual(
    ancestors(nodes[3], new Map(nodes.map((n) => [n.id, n]))).map(
      (n) => n.name,
    ),
    ["Stanton", "Hurston", "Arial", "HDMS-Bezdek"],
  );
  assert.equal(
    ancestors(
      { id: "a", parent_id: "a" },
      new Map([["a", { id: "a", parent_id: "a" }]]),
    ).length,
    1,
  );
});
test("body/search/service filters never turn unknown services into recorded services", () => {
  const nodes = [
    {
      id: "a",
      kind: "location",
      name: "HDMS-Bezdek",
      body_id: "arial",
      services: ["trading"],
    },
    {
      id: "b",
      kind: "location",
      name: "Unassigned",
      body_id: null,
      services: [],
    },
    { id: "world", kind: "moon", name: "Arial", services: [] },
  ];
  assert.deepEqual(
    filterPlaces(nodes, {
      bodyId: "arial",
      term: "bez",
      service: "trading",
    }).map((n) => n.id),
    ["a"],
  );
  assert.equal(filterPlaces(nodes, { bodyId: "hurston" }).length, 0);
  assert.equal(filterPlaces(nodes, { all: true }).length, 2);
  assert.equal(filterPlaces(nodes, { all: true, service: "mining" }).length, 0);
});
