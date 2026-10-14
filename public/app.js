// Constellation — Three.js redesign. State is pushed over SSE; this file
// turns each snapshot into a semi-physical, deep, luminous
// sky instead of a flat network graph. See CLAUDE.md for the architecture
// decision behind adopting Three.js here (client-only, zero server cost).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const HALF_LIFE_DAYS = 21; // mirrors server/db.js — needed to recompute historical brightness client-side

// --- DOM refs --------------------------------------------------------------
const canvas = document.getElementById("sky");
const birthScreen = document.getElementById("birth-screen");
const birthForm = document.getElementById("birth-form");
const hud = document.getElementById("hud");
const hudStats = document.getElementById("hud-stats");
const meName = document.getElementById("me-name");
const modeHint = document.getElementById("mode-hint");
const renameBtn = document.getElementById("rename-btn");
const forgetBtn = document.getElementById("forget-btn");
const renamePanel = document.getElementById("rename-panel");
const renameForm = document.getElementById("rename-form");
const renameInput = document.getElementById("rename-input");
const renameCancel = document.getElementById("rename-cancel");
const connectPanel = document.getElementById("connect-panel");
const connectForm = document.getElementById("connect-form");
const connectTarget = document.getElementById("connect-target");
const connectNote = document.getElementById("connect-note");
const connectCancel = document.getElementById("connect-cancel");
const connectAdminFields = document.getElementById("connect-admin-fields");
const connectDate = document.getElementById("connect-date");
const connectMutual = document.getElementById("connect-mutual");
const adminBadge = document.getElementById("admin-badge");
const hoverLabel = document.getElementById("hover-label");
const reticle = document.getElementById("reticle");
const reticleReadout = reticle.querySelector(".rc-readout");
const timelinePanel = document.getElementById("timeline-panel");
const timelineTitle = document.getElementById("timeline-title");
const timelineList = document.getElementById("timeline-list");
const timelineClose = document.getElementById("timeline-close");
const animateCheckbox = document.getElementById("animate-checkbox");
const historyBtn = document.getElementById("history-btn");
const historyBar = document.getElementById("history-bar");
const historySlider = document.getElementById("history-slider");
const historyDate = document.getElementById("history-date");
const historyClose = document.getElementById("history-close");
const historyStartLabel = document.getElementById("history-start");
const historyEndLabel = document.getElementById("history-end");
const storyBtn = document.getElementById("story-btn");
const storyScroll = document.getElementById("story-scroll");
const storyEnterBtn = document.getElementById("story-enter-btn");

let me = null;
let state = { stars: [], edges: [] };
let historyMode = false;
let historyAsOf = null; // Date, only while historyMode
let storyMode = false;

// animate toggle is a pure viewer preference — never gates a feature
let animate = true;
try {
  const saved = localStorage.getItem("constellation:animate");
  if (saved !== null) animate = saved === "1";
} catch {}
animateCheckbox.checked = animate;
animateCheckbox.addEventListener("change", () => {
  animate = animateCheckbox.checked;
  try { localStorage.setItem("constellation:animate", animate ? "1" : "0"); } catch {}
});

// --- deterministic seeds -----------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

// Each person's star takes a stellar spectral class from its id — real star
// colours, from hot blue O/B through white A/F and yellow G to orange K and
// red M — so the sky reads as a population, not a field of white dots. The
// class is a fingerprint; how big and elaborate a star is comes from its
// connections (`tierFor`), never from the id.
const SPECTRAL = [
  { cls: "O", hex: 0x9db4ff, glow: "157,180,255" },
  { cls: "B", hex: 0xaabfff, glow: "170,191,255" },
  { cls: "A", hex: 0xcad7ff, glow: "202,215,255" },
  { cls: "F", hex: 0xf8f7ff, glow: "248,247,255" },
  { cls: "G", hex: 0xfff2a1, glow: "255,242,161" },
  { cls: "K", hex: 0xffc46f, glow: "255,196,111" },
  { cls: "M", hex: 0xff8a5c, glow: "255,138,92" },
];
const PERSON_COLORS = SPECTRAL;

// Magnitude tiers: a star grows new structure as it gathers connections.
// Thresholds are distinct people connected, not events, so it rewards
// knowing people rather than declaring the same edge over and over.
const TIERS = [
  { min: 0, name: "nascent", size: 0.9 },
  { min: 1, name: "main sequence", size: 1.4 },
  { min: 3, name: "bright", size: 2.1 },
  { min: 6, name: "giant", size: 2.9 },
  { min: 10, name: "supergiant", size: 3.8 },
];
function tierFor(degree) {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (degree >= TIERS[i].min) t = i;
  return t;
}
const styleCache = new Map();
function styleFor(id) {
  if (styleCache.has(id)) return styleCache.get(id);
  const rand = mulberry32(hashString(id) ^ 0x51ed270b);
  // Everything here is a stable fingerprint: colour temperature, halo size,
  // pulse rate, a faint diffraction spike (angle/length), and how many tiny
  // motes orbit it — so a person reads as "their" star, never an avatar.
  const style = {
    color: PERSON_COLORS[Math.floor(rand() * PERSON_COLORS.length)],
    orbitTilt: (rand() - 0.5) * 1.2,
    orbitSpin: (0.15 + rand() * 0.25) * (rand() < 0.5 ? -1 : 1),
    sizeJitter: 0.85 + rand() * 0.5,
    twinklePhase: rand() * Math.PI * 2,
    twinkleSpeed: 0.3 + rand() * 0.4,
    haloScale: 0.8 + rand() * 0.45,
    spikeAngle: rand() * Math.PI / 2,
    spikeLen: 3.2 + rand() * 2.6,
    motes: Math.floor(rand() * 5),
    moteSeed: rand() * 1000,
  };
  styleCache.set(id, style);
  return style;
}

// --- semi-physical layout ------------------------------------------------
// A star's spot isn't fixed: it starts at a deterministic seed (so the first
// frame is reproducible) and then *relaxes* under weak forces — unconnected
// stars drift, connected pairs pull gently together, everything damps hard
// so the motion stays slow. The social graph physically shapes the sky.
function seedPosition(id) {
  const rand = mulberry32(hashString(id));
  const theta = rand() * Math.PI * 2;
  const r = 140 + rand() * 480;
  const z = (rand() - 0.5) * 320;
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r, z };
}
const physics = new Map(); // id -> {x,y,z,vx,vy,vz}
function physicsFor(id) {
  let p = physics.get(id);
  if (!p) {
    const seed = seedPosition(id);
    p = { x: seed.x, y: seed.y, z: seed.z, vx: 0, vy: 0, vz: 0 };
    physics.set(id, p);
  }
  return p;
}
function stepPhysics(dt) {
  const ids = state.stars.map((s) => s.id);
  const pos = new Map(ids.map((id) => [id, physicsFor(id)]));
  const force = new Map(ids.map((id) => [id, { x: 0, y: 0, z: 0 }]));

  for (let i = 0; i < ids.length; i++) {
    const a = pos.get(ids[i]);
    for (let j = i + 1; j < ids.length; j++) {
      const b = pos.get(ids[j]);
      let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1) d2 = 1;
      const d = Math.sqrt(d2);
      const push = 2600 / d2;
      const fx = (dx / d) * push, fy = (dy / d) * push, fz = (dz / d) * push;
      force.get(ids[i]).x += fx; force.get(ids[i]).y += fy; force.get(ids[i]).z += fz;
      force.get(ids[j]).x -= fx; force.get(ids[j]).y -= fy; force.get(ids[j]).z -= fz;
    }
    // gentle centering so the sky doesn't drift off to infinity
    force.get(ids[i]).x -= a.x * 0.0012;
    force.get(ids[i]).y -= a.y * 0.0012;
    force.get(ids[i]).z -= a.z * 0.0012;
  }

  for (const edge of state.edges) {
    const a = pos.get(edge.starA), b = pos.get(edge.starB);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    const rest = 230;
    const strength = (edge.mutual ? 0.012 : 0.006) * (0.4 + edge.brightness * 0.6);
    const pull = (d - rest) * strength;
    const fx = (dx / d) * pull, fy = (dy / d) * pull, fz = (dz / d) * pull;
    a.vx += fx; a.vy += fy; a.vz += fz;
    b.vx -= fx; b.vy -= fy; b.vz -= fz;
  }

  const damping = Math.pow(0.86, dt * 60);
  for (const id of ids) {
    const p = pos.get(id), f = force.get(id);
    p.vx = (p.vx + f.x * dt) * damping;
    p.vy = (p.vy + f.y * dt) * damping;
    p.vz = (p.vz + f.z * dt) * damping;
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    const maxSpeed = 14;
    if (speed > maxSpeed) { p.vx *= maxSpeed / speed; p.vy *= maxSpeed / speed; p.vz *= maxSpeed / speed; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  }
}

// --- three.js scene --------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x05070b, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 6000);

// Bloom: bright cores and supergiant coronas genuinely spill light, so
// brightness (which comes from how recent and frequent connections are)
// reads as light rather than as a sprite. Lighter on small screens.
// OutputPass does the one sRGB conversion at the end; no tone mapping, so
// the near-black sky stays near-black.
renderer.toneMapping = THREE.NoToneMapping;
// The sky colour is scene.background, not the renderer's clear colour: the
// clear colour skips colour management inside the composer and came out
// slate blue (38,46,59 instead of 5,7,11), while a background Color is
// converted correctly. Checked with a minimal three@0.169 repro.
scene.background = new THREE.Color(0x05070b);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const SMALL_SCREEN = Math.min(window.innerWidth, window.innerHeight) < 600;
// High threshold: only genuinely bright cores bloom, never the decorative
// dust or nebula.
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), SMALL_SCREEN ? 0.5 : 0.75, 0.4, 0.62);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// damped orbit camera: "weight", never 1:1 instant-follow
const cam = {
  theta: Math.PI * 0.25, phi: Math.PI * 0.38, radius: 900,
  target: new THREE.Vector3(0, 0, 0),
  desired: { theta: Math.PI * 0.25, phi: Math.PI * 0.38, radius: 900, target: new THREE.Vector3(0, 0, 0) },
  ease: 0.07,
};
function applyCamera() {
  const t = cam;
  t.theta += (t.desired.theta - t.theta) * t.ease;
  t.phi += (t.desired.phi - t.phi) * t.ease;
  t.radius += (t.desired.radius - t.radius) * t.ease;
  t.target.lerp(t.desired.target, t.ease);
  const sinPhi = Math.sin(t.phi);
  camera.position.set(
    t.target.x + t.radius * sinPhi * Math.cos(t.theta),
    t.target.y + t.radius * Math.cos(t.phi),
    t.target.z + t.radius * sinPhi * Math.sin(t.theta),
  );
  camera.lookAt(t.target);
}

function projectToScreen(v3, viewCamera = camera) {
  const p = v3.clone().project(viewCamera);
  return {
    x: (p.x * 0.5 + 0.5) * window.innerWidth,
    y: (1 - (p.y * 0.5 + 0.5)) * window.innerHeight,
    behind: p.z > 1,
  };
}

