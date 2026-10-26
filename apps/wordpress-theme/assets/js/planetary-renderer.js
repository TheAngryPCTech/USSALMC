import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { surfacePoint } from "./planetary-model.js";

export async function createPlanetaryRenderer(host, markerHost, callbacks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.enableDamping = !matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  controls.minDistance = 3;
  // 95 comfortably exceeds the farthest real system from Stanton at
  // GALAXY_VISUAL_SCALE (measured ~132.9 raw units * 0.65 ≈ 86.4) — far
  // enough to actually reach every one of the ~96 systems, not just the
  // nearby ones, when zoomed all the way out.
  controls.maxDistance = 95;
  scene.add(new THREE.AmbientLight(0x667d9c, 0.7));
  const light = new THREE.DirectionalLight(0xffe4b8, 3.5);
  light.position.set(-4, 4, 5);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0x5a7bb0, 0.9);
  fill.position.set(5, -2, -4);
  scene.add(fill);
  const globe = new THREE.Group(),
    system = new THREE.Group(),
    galaxyGroup = new THREE.Group();
  scene.add(globe, system, galaxyGroup);
  // Soft round glow sprite — reused for the star's halo and any other
  // additive-blended glow, never a copied texture.
  function makeGlowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const glowTexture = makeGlowTexture();
  // Fresnel rim-light shell — a thin glowing edge on a sphere, same trick
  // as the globe-view atmosphere, reused here on every system-view body so
  // small markers read as lit 3D orbs instead of flat matte dots.
  function rimShell(radius, color) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 18),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { color: { value: new THREE.Color(color) } },
        vertexShader:
          "varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}",
        fragmentShader:
          "uniform vec3 color;varying vec3 n;varying vec3 v;void main(){float f=pow(1.-abs(dot(normalize(n),normalize(v))),2.4);gl_FragColor=vec4(color,f*.85);}",
      }),
    );
  }
  // An invisible, larger sphere layered over a visible marker purely so
  // raycasting has a forgiving target to hit — the real geometry stays its
  // documented size.
  function hitProxy(position, radius, node) {
    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    proxy.position.copy(position);
    proxy.userData.node = node;
    return proxy;
  }
  // Procedural decoration only — never a geographically accurate map (same
  // noise field as before; only the per-pixel coloring now varies by a
  // named "archetype" so different worlds read as visually distinct). No
  // game asset, texture or dataset from any source is used here.
  function noiseAt(u, v) {
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const f = 2 ** k;
      n +=
        (Math.sin(
          Math.sin(u) * f * 3.7 +
            Math.cos(v) * f * 4.4 +
            Math.sin(u * 3 + v * 5) * 0.7,
        ) *
          Math.cos(Math.cos(u) * f * 3.3 + Math.sin(v) * f * 5.2)) /
        f;
    }
    return Math.max(0, Math.min(1, (n + 1.5) / 3));
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixColor = (c1, c2, t) => c1.map((c, i) => lerp(c, c2[i], t));
  const ZERO = [0, 0, 0];
  // Each archetype paints a diffuse color and, where the surface would
  // actually glow (city lights, lava), an emissive color on top — rendered
  // through MeshStandardMaterial's real emissiveMap rather than baked-in
  // brightness, plus per-archetype roughness/bump so materials read right
  // (glossy ice, flat glowing city, jagged scorched rock).
  const ARCHETYPES = {
    rocky: {
      roughness: 1,
      bumpScale: 0.05,
      emissiveIntensity: 0,
      // Two-tone biome blend (low/high) plus a smooth continuous shade
      // curve — no hard breakpoint, so there's no visible banding seam.
      paint: (u, v, [low, high]) => {
        const t = noiseAt(u, v);
        const grain = noiseAt(u * 3.3 + 1.7, v * 3.3 + 2.1);
        const base = mixColor(low, high, t);
        const shade = 0.85 + grain * 0.3;
        return { color: base.map((c) => c * shade), emissive: ZERO };
      },
      // Real height field (not derived from color), so the bump map reads
      // as terrain, not color-noise misread as elevation.
      bump: (u, v) => noiseAt(u, v) * 0.7 + noiseAt(u * 3.3 + 1.7, v * 3.3 + 2.1) * 0.3,
    },
    // Banded, swirling cloud layers — Crusader and other gas giants.
    gasGiant: {
      roughness: 0.8,
      bumpScale: 0.008,
      emissiveIntensity: 0,
      paint: (u, v, [low, mid, high]) => {
        const t = noiseAt(u, v);
        const swirl = Math.sin(u * 2 + t * 2.5) * 0.08;
        const band = Math.sin(v * 11 + swirl + t * 3) * 0.5 + 0.5;
        const storm = noiseAt(u * 1.6 + 4, v * 1.6 + 4) > 0.82 ? 1 : 0;
        const base = mixColor(low, high, band * 0.7 + t * 0.3);
        return { color: storm ? mixColor(base, mid, 0.6) : base, emissive: ZERO };
      },
      bump: (u, v) => {
        const t = noiseAt(u, v);
        return Math.sin(v * 11 + t * 3) * 0.5 + 0.5;
      },
    },
    // ArcCorp: one unbroken megacity pole to pole — every block is built up
    // and lit, nothing reads as empty ground, warm amber smog-haze glow.
    urban: {
      roughness: 0.5,
      bumpScale: 0.01,
      emissiveIntensity: 1.3,
      paint: (u, v, [base, light]) => {
        const cols = 70,
          rows = 36;
        const cx = Math.floor(((u / (Math.PI * 2)) * cols) % cols),
          cy = Math.floor(((v / Math.PI) * rows) % rows);
        const blockHash =
          Math.abs(Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453) % 1;
        const t = noiseAt(u, v);
        const gx = (((u * cols) % 1) + 1) % 1,
          gy = (((v * rows) % 1) + 1) % 1;
        const street = gx < 0.1 || gy < 0.1 ? 1 : 0;
        const density = 0.45 + blockHash * 0.4 + t * 0.15;
        const glow = Math.min(1, Math.max(density, street * 0.95));
        return {
          color: mixColor(base, light, glow),
          emissive: light.map((c) => (c / 255) * glow),
        };
      },
      // Buildings are slightly raised blocks, streets are flat channels.
      bump: (u, v) => {
        const cols = 70,
          rows = 36;
        const gx = (((u * cols) % 1) + 1) % 1,
          gy = (((v * rows) % 1) + 1) % 1;
        return gx < 0.1 || gy < 0.1 ? 0.2 : 0.8;
      },
    },
    // Bright, flat ice sheets with fine pale crevasse lines — microTech.
    icy: {
      roughness: 0.3,
      bumpScale: 0.018,
      emissiveIntensity: 0,
      paint: (u, v, [low, high]) => {
        const t = noiseAt(u, v);
        const crack = Math.abs(Math.sin(u * 24 + t * 6)) < 0.03 ? 0.25 : 0;
        return {
          color: mixColor(low, high, Math.min(1, t * 0.7 + 0.3 + crack)),
          emissive: ZERO,
        };
      },
      bump: (u, v) => {
        const t = noiseAt(u, v);
        const crack = Math.abs(Math.sin(u * 24 + t * 6)) < 0.03 ? 1 : 0;
        return Math.max(0.5 + t * 0.4, crack);
      },
    },
    // Scorched rock with a glowing lava-fracture network — Pyro's bodies.
    volcanic: {
      roughness: 0.95,
      bumpScale: 0.06,
      emissiveIntensity: 1.8,
      paint: (u, v, [base, glow]) => {
        const t = noiseAt(u, v);
        const vein = Math.abs(noiseAt(u * 6 + 9, v * 6 + 9) - 0.5);
        const fracture = Math.max(
          t > 0.62 ? (t - 0.62) / 0.38 : 0,
          vein < 0.03 ? 1 - vein / 0.03 : 0,
        );
        return {
          color: mixColor(base.map((c) => c * (0.25 + t * 0.3)), glow, fracture),
          emissive: glow.map((c) => (c / 255) * fracture),
        };
      },
      bump: (u, v) => {
        const t = noiseAt(u, v);
        const vein = Math.abs(noiseAt(u * 6 + 9, v * 6 + 9) - 0.5);
        return Math.max(t, vein < 0.03 ? 1 - vein / 0.03 : 0);
      },
    },
  };
  // Name match is cosmetic only — never used to infer any factual data.
  // Palettes tuned from dominant-color statistics sampled off reference
  // imagery (colors/characteristics only, no texture pixels used or
  // stored) — see CLAUDE.md Decisions Log, 2026-10-25.
  const PLANET_LOOK = [
    [/hurston/i, "rocky", [[70, 45, 46], [150, 120, 85]], { ruggedness: 1 }],
    [/crusader/i, "gasGiant", [[150, 120, 120], [185, 165, 160], [214, 205, 190]], { roughness: 0.75 }],
    [/arccorp/i, "urban", [[42, 36, 44], [255, 205, 145]], {}],
    [/microtech/i, "icy", [[90, 115, 145], [246, 249, 252]], { roughness: 0.22, specular: true }],
    [/^pyro i$/i, "volcanic", [[30, 34, 40], [255, 120, 55]], { ruggedness: 1 }],
    [/monox|pyro ii/i, "gasGiant", [[70, 42, 36], [120, 66, 52], [150, 96, 76]], { roughness: 0.8 }],
    [/bloom|pyro iii/i, "rocky", [[40, 40, 42], [232, 233, 235]], { ruggedness: 0.85, specular: true }],
    [/pyro v$/i, "rocky", [[90, 108, 55], [172, 196, 112]], { ruggedness: 0.7 }],
    [/terminus|pyro vi/i, "icy", [[78, 86, 84], [150, 158, 155]], { roughness: 0.4 }],
  ];
  function lookFor(name) {
    for (const [pattern, archetype, palette, traits] of PLANET_LOOK)
      if (pattern.test(name)) return { archetype, palette, traits: traits || {} };
    // Unlisted bodies (moons, anything else) stay a neutral rocky grey —
    // same fallback the single shared texture used to give everyone.
    return { archetype: "rocky", palette: [[110, 110, 115], [185, 185, 190]], traits: {} };
  }
  const textureCache = new Map();
  function texturesFor(name) {
    const { archetype, palette, traits } = lookFor(name);
    const cacheKey = archetype + ":" + JSON.stringify(palette) + ":" + JSON.stringify(traits);
    const cached = textureCache.get(cacheKey);
    if (cached) return cached;
    const config = ARCHETYPES[archetype];
    const W = 1024,
      H = 512;
    const diffuseCanvas = document.createElement("canvas"),
      emissiveCanvas = document.createElement("canvas"),
      bumpCanvas = document.createElement("canvas");
    diffuseCanvas.width = emissiveCanvas.width = bumpCanvas.width = W;
    diffuseCanvas.height = emissiveCanvas.height = bumpCanvas.height = H;
    const dCtx = diffuseCanvas.getContext("2d"),
      eCtx = emissiveCanvas.getContext("2d"),
      bCtx = bumpCanvas.getContext("2d");
    const dPixels = dCtx.createImageData(W, H),
      ePixels = eCtx.createImageData(W, H),
      bPixels = bCtx.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = (x / W) * Math.PI * 2,
          v = (y / H) * Math.PI;
        let { color, emissive } = config.paint(u, v, palette);
        let height = Math.max(0, Math.min(1, config.bump(u, v, palette)));
        // Every longitude line meets at the poles, so a longitude-dependent
        // pattern spirals into a tight swirl there (every u value crowding
        // into one point). Blend toward a fixed-longitude "cap" sample in a
        // thin band near each pole so it converges to one flat value
        // instead of a pinwheel.
        const poleFade = Math.min(1, Math.sin(v) / 0.12);
        if (poleFade < 1) {
          const cap = config.paint(0, v, palette);
          color = mixColor(color, cap.color, poleFade);
          emissive = mixColor(emissive, cap.emissive, poleFade);
          const capHeight = Math.max(0, Math.min(1, config.bump(0, v, palette)));
          height = Math.max(0, Math.min(1, lerp(capHeight, height, poleFade)));
        }
        const i = (y * W + x) * 4;
        dPixels.data[i] = color[0];
        dPixels.data[i + 1] = color[1];
        dPixels.data[i + 2] = color[2];
        dPixels.data[i + 3] = 255;
        ePixels.data[i] = emissive[0] * 255;
        ePixels.data[i + 1] = emissive[1] * 255;
        ePixels.data[i + 2] = emissive[2] * 255;
        ePixels.data[i + 3] = 255;
        const h = height * 255;
        bPixels.data[i] = h;
        bPixels.data[i + 1] = h;
        bPixels.data[i + 2] = h;
        bPixels.data[i + 3] = 255;
      }
    dCtx.putImageData(dPixels, 0, 0);
    eCtx.putImageData(ePixels, 0, 0);
    bCtx.putImageData(bPixels, 0, 0);
    const map = new THREE.CanvasTexture(diffuseCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    // Height data must stay linear — tagging it sRGB would gamma-skew the
    // bump slope and exaggerate exactly the "noisy garbage" look this is
    // meant to fix.
    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    // Per-body 3D-mapping traits (ruggedness/roughness/specular) sourced
    // from reference-image statistics only — never the image pixels
    // themselves. See CLAUDE.md Decisions Log, 2026-10-25.
    const result = {
      map,
      emissiveMap,
      bumpMap,
      roughness: traits.roughness ?? config.roughness,
      bumpScale: config.bumpScale * (traits.ruggedness ?? 1),
      emissiveIntensity: config.emissiveIntensity,
      specular: !!traits.specular,
    };
    textureCache.set(cacheKey, result);
    return result;
  }
  const sphereGeometry = new THREE.SphereGeometry(2, 160, 110);
  const initial = texturesFor("");
  const material = new THREE.MeshStandardMaterial({
    map: initial.map,
    bumpMap: initial.bumpMap,
    bumpScale: initial.bumpScale,
    roughness: initial.roughness,
    emissiveMap: initial.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: initial.emissiveIntensity,
  });
  const planet = new THREE.Mesh(sphereGeometry, material);
  globe.add(planet);
  const grid = new THREE.Mesh(
    new THREE.SphereGeometry(2.012, 36, 18),
    new THREE.MeshBasicMaterial({
      color: 0x89acc5,
      wireframe: true,
      transparent: true,
      opacity: 0.075,
    }),
  );
  globe.add(grid);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.055, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        "varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}",
      fragmentShader:
        "varying vec3 n;varying vec3 v;void main(){float f=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(.25,.48,.75,f*.38);}",
    }),
  );
  globe.add(atmosphere);
  const circle = (radius) =>
    new THREE.BufferGeometry().setFromPoints(
      Array.from(
        { length: 121 },
        (_, i) =>
          new THREE.Vector3(
            Math.cos((i / 120) * Math.PI * 2) * radius,
            0,
            Math.sin((i / 120) * Math.PI * 2) * radius,
          ),
      ),
    );
  const orbit = new THREE.LineLoop(
    circle(2.65),
    new THREE.LineBasicMaterial({
      color: 0x44678d,
      transparent: true,
      opacity: 0.35,
    }),
  );
  orbit.rotation.z = 0.28;
  globe.add(orbit);
  let seed = 17;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const starGeometry = new THREE.BufferGeometry(),
    positions = [],
    starColors = [];
  const STAR_TINTS = [
    [0.86, 0.91, 1],
    [1, 0.94, 0.85],
    [0.75, 0.84, 1],
    [1, 1, 1],
  ];
  for (let i = 0; i < 650; i++) {
    positions.push(
      (random() - 0.5) * 90,
      (random() - 0.5) * 70,
      -12 - random() * 70,
    );
    const tint = STAR_TINTS[Math.floor(random() * STAR_TINTS.length)];
    const flicker = 0.55 + random() * 0.45;
    starColors.push(tint[0] * flicker, tint[1] * flicker, tint[2] * flicker);
  }
  starGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  starGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(starColors, 3),
  );
  scene.add(
    new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        map: glowTexture,
        vertexColors: true,
        size: 0.06,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  let mode = "globe",
    body = null,
    entries = [],
    selectedId,
    layers = { pins: true, grid: true, orbit: true },
    markers = [],
    systemLabels = [],
    allNodes = [],
    moonOrbiters = [],
    planetOrbiters = [],
    moonClock = 0,
    galaxyPoints = [],
    disposed = false,
    frame;
  // Beyond this camera distance (within system mode), the galaxy group
  // fades in — "zoomed out far enough" per the user's request.
  // Must stay comfortably above the largest possible initial system-view
  // camera distance (reset() clamps to systemMaxRadius*1.7+2, and
  // VISUAL_MAX_RADIUS=14 means systemMaxRadius can itself reach 14, i.e.
  // ~25.8) — otherwise the galaxy would appear immediately on entering a
  // system instead of only once the user deliberately zooms out further.
  const GALAXY_REVEAL_DISTANCE = 30,
    // 0.65 fits the farthest real system (~132.9 raw units from Stanton,
    // measured live) inside controls.maxDistance (95) with margin to
    // spare — 1.2 would have needed maxDistance ~160+ to ever reach it.
    GALAXY_VISUAL_SCALE = 0.65;
  const moonOrbitGroup = new THREE.Group();
  globe.add(moonOrbitGroup);
  const MOON_VIEW_ORBIT_BASE = 2.9,
    MOON_VIEW_ORBIT_STEP = 0.55;
  // Rebuilds the moons orbiting the currently zoomed-in planet (globe
  // view) — schematic positions/speed, same non-navigational spirit as the
  // system view's orbital diagram. Clicking a moon here drills into it,
  // same as clicking one in the system view.
  function rebuildMoons(planetNode) {
    while (moonOrbitGroup.children.length) {
      const child = moonOrbitGroup.children[0];
      moonOrbitGroup.remove(child);
      cleanObject(child);
    }
    moonOrbiters.forEach((m) => m.el.remove());
    moonOrbiters = [];
    if (!planetNode) return;
    const moons = allNodes
      .filter((n) => n.parent_id === planetNode.id && n.kind === "moon")
      .map((node, i) => ({
        node,
        order: typeof node.orbit_index === "number" ? node.orbit_index : i,
      }))
      .sort((a, b) => a.order - b.order);
    moons.forEach(({ node, order }, i) => {
      const radius = MOON_VIEW_ORBIT_BASE + order * MOON_VIEW_ORBIT_STEP;
      const ring = new THREE.LineLoop(
        circle(radius),
        new THREE.LineBasicMaterial({
          color: 0x44678d,
          transparent: true,
          opacity: 0.25,
        }),
      );
      moonOrbitGroup.add(ring);
      const startAngle = i * 2.399963;
      const startPos = new THREE.Vector3(
        Math.cos(startAngle) * radius,
        0,
        Math.sin(startAngle) * radius,
      );
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 24, 18),
        new THREE.MeshStandardMaterial({ color: 0x8298b1, roughness: 1 }),
      );
      mesh.position.copy(startPos);
      mesh.userData.node = node;
      moonOrbitGroup.add(mesh);
      const hit = hitProxy(startPos, 0.22 * 2.2, node);
      moonOrbitGroup.add(hit);
      const rim = rimShell(0.24, 0x8fc4ff);
      rim.position.copy(startPos);
      moonOrbitGroup.add(rim);
      const el = button(node);
      el.onclick = () => callbacks.chooseBody(node);
      moonOrbiters.push({
        node,
        mesh,
        rim,
        hit,
        el,
        radius,
        angle: startAngle,
        speed: 0.12 + order * 0.015,
      });
    });
  }
  function button(node, selected = false) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "map-marker" + (selected ? " selected" : "");
    // Lagrange station labels show just the short code (e.g. "CRU-L1") —
    // the full name ("CRU-L1 Ambitious Dream Station") made the system
    // view's labels badly cluttered with every planet having up to 5.
    // Full name stays in aria-label for screen readers.
    const codeMatch = node.lagrange_point && node.name.match(/^(\S+-L[1-5])\b/);
    el.textContent = codeMatch ? codeMatch[1] : node.name;
    el.setAttribute("aria-label", "Select " + node.name);
    markerHost.append(el);
    return el;
  }
  function rebuildMarkers() {
    markers.forEach((m) => m.el.remove());
    markers = [];
    for (const node of entries) {
      const position = surfacePoint(node.coordinates);
      if (!position) continue;
      const el = button(node, node.id === selectedId);
      el.onclick = () => callbacks.select(node);
      markers.push({ node, el, position: new THREE.Vector3(...position) });
    }
  }
  function reset() {
    const systemDistance = Math.min(
      controls.maxDistance,
      systemMaxRadius * 1.7 + 2,
    );
    camera.position.set(0, 0.2, mode === "system" ? systemDistance : 7.6);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  function setMode(next) {
    mode = next;
    globe.visible = mode === "globe" && !!body;
    system.visible = mode === "system";
    reset();
  }
  function cleanObject(object) {
    object.traverse((o) => {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    });
  }
  // Schematic orbital diagram (cstone.space-style concentric rings), not a
  // navigationally accurate simulation: every body sits on its own ring,
  // spaced by its known distance ORDER (orbit_index), not a measured
  // distance. No third-party survey coordinates/scale are used.
  const STAR_ORBIT_BASE = 1.9,
    STAR_ORBIT_STEP = 1.55,
    MOON_ORBIT_BASE = 0.55,
    MOON_ORBIT_STEP = 0.3;
  function orderIndex(node, i) {
    return typeof node.orbit_index === "number" ? node.orbit_index : i;
  }
  let systemMaxRadius = STAR_ORBIT_BASE;
  function setSystem(nodes) {
    allNodes = nodes;
    while (system.children.length) {
      const child = system.children[0];
      system.remove(child);
      cleanObject(child);
    }
    systemLabels.forEach((l) => l.el.remove());
    systemLabels = [];
    planetOrbiters = [];
    systemMaxRadius = STAR_ORBIT_BASE;
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffdca8 }),
    );
    system.add(star);
    const starHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    starHalo.scale.set(2.4, 2.4, 1);
    system.add(starHalo);
    system.add(new THREE.PointLight(0xffe4b8, 6, 30));
    // Real relative scale/position, where we actually have it (Stanton:
    // one-time NAS import; Pyro: live 30-min sheet sync — both verified,
    // neither invented). Falls back to the schematic golden-angle rings
    // per-body wherever real_position_km is absent (e.g. Nyx's Delamar, or
    // any lore-only system). See CLAUDE.md Decisions Log, 2026-10-25.
    //
    // Two independent scales, not one: planet-to-star and moon-to-planet
    // distances differ by 3+ orders of magnitude in real km (Pyro's
    // innermost 3 planets are only ~13-28M km apart while Terminus sits
    // ~68M km out; a moon sits only tens of thousands of km from its
    // planet). One linear scale across both tiers either crushes the
    // close-together inner planets into overlapping click targets or
    // collapses every moon onto its planet. Real RELATIVE position is
    // preserved within each tier — this only decouples how far apart the
    // two tiers render, the same way every real orbital diagram does.
    const VISUAL_MAX_RADIUS = 14,
      MOON_VISUAL_MAX_RADIUS = 1.1;
    const realDistances = nodes
      .filter((n) => n.real_position_km)
      .map((n) => Math.hypot(n.real_position_km.x, n.real_position_km.y));
    const realScale = realDistances.length
      ? VISUAL_MAX_RADIUS / Math.max(...realDistances)
      : 0;
    function realXZ(node) {
      if (!node.real_position_km || !realScale) return null;
      return {
        x: node.real_position_km.x * realScale,
        z: node.real_position_km.y * realScale,
      };
    }
    const roots = nodes
      .filter((n) => !nodes.some((p) => p.id === n.parent_id))
      .map((node, i) => ({ node, order: orderIndex(node, i) }))
      .sort((a, b) => a.order - b.order);
    roots.forEach(({ node, order }, i) => {
      const real = realXZ(node);
      const radius = real
        ? Math.hypot(real.x, real.z)
        : STAR_ORBIT_BASE + order * STAR_ORBIT_STEP;
      systemMaxRadius = Math.max(systemMaxRadius, radius);
      // Golden-angle spread keeps bodies visually distinct on their rings
      // without implying any real orbital phase/time — only used as a
      // fallback when no real position exists for this body.
      const angle = i * 2.399963;
      const x = real ? real.x : Math.cos(angle) * radius,
        z = real ? real.z : Math.sin(angle) * radius;
      // Real-time orbital motion — only where a real initial position AND
      // a real documented orbital period (SED, from the body's own wiki
      // infobox) both exist. Currently just Stanton's 4 planets; Pyro's
      // planets and every moon have no published orbital period, so they
      // stay static rather than animate at a fabricated rate. Circular
      // approximation (constant radius, real initial angle + real angular
      // velocity) — eccentricity isn't modeled. See CLAUDE.md Decisions
      // Log, 2026-10-25.
      const animated =
        real && node.orbital_period_sed && node.real_position_recorded_at;
      const orbiterEntry = animated
        ? {
            node,
            baseRadius: radius,
            initialAngle: Math.atan2(z, x),
            angularVelocity: (2 * Math.PI) / (node.orbital_period_sed * 86400),
            recordedAtMs: Date.parse(node.real_position_recorded_at),
            moons: [],
            lagranges: [],
          }
        : null;
      if (orbiterEntry) planetOrbiters.push(orbiterEntry);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 32, 24),
        new THREE.MeshStandardMaterial({ color: 0xa79479, roughness: 1 }),
      );
      mesh.position.set(x, 0, z);
      mesh.userData.node = node;
      system.add(mesh);
      // Invisible, oversized hit target — the visible sphere is tiny at
      // system-view distances and was effectively impossible to click
      // precisely, forcing people onto the text label instead.
      const hit = hitProxy(mesh.position, 0.34 * 2.4, node);
      system.add(hit);
      const rim = rimShell(0.37, 0x8fc4ff);
      rim.position.copy(mesh.position);
      system.add(rim);
      const el = button(node);
      el.onclick = () => callbacks.chooseBody(node);
      const labelEntry = {
        el,
        position: mesh.position.clone().add(new THREE.Vector3(0, 0.55, 0)),
      };
      systemLabels.push(labelEntry);
      if (orbiterEntry) Object.assign(orbiterEntry, { mesh, rim, hit, label: labelEntry });
      const orbitRing = new THREE.LineLoop(
        circle(radius),
        new THREE.LineBasicMaterial({
          color: 0x44678d,
          transparent: true,
          opacity: 0.32,
        }),
      );
      system.add(orbitRing);
      const moons = nodes
        .filter((n) => n.parent_id === node.id && n.kind === "moon")
        .map((moon, j) => ({ moon, order: orderIndex(moon, j) }))
        .sort((a, b) => a.order - b.order);
      // Moon-to-planet offsets get their OWN scale (see note above the
      // VISUAL_MAX_RADIUS declaration) — computed from real km offsets
      // relative to this planet, not the global star-to-planet scale,
      // which would collapse every moon onto its planet.
      const moonOffsetsKm = moons
        .filter(({ moon }) => moon.real_position_km && node.real_position_km)
        .map(({ moon }) => ({
          dx: moon.real_position_km.x - node.real_position_km.x,
          dy: moon.real_position_km.y - node.real_position_km.y,
        }));
      const maxMoonOffsetKm = moonOffsetsKm.length
        ? Math.max(...moonOffsetsKm.map((o) => Math.hypot(o.dx, o.dy)))
        : 0;
      const moonScale = maxMoonOffsetKm ? MOON_VISUAL_MAX_RADIUS / maxMoonOffsetKm : 0;
      moons.forEach(({ moon, order: moonOrder }, j) => {
        const moonOffsetReal =
          moon.real_position_km && node.real_position_km && moonScale
            ? {
                x: (moon.real_position_km.x - node.real_position_km.x) * moonScale,
                z: (moon.real_position_km.y - node.real_position_km.y) * moonScale,
              }
            : null;
        const moonRadius = moonOffsetReal
          ? Math.hypot(moonOffsetReal.x, moonOffsetReal.z)
          : MOON_ORBIT_BASE + moonOrder * MOON_ORBIT_STEP;
        const a = j * 2.399963;
        const satellite = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 20, 16),
          new THREE.MeshStandardMaterial({ color: 0x8298b1, roughness: 1 }),
        );
        if (moonOffsetReal) {
          satellite.position.set(x + moonOffsetReal.x, 0, z + moonOffsetReal.z);
        } else {
          satellite.position.set(
            x + Math.cos(a) * moonRadius,
            Math.sin(a) * moonRadius * 0.3,
            z + Math.sin(a) * moonRadius,
          );
        }
        satellite.userData.node = moon;
        system.add(satellite);
        const moonHit = hitProxy(satellite.position, 0.1 * 2.6, moon);
        system.add(moonHit);
        const moonRim = rimShell(0.115, 0x8fc4ff);
        moonRim.position.copy(satellite.position);
        system.add(moonRim);
        const moonRing = new THREE.LineLoop(
          circle(moonRadius),
          new THREE.LineBasicMaterial({
            color: 0x44678d,
            transparent: true,
            opacity: 0.22,
          }),
        );
        moonRing.position.set(x, 0, z);
        system.add(moonRing);
        // A moon with a real offset "rides along" rigidly with its
        // animated parent (translate only — we have no real orbital
        // period for moons to animate independently; see note above).
        if (orbiterEntry && moonOffsetReal) {
          orbiterEntry.moons.push({
            satellite,
            moonHit,
            moonRim,
            moonRing,
            offsetX: moonOffsetReal.x,
            offsetZ: moonOffsetReal.z,
          });
        }
      });
      // Lagrange-point stations co-orbit the planet itself. Angles verified
      // against a real Stanton system-map export (user-provided; absolute
      // positions/scale still not used anywhere — only these RELATIVE
      // planet-to-L-point angles, which were identical across all 4
      // planets): L1/L2 sit exactly on the star-planet line, L3 exactly
      // opposite, L4 exactly +60°. L5 is NOT -60° as previously assumed —
      // it's consistently -145.23° relative to the planet in this game's
      // actual layout. See CLAUDE.md Decisions Log, 2026-10-25.
      //
      // L1/L2's radial offset and the marker/hit-target size are fixed in
      // absolute units, independent of VISUAL_MAX_RADIUS — when that was
      // bumped 7->14 for real-scale rendering, L1/L2 ended up rendering
      // almost inside the planet's own sphere (radius 0.34, hit target
      // 0.816) and every marker became proportionally tiny/hard to see.
      // 1.0 comfortably clears the hit target at any real distance a
      // planet can sit at (minimum real/schematic radius is well above 2).
      const LAGRANGE_OFFSET = {
        L1: { radius: -1, angle: 0 },
        L2: { radius: 1, angle: 0 },
        L3: { radius: 0, angle: Math.PI },
        L4: { radius: 0, angle: Math.PI / 3 },
        L5: { radius: 0, angle: (-145.227 * Math.PI) / 180 },
      };
      const LAGRANGE_MARKER_SIZE = 0.16;
      for (const point of nodes.filter(
        (n) => n.parent_id === node.id && n.lagrange_point,
      )) {
        const offset = LAGRANGE_OFFSET[point.lagrange_point];
        if (!offset) continue;
        // Use the planet's REAL angle around the star when it has a real
        // position, not the arbitrary golden-angle fallback used only for
        // visual placement when no real position exists.
        const planetAngle = real ? Math.atan2(z, x) : angle;
        const pointAngle = planetAngle + offset.angle,
          pointRadius = radius + offset.radius;
        const marker = new THREE.Mesh(
          new THREE.TetrahedronGeometry(LAGRANGE_MARKER_SIZE),
          new THREE.MeshStandardMaterial({ color: 0xe8b85a, roughness: 0.6, emissive: 0x4a3414, emissiveIntensity: 0.6 }),
        );
        marker.position.set(
          Math.cos(pointAngle) * pointRadius,
          0.08,
          Math.sin(pointAngle) * pointRadius,
        );
        marker.userData.node = point;
        system.add(marker);
        const pointHit = hitProxy(marker.position, LAGRANGE_MARKER_SIZE * 3, point);
        system.add(pointHit);
        const pointEl = button(point);
        pointEl.onclick = () => callbacks.select(point);
        const pointLabel = {
          el: pointEl,
          position: marker.position
            .clone()
            .add(new THREE.Vector3(0, 0.25, 0)),
        };
        systemLabels.push(pointLabel);
        // A Lagrange point is defined relative to its planet's live
        // position, so it's recomputed from the planet's current angle
        // each frame — not translated, like a moon — via the same
        // offset.angle/offset.radius used above.
        if (orbiterEntry)
          orbiterEntry.lagranges.push({ marker, pointHit, pointLabel, offset });
      }
    });
  }
  // All systems, implemented or lore-only, recentered on whichever system
  // is currently open (so its star sits at local origin, matching the
  // rendered system view) and scaled from their real galactic_position —
  // visible only once the camera pulls back past GALAXY_REVEAL_DISTANCE.
  // See CLAUDE.md Decisions Log, 2026-10-25.
  function setGalaxy(systemNodes, currentSystemId) {
    while (galaxyGroup.children.length) {
      const child = galaxyGroup.children[0];
      galaxyGroup.remove(child);
      cleanObject(child);
    }
    galaxyPoints.forEach((p) => p.el.remove());
    galaxyPoints = [];
    const current = systemNodes.find((n) => n.id === currentSystemId);
    if (!current || !current.galactic_position) return;
    const origin = current.galactic_position;
    for (const node of systemNodes) {
      if (!node.galactic_position) continue;
      const dx = (node.galactic_position.x - origin.x) * GALAXY_VISUAL_SCALE,
        dz = (node.galactic_position.y - origin.y) * GALAXY_VISUAL_SCALE;
      const isCurrent = node.id === currentSystemId;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(isCurrent ? 0.22 : 0.14, 16, 12),
        new THREE.MeshBasicMaterial({
          color: isCurrent ? 0xffdca8 : node.implemented === false ? 0x4a5f78 : 0x8fc4ff,
          transparent: true,
          opacity: isCurrent ? 1 : node.implemented === false ? 0.55 : 0.9,
        }),
      );
      dot.position.set(dx, 0, dz);
      dot.userData.node = node;
      galaxyGroup.add(dot);
      if (!isCurrent) galaxyGroup.add(hitProxy(dot.position, 0.14 * 3, node));
      const el = button(node);
      el.onclick = () => callbacks.chooseSystem(node);
      galaxyPoints.push({ node, mesh: dot, el });
    }
  }
  const raycaster = new THREE.Raycaster();
  let pointerDown;
  function pickObject(e, group) {
    const rect = host.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    return raycaster
      .intersectObjects(group.children)
      .find((h) => h.object.userData.node);
  }
  function down(e) {
    pointerDown = [e.clientX, e.clientY];
  }
  function up(e) {
    if (
      !pointerDown ||
      Math.hypot(e.clientX - pointerDown[0], e.clientY - pointerDown[1]) > 5
    )
      return;
    if (mode === "system" && galaxyGroup.visible) {
      const hit = pickObject(e, galaxyGroup);
      if (hit) callbacks.chooseSystem(hit.object.userData.node);
    } else if (mode === "system") {
      const hit = pickObject(e, system);
      if (!hit) return;
      const hitNode = hit.object.userData.node;
      // A Lagrange-point station isn't a navigable body — select it like
      // any other location instead of trying to drill into it as one.
      if (hitNode.lagrange_point) callbacks.select(hitNode);
      else callbacks.chooseBody(hitNode);
    } else if (mode === "globe") {
      const hit = pickObject(e, moonOrbitGroup);
      if (hit) callbacks.chooseBody(hit.object.userData.node);
    }
  }
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointerup", up);
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(host);
  // Places a label and, if it would land on top of one already placed this
  // frame, hides it instead of letting text overlap illegibly — nearer/
  // earlier labels win, since markers/labels are iterated front-to-back.
  function placeLabel(el, position, show, claimed) {
    el.hidden = !show;
    if (!show) return;
    const p = position.clone().project(camera);
    if (p.z > 1 || Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.97) {
      el.hidden = true;
      return;
    }
    const sx = (p.x * 0.5 + 0.5) * host.clientWidth,
      sy = (-p.y * 0.5 + 0.5) * host.clientHeight;
    const LABEL_MIN_GAP = 26;
    if (claimed.some(([ox, oy]) => Math.hypot(sx - ox, sy - oy) < LABEL_MIN_GAP)) {
      el.hidden = true;
      return;
    }
    claimed.push([sx, sy]);
    el.style.left = sx + "px";
    el.style.top = sy + "px";
  }
  function draw() {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    if (document.hidden) return;
    controls.update();
    galaxyGroup.visible =
      mode === "system" && camera.position.length() > GALAXY_REVEAL_DISTANCE;
    if (mode === "globe" && moonOrbiters.length) {
      moonClock += 1 / 60;
      for (const m of moonOrbiters) {
        const a = m.angle + moonClock * m.speed;
        m.mesh.position.set(
          Math.cos(a) * m.radius,
          0,
          Math.sin(a) * m.radius,
        );
        m.rim.position.copy(m.mesh.position);
        m.hit.position.copy(m.mesh.position);
      }
    }
    if (mode === "system" && planetOrbiters.length) {
      const now = Date.now();
      for (const p of planetOrbiters) {
        const elapsedSec = (now - p.recordedAtMs) / 1000;
        const a = p.initialAngle + p.angularVelocity * elapsedSec;
        const px = Math.cos(a) * p.baseRadius,
          pz = Math.sin(a) * p.baseRadius;
        p.mesh.position.set(px, 0, pz);
        p.rim.position.copy(p.mesh.position);
        p.hit.position.copy(p.mesh.position);
        p.label.position.set(px, 0.55, pz);
        for (const m of p.moons) {
          m.satellite.position.set(px + m.offsetX, 0, pz + m.offsetZ);
          m.moonHit.position.copy(m.satellite.position);
          m.moonRim.position.copy(m.satellite.position);
          m.moonRing.position.set(px, 0, pz);
        }
        for (const l of p.lagranges) {
          const pointAngle = a + l.offset.angle,
            pointRadius = p.baseRadius + l.offset.radius;
          l.marker.position.set(
            Math.cos(pointAngle) * pointRadius,
            0.08,
            Math.sin(pointAngle) * pointRadius,
          );
          l.pointHit.position.copy(l.marker.position);
          l.pointLabel.position
            .copy(l.marker.position)
            .add(new THREE.Vector3(0, 0.25, 0));
        }
      }
    }
    const claimed = [];
    for (const marker of markers) {
      const front =
        marker.position
          .clone()
          .normalize()
          .dot(camera.position.clone().normalize()) > 0.015;
      placeLabel(
        marker.el,
        marker.position,
        mode === "globe" && !!body && layers.pins && front,
        claimed,
      );
    }
    for (const label of systemLabels)
      placeLabel(label.el, label.position, mode === "system", claimed);
    for (const m of moonOrbiters)
      placeLabel(m.el, m.mesh.position, mode === "globe" && !!body, claimed);
    for (const g of galaxyPoints)
      placeLabel(g.el, g.mesh.position, galaxyGroup.visible, claimed);
    renderer.render(scene, camera);
  }
  function lost(event) {
    event.preventDefault();
    callbacks.contextLost();
  }
  renderer.domElement.addEventListener("webglcontextlost", lost);
  reset();
  draw();
  return {
    setBody(node) {
      body = node;
      if (body) {
        const t = texturesFor(body.name || "");
        material.map = t.map;
        material.bumpMap = t.bumpMap;
        material.bumpScale = t.bumpScale;
        material.roughness = t.roughness;
        material.emissiveMap = t.emissiveMap;
        material.emissiveIntensity = t.emissiveIntensity;
        // Bodies whose reference imagery includes a real specular map (ice
        // sheets, bright salt/rock) get a tight clearcoat highlight instead
        // of copying that map — a real optical cue, procedurally sourced.
        material.clearcoat = t.specular ? 0.6 : 0;
        material.clearcoatRoughness = t.specular ? 0.25 : 1;
        material.needsUpdate = true;
      }
      rebuildMoons(body);
      globe.visible = mode === "globe" && !!body;
      reset();
    },
    setSystem,
    setGalaxy,
    setMode,
    setMarkers(nodes, id) {
      entries = nodes;
      selectedId = id;
      rebuildMarkers();
    },
    setLayers(next) {
      layers = next;
      grid.visible = next.grid;
      orbit.visible = next.orbit;
    },
    focus(coordinates) {
      const pos = surfacePoint(coordinates, 7.6);
      if (pos) {
        camera.position.set(...pos);
        controls.target.set(0, 0, 0);
        controls.update();
      }
    },
    zoom(factor) {
      camera.position.multiplyScalar(factor);
      camera.position.clampLength(controls.minDistance, controls.maxDistance);
      controls.update();
    },
    reset,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      markers.forEach((m) => m.el.remove());
      systemLabels.forEach((m) => m.el.remove());
      moonOrbiters.forEach((m) => m.el.remove());
      galaxyPoints.forEach((m) => m.el.remove());
      cleanObject(scene);
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
