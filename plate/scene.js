import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

// Deterministic random so the plating looks the same on every visit.
let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const range = (a, b) => a + (b - a) * rand();

// Timeline (fractions of total scroll).
const T = {
  ribbonsStart: 0.14,
  ribbonsEnd: 0.46,
  flowersStart: 0.46,
  flowersEnd: 0.86,
};

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (err) {
  document.getElementById('fallback').style.display = 'flex';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 1.0;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

// Soft key light from upper left, like the studio light in the reference.
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-5, 9, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -5;
key.shadow.camera.right = 5;
key.shadow.camera.top = 5;
key.shadow.camera.bottom = -5;
key.shadow.camera.near = 1;
key.shadow.camera.far = 25;
key.shadow.radius = 6;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
scene.add(new THREE.HemisphereLight(0xffffff, 0xdedee6, 0.6));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const plate = new THREE.Group();
scene.add(plate);

// ---------------------------------------------------------------------------
// The bowl: a lathe profile (deep well + wide rim), then the rim is rippled
// with concentric, wobbling waves and an irregular outline.
// ---------------------------------------------------------------------------
function buildBowl() {
  const profile = [
    // top surface, centre outwards
    [0, 0.14], [0.5, 0.15], [0.95, 0.24], [1.25, 0.48], [1.45, 0.82], [1.58, 1.05],
    [1.8, 1.16], [2.2, 1.24], [2.65, 1.36], [3.05, 1.5], [3.26, 1.58], [3.34, 1.54],
    // lip and underside, back towards the centre
    [3.28, 1.44], [2.95, 1.35], [2.45, 1.2], [1.95, 1.04], [1.6, 0.8], [1.35, 0.35],
    [1.15, 0.0], [0.9, 0.0], [0.0, 0.02],
  ].map(([r, y]) => new THREE.Vector3(r, y, 0));
  const curve = new THREE.CatmullRomCurve3(profile, false, 'centripetal');
  const points = curve.getPoints(260).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));

  let geo = new THREE.LatheGeometry(points, 280);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    const th = Math.atan2(v.x, v.z);
    const m = smoothstep(1.55, 1.95, r);
    if (m <= 0) continue;
    const ripple =
      Math.sin(r * 13 + 1.3 * Math.sin(2 * th + 0.3) + 0.7 * Math.sin(5 * th + 1.1) + 0.3 * Math.sin(9 * th)) *
      0.032 * (0.6 + 0.4 * Math.sin(4 * th + r * 2));
    const swell =
      (0.05 * Math.sin(3 * th + r * 1.6) + 0.025 * Math.sin(7 * th - r * 2.1) + 0.012 * Math.sin(12 * th + r)) *
      smoothstep(1.7, 3.2, r);
    const outline =
      (r - 1.5) * (0.025 * Math.sin(3 * th + 0.5) + 0.014 * Math.sin(6 * th + 2.0) + 0.008 * Math.sin(11 * th));
    const nr = r + m * outline;
    v.x = Math.sin(th) * nr;
    v.z = Math.cos(th) * nr;
    v.y += m * (ripple + swell);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Weld the lathe seam so normals are smooth all the way round.
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xfbfbfa,
    roughness: 0.22,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xffffff),
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
plate.add(buildBowl());

// ---------------------------------------------------------------------------
// Ribbons: thin flat strips. Each one falls as a straight, gently twisting
// strip, then folds from its leading end into a loop in the nest.
// ---------------------------------------------------------------------------
const RIBBON_SEGS = 72;
const ribbonMat = new THREE.MeshPhysicalMaterial({
  color: 0xf7f5ee,
  emissive: 0x24221c,
  roughness: 0.3,
  clearcoat: 0.8,
  clearcoatRoughness: 0.2,
  transparent: true,
  opacity: 0.84,
  side: THREE.DoubleSide,
});