// --- reusable glow textures ------------------------------------------------
function makeRadialTexture(inner, outer, mid) {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  // inset by a pixel so the outermost ring is exactly transparent — under
  // bloom's linear compositing any alpha left at the edge showed the
  // sprite's square outline
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2 - 1);
  grad.addColorStop(0, inner);
  if (mid) grad.addColorStop(0.6, mid);
  grad.addColorStop(0.85, mid ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.03)");
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const haloTexture = makeRadialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)");
// must reach alpha 0 at the edge, or the sprite's square outline shows up close
const coreTexture = makeRadialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)", "rgba(255,255,255,0.12)");
const ringTexture = (() => {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 4;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
})();

// HUD-style orbit ring: a thin circle with tick marks and one bright arc, so
// a rotating ring reads as instrumentation rather than a plain halo.
const orbitTexture = (() => {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = size / 2 - 8;
  g.translate(size / 2, size / 2);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const len = i % 6 === 0 ? 9 : 4;
    g.strokeStyle = i % 6 === 0 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)";
    g.beginPath();
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    g.lineTo(Math.cos(a) * (r - len), Math.sin(a) * (r - len));
    g.stroke();
  }
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 3.5;
  g.beginPath(); g.arc(0, 0, r, -0.5, 0.45); g.stroke();
  return new THREE.CanvasTexture(c);
})();
// hairline ring for the sonar ping, so it stays thin when scaled up large
const pulseTexture = (() => {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 2;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2); g.stroke();
  return new THREE.CanvasTexture(c);
})();
// soft, slightly ragged corona for supergiants
const coronaTexture = (() => {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.translate(size / 2, size / 2);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const len = size * (0.26 + 0.18 * Math.abs(Math.sin(i * 2.7)));
    const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
  }
  return new THREE.CanvasTexture(c);
})();

