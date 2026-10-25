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
  controls.maxDistance = 20;
  scene.add(new THREE.AmbientLight(0x667d9c, 0.7));
  const light = new THREE.DirectionalLight(0xffe4b8, 3.5);
  light.position.set(-4, 4, 5);
  scene.add(light);
  const globe = new THREE.Group(),
    system = new THREE.Group();
  scene.add(globe, system);
  // Neutral procedural texture: decoration, never a geographically accurate map.
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 512;
  textureCanvas.height = 256;
  const ctx = textureCanvas.getContext("2d"),
    pixels = ctx.createImageData(512, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 512; x++) {
      const u = (x / 512) * Math.PI * 2,
        v = (y / 256) * Math.PI;
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
      const t = Math.max(0, Math.min(1, (n + 1.5) / 3));
      const shade = t < 0.37 ? 0.28 + t * 0.25 : 0.52 + t * 0.48;
      const i = (y * 512 + x) * 4;
      [160, 145, 123].forEach((z, c) => {
        pixels.data[i + c] = z * shade;
      });
      pixels.data[i + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sphereGeometry = new THREE.SphereGeometry(2, 96, 64);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 0.035,
    roughness: 1,
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
    positions = [];
  for (let i = 0; i < 200; i++)
    positions.push(
      (random() - 0.5) * 50,
      (random() - 0.5) * 40,
      -10 - random() * 30,
    );
  starGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  scene.add(
    new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0x90aecf,
        size: 0.027,
        transparent: true,
        opacity: 0.45,
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
    camera.position.set(0, 0.2, mode === "system" ? 12 : 7.6);
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
  function setSystem(nodes) {
    while (system.children.length) {
      const child = system.children[0];
      system.remove(child);
      cleanObject(child);
    }
    systemLabels.forEach((l) => l.el.remove());
    systemLabels = [];
    const roots = nodes.filter((n) => !nodes.some((p) => p.id === n.parent_id));
    roots.forEach((node, i) => {
      const angle = (i / Math.max(roots.length, 1)) * Math.PI * 2 + 0.3;
      const x = Math.cos(angle) * 3,
        z = Math.sin(angle) * 1.5;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 32, 24),
        new THREE.MeshStandardMaterial({ color: 0xa79479, roughness: 1 }),
      );
      mesh.position.set(x, 0, z);
      mesh.userData.node = node;
      system.add(mesh);
      const el = button(node);
      el.onclick = () => callbacks.chooseBody(node);
      systemLabels.push({
        el,
        position: mesh.position.clone().add(new THREE.Vector3(0, 0.65, 0)),
      });
      const moons = nodes.filter((n) => n.parent_id === node.id);
      moons.forEach((moon, j) => {
        const a = (j / Math.max(moons.length, 1)) * Math.PI * 2;
        const satellite = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 20, 16),
          new THREE.MeshStandardMaterial({ color: 0x8298b1, roughness: 1 }),
        );
        satellite.position.set(
          x + Math.cos(a) * 0.85,
          Math.sin(a) * 0.25,
          z + Math.sin(a) * 0.65,
        );
        satellite.userData.node = moon;
        system.add(satellite);
      });
      const ring = new THREE.LineLoop(
        circle(0.85),
        new THREE.LineBasicMaterial({
          color: 0x44678d,
          transparent: true,
          opacity: 0.4,
        }),
      );
      ring.position.set(x, 0, z);
      system.add(ring);
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
    if (hit) callbacks.chooseBody(hit.object.userData.node);
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