const ribbons = [];
const RIBBON_COUNT = 18;
const UP = new THREE.Vector3(0, 1, 0);
for (let i = 0; i < RIBBON_COUNT; i++) {
  const layer = i / (RIBBON_COUNT - 1);
  const cAng = range(0, Math.PI * 2);
  const cRad = range(0, 0.3) * (1 - layer * 0.5);
  const center = new THREE.Vector3(Math.cos(cAng) * cRad, 0, Math.sin(cAng) * cRad);
  const loopR = range(0.32, 0.6) * (1 - layer * 0.3);
  const turns = range(0.9, 1.5);
  const a0 = range(0, Math.PI * 2);
  const baseY = 0.28 + layer * 0.42;
  const wobble = range(0.04, 0.12);
  const ph = range(0, Math.PI * 2);
  const width = range(0.22, 0.34);
  const tilt = range(0.25, 0.75);

  const rest = [];
  const restSide = [];
  for (let s = 0; s <= RIBBON_SEGS; s++) {
    const u = s / RIBBON_SEGS;
    const phi = a0 + u * Math.PI * 2 * turns;
    const r = loopR * (0.75 + 0.25 * Math.sin(u * 5 + ph));
    const p = new THREE.Vector3(
      center.x + Math.cos(phi) * r,
      baseY + Math.sin(phi * 1.5 + ph) * wobble + Math.sin(u * Math.PI) * 0.05,
      center.z + Math.sin(phi) * r
    );
    rest.push(p);
    const radial = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
    restSide.push(UP.clone().multiplyScalar(1 - tilt).addScaledVector(radial, tilt).normalize());
  }

  // Falling shape: a near-vertical strip above a pour point, bottom at the nest.
  const pour = new THREE.Vector3(range(-0.08, 0.08), 0, range(-0.08, 0.08));
  const length = 3.2;
  const sideAng = range(0, Math.PI * 2);
  const twist = range(1.0, 2.5) * Math.PI;
  const fall = [];
  const fallSide = [];
  for (let s = 0; s <= RIBBON_SEGS; s++) {
    const u = s / RIBBON_SEGS;
    fall.push(
      new THREE.Vector3(
        pour.x + Math.sin(u * 8 + ph) * 0.05,
        baseY + (1 - u) * length,
        pour.z + Math.cos(u * 6 + ph) * 0.05
      )
    );
    const a = sideAng + u * twist;
    fallSide.push(new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)).normalize());
  }

  const widths = [];
  for (let s = 0; s <= RIBBON_SEGS; s++) {
    const u = s / RIBBON_SEGS;
    widths.push(width * (0.7 + 0.3 * Math.sin(u * Math.PI)));
  }

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((RIBBON_SEGS + 1) * 2 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const index = [];
  for (let s = 0; s < RIBBON_SEGS; s++) {
    const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
    index.push(a, b, c, b, d, c);
  }
  geo.setIndex(index);

  const mesh = new THREE.Mesh(geo, ribbonMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.visible = false;
  mesh.frustumCulled = false;
  plate.add(mesh);

  const span = (T.ribbonsEnd - T.ribbonsStart);
  const start = T.ribbonsStart + (i / RIBBON_COUNT) * span * 0.72;
  ribbons.push({ mesh, rest, restSide, fall, fallSide, widths, start, dur: span * 0.3, lastT: -1 });
}

const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
function poseRibbon(rb, t) {
  const pos = rb.mesh.geometry.attributes.position;
  const drop = smooth(clamp01(t / 0.45));
  const yOff = (1 - drop) * 7;
  const fold = clamp01((t - 0.25) / 0.75);
  for (let s = 0; s <= RIBBON_SEGS; s++) {
    const u = s / RIBBON_SEGS;
    // The leading (bottom) end settles first and the tail piles on top.
    const m = smooth(clamp01(fold * 1.6 - (1 - u) * 0.6));
    tmpP.copy(rb.fall[s]);
    tmpP.y += yOff;
    tmpP.lerp(rb.rest[s], m);
    tmpS.copy(rb.fallSide[s]).lerp(rb.restSide[s], m).normalize();
    const hw = rb.widths[s] / 2;
    pos.setXYZ(s * 2, tmpP.x - tmpS.x * hw, tmpP.y - tmpS.y * hw, tmpP.z - tmpS.z * hw);
    pos.setXYZ(s * 2 + 1, tmpP.x + tmpS.x * hw, tmpP.y + tmpS.y * hw, tmpP.z + tmpS.z * hw);
  }
  pos.needsUpdate = true;
  rb.mesh.geometry.computeVertexNormals();
  rb.mesh.geometry.computeBoundingSphere();
}

// Height of the finished nest at (x, z), sampled from the resting ribbons so
// that flowers land on top of what's actually there.
function nestHeight(x, z) {
  let h = 0.16;
  for (const rb of ribbons) {
    for (let s = 0; s <= RIBBON_SEGS; s++) {
      const p = rb.rest[s];
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 0.14) {
        const top = p.y + (rb.restSide[s].y * rb.widths[s]) / 2;
        h = Math.max(h, top - d * 0.6);
      }
    }
  }
  return h;
}

// ---------------------------------------------------------------------------
// Edible flowers, herbs and roe.
// ---------------------------------------------------------------------------
const matCache = new Map();
function mat(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!matCache.has(k)) {
    matCache.set(
      k,
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide, ...opts })
    );
  }
  return matCache.get(k);
}

// A flat shape from a polar radius function, cupped slightly and laid flat.
function polarGeo(rFn, cup = 1.2, steps = 90) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const r = rFn(th);
    const x = Math.cos(th) * r, y = Math.sin(th) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ShapeGeometry(shape, 24);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, cup * (x * x + y * y));
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