// faint four-point diffraction spike: two thin crossed lines that taper to a
// point at each end and fade toward the centre too, so where they cross
// doesn't stack into a bright square under bloom
const spikeTexture = (() => {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const h = size / 2;
  for (const horizontal of [true, false]) {
    const grad = horizontal
      ? g.createLinearGradient(0, 0, size, 0)
      : g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.42, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
    grad.addColorStop(0.58, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    if (horizontal) { g.moveTo(0, h); g.lineTo(h, h - 1.5); g.lineTo(size, h); g.lineTo(h, h + 1.5); }
    else { g.moveTo(h, 0); g.lineTo(h + 1.5, h); g.lineTo(h, size); g.lineTo(h - 1.5, h); }
    g.closePath();
    g.fill();
  }
  return new THREE.CanvasTexture(c);
})();

function textSprite(text, color = "rgba(233,230,222,0.9)") {
  const c = document.createElement("canvas");
  const scale = 2;
  c.width = 256 * scale; c.height = 64 * scale;
  const g = c.getContext("2d");
  g.font = `${22 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`;
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(70, 17.5, 1);
  return sprite;
}
// Every textSprite() call allocates its own CanvasTexture; over a long-lived
// public session (renames, "joined the sky" spectacle labels) never
// disposing these leaks GPU texture memory, which on a constrained GPU can
// eventually surface as a failed/placeholder (flat grey) texture elsewhere —
// so anything built by textSprite() must be disposed through this when
// removed, not just unparented.
function disposeSprite(sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

// --- background dust + nebula wash (purely decorative, fixed seed) --------
const SKY_SEED = 1337;
(function buildDust() {
  const rand = mulberry32(SKY_SEED);
  const count = 3200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const base = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = 500 + rand() * 2600;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.6;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const warmth = rand();
    base.setRGB(0.85 + warmth * 0.15, 0.85 + warmth * 0.1, 0.9 - warmth * 0.1);
    base.toArray(colors, i * 3);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.4, vertexColors: true, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const dust = new THREE.Points(geom, mat);
  scene.add(dust);

  for (let i = 0; i < 2; i++) {
    const r = 900 + rand() * 900;
    const theta = rand() * Math.PI * 2;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      // tuned for the bloom pipeline's linear compositing, where the dark end
      // is lifted on output: 0.05 here (the pre-bloom value) washes the sky
      map: haloTexture, color: 0x6a7bd6, transparent: true, opacity: 0.03,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.position.set(Math.cos(theta) * r, (rand() - 0.5) * 300, Math.sin(theta) * r);
    sprite.scale.set(1800, 1800, 1);
    scene.add(sprite);
  }

  window.__dust = dust;
})();

// --- star visuals ---------------------------------------------------------
const starNodes = new Map(); // id -> {group, core, halo, ring, label, labelText, scale}
function nodeFor(star) {
  let node = starNodes.get(star.id);
  if (!node) {
    const style = styleFor(star.id);
    const group = new THREE.Group();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture, color: style.color.hex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: coreTexture, color: style.color.hex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTexture, color: 0x9ad1ff, transparent: true, opacity: 0,
      depthWrite: false,
    }));
    const spike = new THREE.Sprite(new THREE.SpriteMaterial({
      map: spikeTexture, color: style.color.hex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, rotation: style.spikeAngle,
    }));
    const motes = [];
    for (let i = 0; i < style.motes; i++) {
      const mote = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTexture, color: style.color.hex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      group.add(mote);
      motes.push(mote);
    }
    // Tier structure. Orbit rings are flat meshes, not sprites, so they tilt
    // in 3D and foreshorten as the camera moves — that's what sells them.
    const orbitMat = () => new THREE.MeshBasicMaterial({
      map: orbitTexture, color: style.color.hex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const orbitGeom = new THREE.PlaneGeometry(1, 1);
    const orbitA = new THREE.Mesh(orbitGeom, orbitMat());
    const orbitB = new THREE.Mesh(orbitGeom, orbitMat());
    orbitA.rotation.x = Math.PI / 2 + style.orbitTilt;
    orbitB.rotation.x = Math.PI / 2 - style.orbitTilt * 0.6;
    orbitB.rotation.y = 1.1;
    const corona = new THREE.Sprite(new THREE.SpriteMaterial({
      map: coronaTexture, color: style.color.hex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const pulse = new THREE.Sprite(new THREE.SpriteMaterial({
      map: pulseTexture, color: style.color.hex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    group.add(corona, halo, spike, orbitA, orbitB, pulse, core, ring);
    scene.add(group);
    node = {
      group, core, halo, ring, spike, motes, orbitA, orbitB, corona, pulse,
      // eased tier (fractional while growing) and when it last went up
      tierF: -1, tier: -1, levelUpAt: -1e9,
      label: null, labelText: null, scale: 0,
      // eased visual state, so status changes (online → recent → dim) and
      // attention dimming glide instead of popping
      coreA: 0, haloA: 0, haloR: 0, attn: 1, labelA: 0,
    };
    starNodes.set(star.id, node);
  }
  return node;
}

// --- connection visuals ----------------------------------------------------
// One declared event = one strand of light: a thin additive line along a
// gently-bent curve between the two stars, fanned out per event so repeated
// events visibly read as separate threads, plus a small travelling photon.
const STRAND_SAMPLES = 120; // enough for ~7 helix turns to stay smooth
const strands = new Map(); // "edgeId:i" -> {line, photon, color, speed, phase, seed}
// Redshift: old light is redder. A strand starts in its declarer's colour
// and drifts toward deep red as the event it stands for recedes into the
// past — the README's "a friendship from last year is fainter old light,
// not deleted", drawn as colour. Measured against History's date when
// scrubbing, so dragging the timeline shows light reddening. Much slower
// than brightness's 21-day half-life, so old friends don't all turn red.
const REDSHIFT_DAYS = 240;
const OLD_LIGHT = new THREE.Color(0xff5a3c);
const tmpColor = new THREE.Color();
function redshifted(baseHex, occurredOn, nowMs) {
  const ageDays = Math.max(0, (nowMs - new Date(occurredOn).getTime()) / 86_400_000);
  const k = 1 - Math.exp(-ageDays / REDSHIFT_DAYS);
  return tmpColor.setHex(baseHex).lerp(OLD_LIGHT, k * 0.85);
}

function strandFor(key, color) {
  let s = strands.get(key);
  if (!s) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STRAND_SAMPLES * 3), 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    const photon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    photon.scale.set(10, 10, 1);
    scene.add(photon);
    s = { line, photon };
    strands.set(key, s);
  }
  return s;
}
const liveStrandKeys = new Set();

function quadBezier(a, m, b, t, out) {
  const omt = 1 - t;
  out.x = omt * omt * a.x + 2 * omt * t * m.x + t * t * b.x;
  out.y = omt * omt * a.y + 2 * omt * t * m.y + t * t * b.y;
  out.z = omt * omt * a.z + 2 * omt * t * m.z + t * t * b.z;
  return out;
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpM = new THREE.Vector3(), tmpM2 = new THREE.Vector3(), tmpP = new THREE.Vector3();

function newestEventIndex(events) {
  let best = events.length - 1, bestT = -Infinity;
  events.forEach((ev, i) => {
    const t = ev.declaredAt ? new Date(ev.declaredAt).getTime() : -Infinity;
    if (t > bestT) { bestT = t; best = i; }
  });
  return best;
}
function updateConnections(nowMs, drawEdges, focusId) {
  liveStrandKeys.clear();
  for (const edge of drawEdges) {
    const touchesFocus = !!focusId && (edge.starA === focusId || edge.starB === focusId);
    const attnTarget = !focusId ? 1 : touchesFocus ? 1.7 : 0.3;
    // a just-declared strand stays dark until its travelling light arrives
    const inFlight = travelInFlight(edge.starA, edge.starB);
    const newest = inFlight ? newestEventIndex(edge.events ?? []) : -1;
    const pa = physicsFor(edge.starA), pb = physicsFor(edge.starB);
    tmpA.set(pa.x, pa.y, pa.z);
    tmpB.set(pb.x, pb.y, pb.z);
    const ab = tmpB.clone().sub(tmpA);
    const abLen = Math.max(1, ab.length());
    const abNorm = ab.clone().divideScalar(abLen);
    let u = new THREE.Vector3().crossVectors(abNorm, new THREE.Vector3(0, 1, 0));
    if (u.lengthSq() < 1e-4) u = new THREE.Vector3().crossVectors(abNorm, new THREE.Vector3(1, 0, 0));
    u.normalize();
    const v = new THREE.Vector3().crossVectors(abNorm, u).normalize();

    const events = edge.events ?? [];
    const n = events.length;
    // On a mutual edge, each side's newest declaration becomes one of the
    // two helix strands; every older event stays a thin fanned arc.
    const helixLead = new Set();
    if (edge.mutual) {
      for (const who of [edge.starA, edge.starB]) {
        let best = -1;
        events.forEach((ev, k) => { if (ev.declaredBy === who && (best < 0 || ev.occurredOn >= events[best].occurredOn)) best = k; });
        if (best >= 0) helixLead.add(best);
      }
    }
    events.forEach((ev, i) => {
      const key = `${edge.id}:${i}`;
      liveStrandKeys.add(key);
      const seed = Math.abs(hashString(key));
      const color = (styleFor(ev.declaredBy).color);
      const strand = strandFor(key, color.hex);
      const asOfMs = historyMode && historyAsOf ? historyAsOf.getTime() : Date.now();
      const shifted = redshifted(color.hex, ev.occurredOn, asOfMs);
      strand.line.material.color.copy(shifted);
      strand.photon.material.color.copy(shifted);

      const angle = (seed % 628) / 100;
      const mag = 16 + (i % 6) * 10 + (n > 1 ? 14 : 0);
      const offset = u.clone().multiplyScalar(Math.cos(angle) * mag).add(v.clone().multiplyScalar(Math.sin(angle) * mag));
      tmpM.copy(tmpA).add(tmpB).multiplyScalar(0.5).add(offset);

      // Mutual edges twist into a double helix: each side's strands wind
      // around the bent spine half a turn apart, so "both of us said so"
      // reads as two threads braided together. One-sided edges keep the
      // plain fanned arc.
      const helix = helixLead.has(i);
      const side = ev.declaredBy === edge.starA ? 0 : Math.PI;
      const turns = Math.max(2, Math.min(6, Math.round(abLen / 110)));
      const helixR = Math.max(8, Math.min(22, abLen * 0.045));
      const helixSpin = animate ? animClock * 0.0003 : 0;
      tmpM2.copy(tmpA).add(tmpB).multiplyScalar(0.5).add(
        u.clone().multiplyScalar(Math.cos(angle) * 22).add(v.clone().multiplyScalar(Math.sin(angle) * 22)),
      );
      const posAttr = strand.line.geometry.attributes.position;
      for (let s = 0; s < STRAND_SAMPLES; s++) {
        const t = s / (STRAND_SAMPLES - 1);
        if (helix) {
          quadBezier(tmpA, tmpM2, tmpB, t, tmpP);
          const env = Math.sin(Math.PI * t); // pinch to the stars at both ends
          const ph = t * turns * Math.PI * 2 + side + helixSpin;
          tmpP.addScaledVector(u, Math.cos(ph) * helixR * env).addScaledVector(v, Math.sin(ph) * helixR * env);
        } else {
          quadBezier(tmpA, tmpM, tmpB, t, tmpP);
        }
        posAttr.setXYZ(s, tmpP.x, tmpP.y, tmpP.z);
      }
      posAttr.needsUpdate = true;

      // age-in: a brand new strand fades up rather than popping into place
      if (strand.bornAt === undefined || i === newest) strand.bornAt = nowMs;
      strand.attn = (strand.attn ?? 1) + (attnTarget - (strand.attn ?? 1)) * 0.06;
      const age = (nowMs - strand.bornAt) / 1000;
      const fadeIn = Math.min(1, age / 1.4);
      // Slow, barely-there shimmer rather than a visible pulse — this used to
      // run at ~3s/cycle with a ~3-6s photon loop, which read as "too fast"
      // (frantic flicker, especially with several strands fanned on one
      // edge). Both are now ~3x slower: a gentle multi-second drift.
      const pulse = animate ? 0.9 + 0.1 * Math.sin(nowMs * 0.0007 + seed) : 1;
      const visible = fadeIn * (ev.fade ?? 1) * revealMul * strand.attn;
      const role = helix ? 1.6 : edge.mutual ? 0.45 : 1;
      strand.line.material.opacity = Math.min(0.95, Math.max(helix ? 0.35 : 0, ev.brightness) * 0.55 * role * pulse * visible);

      if (animate) {
        const speed = 0.00005 + (seed % 97) / 97 * 0.00006;
        const phase = (seed % 1000) / 1000;
        const frac = (nowMs * speed + phase) % 1;
        if (helix) {
          quadBezier(tmpA, tmpM2, tmpB, frac, tmpP);
          const env = Math.sin(Math.PI * frac);
          const ph = frac * turns * Math.PI * 2 + side + (animate ? animClock * 0.0003 : 0);
          tmpP.addScaledVector(u, Math.cos(ph) * helixR * env).addScaledVector(v, Math.sin(ph) * helixR * env);
        } else {
          quadBezier(tmpA, tmpM, tmpB, frac, tmpP);
        }
        strand.photon.position.copy(tmpP);
        strand.photon.material.opacity = ev.brightness * 0.8 * visible;
      } else {
        strand.photon.material.opacity = 0;
      }
    });
  }
  for (const [key, s] of strands) {
    if (!liveStrandKeys.has(key)) {
      s.line.material.opacity *= 0.85;
      s.photon.material.opacity *= 0.85;
      if (s.line.material.opacity < 0.01) {
        scene.remove(s.line); scene.remove(s.photon);
        s.line.geometry.dispose(); s.line.material.dispose();
        s.photon.material.dispose(); // photon.material.map is the shared haloTexture — leave it
        strands.delete(key);
      }
    }
  }
}

// --- gravity preview (connect-mode) ----------------------------------------
const previewGeom = new THREE.BufferGeometry();
previewGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
const previewLine = new THREE.Line(previewGeom, new THREE.LineDashedMaterial({
  color: 0x9ad1ff, transparent: true, opacity: 0, dashSize: 8, gapSize: 6, blending: THREE.AdditiveBlending,
}));
previewLine.computeLineDistances();
scene.add(previewLine);

// --- transient "light travels from A to B" on a new declaration -----------
// Fired for your own declare immediately, and for anyone else's when the
// pushed snapshot carries a new event, so other viewers watch the light arrive too.
// The light leaves A as a bright point trailing a few dimmer dots
// ("✦ · · ·"), arcs over to B, and only then does the strand itself fade in
// (see travelInFlight in updateConnections).
const TRAVEL_TRAIL = 4;
const travels = []; // {fromId, toId, start, duration, sprites}
function beginTravel(fromId, toId) {
  const sprites = [];
  for (let k = 0; k <= TRAVEL_TRAIL; k++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture, color: 0xffe196, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const size = k === 0 ? 14 : 6;
    sprite.scale.set(size, size, 1);
    scene.add(sprite);
    sprites.push(sprite);
  }
  travels.push({ fromId, toId, start: performance.now(), duration: 1800, sprites });
}
function travelInFlight(a, b) {
  return travels.some((t) => (t.fromId === a && t.toId === b) || (t.fromId === b && t.toId === a));
}
function travelPoint(a, b, t, out) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + Math.hypot(b.x - a.x, b.z - a.z) * 0.12, z: (a.z + b.z) / 2 };
  return quadBezier(a, mid, b, t, out);
}

// --- interaction state -------------------------------------------------
let connectMode = false;
let hoverStarId = null;
let selectedTargetId = null;
const STAR_HIT_PX = 18;
const EDGE_HIT_PX = 7;
const ONLINE_MS = 20_000; // "last seen now" grace for a star that just closed its tab
const ACTIVE_MS = 10 * 60_000; // declared something this recently → "currently active"
const FLARE_PERIOD_S = 7;

// Clicking someone's star focuses it: the camera flies to it and stays
// until you click empty sky (or press Esc). Hover still works on top.
let focusStarId = null;
let focusReturnRadius = null;
function focusStar(id) {
  if (!focusStarId) focusReturnRadius = cam.desired.radius;
  focusStarId = id;
  cam.desired.radius = Math.min(cam.desired.radius, 360);
}
function clearFocus() {
  if (!focusStarId) return;
  focusStarId = null;
  if (focusReturnRadius) cam.desired.radius = focusReturnRadius;
  focusReturnRadius = null;
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { clearFocus(); connectMode = false; setHint(); }
});

function attentionStarId() {
  if (historyMode || storyMode || intro) return null;
  return hoverStarId ?? focusStarId;
}
let lastAttentionId = null;
let attentionSince = 0;
function neighbourIds(id) {
  const out = new Set();
  for (const e of state.edges) {
    if (e.starA === id) out.add(e.starB);
    else if (e.starB === id) out.add(e.starA);
  }
  return out;
}
function activeStarIds() {
  const cutoff = Date.now() - ACTIVE_MS;
  const out = new Set();
  for (const e of state.edges) {
    for (const ev of e.events ?? []) {
      if (ev.declaredAt && new Date(ev.declaredAt).getTime() > cutoff) out.add(ev.declaredBy);
    }
  }
  return out;
}

// --- admin mode: backfill a connection between two *other* people's stars --
// Not part of the designed visitor experience — a owner-only tool (shift+A,
// then an admin key kept in localStorage) for recording real history that
// predates this site, where neither side is around to click "connect"
// themselves. Server-side the endpoint is a 404 unless ADMIN_KEY is set.
let adminMode = false;
let adminFromId = null;
function setAdminHint() {
  if (!adminMode) return;
  modeHint.textContent = adminFromId
    ? "click the other star to connect them — click the same star to cancel"
    : "admin: click a star to start a connection between two other people";
}
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "a" || !e.shiftKey) return;
  if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  adminMode = !adminMode;
  adminFromId = null;
  adminBadge.classList.toggle("hidden", !adminMode);
  if (adminMode) {
    try { if (!localStorage.getItem("constellation:adminKey")) {
      const key = prompt("admin key (kept only in this browser)");
      if (key) localStorage.setItem("constellation:adminKey", key);
    } } catch {}
    setAdminHint();
  } else {
    setHint();
  }
});

function setHint() {
  if (adminMode) { setAdminHint(); return; }
  if (!me) { modeHint.textContent = ""; return; }
  modeHint.textContent = connectMode
    ? "move toward another star, then click to connect — click elsewhere to cancel"
    : "drag to drift · scroll to travel deeper · click your star to connect";
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const factor = Math.pow(1.0018, e.deltaY);
    cam.desired.radius = Math.min(2600, Math.max(40, cam.desired.radius * factor));
  },
  { passive: false },
);

let dragging = false, dragStart = null;
canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragStart = { x: e.clientX, y: e.clientY, theta: cam.desired.theta, phi: cam.desired.phi, moved: false };
});
window.addEventListener("pointermove", (e) => {
  updateHover(e);
  if (!dragging || !dragStart) return;
  const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragStart.moved = true;
  cam.desired.theta = dragStart.theta - dx * 0.004;
  cam.desired.phi = Math.min(Math.PI - 0.15, Math.max(0.15, dragStart.phi - dy * 0.004));
});
window.addEventListener("pointerup", (e) => {
  if (dragging && dragStart && !dragStart.moved) onCanvasClick(e);
  dragging = false; dragStart = null;
});

