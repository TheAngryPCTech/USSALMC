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
  controls.enablePan = false;
  controls.enableDamping = !matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  controls.minDistance = 3;
  controls.maxDistance = 30;
  scene.add(new THREE.AmbientLight(0x667d9c, 0.7));
  const light = new THREE.DirectionalLight(0xffe4b8, 3.5);
  light.position.set(-4, 4, 5);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0x5a7bb0, 0.9);
  fill.position.set(5, -2, -4);
  scene.add(fill);
  const globe = new THREE.Group(),
    system = new THREE.Group();
  scene.add(globe, system);
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
      // Smooth continuous curve — no hard breakpoint, so there's no visible
      // banding seam cutting across the surface.
      paint: (u, v, palette) => {
        const t = noiseAt(u, v);
        const grain = noiseAt(u * 3.3 + 1.7, v * 3.3 + 2.1);
        const shade = (0.32 + t * 0.62) * (0.92 + grain * 0.16);
        return { color: palette.map((c) => c * shade), emissive: ZERO };
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
  const PLANET_LOOK = [
    [/hurston/i, "rocky", [168, 134, 96]],
    [/crusader/i, "gasGiant", [[70, 92, 110], [150, 170, 165], [214, 222, 226]]],
    [/arccorp/i, "urban", [[58, 40, 18], [255, 206, 122]]],
    [/microtech/i, "icy", [[176, 198, 214], [244, 250, 255]]],
    [/^pyro i$/i, "volcanic", [[40, 24, 20], [255, 123, 51]]],
    [/monox|pyro ii/i, "gasGiant", [[94, 86, 48], [150, 140, 70], [189, 184, 110]]],
    [/bloom|pyro iii/i, "rocky", [150, 168, 132]],
    [/pyro v$/i, "rocky", [120, 108, 104]],
    [/terminus|pyro vi/i, "icy", [[150, 160, 176], [214, 220, 232]]],
  ];
  function lookFor(name) {
    for (const [pattern, archetype, palette] of PLANET_LOOK)
      if (pattern.test(name)) return { archetype, palette };
    // Unlisted bodies (moons, anything else) stay a neutral rocky grey —
    // same fallback the single shared texture used to give everyone.
    return { archetype: "rocky", palette: [150, 150, 155] };
  }
  const textureCache = new Map();
  function texturesFor(name) {
    const { archetype, palette } = lookFor(name);
    const cacheKey = archetype + ":" + JSON.stringify(palette);
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
    const result = {
      map,
      emissiveMap,
      bumpMap,
      roughness: config.roughness,
      bumpScale: config.bumpScale,
      emissiveIntensity: config.emissiveIntensity,
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
    disposed = false,
    frame;
  function button(node, selected = false) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "map-marker" + (selected ? " selected" : "");
    el.textContent = node.name;
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
    while (system.children.length) {
      const child = system.children[0];
      system.remove(child);
      cleanObject(child);
    }
    systemLabels.forEach((l) => l.el.remove());
    systemLabels = [];
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
    const roots = nodes
      .filter((n) => !nodes.some((p) => p.id === n.parent_id))
      .map((node, i) => ({ node, order: orderIndex(node, i) }))
      .sort((a, b) => a.order - b.order);
    roots.forEach(({ node, order }, i) => {
      const radius = STAR_ORBIT_BASE + order * STAR_ORBIT_STEP;
      systemMaxRadius = Math.max(systemMaxRadius, radius);
      // Golden-angle spread keeps bodies visually distinct on their rings
      // without implying any real orbital phase/time.
      const angle = i * 2.399963;
      const x = Math.cos(angle) * radius,
        z = Math.sin(angle) * radius;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 32, 24),
        new THREE.MeshStandardMaterial({ color: 0xa79479, roughness: 1 }),
      );
      mesh.position.set(x, 0, z);
      mesh.userData.node = node;
      system.add(mesh);
      const rim = rimShell(0.37, 0x8fc4ff);
      rim.position.copy(mesh.position);
      system.add(rim);
      const el = button(node);
      el.onclick = () => callbacks.chooseBody(node);
      systemLabels.push({
        el,
        position: mesh.position.clone().add(new THREE.Vector3(0, 0.55, 0)),
      });
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
      moons.forEach(({ moon, order: moonOrder }, j) => {
        const moonRadius = MOON_ORBIT_BASE + moonOrder * MOON_ORBIT_STEP;
        const a = j * 2.399963;
        const satellite = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 20, 16),
          new THREE.MeshStandardMaterial({ color: 0x8298b1, roughness: 1 }),
        );
        satellite.position.set(
          x + Math.cos(a) * moonRadius,
          Math.sin(a) * moonRadius * 0.3,
          z + Math.sin(a) * moonRadius,
        );
        satellite.userData.node = moon;
        system.add(satellite);
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
      });
      // Lagrange-point stations co-orbit the planet itself (L1/L2 along the
      // star-planet line, L3 opposite the star, L4/L5 at +/-60 degrees) —
      // schematic positions, not a measured survey, same as everything else
      // in this view.
      const LAGRANGE_OFFSET = {
        L1: { radius: -0.3, angle: 0 },
        L2: { radius: 0.3, angle: 0 },
        L3: { radius: 0, angle: Math.PI },
        L4: { radius: 0, angle: Math.PI / 3 },
        L5: { radius: 0, angle: -Math.PI / 3 },
      };
      for (const point of nodes.filter(
        (n) => n.parent_id === node.id && n.lagrange_point,
      )) {
        const offset = LAGRANGE_OFFSET[point.lagrange_point];
        if (!offset) continue;
        const pointAngle = angle + offset.angle,
          pointRadius = radius + offset.radius;
        const marker = new THREE.Mesh(
          new THREE.TetrahedronGeometry(0.065),
          new THREE.MeshStandardMaterial({ color: 0xe8b85a, roughness: 0.6 }),
        );
        marker.position.set(
          Math.cos(pointAngle) * pointRadius,
          0.08,
          Math.sin(pointAngle) * pointRadius,
        );
        marker.userData.node = point;
        system.add(marker);
      }
    });
  }
  const raycaster = new THREE.Raycaster();
  let pointerDown;
  function down(e) {
    pointerDown = [e.clientX, e.clientY];
  }
  function up(e) {
    if (
      mode !== "system" ||
      !pointerDown ||
      Math.hypot(e.clientX - pointerDown[0], e.clientY - pointerDown[1]) > 5
    )
      return;
    const rect = host.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster
      .intersectObjects(system.children)
      .find((h) => h.object.userData.node);
    if (!hit) return;
    const hitNode = hit.object.userData.node;
    // A Lagrange-point station isn't a navigable body — select it like any
    // other location instead of trying to drill into it as one.
    if (hitNode.lagrange_point) callbacks.select(hitNode);
    else callbacks.chooseBody(hitNode);
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
  function placeLabel(el, position, show) {
    el.hidden = !show;
    if (!show) return;
    const p = position.clone().project(camera);
    el.hidden = p.z > 1 || Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.97;
    el.style.left = (p.x * 0.5 + 0.5) * host.clientWidth + "px";
    el.style.top = (-p.y * 0.5 + 0.5) * host.clientHeight + "px";
  }
  function draw() {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    if (document.hidden) return;
    controls.update();
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
      );
    }
    for (const label of systemLabels)
      placeLabel(label.el, label.position, mode === "system");
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
        material.needsUpdate = true;
      }
      globe.visible = mode === "globe" && !!body;
      reset();
    },
    setSystem,
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
      cleanObject(scene);
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