const disc = (r) => polarGeo(() => r, 0, 24);

const GEOS = {
  borage: polarGeo((th) => 0.11 * (0.32 + 0.68 * Math.pow(Math.abs(Math.cos(2.5 * th)), 2.2)), 1.6),
  viola: polarGeo((th) => 0.09 * (0.62 + 0.38 * Math.abs(Math.cos(2.5 * th))), 2.0),
  pink: polarGeo((th) => 0.085 * (0.5 + 0.5 * Math.pow(Math.abs(Math.cos(2.5 * th)), 0.7)) * (1 + 0.12 * Math.sin(10 * th)), 2.2),
  petal: polarGeo((th) => 0.06 / Math.sqrt(Math.pow(Math.cos(th) / 1.0, 2) + Math.pow(Math.sin(th) / 0.45, 2)), 3),
  leaf: polarGeo((th) => 0.1 * (0.45 + 0.55 * Math.abs(Math.cos(1.5 * th))) * (1 + 0.15 * Math.sin(9 * th)), 1.0),
  tiny: polarGeo((th) => 0.03 * (0.55 + 0.45 * Math.abs(Math.cos(2 * th))), 3),
  center: disc(0.022),
  roe: new THREE.SphereGeometry(0.028, 16, 12),
  bud: new THREE.SphereGeometry(0.02, 10, 8),
};

function makeFlower(kind) {
  const g = new THREE.Group();
  const add = (geo, m, x = 0, y = 0, z = 0, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (kind) {
    case 'borage':
      add(GEOS.borage, mat(0x3f5fe8, { emissive: 0x0b1440 }));
      add(GEOS.center, mat(0x1b1b3a), 0, 0.012, 0);
      break;
    case 'viola':
      add(GEOS.viola, mat(0xf7c51c, { emissive: 0x3a2800 }));
      add(GEOS.center, mat(0xe07a10), 0, 0.012, 0);
      break;
    case 'pink':
      add(GEOS.pink, mat(0xe63e8c, { emissive: 0x3a0820 }));
      add(GEOS.center, mat(0xfff1a0), 0, 0.012, 0);
      break;
    case 'purple':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        add(GEOS.bud, mat(0x8a6bc4), Math.cos(a) * 0.035, 0.01 + (i % 2) * 0.012, Math.sin(a) * 0.035);
      }
      add(GEOS.bud, mat(0x6b4fa8), 0, 0.03, 0);
      break;
    case 'marigold':
      for (let i = 0; i < 4; i++) {
        add(GEOS.petal, mat(0xf2841a, { emissive: 0x3a1500 }), range(-0.04, 0.04), i * 0.006, range(-0.04, 0.04), range(0, 6.3));
      }
      break;
    case 'alyssum':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + range(0, 0.5);
        const r = i === 0 ? 0 : range(0.04, 0.07);
        add(GEOS.tiny, mat(0xfbfbf7), Math.cos(a) * r, range(0, 0.02), Math.sin(a) * r, range(0, 6.3));
      }
      break;
    case 'leaf':
      add(GEOS.leaf, mat(0x4e9a36, { roughness: 0.45 }));
      break;
    case 'roe':
      for (let i = 0; i < 5; i++) {
        const m = add(GEOS.roe, mat(0xf26a1b, { roughness: 0.12, emissive: 0x401000 }), range(-0.05, 0.05), 0.02 + (i > 2 ? 0.035 : 0), range(-0.05, 0.05));
        m.scale.setScalar(range(0.85, 1.1));
      }
      break;
  }
  return g;
}

const FLOWER_MIX = [
  ['borage', 9], ['viola', 9], ['pink', 6], ['marigold', 8], ['alyssum', 6],
  ['leaf', 13], ['purple', 3], ['roe', 4],
];
const flowerList = [];
for (const [kind, n] of FLOWER_MIX) for (let i = 0; i < n; i++) flowerList.push(kind);
// Shuffle so colours rain in mixed order.
for (let i = flowerList.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [flowerList[i], flowerList[j]] = [flowerList[j], flowerList[i]];
}

const flowers = flowerList.map((kind, i) => {
  const obj = makeFlower(kind);
  obj.userData.size = range(1.25, 1.6);
  // Land in a loose disc on the nest, denser towards the middle.
  const a = range(0, Math.PI * 2);
  const r = Math.sqrt(rand()) * 0.78;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const end = new THREE.Vector3(x, nestHeight(x, z) + 0.01, z);
  const endRot = new THREE.Euler(range(-0.45, 0.45), range(0, Math.PI * 2), range(-0.45, 0.45));
  const startPos = new THREE.Vector3(x + range(-0.25, 0.25), range(5.5, 7), z + range(-0.25, 0.25));
  const spin = new THREE.Vector3(range(-6, 6), range(-8, 8), range(-6, 6));
  const span = T.flowersEnd - T.flowersStart;
  const start = T.flowersStart + (i / flowerList.length) * span * 0.78 + range(-0.01, 0.01);
  obj.visible = false;
  plate.add(obj);
  return { obj, end, endRot, startPos, spin, start, dur: span * 0.2 };
});