function screenPosOf(id, viewCamera) {
  const p = physicsFor(id);
  return projectToScreen(new THREE.Vector3(p.x, p.y, p.z), viewCamera);
}
// The focused star's "zone" is a capsule from the screen point where it was
// when focus began (`hoverAnchor`) to where it's rendered now, so the cursor
// can stay put OR follow the star as gravity-of-attention pans it toward
// centre without losing focus. Hover and click share this one test — they
// used to use different cameras, so a click where the star had been missed
// it once the pan had moved it.
let hoverAnchor = null;
function inFocusZone(id, sx, sy) {
  const b = screenPosOf(id, camera);
  if (b.behind) return false;
  const a = hoverAnchor ?? b;
  return pointToSegmentDistance(sx, sy, a.x, a.y, b.x, b.y) <= STAR_HIT_PX * 1.8;
}
function findStarAt(sx, sy) {
  if (hoverStarId) {
    const focused = state.stars.find((s) => s.id === hoverStarId);
    if (focused && inFocusZone(focused.id, sx, sy)) return focused;
  }
  let best = null, bestDist = Infinity;
  for (const star of state.stars) {
    const s = screenPosOf(star.id, camera);
    if (s.behind) continue;
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d <= STAR_HIT_PX && d < bestDist) { bestDist = d; best = star; }
  }
  return best;
}
function findEdgeAt(sx, sy) {
  for (const edge of state.edges) {
    const pa = physicsFor(edge.starA), pb = physicsFor(edge.starB);
    const a = projectToScreen(new THREE.Vector3(pa.x, pa.y, pa.z));
    const b = projectToScreen(new THREE.Vector3(pb.x, pb.y, pb.z));
    const d = pointToSegmentDistance(sx, sy, a.x, a.y, b.x, b.y);
    if (d <= EDGE_HIT_PX) return edge;
  }
  return null;
}
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// When focus drops, the pan holds for HOVER_RELEASE_MS before easing back,
// so moving from one star to the next doesn't slide the next one out from
// under the cursor mid-reach.
const HOVER_RELEASE_MS = 700;
let hoverSince = 0;
let hoverLostAt = -Infinity;
function updateHover(e) {
  if (historyMode || storyMode || inputLocked() || flight) return;
  if (dragging && dragStart?.moved) {
    if (hoverStarId) hoverLostAt = performance.now();
    hoverStarId = null; hoverAnchor = null;
    return;
  }
  const star = findStarAt(e.clientX, e.clientY);
  const id = star ? star.id : null;
  if (id === hoverStarId) return;
  if (id) {
    hoverSince = performance.now();
    hoverAnchor = screenPosOf(id, camera);
  } else {
    hoverLostAt = performance.now();
    hoverAnchor = null;
  }
  hoverStarId = id;
}

// Travel: clicking a connection flies the camera along its curve to the far
// end (starting from whichever end is focused, else the end nearer the
// click), then focuses that star and opens the connection's timeline.
let flight = null; // {fromId, toId, edge, start, duration, startTarget}
function flyAlongEdge(edge, sx, sy) {
  let from;
  if (focusStarId === edge.starA || focusStarId === edge.starB) {
    from = focusStarId;
  } else {
    const a = screenPosOf(edge.starA, camera), b = screenPosOf(edge.starB, camera);
    from = Math.hypot(a.x - sx, a.y - sy) <= Math.hypot(b.x - sx, b.y - sy) ? edge.starA : edge.starB;
  }
  if (!focusStarId) focusReturnRadius = cam.desired.radius;
  focusStarId = null;
  hoverStarId = null; hoverAnchor = null;
  timelinePanel.classList.add("hidden");
  flight = {
    fromId: from, toId: from === edge.starA ? edge.starB : edge.starA, edge,
    start: performance.now(), duration: 3200, startTarget: cam.target.clone(),
  };
  cam.desired.radius = 200;
}
function stepFlight(nowMs) {
  if (!flight) return;
  const t = Math.min(1, (nowMs - flight.start) / flight.duration);
  const onCurve = travelPoint(physicsFor(flight.fromId), physicsFor(flight.toId), smoothstep(t), new THREE.Vector3());
  // the first stretch blends in from wherever the camera was looking
  const target = flight.startTarget.clone().lerp(onCurve, smoothstep(Math.min(1, t / 0.3)));
  cam.target.copy(target);
  cam.desired.target.copy(target);
  if (t >= 1) {
    const { toId, edge } = flight;
    flight = null;
    focusStarId = toId;
    openTimeline(edge);
  }
}

function onCanvasClick(e) {
  if (historyMode || storyMode || flight) return;
  const star = findStarAt(e.clientX, e.clientY);

  if (adminMode) {
    if (star) {
      if (adminFromId === star.id) { adminFromId = null; setAdminHint(); return; }
      if (adminFromId) { openConnectPanel(star, adminFromId); return; }
      adminFromId = star.id;
      setAdminHint();
    }
    return;
  }

  if (star) {
    if (me && star.id === me.id) {
      connectMode = !connectMode;
      setHint();
      return;
    }
    if (connectMode && me) {
      openConnectPanel(star);
      return;
    }
    focusStar(star.id);
    return;
  }

  if (connectMode) { connectMode = false; setHint(); return; }

  const edge = findEdgeAt(e.clientX, e.clientY);
  if (edge) { flyAlongEdge(edge, e.clientX, e.clientY); return; }
  clearFocus();
  timelinePanel.classList.add("hidden");
}

// --- intros: watch-only arrival and birth ---------------------------------
// Two intros, both watch-only (`#input-blocker` swallows pointer, wheel and
// keys; the HUD stays hidden until they finish):
//   arrival — every page load with an existing star: your star kindles in
//     the dark, then the camera pulls back to the whole sky as everyone else
//     fades in, landing exactly on Explore's default pose.
//   birth — right after claiming a new star: the *same* kindle, but as
//     Story's opening — beat 01 copy fades in, then it unlocks right there on
//     page 01 with "scroll to continue", so the reader's own scroll pulls back
//     into beat 02 and reveals the sky. One continuous camera, no hand-off.
const INTRO_KINDLE_S = 1.6;
const ARRIVAL_PULL_S = 4.6;
const BIRTH_UNLOCK_S = INTRO_KINDLE_S + 1.8; // kindle, then beat 01 copy fully in
const inputBlocker = document.getElementById("input-blocker");
let intro = null; // {mode: "arrival" | "birth", start}
let revealMul = 1; // 0..1 brightness for everything that isn't your star
let storyCopyGate = 1; // holds Story copy back until your star has kindled
function inputLocked() { return !!intro; }
function startIntro(mode) {
  if (!me) return;
  if (historyMode) exitHistory();
  clearFocus(); flight = null;
  hoverStarId = null; hoverAnchor = null; connectMode = false;
  timelinePanel.classList.add("hidden");
  const node = starNodes.get(me.id);
  if (node) node.scale = 0;
  // a poll already in flight when you claimed can still announce your own
  // star as a stranger joining; never show that to you
  for (let i = spectacleLabels.length - 1; i >= 0; i--) {
    if (spectacleLabels[i].starId !== me.id) continue;
    scene.remove(spectacleLabels[i].sprite);
    disposeSprite(spectacleLabels[i].sprite);
    spectacleLabels.splice(i, 1);
  }
  intro = { mode, start: performance.now() };
  inputBlocker.classList.remove("hidden");
  hud.classList.add("hidden");
  if (mode === "birth") enterStory();
}
function endIntro() {
  intro = null;
  storyCopyGate = 1;
  inputBlocker.classList.add("hidden");
  if (me) hud.classList.remove("hidden");
  setHint();
}
function arrivalPose(u) {
  const M = storyStarPos(me.id);
  const k = smoothstep(u);
  // hold on your star for the first stretch of the pull-back, then drift to
  // the centre, so your star never slides out of frame mid-way
  const w = smoothstep(Math.min(1, Math.max(0, (u - 0.45) / 0.55)));
  return {
    target: lerpPoint(M, ORIGIN, w),
    theta: Math.PI * 0.6 + (STORY_DEFAULT.theta - Math.PI * 0.6) * k,
    phi: Math.PI * 0.45 + (STORY_DEFAULT.phi - Math.PI * 0.45) * k,
    radius: Math.exp(Math.log(70) + (Math.log(STORY_DEFAULT.radius) - Math.log(70)) * k),
  };
}
// returns true when the intro drove the camera itself this frame
function stepIntro(nowMs) {
  storyCopyGate = 1;
  if (!intro) { revealMul = storyMode ? smoothstep(Math.min(1, storyProgress / 0.85)) : 1; return false; }
  const t = (nowMs - intro.start) / 1000;
  if (intro.mode === "arrival") {
    const u = Math.min(1, Math.max(0, (t - INTRO_KINDLE_S) / ARRIVAL_PULL_S));
    revealMul = smoothstep(Math.min(1, u / 0.8));
    applyPose(arrivalPose(u));
    if (u >= 1) {
      cam.desired.theta = STORY_DEFAULT.theta; cam.desired.phi = STORY_DEFAULT.phi;
      cam.desired.radius = STORY_DEFAULT.radius; cam.desired.target.set(0, 0, 0);
      endIntro();
    }
    return true;
  }
  // birth: hold Story on page 01 while your star kindles; stepStory moves the camera
  storyCopyGate = Math.min(1, Math.max(0, (t - INTRO_KINDLE_S) / 1.2));
  storyScroll.scrollTop = 0;
  revealMul = smoothstep(Math.min(1, storyProgress / 0.85));
  if (t >= BIRTH_UNLOCK_S) endIntro();
  return false;
}
// watch-only means watch-only: swallow input while an intro plays
inputBlocker.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
for (const type of ["pointerdown", "pointerup", "click", "dblclick", "contextmenu"]) {
  inputBlocker.addEventListener(type, (e) => { e.preventDefault(); e.stopPropagation(); });
}
window.addEventListener("keydown", (e) => {
  if (inputLocked()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, { capture: true });

async function refreshMe() {
  const res = await fetch("/api/me");
  const data = await res.json();
  me = data.star;
  if (me) {
    birthScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    meName.textContent = me.pseudonym;
    setHint();
  } else {
    birthScreen.classList.remove("hidden");
    hud.classList.add("hidden");
  }
}

async function claim(pseudonym) {
  const res = await fetch("/api/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym }),
  });
  return { res, data: await res.json() };
}

birthForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pseudonym = document.getElementById("pseudonym").value;
  // A name already in the sky enters that star (ADR 0002), so there's no
  // duplicate prompt any more: returning plays the arrival, not a birth.
  const { res, data } = await claim(pseudonym);
  if (res.ok) {
    // set who you are *before* the poll, or noteSpectacle announces your own
    // new star as "X joined the sky" — a giant, cut-off label at birth range
    me = data.star;
    await pollState();
    await refreshMe();
    connectStream();
    startIntro(data.returning ? "arrival" : "birth");
  } else {
    alert(data.error);
  }
});

