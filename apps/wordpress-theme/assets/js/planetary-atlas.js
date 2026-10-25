import {
  ancestors,
  filterPlaces,
  isBody,
  surfacePoint,
} from "./planetary-model.js";

// The viewer is progressive: list/details/search work before WebGL loads and
// remain usable if rendering is unavailable. Browser never receives an API key.
for (const root of document.querySelectorAll(".planetary-atlas")) {
  const dataTag = root.querySelector("#planetary-data");
  if (!dataTag) continue;
  let data;
  try {
    data = JSON.parse(dataTag.textContent);
  } catch {
    continue;
  }
  const q = (id) => root.querySelector("#planetary-" + id);
  const nodes = data.nodes || [],
    byId = new Map(nodes.map((n) => [n.id, n]));
  const bodies = nodes.filter(isBody),
    // Lagrange-point stations are kind "location" (not a body), but the 3D
    // system view still places them near their planet — same data source
    // as bodies, just not shown as a full satellite sphere.
    systemBodies = nodes.filter((n) => isBody(n) || n.lagrange_point),
    // Lore-only starmap entries (not yet flyable/landable in the live game)
    // are kept in the KB/search but never offered as an explorable system.
    systems = nodes.filter((n) => n.kind === "system" && n.implemented !== false);
  let body = byId.get(data.body),
    selected = byId.get(data.place),
    mode = "globe",
    limit = 50,
    engine = null,
    rendererError = "";
  if (!isBody(body))
    body =
      byId.get(selected?.body_id) ||
      bodies.find((n) => n.name.toLowerCase() === "hurston") ||
      bodies[0] ||
      null;
  selected ||= body;
  const text = (element, value) => {
    element.textContent = value;
  };
  const element = (tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) text(el, value);
    return el;
  };
  function path(node) {
    return ancestors(node, byId)
      .map((n) => n.name)
      .join(" / ");
  }
  function kbLink(node) {
    const url = new URL(data.kbUrl, location.href);
    url.searchParams.set("entity", node.id);
    return url.href;
  }
  function safeLink(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
  function setLink(link, url, label) {
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute("href");
    if (label) text(link, label);
  }
  function remember() {
    const url = new URL(location.href);
    url.searchParams.set("tool", "locations");
    ["category", "entity", "q", "view"].forEach((k) =>
      url.searchParams.delete(k),
    );
    if (body) url.searchParams.set("body", body.id);
    else url.searchParams.delete("body");
    if (selected && !selected.reference_only)
      url.searchParams.set("place", selected.id);
    else url.searchParams.delete("place");
    history.replaceState(null, "", url);
  }
  function details(node) {
    if (!node) {
      text(q("place-title"), "Choose a location.");
      text(q("place-path"), "");
      text(q("description"), "Select an entry from the location browser.");
      q("photo").hidden = true;
      q("open").hidden = true;
      text(q("coordinates"), "No position selected");
      text(q("services"), "No service selected");
      text(q("provenance"), "Not yet selected");
      return;
    }
    text(q("place-title"), node.name);
    text(q("place-path"), path(node));
    text(
      q("description"),
      node.summary ||
        (node.reference_only
          ? "Reference catalogue entry. This world has no matching knowledge-base article yet."
          : "No description recorded. Open the knowledge-base entry for its available details."),
    );
    const photo = q("photo"),
      photoUrl = safeLink(node.image?.url);
    photo.hidden = !photoUrl;
    if (photoUrl) {
      photo.src = photoUrl;
      photo.alt = node.image?.caption || node.name;
    }
    photo.onerror = () => {
      photo.hidden = true;
    };
    text(
      q("coordinates"),
      node.coordinates
        ? `${node.coordinates.latitude.toFixed(5)}°, ${node.coordinates.longitude.toFixed(5)}°${node.body_id ? "" : " · body not recorded; not mapped"}`
        : "No surface coordinates recorded",
    );
    text(
      q("services"),
      node.services.length
        ? node.services.map((s) => s[0].toUpperCase() + s.slice(1)).join(" · ")
        : "No service data recorded",
    );
    q("provenance").replaceChildren();
    const origin = node.source?.origin || "Source not recorded";
    const sourceUrl = safeLink(node.source?.url);
    if (sourceUrl) {
      const a = element("a", "", origin);
      a.href = sourceUrl;
      a.rel = "noopener noreferrer";
      q("provenance").append(a);
    } else text(q("provenance"), origin);
    if (node.confidence)
      q("provenance").append(document.createTextNode(` · ${node.confidence}`));
    if (node.source?.last_verified) {
      const date = new Date(node.source.last_verified);
      if (!Number.isNaN(date.getTime()))
        q("provenance").append(
          document.createTextNode(
            ` · verified ${date.toISOString().slice(0, 10)}`,
          ),
        );
    }
    setLink(q("open"), node.reference_only ? null : kbLink(node));
    text(
      q("live-status"),
      `${node.name}. ${node.coordinates && node.body_id ? "Recorded surface position available." : "No mapped surface position."}`,
    );
  }
  function filtered() {
    return filterPlaces(nodes, {
      bodyId: body?.id,
      all: q("all").checked,
      term: q("search").value,
      service: q("service").value,
    });
  }
  function markers() {
    const candidates = filterPlaces(nodes, {
      bodyId: body?.id,
      term: q("search").value,
      service: q("service").value,
    });
    const placed = candidates.filter((n) => surfacePoint(n.coordinates));
    text(
      q("count"),
      `${placed.length} mapped · ${candidates.length - placed.length} without coordinates`,
    );
    engine?.setMarkers(placed, selected?.id);
    const status = q("render-status");
    const message =
      rendererError ||
      (!body
        ? "No classified worlds recorded. Search all locations or use the directory."
        : selected?.kind === "location" && !selected.body_id
          ? `No body recorded for ${selected.name}; the globe remains on ${body.name}.`
          : mode === "globe" && placed.length === 0
            ? "No recorded surface positions for this selection. Browse the location list instead."
            : "");
    status.hidden = !message;
    text(status, message);
  }
  function list() {
    const matches = filtered();
    q("results").replaceChildren();
    text(
      q("results-title"),
      `${matches.length} LOCATION${matches.length === 1 ? "" : "S"}${q("all").checked ? " / ALL WORLDS" : ""}`,
    );
    for (const node of matches.slice(0, limit)) {
      const wrap = element("div");
      wrap.setAttribute("role", "listitem");
      const button = element(
        "button",
        "place-button" + (node.id === selected?.id ? " active" : ""),
        node.name,
      );
      button.type = "button";
      button.dataset.placeId = node.id;
      button.setAttribute("aria-pressed", String(node.id === selected?.id));
      const mapped = node.body_id && surfacePoint(node.coordinates);
      button.append(
        element(
          "small",
          mapped ? "" : "unplaced",
          mapped
            ? path(byId.get(node.body_id))
            : node.body_id
              ? "Surface position not recorded"
              : "Body not recorded",
        ),
      );
      button.addEventListener("click", () => select(node));
      wrap.append(button);
      q("results").append(wrap);
    }
    if (!matches.length) {
      const message = element(
        "p",
        "map-empty",
        "No matching locations. Try another world, search all locations, or clear the service filter.",
      );
      q("results").append(message);
    }
    q("more").hidden = matches.length <= limit;
    markers();
  }
  // Distance-from-parent order (0 = closest); unordered bodies sort last
  // rather than disappearing or defaulting to 0.
  const orbitOrder = (n) =>
    typeof n.orbit_index === "number" ? n.orbit_index : Infinity;
  function tree() {
    q("tree").replaceChildren();
    const systemId = q("system").value;
    const visible = bodies.filter(
      (n) => (n.system_id || "unassigned") === systemId,
    );
    function add(node, depth) {
      const button = element(
        "button",
        "body-button" +
          (depth ? " moon" : "") +
          (node.id === body?.id ? " active" : ""),
        node.name,
      );
      button.type = "button";
      button.dataset.bodyId = node.id;
      button.setAttribute("aria-pressed", String(node.id === body?.id));
      button.append(
        element(
          "small",
          "",
          (node.kind === "moon"
            ? "Moon"
            : node.kind === "planet"
              ? "Planet"
              : "World") +
            (node.reference_only ? " · reference catalogue" : ""),
        ),
      );
      button.onclick = () => {
        mode = "globe";
        chooseBody(node);
      };
      q("tree").append(button);
      for (const child of visible
        .filter((n) => n.parent_id === node.id)
        .sort((a, b) => orbitOrder(a) - orbitOrder(b)))
        add(child, depth + 1);
    }
    for (const node of visible
      .filter((n) => !visible.some((parent) => parent.id === n.parent_id))
      .sort((a, b) => orbitOrder(a) - orbitOrder(b)))
      add(node, 0);
    if (!visible.length)
      q("tree").append(
        element(
          "p",
          "map-empty",
          "No classified worlds recorded in this system.",
        ),
      );
    const activeButton = q("tree").querySelector('[aria-pressed="true"]');
    if (activeButton)
      q("tree").scrollTop +=
        activeButton.getBoundingClientRect().top -
        q("tree").getBoundingClientRect().top -
        65;
  }
  function worldLabels() {
    text(
      q("path"),
      body
        ? ancestors(body, byId)
            .slice(0, -1)
            .map((n) => n.name)
            .join(" / ") || "SYSTEM NOT RECORDED"
        : "KNOWLEDGE BASE",
    );
    text(
      q("world"),
      mode === "system"
        ? byId.get(q("system").value)?.name || "Unassigned worlds"
        : body?.name || "No world selected",
    );
    text(
      q("geometry"),
      mode === "system"
        ? "SCHEMATIC LAYOUT · NOT TO SCALE"
        : "ILLUSTRATIVE TERRAIN · NOT A NAVIGATIONAL CHART",
    );
    q("globe").setAttribute("aria-pressed", String(mode === "globe"));
    q("system-view").setAttribute("aria-pressed", String(mode === "system"));
  }
  function chooseBody(node, place = null, systemId = null) {
    body = node;
    selected = place || node;
    limit = 50;
    q("system").value = systemId || node?.system_id || "unassigned";
    worldLabels();
    tree();
    details(selected);
    list();
    engine?.setBody(body);
    engine?.setSystem(
      systemBodies.filter(
        (n) => (n.system_id || "unassigned") === q("system").value,
      ),
    );
    engine?.setMode(mode);
    markers();
    remember();
  }
  function select(node) {
    const target = byId.get(node.body_id);
    if (target && target.id !== body?.id) chooseBody(target, node);
    else {
      selected = node;
      details(node);
      list();
      remember();
    }
    if (node.coordinates && target) {
      mode = "globe";
      worldLabels();
      engine?.setMode(mode);
      engine?.focus(node.coordinates);
    }
  }
  const systemOptions = [
    ...systems.map((n) => ({ id: n.id, name: n.name })),
    { id: "unassigned", name: "Unassigned system" },
  ];
  for (const item of systemOptions) {
    const option = element("option", "", item.name);
    option.value = item.id;
    q("system").append(option);
  }
  q("system").value = body?.system_id || "unassigned";
  q("system").onchange = () => {
    const systemId = q("system").value;
    const candidates = bodies.filter(
      (n) => (n.system_id || "unassigned") === systemId,
    );
    mode = "system";
    chooseBody(
      candidates.find((n) => n.kind === "planet") || candidates[0] || null,
      null,
      systemId,
    );
  };
  q("all").checked = !body;
  q("all").onchange = () => {
    limit = 50;
    list();
  };
  q("search").oninput = () => {
    limit = 50;
    list();
  };
  q("service").onchange = () => {
    limit = 50;
    list();
  };
  q("more").onclick = () => {
    limit += 50;
    list();
  };
  for (const name of ["pins", "grid", "orbit"])
    q(name).onchange = () => {
      engine?.setLayers({
        pins: q("pins").checked,
        grid: q("grid").checked,
        orbit: q("orbit").checked,
      });
      markers();
    };
  for (const [id, next] of [
    ["globe", "globe"],
    ["system-view", "system"],
  ])
    q(id).onclick = () => {
      mode = next;
      worldLabels();
      engine?.setMode(mode);
      markers();
    };
  q("zoom-in").onclick = () => engine?.zoom(0.85);
  q("zoom-out").onclick = () => engine?.zoom(1.15);
  q("reset").onclick = () => engine?.reset();
  worldLabels();
  tree();
  details(selected);
  list();
  root.dataset.ready = "true";
  // Lazy module loading keeps Three.js off ordinary pages and list-only
  // users. The query string busts the browser's module cache when this
  // file's own ?ver= (USSALMC_THEME_VERSION) changes, since a dynamic
  // import() has no version string of its own otherwise.
  import(
    "./planetary-renderer.js?v=" +
      encodeURIComponent(
        new URL(import.meta.url).searchParams.get("ver") || "0",
      )
  )
    .then(async ({ createPlanetaryRenderer }) => {
      engine = await createPlanetaryRenderer(q("scene"), q("markers"), {
        select,
        chooseBody: (node) => {
          mode = "globe";
          chooseBody(node);
        },
        contextLost: () => {
          rendererError =
            "3D rendering was interrupted. Reload the page to restore it; location entries remain available in the list.";
          markers();
        },
      });
      engine.setBody(body);
      engine.setSystem(
        systemBodies.filter(
          (n) => (n.system_id || "unassigned") === q("system").value,
        ),
      );
      engine.setMode(mode);
      engine.setLayers({
        pins: q("pins").checked,
        grid: q("grid").checked,
        orbit: q("orbit").checked,
      });
      markers();
      root.dataset.renderer = "ready";
      window.addEventListener("pagehide", () => engine.dispose(), {
        once: true,
      });
    })
    .catch(() => {
      rendererError =
        "3D rendering is unavailable in this browser. You can still search locations, read details, and open KB entries.";
      root.dataset.renderer = "unavailable";
      markers();
    });
}