function poseFlower(f, t) {
  if (t <= 0) {
    f.obj.visible = false;
    return;
  }
  f.obj.visible = true;
  const fallT = clamp01(t / 0.85);
  const g = fallT * fallT; // gravity: slow start, fast landing
  f.obj.position.lerpVectors(f.startPos, f.end, g);
  // A small bounce once it lands.
  const settle = clamp01((t - 0.85) / 0.15);
  f.obj.position.y += Math.sin(settle * Math.PI) * 0.04;
  const k = 1 - g;
  f.obj.rotation.set(
    f.endRot.x + f.spin.x * k,
    f.endRot.y + f.spin.y * k,
    f.endRot.z + f.spin.z * k
  );
  const s = t >= 1 ? 1 : lerp(0.92, 1, easeOutBack(settle));
  f.obj.scale.setScalar(s * f.obj.userData.size);
}

// ---------------------------------------------------------------------------
// Camera path: a slow orbit that eases in, like the drifting camera in the
// reference shot.
// ---------------------------------------------------------------------------
const target = new THREE.Vector3();
function poseCamera(p, time) {
  const e = easeInOut(p);
  const aspect = window.innerWidth / window.innerHeight;
  const fit = aspect < 1.1 ? Math.min(2.1, 1.25 / aspect) : 1;
  let dist = lerp(15, 11.2, smoothstep(0, 0.3, p));
  dist = lerp(dist, 9.6, smoothstep(0.4, 0.8, p)); // lean in for the flowers
  dist = lerp(dist, 11.5, smoothstep(0.86, 1, p)); // pull back for the final plate
  dist *= fit;
  const elev = THREE.MathUtils.degToRad(lerp(50, 40, e) + Math.sin(time * 0.3) * 0.6);
  const azim = lerp(-0.95, 0.75, e) + Math.sin(time * 0.2) * 0.02;
  target.set(0, lerp(0.9, 0.5, smoothstep(0.1, 0.5, p)), 0);
  camera.position.set(
    target.x + Math.sin(azim) * Math.cos(elev) * dist,
    target.y + Math.sin(elev) * dist,
    target.z + Math.cos(azim) * Math.cos(elev) * dist
  );
  camera.lookAt(target);
}

// ---------------------------------------------------------------------------
// Scroll + render loop
// ---------------------------------------------------------------------------
const chapters = [...document.querySelectorAll('.chapter')].map((el) => ({
  el,
  a: parseFloat(el.dataset.in),
  b: parseFloat(el.dataset.out),
}));
const hint = document.getElementById('hint');
const bar = document.getElementById('bar');

function scrollProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? clamp01(window.scrollY / max) : 0;
}

let progress = scrollProgress();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // On wide screens, push the bowl right so the captions sit beside it.
  if (camera.aspect > 1.1) camera.setViewOffset(w, h, -w * 0.13, 0, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function update(p, time) {
  for (const rb of ribbons) {
    const t = clamp01((p - rb.start) / rb.dur);
    rb.mesh.visible = p > rb.start;
    if (rb.mesh.visible && t !== rb.lastT) {
      poseRibbon(rb, t);
      rb.lastT = t;
    }
  }
  for (const f of flowers) poseFlower(f, clamp01((p - f.start) / f.dur) * (p > f.start ? 1 : 0));
  plate.rotation.y = lerp(0, 0.5, p);
  poseCamera(p, time);

  for (const c of chapters) {
    const fadeIn = smoothstep(c.a, c.a + 0.04, p);
    const fadeOut = 1 - smoothstep(c.b - 0.04, c.b, p);
    const o = Math.min(fadeIn, fadeOut);
    c.el.style.opacity = o.toFixed(3);
    c.el.style.transform = `translateY(${((1 - o) * 16).toFixed(1)}px)`;
  }
  hint.style.opacity = (1 - smoothstep(0.0, 0.03, p)).toFixed(3);
  bar.style.transform = `scaleY(${p.toFixed(4)})`;
}

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const goal = scrollProgress();
  // Ease toward the scroll position so wheel steps feel continuous.
  progress += (goal - progress) * (1 - Math.exp(-dt * 7));
  if (Math.abs(goal - progress) < 1e-5) progress = goal;
  update(progress, clock.elapsedTime);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/preview hook: ?p=0.5 jumps straight to a point in the timeline.
const qp = new URLSearchParams(location.search).get('p');
if (qp !== null) {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo(0, clamp01(parseFloat(qp)) * max);
  progress = scrollProgress();
}