// --- connect panel -------------------------------------------------------
// `adminFromStarId` is only set when admin mode opened this panel between
// two other people's stars; plain visitor use always connects from `me`.
let adminPendingFromId = null;
function openConnectPanel(star, adminFromStarId) {
  selectedTargetId = star.id;
  adminPendingFromId = adminFromStarId ?? null;
  const fromName = adminPendingFromId ? (state.stars.find((s) => s.id === adminPendingFromId)?.pseudonym ?? "?") : null;
  connectTarget.textContent = adminPendingFromId ? `${fromName} ↔ ${star.pseudonym}` : star.pseudonym;
  connectNote.value = "";
  connectAdminFields.classList.toggle("hidden", !adminPendingFromId);
  if (adminPendingFromId) {
    connectDate.value = new Date().toISOString().slice(0, 10);
    connectMutual.checked = true;
  }
  connectPanel.classList.remove("hidden");
}
connectCancel.addEventListener("click", () => {
  connectPanel.classList.add("hidden");
  adminPendingFromId = null;
  adminFromId = null;
  connectMode = false;
  setHint();
});
connectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = connectForm.querySelector("input[name=type]:checked").value;
  const note = connectNote.value;

  if (adminPendingFromId) {
    const fromId = adminPendingFromId, toId = selectedTargetId;
    let adminKey = null;
    try { adminKey = localStorage.getItem("constellation:adminKey"); } catch {}
    await fetch("/api/admin/connect", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": adminKey ?? "" },
      body: JSON.stringify({ fromId, toId, type, occurredOn: connectDate.value, note, mutual: connectMutual.checked }),
    });
    connectPanel.classList.add("hidden");
    adminPendingFromId = null;
    adminFromId = null;
    setHint();
    await pollState();
    return;
  }

  const res = await fetch("/api/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: selectedTargetId, type, note }),
  });
  if (!res.ok) {
    alert((await res.json()).error ?? "couldn't declare that connection");
    return;
  }
  connectPanel.classList.add("hidden");
  if (me && selectedTargetId) beginTravel(me.id, selectedTargetId);
  connectMode = false; setHint();
  await pollState();
});

// --- rename --------------------------------------------------------------
renameBtn.addEventListener("click", () => {
  renameInput.value = me?.pseudonym ?? "";
  renamePanel.classList.remove("hidden");
  renameInput.focus();
});
renameCancel.addEventListener("click", () => renamePanel.classList.add("hidden"));
renameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pseudonym = renameInput.value;
  const res = await fetch("/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym }),
  });
  if (res.ok) {
    renamePanel.classList.add("hidden");
    const node = starNodes.get(me.id);
    if (node) node.labelText = null; // force label texture rebuild
    await refreshMe();
  } else {
    const { error } = await res.json();
    alert(error);
  }
});

forgetBtn.addEventListener("click", async () => {
  if (!confirm("Forget this browser's star and start over? Your current star stays in the sky — this browser just stops being it.")) return;
  await fetch("/api/forget", { method: "POST" });
  if (storyMode) exitStory();
  if (historyMode) exitHistory();
  clearFocus(); flight = null;
  me = null;
  connectMode = false;
  connectStream();
  birthScreen.classList.remove("hidden");
  hud.classList.add("hidden");
});

// --- timeline (kept public, per CLAUDE.md) --------------------------------
const TYPE_LABEL = {
  know: "said they know", worked_together: "said they worked together",
  met_today: "said they met up", hung_out: "said they hung out",
};
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function openTimeline(edge) {
  const res = await fetch(`/api/edges/${edge.id}`);
  if (!res.ok) return;
  const { events } = await res.json();
  const starA = state.stars.find((s) => s.id === edge.starA);
  const starB = state.stars.find((s) => s.id === edge.starB);
  timelineTitle.textContent = `${starA?.pseudonym ?? "?"} ↔ ${starB?.pseudonym ?? "?"}`;
  timelineList.innerHTML = "";
  for (const ev of events) {
    const who = state.stars.find((s) => s.id === ev.declared_by)?.pseudonym ?? "someone";
    const li = document.createElement("li");
    const note = ev.note ? ` — "${escapeHtml(ev.note)}"` : "";
    li.innerHTML = `<span class="date">${ev.occurred_on}</span>${escapeHtml(who)} ${TYPE_LABEL[ev.type] ?? ev.type}${note}`;
    timelineList.appendChild(li);
  }
  timelinePanel.classList.remove("hidden");
}
timelineClose.addEventListener("click", () => timelinePanel.classList.add("hidden"));

