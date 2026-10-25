// Pure model functions shared by the UI and regression tests.
export const isBody = (n) => ["planet", "moon", "body"].includes(n?.kind);
export function ancestors(node, byId) {
  const chain = [],
    seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    chain.unshift(node);
    node = byId.get(node.parent_id);
  }
  return chain;
}
export function surfacePoint(coordinates, radius = 2.04) {
  const { latitude, longitude } = coordinates || {};
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const lat = (latitude * Math.PI) / 180,
    lon = (longitude * Math.PI) / 180;
  return [
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon),
  ];
}
export function filterPlaces(
  nodes,
  { bodyId, all = false, term = "", service = "" },
) {
  const needle = term.trim().toLocaleLowerCase();
  return nodes.filter(
    (n) =>
      n.kind === "location" &&
      (all || n.body_id === bodyId) &&
      (!needle || n.name.toLocaleLowerCase().includes(needle)) &&
      (!service || n.services.includes(service)),
  );
}