// --- floating star info ("ALICE / joined 14 Sep / …") ---------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(d) {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? "" : " " + d.getFullYear()}`;
}
function fmtLongDate(d) {
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}
function fmtAgo(ms) {
  if (ms < ONLINE_MS) return "now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
function starInfoHtml(star) {
  const conns = state.edges.filter((e) => e.starA === star.id || e.starB === star.id).length;
  const lines = [
    `<span class="label-name">${escapeHtml(star.pseudonym)}</span>`,
    `<span class="label-meta">joined ${fmtDay(new Date(star.created_at))}</span>`,
    `<span class="label-meta label-class">class ${styleFor(star.id).color.cls} · ${TIERS[tierFor(conns)].name}</span>`,
    `<span class="label-meta">${conns} connection${conns === 1 ? "" : "s"}${tierFor(conns) < TIERS.length - 1 ? ` · ${TIERS[tierFor(conns) + 1].min - conns} to ${TIERS[tierFor(conns) + 1].name}` : ""}</span>`,
    `<span class="label-meta">${onlineIds.has(star.id) ? "here now" : `last seen ${fmtAgo(Date.now() - new Date(star.last_seen_at).getTime())}`}</span>`,
  ];
  if (me && star.id === me.id) {
    lines.push(`<span class="label-meta label-you">this is you</span>`);
  } else if (me) {
    const edge = state.edges.find((e) => (e.starA === me.id && e.starB === star.id) || (e.starB === me.id && e.starA === star.id));
    if (edge?.events?.length) {
      const first = Math.min(...edge.events.map((ev) => new Date(ev.occurredOn).getTime()));
      const days = Math.floor((Date.now() - first) / 86_400_000);
      lines.push(`<span class="label-meta label-you">← connected to you ${days <= 0 ? "today" : days + " day" + (days === 1 ? "" : "s") + " ago"}</span>`);
    }
  }
  return lines.join("");
}

// --- history mode: reconstruct a past sky from the real event log ---------
// No snapshot history is stored — this recomputes stars/edges exactly as
// they were as of a chosen date, straight from created_at/occurred_on, the
// same way the server computes "now". Positions reuse the live simulation
// (we don't re-derive a historical layout), since the point is to show which
// stars and connections existed and how bright they were, not literally
// where they sat that day.
//
// The timeline starts a little *before* the first star was born, so the far
// left of the slider is an empty sky; scrubbing forward, stars appear first
// and each connection then fades in over a stretch of history after its
// date (`historyEdgeRampMs`), so it reads as "stars, then links" even when
// a star's birthday and its first connection fall on the same day.
let historyStartMs = Date.now();
function historyTimelineStart() {
  const now = Date.now();
  const earliest = Math.min(now, ...state.stars.map((s) => new Date(s.created_at).getTime()));
  return earliest - Math.max(86_400_000, (now - earliest) * 0.04);
}
function historyEdgeRampMs() {
  return Math.max(2 * 86_400_000, (Date.now() - historyStartMs) * 0.03);
}
function enterHistory() {
  if (!state.stars.length) return;
  historyMode = true;
  connectMode = false; setHint();
  clearFocus();
  historyBar.classList.remove("hidden");
  historyBtn.classList.add("active");
  historyStartMs = historyTimelineStart();
  historyStartLabel.textContent = fmtLongDate(new Date(historyStartMs));
  historyEndLabel.textContent = "NOW";
  historySlider.value = "1000";
  applyHistorySlider();
}
function exitHistory() {
  historyMode = false;
  historyAsOf = null;
  historyBar.classList.add("hidden");
  historyBtn.classList.remove("active");
}
function applyHistorySlider() {
  const now = Date.now();
  const frac = Number(historySlider.value) / 1000;
  historyAsOf = new Date(historyStartMs + frac * (now - historyStartMs));
  historyDate.textContent = frac >= 0.999 ? `${fmtLongDate(historyAsOf)} · now` : fmtLongDate(historyAsOf);
}
historyBtn.addEventListener("click", () => (historyMode ? exitHistory() : enterHistory()));
historyClose.addEventListener("click", exitHistory);
historySlider.addEventListener("input", applyHistorySlider);

// --- story mode: a scroll-bound guided tour ----------------------------------
// The camera is one continuous function of scroll progress p ∈ [0, 5] (one
// unit per 100vh spacer), evaluated every frame from live star positions —
// not discrete beats handed between systems, which is what used to make it
// jump. Progress is smoothed toward the real scroll position, so wheel steps
// glide. Keyframes are spherical poses (target + theta/phi/radius) joined
// with smoothstep, so every boundary is continuous by construction:
//   p=0  01 close on your own star          "You entered the sky"
//   p=1  02 pulled back around it           "You are not alone"
//   1→2     dive to A, then slide the target along A→B's connection (yours
//           if you have one, else any)
//   p=2  03 close on B                      "Connections shape the sky"
//   p=3  04 close on the quietest old star  "Old light remains"
//   3→4     pull back while the sky rewinds to before anyone existed
//   p=4  05 the empty sky                   "The sky remembers"
//   4→5     the sky re-forms up to today as the camera settles on the exact
//   p=5  06 default Explore pose, so leaving Story never snaps.
// Narrative copy is fixed on the right and faded in by progress, so each
// line arrives with the camera rather than scrolling past it. Opt-in via the
// `story` button, and as the continuation of every new star's birth intro.
const storyCopy = document.getElementById("story-copy");
const storyBeats = [...storyCopy.querySelectorAll(".story-beat")];
const storyOldLine = document.getElementById("story-old-line");
const storyScrollHint = document.getElementById("story-scroll-hint");
const STORY_SECTIONS = storyBeats.length - 1;
let storyProgress = 0;
let storyMe = null, storyA = null, storyB = null, storyOld = null;
let storyHistoryStart = Date.now();

function computeStoryScene() {
  const edges = state.edges.filter((e) => (e.events ?? []).length > 0);
  const mine = me ? edges.find((e) => e.starA === me.id || e.starB === me.id) : null;
  const edge = mine ?? edges[0] ?? null;
  if (edge) {
    const aIsMe = me && edge.starB === me.id;
    storyA = aIsMe ? edge.starB : edge.starA;
    storyB = aIsMe ? edge.starA : edge.starB;
  } else {
    storyA = storyB = me?.id ?? state.stars[0]?.id ?? null;
  }
  storyMe = me?.id ?? storyA;
  // "old light": the longest-quiet star that still has connections
  const connected = new Set(state.edges.flatMap((e) => [e.starA, e.starB]));
  const candidates = state.stars
    .filter((s) => s.id !== storyA && s.id !== storyB && s.id !== storyMe)
    .sort((a, b) => new Date(a.last_seen_at) - new Date(b.last_seen_at));
  const old = candidates.find((s) => connected.has(s.id)) ?? candidates[0] ?? null;
  storyOld = old?.id ?? storyB;
  if (old) {
    const conns = state.edges.filter((e) => e.starA === old.id || e.starB === old.id).length;
    const ago = fmtAgo(Date.now() - new Date(old.last_seen_at).getTime());
    storyOldLine.textContent = `${old.pseudonym}, last seen ${ago}. ` +
      (conns ? `${conns === 1 ? "Their connection remains" : `All ${conns} of their connections remain`}.` : "Their light remains.");
  }
  storyHistoryStart = historyTimelineStart();
}

const ORIGIN = { x: 0, y: 0, z: 0 };
const STORY_DEFAULT = { theta: Math.PI * 0.25, phi: Math.PI * 0.38, radius: 900 };
function storyStarPos(id) {
  if (!id) return ORIGIN;
  const p = physicsFor(id);
  return { x: p.x, y: p.y, z: p.z };
}
function smoothstep(t) { return t * t * (3 - 2 * t); }
function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
function lerpPose(a, b, t) {
  // log-space so a 60 → 900 zoom feels even rather than front-loaded
  let radius = Math.exp(Math.log(a.radius) + (Math.log(b.radius) - Math.log(a.radius)) * t);
  // If the targets are far apart relative to how close we're looking, pull
  // back mid-way (a "hop") so both ends stay in frame instead of panning
  // across empty space. sin(πt) is 0 at both ends, so keyframes are untouched.
  const gap = Math.hypot(b.target.x - a.target.x, b.target.y - a.target.y, b.target.z - a.target.z);
  const hop = Math.max(0, (gap * 1.4) / radius - 1);
  radius *= 1 + hop * Math.sin(Math.PI * t);
  return {
    target: lerpPoint(a.target, b.target, t),
    theta: a.theta + (b.theta - a.theta) * t,
    phi: a.phi + (b.phi - a.phi) * t,
    radius,
  };
}
function storyPose(p) {
  const M = storyStarPos(storyMe), A = storyStarPos(storyA), B = storyStarPos(storyB), O = storyStarPos(storyOld);
  const close = { theta: Math.PI * 0.6, phi: Math.PI * 0.45, radius: 60 };
  const near = { theta: Math.PI * 0.6, phi: Math.PI * 0.45, radius: 110 };
  const atMe = { target: M, ...close };
  const aroundMe = { target: lerpPoint(M, ORIGIN, 0.5), theta: Math.PI * 0.35, phi: Math.PI * 0.4, radius: 820 };
  const nearA = { target: A, ...near };
  const nearB = { target: B, ...near };
  const atOld = { target: O, theta: Math.PI * 0.15, phi: Math.PI * 0.42, radius: 120 };
  const wide = { target: ORIGIN, theta: Math.PI * 0.05, phi: Math.PI * 0.4, radius: 650 };
  const exit = { target: ORIGIN, ...STORY_DEFAULT };
  if (p <= 1) return lerpPose(atMe, aroundMe, smoothstep(p));
  if (p <= 2) {
    const u = p - 1;
    if (u < 0.45) return lerpPose(aroundMe, nearA, smoothstep(u / 0.45));
    return { target: travelPoint(A, B, smoothstep((u - 0.45) / 0.55), { x: 0, y: 0, z: 0 }), ...near };
  }
  if (p <= 3) return lerpPose(nearB, atOld, smoothstep(p - 2));
  if (p <= 4) return lerpPose(atOld, wide, smoothstep(p - 3));
  return lerpPose(wide, exit, smoothstep(Math.min(1, p - 4)));
}

// place the camera at a spherical pose, mirrored into `cam` so whatever
// takes over next (Explore's damped orbit) eases on from here, not a snap
function applyPose(pose) {
  const sinPhi = Math.sin(pose.phi);
  camera.position.set(
    pose.target.x + pose.radius * sinPhi * Math.cos(pose.theta),
    pose.target.y + pose.radius * Math.cos(pose.phi),
    pose.target.z + pose.radius * sinPhi * Math.sin(pose.theta),
  );
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  cam.theta = pose.theta; cam.phi = pose.phi; cam.radius = pose.radius;
  cam.target.set(pose.target.x, pose.target.y, pose.target.z);
  cam.desired.target.copy(cam.target);
}

function stepStory(dt) {
  const viewport = storyScroll.clientHeight || 1;
  const goal = Math.max(0, Math.min(STORY_SECTIONS, storyScroll.scrollTop / viewport));
  storyProgress += (goal - storyProgress) * (1 - Math.exp(-dt * 5));
  applyPose(storyPose(storyProgress));

  // each beat's copy peaks when the camera has arrived at its keyframe
  storyBeats.forEach((beat, i) => {
    const o = Math.max(0, Math.min(1, 1 - Math.abs(storyProgress - i) * 2.4)) * storyCopyGate;
    beat.style.opacity = String(o);
    beat.style.transform = `translateY(${(storyProgress - i) * -18}px)`;
    beat.classList.toggle("live", o > 0.5);
  });
  // the hint waits for the watch-only opening to finish, then invites the scroll
  storyScrollHint.style.opacity = !intro && storyProgress < 1.3 ? "1" : "0";

  const now = Date.now();
  if (storyProgress > 3) {
    // 3→4 rewinds today → before the first star; 4→5 replays forward to today
    const back = storyProgress <= 4 ? smoothstep(storyProgress - 3) : 1 - smoothstep(Math.min(1, storyProgress - 4));
    historyStartMs = storyHistoryStart;
    historyAsOf = new Date(now - back * (now - storyHistoryStart));
    historyMode = back > 0.001;
  } else {
    historyMode = false;
    historyAsOf = null;
  }
}

function enterStory() {
  if (historyMode) exitHistory();
  connectMode = false;
  adminMode = false; adminFromId = null;
  adminBadge.classList.add("hidden");
  hoverStarId = null;
  clearFocus();
  flight = null;
  timelinePanel.classList.add("hidden");
  hoverLabel.classList.add("hidden");
  computeStoryScene();
  storyMode = true;
  storyProgress = 0;
  storyBtn.classList.add("active");
  storyScroll.classList.remove("hidden");
  storyScroll.scrollTop = 0;
  setHint();
}
function exitStory() {
  storyMode = false;
  historyMode = false;
  historyAsOf = null;
  storyBtn.classList.remove("active");
  storyScroll.classList.add("hidden");
  cam.desired.theta = STORY_DEFAULT.theta;
  cam.desired.phi = STORY_DEFAULT.phi;
  cam.desired.radius = STORY_DEFAULT.radius;
  cam.desired.target.set(0, 0, 0);
  setHint();
}
storyBtn.addEventListener("click", () => (storyMode ? exitStory() : enterStory()));
storyEnterBtn.addEventListener("click", exitStory);

function historicalState() {
  const asOf = historyAsOf.getTime();
  const stars = state.stars.filter((s) => new Date(s.created_at).getTime() <= asOf);
  const starIds = new Set(stars.map((s) => s.id));
  const edges = [];
  for (const edge of state.edges) {
    if (!starIds.has(edge.starA) || !starIds.has(edge.starB)) continue;
    const events = (edge.events ?? []).filter((ev) => new Date(ev.occurredOn).getTime() <= asOf);
    if (events.length === 0) continue;
    const rampMs = historyEdgeRampMs();
    const recomputed = events.map((ev) => {
      const sinceMs = asOf - new Date(ev.occurredOn).getTime();
      const ageDays = Math.max(0, sinceMs / 86_400_000);
      const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      return { ...ev, brightness: Math.max(0.12, Math.min(1, recency)), fade: Math.min(1, sinceMs / rampMs) };
    });
    const mostRecent = Math.max(...recomputed.map((e) => new Date(e.occurredOn).getTime()));
    const ageDays = Math.max(0, (asOf - mostRecent) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const frequency = Math.min(1, recomputed.length / 8);
    edges.push({ ...edge, events: recomputed, brightness: Math.max(0.08, Math.min(1, recency * 0.75 + frequency * 0.25)) });
  }
  return { stars, edges };
}

// --- snapshot-diff "real-time as spectacle" ------------------------------------
let knownStarIds = null;
let knownEventCounts = null;
const spectacleLabels = []; // {sprite, until}
function noteSpectacle(stars, edges) {
  if (knownStarIds) {
    for (const s of stars) {
      if (knownStarIds.has(s.id)) continue;
      spawnShockwave(s.id, true);
      if (!(me && s.id === me.id)) spawnSpectacleLabel(s.id, `${s.pseudonym} joined the sky`);
    }
  }
  if (knownEventCounts) {
    for (const e of edges) {
      const prev = knownEventCounts.get(e.id) ?? 0;
      if (e.eventCount <= prev) continue;
      if (prev > 0) {
        const strand = strands.get(`${e.id}:${e.eventCount - 1}`);
        if (strand) strand.bornAt = undefined; // replay the fade-in for the newest strand
      }
      const from = e.events?.[newestEventIndex(e.events)]?.declaredBy;
      if (from && !(me && from === me.id)) beginTravel(from, from === e.starA ? e.starB : e.starA);
    }
  }
  knownStarIds = new Set(stars.map((s) => s.id));
  knownEventCounts = new Map(edges.map((e) => [e.id, e.eventCount]));
}
// Cluster nebulae: every group of 3+ people joined by connections gets a
// faint cloud behind it, tinted by its members' spectral colours and sized
// to how far they spread. Unlike the decorative nebula wash (fixed seed,
// never real data), these ARE the data: the clusters that emerge from who
// declared what, made visible. Layered sprites at a few offsets so it reads
// as a cloud, not a disc.
const nebulaTexture = (() => {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const rand = mulberry32(7);
  for (let k = 0; k < 14; k++) {
    const x = size / 2 + (rand() - 0.5) * size * 0.45;
    const y = size / 2 + (rand() - 0.5) * size * 0.45;
    const r = size * (0.18 + rand() * 0.22);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.22)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  // force a clean, zero-alpha edge so no square ever shows under bloom
  const mask = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2 - 1);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = mask;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
})();
const clusterCentre = new THREE.Vector3();
const clusterClouds = new Map(); // cluster key -> {sprites, color, center, radius, a}
function clustersOf(stars, edges) {
  const parent = new Map(stars.map((s) => [s.id, s.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const e of edges) {
    if (!parent.has(e.starA) || !parent.has(e.starB)) continue;
    const a = find(e.starA), b = find(e.starB);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const s of stars) {
    const r = find(s.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s.id);
  }
  return [...groups.values()].filter((g) => g.length >= 3);
}
function stepClusterNebulae(stars, edges) {
  const live = new Set();
  for (const members of clustersOf(stars, edges)) {
    // keyed by its oldest member, so a cloud survives people joining it
    const key = members.slice().sort()[0];
    live.add(key);
    let cloud = clusterClouds.get(key);
    if (!cloud) {
      const sprites = [0, 1, 2].map((k) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: nebulaTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
          rotation: k * 2.1,
        }));
        scene.add(sp);
        return sp;
      });
      cloud = { sprites, center: new THREE.Vector3(), radius: 0, a: 0, color: new THREE.Color() };
      clusterClouds.set(key, cloud);
    }
    // centre and spread from the live (simulated) positions
    const c = clusterCentre.set(0, 0, 0);
    for (const id of members) { const p = physicsFor(id); c.x += p.x; c.y += p.y; c.z += p.z; }
    c.divideScalar(members.length);
    let spread = 0;
    const mix = new THREE.Color(0, 0, 0);
    for (const id of members) {
      const p = physicsFor(id);
      spread = Math.max(spread, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z));
      mix.add(tmpColor.setHex(styleFor(id).color.hex));
    }
    mix.multiplyScalar(1 / members.length);
    // averaging spectral colours drifts toward grey-brown; push saturation
    // back up so a cluster keeps a hue (a cool cluster blue, a warm one amber)
    const hsl = {};
    mix.getHSL(hsl);
    mix.setHSL(hsl.h, Math.min(1, hsl.s * 2.2 + 0.25), 0.55);
    cloud.center.lerp(c, cloud.a === 0 ? 1 : 0.05);
    // capped: a sky that's mostly one cluster mustn't fog the whole screen
    cloud.radius += ((Math.min(320, spread * 0.8 + 50)) - cloud.radius) * 0.05;
    cloud.color.lerp(mix, 0.05);
    cloud.a += (Math.min(1, 0.4 + members.length * 0.06) - cloud.a) * 0.02;
    cloud.sprites.forEach((sp, k) => {
      const off = (k - 1) * cloud.radius * 0.25;
      sp.position.set(cloud.center.x + off, cloud.center.y - off * 0.4, cloud.center.z + off * 0.3);
      const sc = cloud.radius * (2.2 - k * 0.35);
      sp.scale.set(sc, sc, 1);
      sp.material.color.copy(cloud.color);
      sp.material.opacity = 0.022 * cloud.a * revealMul;
    });
  }
  for (const [key, cloud] of clusterClouds) {
    if (live.has(key)) continue;
    cloud.a *= 0.94;
    for (const sp of cloud.sprites) sp.material.opacity *= 0.94;
    if (cloud.a < 0.01) {
      for (const sp of cloud.sprites) { scene.remove(sp); sp.material.dispose(); }
      clusterClouds.delete(key);
    }
  }
}

// Shockwaves: a shell of particles thrown out from a star and fading, for a
// birth (big) or a level-up (smaller). One Points object per wave, freed
// when it finishes; capped so a burst of joins can't pile up.
const shockwaves = [];
const SHOCK_PARTICLES = 140;
function spawnShockwave(starId, big) {
  if (shockwaves.length > 6) return;
  const style = styleFor(starId);
  const dirs = new Float32Array(SHOCK_PARTICLES * 3);
  for (let i = 0; i < SHOCK_PARTICLES; i++) {
    // a thin, tilted ring with a little scatter, so it reads as a wavefront
    const th = (i / SHOCK_PARTICLES) * Math.PI * 2 + Math.random() * 0.05;
    const sp = 0.92 + Math.random() * 0.16;
    const lift = (Math.random() - 0.5) * 0.12;
    dirs[i * 3] = Math.cos(th) * sp;
    dirs[i * 3 + 1] = Math.sin(th) * sp * 0.35 + lift;
    dirs[i * 3 + 2] = Math.sin(th) * sp * 0.94;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SHOCK_PARTICLES * 3), 3));
  const mat = new THREE.PointsMaterial({
    size: big ? 7 : 5, color: style.color.hex, map: haloTexture, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geom, mat);
  scene.add(pts);
  shockwaves.push({ pts, dirs, starId, born: performance.now(), dur: big ? 2200 : 1500, reach: big ? 170 : 100 });
}
function stepShockwaves(nowMs) {
  for (let k = shockwaves.length - 1; k >= 0; k--) {
    const w = shockwaves[k];
    const u = (nowMs - w.born) / w.dur;
    if (u >= 1) {
      scene.remove(w.pts); w.pts.geometry.dispose(); w.pts.material.dispose();
      shockwaves.splice(k, 1);
      continue;
    }
    const p = physicsFor(w.starId);
    const d = w.reach * (1 - Math.pow(1 - u, 3)); // fast out, slow settle
    const pos = w.pts.geometry.attributes.position;
    for (let i = 0; i < SHOCK_PARTICLES; i++) {
      pos.setXYZ(i, p.x + w.dirs[i * 3] * d, p.y + w.dirs[i * 3 + 1] * d, p.z + w.dirs[i * 3 + 2] * d);
    }
    pos.needsUpdate = true;
    w.pts.material.opacity = Math.min(1, u * 8) * (1 - u) * (1 - u) * 0.85;
  }
}

function spawnSpectacleLabel(starId, text) {
  const sprite = textSprite(text, "rgba(255,225,150,0.95)");
  const p = physicsFor(starId);
  sprite.position.set(p.x, p.y + 26, p.z);
  scene.add(sprite);
  spectacleLabels.push({ sprite, starId, until: performance.now() + 3000 });
}

// --- live state: pushed over SSE, with a one-off fetch for your own actions --
let onlineIds = new Set();
function applyState(next) {
  noteSpectacle(next.stars, next.edges);
  state = next;
  onlineIds = new Set(next.online ?? []);
  const observers = next.observers ?? onlineIds.size;
  hudStats.textContent = `${observers} observer${observers === 1 ? "" : "s"} · ${state.stars.length} stars · ${state.edges.length} connections`;
}
async function pollState() {
  const [stateRes, meRes] = await Promise.all([fetch("/api/state"), fetch("/api/me")]);
  applyState(await stateRes.json());
  const meData = await meRes.json();
  if (meData.star) me = meData.star;
}
// The server only knows whose star a stream belongs to from the cookie at
// connect time, so claiming or forgetting reopens it.
let stream = null;
function connectStream() {
  stream?.close();
  stream = new EventSource("/api/stream");
  stream.onmessage = (e) => applyState(JSON.parse(e.data));
}
(async () => {
  await pollState();
  await refreshMe();
  connectStream();
  if (me) startIntro("arrival");
  canvas.classList.add("ready"); // held invisible until now, so no flash of the full sky first
})();
// labels drawn before the web font arrived used the fallback face — redraw
document.fonts?.ready.then(() => { for (const node of starNodes.values()) node.labelText = null; });

// --- main loop ---------------------------------------------------------
let lastT = performance.now();
// Read-only hook for the headless-Chrome checks: where a star is on screen.
window.__debugStarScreen = (name) => {
  const star = state.stars.find((x) => x.pseudonym === name);
  return star ? screenPosOf(star.id, camera) : null;
};
let reticleFor = null, reticleSince = 0, reticleRadius = 0;
const tmpV = new THREE.Vector3();
let animClock = 0; // idle-motion clock; dt is clamped so a backgrounded tab doesn't lurch on return
function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - lastT) / 1000);
  lastT = nowMs;
  animClock += dt * 1000;

  if (animate && !historyMode) stepPhysics(dt);
  if (window.__dust && animate) window.__dust.rotation.y += dt * 0.004;

  const drawState = historyMode && historyAsOf ? historicalState() : state;

  const introDrivesCamera = stepIntro(nowMs);
  if (window.__dust) window.__dust.material.opacity = 0.55 * (0.15 + 0.85 * revealMul);

  // Gravity of attention, part 2: whoever is focused (hovered, or clicked),
  // their neighbours and you stay lit; everyone else dims a little, and the
  // neighbours' names surface one after another.
  const focusId = attentionStarId();
  if (focusId !== lastAttentionId) { lastAttentionId = focusId; attentionSince = nowMs; }
  const neighbours = focusId ? neighbourIds(focusId) : null;
  const neighbourOrder = neighbours ? [...neighbours] : [];
  const activeIds = activeStarIds();

  const degree = new Map();
  for (const e of drawState.edges) {
    degree.set(e.starA, (degree.get(e.starA) ?? 0) + 1);
    degree.set(e.starB, (degree.get(e.starB) ?? 0) + 1);
  }

  const drawnIds = new Set();
  for (const star of drawState.stars) {
    drawnIds.add(star.id);
    const node = nodeFor(star);
    const p = physicsFor(star.id);
    node.group.position.set(p.x, p.y, p.z);

    const isMe = me && star.id === me.id;
    const style = styleFor(star.id);
    const idleMs = Date.now() - new Date(star.last_seen_at).getTime();
    const status = onlineIds.has(star.id) ? "online" : idleMs < 10 * 60_000 ? "recent" : "dim";

    // grows in on first appearance and on reappearing in History; your own
    // star kindles more slowly during an intro
    node.scale += (1 - node.scale) * (intro && isMe ? 0.025 : 0.04);
    const reveal = isMe ? 1 : revealMul;
    const related = !focusId || star.id === focusId || isMe || neighbours.has(star.id);
    node.attn += ((related ? 1 : 0.4) - node.attn) * 0.06;
    const vis = node.scale * reveal * node.attn;

    const twinkle = animate && status === "online"
      ? 0.75 + 0.25 * Math.sin(animClock * 0.0012 * style.twinkleSpeed + style.twinklePhase)
      : 1;
    const tier = tierFor(degree.get(star.id) ?? 0);
    // a level-up (not the first frame, not History scrubbing) fires a pulse
    if (node.tier >= 0 && tier > node.tier && !historyMode) {
      node.levelUpAt = nowMs;
      spawnShockwave(star.id, tier === TIERS.length - 1);
    }
    node.tier = tier;
    if (node.tierF < 0) node.tierF = tier;
    node.tierF += (tier - node.tierF) * 0.04;
    const tf = node.tierF;
    const tierSize = TIERS[0].size + (TIERS[TIERS.length - 1].size - TIERS[0].size) * (tf / (TIERS.length - 1));
    const baseR = 4.6 * (isMe ? 1.15 : style.sizeJitter) * tierSize * node.scale;
    node.core.scale.set(baseR, baseR, 1);
    // capped below 1: under bloom an overexposed core blows out to a square
    node.coreA += ((status === "dim" ? 0.55 : 0.78) - node.coreA) * 0.03;
    node.core.material.opacity = node.coreA * vis;

    const haloTargetR = style.haloScale * (status === "online" ? 6.5 : status === "recent" ? 4.5 : 3.2);
    node.haloR += (haloTargetR - node.haloR) * 0.03;
    node.halo.scale.set(baseR * node.haloR, baseR * node.haloR, 1);
    node.haloA += ((status === "online" ? 0.55 : status === "recent" ? 0.3 : 0.17) - node.haloA) * 0.03;
    node.halo.material.opacity = node.haloA * twinkle * vis;

    // "currently active" (declared something recently): an occasional flare
    // of the diffraction spike, on a per-star rhythm
    let flare = 0;
    if (activeIds.has(star.id) && animate) {
      const phase = ((animClock / 1000 + style.moteSeed) % FLARE_PERIOD_S) / 0.9;
      if (phase < 1) flare = Math.sin(Math.PI * phase);
    }
    const spikeBase = (status === "online" ? 0.16 : status === "recent" ? 0.08 : 0.03) + 0.07 * tf;
    node.spike.material.opacity = (spikeBase + flare * 0.75) * vis;
    const spikeR = baseR * style.spikeLen * (1 + 0.25 * tf) * (1 + flare * 0.9);
    node.spike.scale.set(spikeR, spikeR, 1);

    for (let i = 0; i < node.motes.length; i++) {
      const mote = node.motes[i];
      const orbit = baseR * (2.4 + i * 0.8);
      const ang = (animate ? animClock * 0.00025 * (1 + i * 0.35) : 0) + style.moteSeed + i * 2.1;
      mote.position.set(Math.cos(ang) * orbit, Math.sin(ang * 0.7) * orbit * 0.4, Math.sin(ang) * orbit);
      mote.scale.set(baseR * 0.45, baseR * 0.45, 1);
      mote.material.opacity = (status === "dim" ? 0.1 : 0.45) * vis;
    }

    // Tier structure fades in as tierF crosses each threshold.
    const step = (k) => Math.max(0, Math.min(1, tf - (k - 1)));
    const dimMul = status === "dim" ? 0.6 : 1;
    const spin = animate ? animClock * 0.001 * style.orbitSpin : 0;
    const orbitR = baseR * 3.2;
    node.orbitA.scale.set(orbitR, orbitR, 1);
    node.orbitA.rotation.z = spin;
    node.orbitA.material.opacity = 0.42 * step(2) * dimMul * vis;
    const orbitR2 = baseR * 4.1;
    node.orbitB.scale.set(orbitR2, orbitR2, 1);
    node.orbitB.rotation.z = -spin * 0.7;
    node.orbitB.material.opacity = 0.3 * step(3) * dimMul * vis;
    const coronaPulse = animate ? 0.85 + 0.15 * Math.sin(animClock * 0.0009 + style.twinklePhase) : 1;
    const coronaR = baseR * 6 * coronaPulse;
    node.corona.scale.set(coronaR, coronaR, 1);
    node.corona.material.rotation = animate ? animClock * 0.00005 * style.orbitSpin : 0;
    node.corona.material.opacity = 0.32 * step(4) * dimMul * vis;
    // Giants and up emit a slow sonar ping; a level-up fires one big ring.
    const sinceUp = nowMs - node.levelUpAt;
    let pulseA = 0, pulseR = baseR;
    if (sinceUp < 1800) {
      const u = sinceUp / 1800;
      pulseR = baseR * (2 + u * 14);
      pulseA = 0.9 * (1 - u) * (1 - u);
    } else if (tf >= 2.5 && animate) {
      const u = ((animClock / 1000 + style.moteSeed) % 4.5) / 4.5;
      pulseR = baseR * (2 + u * 7);
      pulseA = 0.22 * (1 - u) * step(3) * dimMul;
    }
    node.pulse.scale.set(pulseR, pulseR, 1);
    node.pulse.material.opacity = pulseA * vis;

    node.ring.material.opacity = isMe && connectMode ? 0.5 + 0.3 * Math.sin(nowMs * 0.006) : 0;
    const ringR = baseR * 2.6;
    node.ring.scale.set(ringR, ringR, 1);

    const dist = camera.position.distanceTo(node.group.position);
    let labelTarget = 0;
    if ((isMe || dist < 650) && status !== "dim") labelTarget = related ? 0.8 : 0.25;
    if (star.id === focusId) labelTarget = 0.9;
    if (neighbours?.has(star.id)) {
      // surface one by one, ~180ms apart, after focus begins
      const k = neighbourOrder.indexOf(star.id);
      if (nowMs - attentionSince > 250 + k * 180) labelTarget = 0.85;
    }
    node.labelA += (labelTarget - node.labelA) * 0.08;
    if (node.labelA > 0.01) {
      if (node.labelText !== star.pseudonym) {
        if (node.label) { node.group.remove(node.label); disposeSprite(node.label); }
        node.label = textSprite(star.pseudonym);
        node.group.add(node.label);
        node.labelText = star.pseudonym;
      }
      // shrink up close so a name never fills the screen
      const labelScale = Math.min(1, Math.max(0.12, dist / 450));
      node.label.scale.set(70 * labelScale, 17.5 * labelScale, 1);
      node.label.position.set(0, baseR + 14 * labelScale, 0);
      // your own label too waits for the pull-back — up close it's huge
      node.label.material.opacity = node.labelA * node.scale * revealMul;
    } else if (node.label) {
      node.label.material.opacity = 0;
    }
  }

  // Stars not in this frame's sky (History before their birth) fade out
  // instead of keeping whatever opacity they last had.
  for (const [id, node] of starNodes) {
    if (drawnIds.has(id)) continue;
    node.scale *= 0.88;
    node.core.material.opacity *= 0.88;
    node.halo.material.opacity *= 0.88;
    node.spike.material.opacity *= 0.88;
    for (const mote of node.motes) mote.material.opacity *= 0.88;
    for (const m of [node.orbitA, node.orbitB, node.corona, node.pulse]) m.material.opacity *= 0.88;
    node.ring.material.opacity = 0;
    node.labelA *= 0.88;
    if (node.label) node.label.material.opacity *= 0.88;
  }

  updateConnections(animClock, drawState.edges, focusId);
  stepShockwaves(nowMs);
  stepClusterNebulae(drawState.stars, drawState.edges);

  // gravity preview while in connect-mode and hovering someone else
  if (connectMode && me && hoverStarId && hoverStarId !== me.id) {
    const a = physicsFor(me.id), b = physicsFor(hoverStarId);
    previewGeom.attributes.position.setXYZ(0, a.x, a.y, a.z);
    previewGeom.attributes.position.setXYZ(1, b.x, b.y, b.z);
    previewGeom.attributes.position.needsUpdate = true;
    previewLine.computeLineDistances();
    previewLine.material.opacity = 0.5 + 0.2 * Math.sin(nowMs * 0.006);
  } else {
    previewLine.material.opacity = 0;
  }

  // travelling light from you to a just-declared connection
  for (let i = travels.length - 1; i >= 0; i--) {
    const tr = travels[i];
    const t = Math.min(1, (nowMs - tr.start) / tr.duration);
    const a = physicsFor(tr.fromId), b = physicsFor(tr.toId);
    tr.sprites.forEach((sprite, k) => {
      const tk = Math.max(0, t - k * 0.06);
      travelPoint(a, b, smoothstep(tk), sprite.position);
      const fadeOut = t >= 0.9 ? (1 - t) / 0.1 : 1;
      sprite.material.opacity = (tk > 0 ? (k === 0 ? 0.95 : 0.5 - k * 0.09) : 0) * fadeOut;
    });
    if (t >= 1) {
      for (const sprite of tr.sprites) { scene.remove(sprite); sprite.material.dispose(); }
      travels.splice(i, 1);
    }
  }

  for (let i = spectacleLabels.length - 1; i >= 0; i--) {
    const sl = spectacleLabels[i];
    const p = physicsFor(sl.starId);
    const k = Math.min(1, Math.max(0.12, camera.position.distanceTo(sl.sprite.position) / 450));
    sl.sprite.scale.set(70 * k, 17.5 * k, 1);
    sl.sprite.position.set(p.x, p.y + 26 * k, p.z);
    const remain = sl.until - nowMs;
    sl.sprite.material.opacity = Math.max(0, Math.min(1, remain / 600));
    if (remain <= 0) { scene.remove(sl.sprite); disposeSprite(sl.sprite); spectacleLabels.splice(i, 1); }
  }

  // Gravity of attention: the whole view eases a little toward whoever you
  // hover. Ramped in over ~300ms (rather than applied at full strength the
  // instant hoverStarId changes) so a quick point-and-click doesn't yank the
  // camera mid-click — that abrupt pan read as the page "twitching" right
  // when clicking someone else's star, since moving the cursor onto a star
  // and clicking it happens well inside that 300ms window.
  stepFlight(nowMs);
  if (intro || storyMode || flight) {
    // intros, Story and a connection flight own the camera target
  } else if (!historyMode && focusStarId) {
    const p = physicsFor(focusStarId);
    cam.desired.target.set(p.x, p.y, p.z);
  } else if (!historyMode && hoverStarId) {
    const p = physicsFor(hoverStarId);
    const pull = Math.min(1, (nowMs - hoverSince) / 300) * 0.3;
    cam.desired.target.set(p.x * pull, p.y * pull, p.z * pull);
  } else if (!historyMode && nowMs - hoverLostAt > HOVER_RELEASE_MS) {
    cam.desired.target.set(0, 0, 0);
  }

  const labelStar = focusId ? state.stars.find((s) => s.id === focusId) : null;
  // Reticle: brackets start wide and close onto the star over ~350ms, sized
  // to the star's on-screen radius, tinted with its spectral colour.
  if (labelStar && !storyMode) {
    const s = screenPosOf(labelStar.id, camera);
    if (reticleFor !== labelStar.id) { reticleFor = labelStar.id; reticleSince = nowMs; }
    const lock = Math.min(1, (nowMs - reticleSince) / 350);
    const ease = 1 - Math.pow(1 - lock, 3);
    const node = starNodes.get(labelStar.id);
    const p3 = physicsFor(labelStar.id);
    const dist = camera.position.distanceTo(tmpV.set(p3.x, p3.y, p3.z));
    const worldR = node ? node.core.scale.x * 1.6 : 8;
    const pxR = (worldR / dist) * (window.innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360)));
    const target = Math.max(16, Math.min(90, pxR));
    const r = target + (1 - ease) * 60;
    const style = styleFor(labelStar.id);
    reticle.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${(1 - ease) * 45}deg)`;
    reticle.style.setProperty("--r", `${r}px`);
    reticle.style.setProperty("--rc-color", `rgb(${style.color.glow})`);
    reticle.style.opacity = String(0.3 + 0.7 * ease);
    const deg = (state.edges.filter((e) => e.starA === labelStar.id || e.starB === labelStar.id)).length;
    reticleReadout.textContent = lock < 1
      ? "ACQUIRING…"
      : `LOCK · ${style.color.cls}-${TIERS[tierFor(deg)].name.toUpperCase()}`;
    reticle.classList.toggle("hidden", s.behind);
    reticleRadius = r;
  } else {
    reticleFor = null;
    reticleRadius = 0;
    reticle.classList.add("hidden");
  }
  if (labelStar) {
    const s = screenPosOf(labelStar.id, camera);
    // sits outside the reticle's right edge so it never covers the brackets
    hoverLabel.style.left = `${s.x + Math.max(18, reticleRadius + 14)}px`;
    hoverLabel.style.top = `${s.y - 10}px`;
    hoverLabel.innerHTML = starInfoHtml(labelStar);
    hoverLabel.classList.toggle("hidden", s.behind);
  } else if (!storyMode) {
    hoverLabel.classList.add("hidden");
  }

  if (introDrivesCamera) { /* arrival placed the camera already */ }
  else if (storyMode) stepStory(dt);
  else applyCamera();
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
