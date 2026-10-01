// Constellation — Three.js redesign. State is polled, not pushed (that's
// W10's job); this file turns the poll into a semi-physical, deep, luminous
// sky instead of a flat network graph. See CLAUDE.md for the architecture
// decision behind adopting Three.js here (client-only, zero server cost).
import * as THREE from "three";

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
const timelinePanel = document.getElementById("timeline-panel");
const timelineTitle = document.getElementById("timeline-title");
const timelineList = document.getElementById("timeline-list");
const timelineClose = document.getElementById("timeline-close");
const animateCheckbox = document.getElementById("animate-checkbox");
const speedBtn = document.getElementById("speed-btn");
const historyBtn = document.getElementById("history-btn");
const historyBar = document.getElementById("history-bar");
const historySlider = document.getElementById("history-slider");
const historyDate = document.getElementById("history-date");
const historyClose = document.getElementById("history-close");
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

// Speed control: how fast *idle* motion runs (physics drift, twinkle,
// connection shimmer) — a separate axis from History (which scrubs through
// *past* declared events, not live animation rate). Like `animate`, this is
// a pure viewer preference, localStorage-persisted, never gating a feature.
const SPEEDS = [0.5, 1, 2, 4];
let speedMultiplier = 1;
try {
  const saved = Number(localStorage.getItem("constellation:speed"));
  if (SPEEDS.includes(saved)) speedMultiplier = saved;
} catch {}
function setSpeedLabel() { speedBtn.textContent = `speed ${speedMultiplier}×`; }
setSpeedLabel();
speedBtn.addEventListener("click", () => {
  speedMultiplier = SPEEDS[(SPEEDS.indexOf(speedMultiplier) + 1) % SPEEDS.length];
  setSpeedLabel();
  try { localStorage.setItem("constellation:speed", String(speedMultiplier)); } catch {}
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

// Restrained, near-monochrome identity palette — explicitly not saturated
// RGB. Each person's star gets a stable look derived from its id alone.
const PERSON_COLORS = [
  { hex: 0xf4f3fa, glow: "244,243,250" }, // warm/neutral white
  { hex: 0xf6e6bf, glow: "246,230,191" }, // pale gold
  { hex: 0xd8e9ff, glow: "216,233,255" }, // cold white
  { hex: 0xbdeef0, glow: "189,238,240" }, // faint cyan
  { hex: 0xdccdf0, glow: "220,205,240" }, // faint lavender
];
const styleCache = new Map();
function styleFor(id) {
  if (styleCache.has(id)) return styleCache.get(id);
  const rand = mulberry32(hashString(id) ^ 0x51ed270b);
  const style = {
    color: PERSON_COLORS[Math.floor(rand() * PERSON_COLORS.length)],
    sizeJitter: 0.85 + rand() * 0.5,
    twinklePhase: rand() * Math.PI * 2,
    twinkleSpeed: 0.3 + rand() * 0.4,
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x05070b, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 6000);
// A second camera, never rendered, kept at the same orbit (theta/phi/radius)
// as `camera` but always looking at the true origin instead of `cam.target`.
// Hover hit-testing (see findStarAt's `stable` option) projects against this
// one instead of the live camera, specifically to break a feedback loop:
// gravity-of-attention (below) eases the live camera's target toward
// whoever's hovered, which shifts that star's own screen position, which
// could flip the hover hit-test, which changes the target again... a visible
// jitter loop the instant someone's cursor tried to track the drift. Hit
// -testing against a camera that never moves for that reason has no such
// loop. Clicks still use the live camera, so click precision matches what's
// actually on screen.
const hitCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 6000);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hitCamera.aspect = window.innerWidth / window.innerHeight;
  hitCamera.updateProjectionMatrix();
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
  hitCamera.position.set(
    t.radius * sinPhi * Math.cos(t.theta),
    t.radius * Math.cos(t.phi),
    t.radius * sinPhi * Math.sin(t.theta),
  );
  hitCamera.lookAt(0, 0, 0);
  hitCamera.updateMatrixWorld();
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
function makeRadialTexture(inner, outer) {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const haloTexture = makeRadialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)");
const coreTexture = makeRadialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0.05)");
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

function textSprite(text, color = "rgba(233,230,222,0.9)") {
  const c = document.createElement("canvas");
  const scale = 2;
  c.width = 256 * scale; c.height = 64 * scale;
  const g = c.getContext("2d");
  g.font = `${22 * scale}px ui-sans-serif, system-ui, sans-serif`;
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
      map: haloTexture, color: 0x6a7bd6, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.position.set(Math.cos(theta) * r, (rand() - 0.5) * 300, Math.sin(theta) * r);
    sprite.scale.set(1800, 1800, 1);
    scene.add(sprite);
  }

  window.__dust = dust;
})();

// --- star visuals ---------------------------------------------------------
const starNodes = new Map(); // id -> {group, core, halo, ring, label, labelText, enteredAt}
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
    group.add(halo, core, ring);
    scene.add(group);
    node = { group, core, halo, ring, label: null, labelText: null, enteredAt: performance.now(), scale: 0 };
    starNodes.set(star.id, node);
  }
  return node;
}

// --- connection visuals ----------------------------------------------------
// One declared event = one strand of light: a thin additive line along a
// gently-bent curve between the two stars, fanned out per event so repeated
// events visibly read as separate threads, plus a small travelling photon.
const STRAND_SAMPLES = 18;
const strands = new Map(); // "edgeId:i" -> {line, photon, color, speed, phase, seed}
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
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpM = new THREE.Vector3(), tmpP = new THREE.Vector3();

function updateConnections(nowMs, drawEdges) {
  liveStrandKeys.clear();
  for (const edge of drawEdges) {
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
    events.forEach((ev, i) => {
      const key = `${edge.id}:${i}`;
      liveStrandKeys.add(key);
      const seed = Math.abs(hashString(key));
      const color = (styleFor(ev.declaredBy).color);
      const strand = strandFor(key, color.hex);

      const angle = (seed % 628) / 100;
      const mag = 16 + (i % 6) * 10 + (n > 1 ? 14 : 0);
      const offset = u.clone().multiplyScalar(Math.cos(angle) * mag).add(v.clone().multiplyScalar(Math.sin(angle) * mag));
      tmpM.copy(tmpA).add(tmpB).multiplyScalar(0.5).add(offset);

      const posAttr = strand.line.geometry.attributes.position;
      for (let s = 0; s < STRAND_SAMPLES; s++) {
        const t = s / (STRAND_SAMPLES - 1);
        quadBezier(tmpA, tmpM, tmpB, t, tmpP);
        posAttr.setXYZ(s, tmpP.x, tmpP.y, tmpP.z);
      }
      posAttr.needsUpdate = true;

      // age-in: a brand new strand fades up rather than popping into place
      if (strand.bornAt === undefined) strand.bornAt = nowMs;
      const age = (nowMs - strand.bornAt) / 1000;
      const fadeIn = Math.min(1, age / 1.4);
      // Slow, barely-there shimmer rather than a visible pulse — this used to
      // run at ~3s/cycle with a ~3-6s photon loop, which read as "too fast"
      // (frantic flicker, especially with several strands fanned on one
      // edge). Both are now ~3x slower: a gentle multi-second drift.
      const pulse = animate ? 0.9 + 0.1 * Math.sin(nowMs * 0.0007 + seed) : 1;
      strand.line.material.opacity = ev.brightness * 0.55 * pulse * fadeIn;

      if (animate) {
        const speed = 0.00005 + (seed % 97) / 97 * 0.00006;
        const phase = (seed % 1000) / 1000;
        const frac = (nowMs * speed + phase) % 1;
        quadBezier(tmpA, tmpM, tmpB, frac, tmpP);
        strand.photon.position.copy(tmpP);
        strand.photon.material.opacity = ev.brightness * 0.8 * fadeIn;
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

// --- transient "light travels from you to them" on your own new declare ----
const travelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: haloTexture, color: 0xffe196, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
}));
travelSprite.scale.set(14, 14, 1);
scene.add(travelSprite);
let travel = null; // {from, to, start, duration}
function beginTravel(fromId, toId) {
  travel = { fromId, toId, start: performance.now(), duration: 900 };
}

// --- interaction state -------------------------------------------------
let connectMode = false;
let hoverStarId = null;
let selectedTargetId = null;
const STAR_HIT_PX = 18;
const EDGE_HIT_PX = 7;

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
    : "click your star, then another, to connect";
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

// `stable: true` projects against `hitCamera` (never moved by
// gravity-of-attention) instead of the live camera — that's the actual fix
// for hover jitter; see hitCamera's own comment above. `stickyId` additionally
// widens the hit radius for whichever star is already hovered, as a second
// line of defence against the sky's own slow physics drift (CLAUDE.md) still
// nudging a star just past the hit radius between frames. Clicks pass neither
// option, so they stay pixel-accurate against what's actually rendered.
function findStarAt(sx, sy, { stickyId, stable } = {}) {
  const viewCamera = stable ? hitCamera : camera;
  if (stickyId) {
    const star = state.stars.find((s) => s.id === stickyId);
    if (star) {
      const p = physicsFor(star.id);
      const s = projectToScreen(new THREE.Vector3(p.x, p.y, p.z), viewCamera);
      if (!s.behind && Math.hypot(s.x - sx, s.y - sy) <= STAR_HIT_PX * 1.8) return star;
    }
  }
  let best = null, bestDist = Infinity;
  for (const star of state.stars) {
    const p = physicsFor(star.id);
    const s = projectToScreen(new THREE.Vector3(p.x, p.y, p.z), viewCamera);
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

let hoverSince = 0;
function updateHover(e) {
  if (historyMode || storyMode) return;
  const star = findStarAt(e.clientX, e.clientY, { stickyId: hoverStarId, stable: true });
  const id = star ? star.id : null;
  if (id !== hoverStarId) hoverSince = performance.now();
  hoverStarId = id;
}

function onCanvasClick(e) {
  if (historyMode || storyMode) return;
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
    return;
  }

  if (connectMode) { connectMode = false; setHint(); return; }

  const edge = findEdgeAt(e.clientX, e.clientY);
  if (edge) openTimeline(edge);
}

// --- claim / birth sequence --------------------------------------------
let birthPending = false;
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

birthForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pseudonym = document.getElementById("pseudonym").value;
  const res = await fetch("/api/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym }),
  });
  if (res.ok) {
    birthPending = true;
    cam.radius = 6; cam.desired.radius = 6; cam.ease = 0.02;
    await refreshMe();
    await pollState();
  } else {
    const { error } = await res.json();
    alert(error);
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

  await fetch("/api/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: selectedTargetId, type, note }),
  });
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
  me = null;
  connectMode = false;
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

// --- history mode: reconstruct a past sky from the real event log ---------
// No snapshot history is stored — this recomputes stars/edges exactly as
// they were as of a chosen date, straight from created_at/occurred_on, the
// same way the server computes "now". Positions reuse the live simulation
// (we don't re-derive a historical layout), since the point is to show which
// stars and connections existed and how bright they were, not literally
// where they sat that day.
function enterHistory() {
  if (!state.stars.length) return;
  historyMode = true;
  connectMode = false; setHint();
  historyBar.classList.remove("hidden");
  historyBtn.classList.add("active");
  const earliest = Math.min(...state.stars.map((s) => new Date(s.created_at).getTime()));
  historySlider.dataset.earliest = String(earliest);
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
  const earliest = Number(historySlider.dataset.earliest || Date.now());
  const now = Date.now();
  const frac = Number(historySlider.value) / 1000;
  historyAsOf = new Date(earliest + frac * (now - earliest));
  historyDate.textContent = historyAsOf.toISOString().slice(0, 10);
}
historyBtn.addEventListener("click", () => (historyMode ? exitHistory() : enterHistory()));
historyClose.addEventListener("click", exitHistory);
historySlider.addEventListener("input", applyHistorySlider);

// --- story mode: a scroll-bound guided tour through four cinematic beats --
// Reuses existing machinery rather than building a second tweening system:
// every beat but "travel" moves the camera by writing into `cam.desired`
// (the same damped orbit the rest of the app eases toward); "travel" is the
// one exception, bypassing `cam.desired` for the duration of that single
// scroll transition to fly the camera directly along a real connection's
// curve, then handing control back by syncing `cam`'s actual spherical
// state (not just `desired`) to the arrival pose so there's no snap. The
// "memory" beat drives `historyMode`/`historicalState()` from scroll
// position instead of a dragged slider — same reconstruction, same decay
// math, just a different input. Opt-in via the `story` button, not
// auto-played on first visit, and mutually exclusive with History — see
// CLAUDE.md for why both are deliberate scope cuts.
const STORY_BEATS = ["intro", "birth", "travel", "memory", "exit"];
let storyFlightActive = false;
let storyWasFlying = false;
let storyFlightEndPose = null;
let storySampleStarId = null;
let storyEdge = null;
let storyCurveA = null, storyCurveM = null, storyCurveB = null;
let storyEarliest = Date.now();

function computeStoryScene() {
  storyEdge = state.edges.find((e) => (e.events ?? []).length > 0) ?? null;
  if (storyEdge) {
    storySampleStarId = storyEdge.starA;
    const pa = physicsFor(storyEdge.starA), pb = physicsFor(storyEdge.starB);
    storyCurveA = { x: pa.x, y: pa.y, z: pa.z };
    storyCurveB = { x: pb.x, y: pb.y, z: pb.z };
    storyCurveM = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 + 40, z: (pa.z + pb.z) / 2 };
  } else {
    storySampleStarId = state.stars[0]?.id ?? null;
    storyCurveA = storyCurveM = storyCurveB = null;
  }
  storyEarliest = state.stars.length
    ? Math.min(...state.stars.map((s) => new Date(s.created_at).getTime()))
    : Date.now();
}

function sphericalFromCamera(target) {
  const rel = { x: camera.position.x - target.x, y: camera.position.y - target.y, z: camera.position.z - target.z };
  const radius = Math.max(1, Math.hypot(rel.x, rel.y, rel.z));
  const phi = Math.acos(Math.min(1, Math.max(-1, rel.y / radius)));
  const theta = Math.atan2(rel.z, rel.x);
  return { theta, phi, radius, target };
}

function storyLerpPose(from, to, t) {
  cam.desired.theta = from.theta + (to.theta - from.theta) * t;
  cam.desired.phi = from.phi + (to.phi - from.phi) * t;
  cam.desired.radius = from.radius + (to.radius - from.radius) * t;
  cam.desired.target.set(
    from.target.x + (to.target.x - from.target.x) * t,
    from.target.y + (to.target.y - from.target.y) * t,
    from.target.z + (to.target.z - from.target.z) * t,
  );
}

function onStoryScroll() {
  if (!storyMode) return;
  const sections = storyScroll.querySelectorAll(".story-section");
  const viewport = storyScroll.clientHeight || 1;
  const idxFloat = storyScroll.scrollTop / viewport;
  const idx = Math.max(0, Math.min(sections.length - 2, Math.floor(idxFloat)));
  const frac = Math.max(0, Math.min(1, idxFloat - idx));
  const beat = STORY_BEATS[idx];

  const origin = { x: 0, y: 0, z: 0 };
  const sampleTarget = sampleStarPos(storySampleStarId, origin);
  const arrivalTarget = storyEdge ? sampleStarPos(storyEdge.starB, sampleTarget) : sampleTarget;

  const POSE = {
    intro: { theta: Math.PI * 0.22, phi: Math.PI * 0.4, radius: 1500, target: origin },
    birth: { theta: Math.PI * 0.6, phi: Math.PI * 0.45, radius: 36, target: sampleTarget },
    arrival: { theta: Math.PI * 0.95, phi: Math.PI * 0.45, radius: 36, target: arrivalTarget },
    memoryWide: { theta: Math.PI * 0.05, phi: Math.PI * 0.4, radius: 650, target: origin },
    exit: { theta: Math.PI * 0.25, phi: Math.PI * 0.38, radius: 900, target: origin },
  };

  storyFlightActive = beat === "birth" && !!storyCurveA;

  if (storyFlightActive) {
    storyWasFlying = true;
    quadBezier(storyCurveA, storyCurveM, storyCurveB, frac, tmpP);
    camera.position.set(tmpP.x, tmpP.y, tmpP.z);
    const ahead = { x: 0, y: 0, z: 0 };
    quadBezier(storyCurveA, storyCurveM, storyCurveB, Math.min(1, frac + 0.08), ahead);
    camera.lookAt(ahead.x, ahead.y, ahead.z);
  } else {
    if (storyWasFlying) {
      storyFlightEndPose = sphericalFromCamera(arrivalTarget);
      cam.theta = storyFlightEndPose.theta;
      cam.phi = storyFlightEndPose.phi;
      cam.radius = storyFlightEndPose.radius;
      cam.target.set(arrivalTarget.x, arrivalTarget.y, arrivalTarget.z);
      storyWasFlying = false;
    }
    if (beat === "intro") storyLerpPose(POSE.intro, POSE.birth, frac);
    else if (beat === "birth") storyLerpPose(POSE.birth, POSE.birth, frac); // no real edge to fly along — hold
    else if (beat === "travel") storyLerpPose(storyFlightEndPose ?? POSE.arrival, POSE.memoryWide, frac);
    else if (beat === "memory") storyLerpPose(POSE.memoryWide, POSE.exit, frac);
    else storyLerpPose(POSE.exit, POSE.exit, frac);
  }

  if (beat === "memory") {
    historyMode = true;
    const now = Date.now();
    historyAsOf = new Date(now - frac * (now - storyEarliest));
  } else {
    historyMode = false;
    historyAsOf = null;
  }
}
function sampleStarPos(id, fallback) {
  if (!id) return fallback;
  const p = physicsFor(id);
  return { x: p.x, y: p.y, z: p.z };
}
storyScroll.addEventListener("scroll", onStoryScroll, { passive: true });

function enterStory() {
  if (historyMode) exitHistory();
  connectMode = false;
  adminMode = false; adminFromId = null;
  adminBadge.classList.add("hidden");
  computeStoryScene();
  storyMode = true;
  storyWasFlying = false;
  storyFlightEndPose = null;
  storyBtn.classList.add("active");
  storyScroll.classList.remove("hidden");
  storyScroll.scrollTop = 0;
  onStoryScroll();
  setHint();
}
function exitStory() {
  storyMode = false;
  storyFlightActive = false;
  storyWasFlying = false;
  historyMode = false;
  historyAsOf = null;
  storyBtn.classList.remove("active");
  storyScroll.classList.add("hidden");
  cam.desired.theta = Math.PI * 0.25;
  cam.desired.phi = Math.PI * 0.38;
  cam.desired.radius = 900;
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
    const recomputed = events.map((ev) => {
      const ageDays = Math.max(0, (asOf - new Date(ev.occurredOn).getTime()) / 86_400_000);
      const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      return { ...ev, brightness: Math.max(0.12, Math.min(1, recency)) };
    });
    const mostRecent = Math.max(...recomputed.map((e) => new Date(e.occurredOn).getTime()));
    const ageDays = Math.max(0, (asOf - mostRecent) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const frequency = Math.min(1, recomputed.length / 8);
    edges.push({ ...edge, events: recomputed, brightness: Math.max(0.08, Math.min(1, recency * 0.75 + frequency * 0.25)) });
  }
  return { stars, edges };
}

// --- poll-diff "real-time as spectacle" ------------------------------------
let knownStarIds = null;
let knownEventCounts = null;
const spectacleLabels = []; // {sprite, until}
function noteSpectacle(stars, edges) {
  if (knownStarIds) {
    for (const s of stars) {
      if (!knownStarIds.has(s.id) && !(me && s.id === me.id)) spawnSpectacleLabel(s.id, `${s.pseudonym} joined the sky`);
    }
  }
  if (knownEventCounts) {
    for (const e of edges) {
      const prev = knownEventCounts.get(e.id) ?? 0;
      if (e.eventCount > prev && prev > 0) {
        const strand = strands.get(`${e.id}:${e.eventCount - 1}`);
        if (strand) strand.bornAt = undefined; // replay the fade-in for the newest strand
      }
    }
  }
  knownStarIds = new Set(stars.map((s) => s.id));
  knownEventCounts = new Map(edges.map((e) => [e.id, e.eventCount]));
}
function spawnSpectacleLabel(starId, text) {
  const sprite = textSprite(text, "rgba(255,225,150,0.95)");
  const p = physicsFor(starId);
  sprite.position.set(p.x, p.y + 26, p.z);
  scene.add(sprite);
  spectacleLabels.push({ sprite, starId, until: performance.now() + 3000 });
}

// --- polling (also doubles as this browser's own heartbeat) ----------------
async function pollState() {
  const [stateRes, meRes] = await Promise.all([fetch("/api/state"), fetch("/api/me")]);
  const next = await stateRes.json();
  noteSpectacle(next.stars, next.edges);
  state = next;
  const meData = await meRes.json();
  if (meData.star) me = meData.star;
  if (!hudStats.hidden) {
    hudStats.textContent = `${state.stars.length} stars · ${state.edges.length} connections`;
  }
}
pollState();
setInterval(pollState, 4000);
refreshMe();

// --- main loop ---------------------------------------------------------
let lastT = performance.now();
let animClock = 0; // virtual clock for idle motion only — speedMultiplier scales this, not wall time
function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - lastT) / 1000);
  lastT = nowMs;
  animClock += dt * 1000 * speedMultiplier;

  if (animate && !historyMode) stepPhysics(dt * speedMultiplier);
  if (window.__dust && animate) window.__dust.rotation.y += dt * 0.004 * speedMultiplier;

  const drawState = historyMode && historyAsOf ? historicalState() : state;

  // birth reveal: once our own star exists, pull the camera back slowly
  if (birthPending && me && starNodes.has(me.id)) {
    birthPending = false;
    setTimeout(() => { cam.desired.radius = 900; cam.ease = 0.015; setTimeout(() => (cam.ease = 0.07), 4500); }, 1400);
  }

  for (const star of drawState.stars) {
    const node = nodeFor(star);
    const p = physicsFor(star.id);
    node.group.position.set(p.x, p.y, p.z);

    const isMe = me && star.id === me.id;
    const style = styleFor(star.id);
    const lastSeen = new Date(star.last_seen_at).getTime();
    const idleMs = Date.now() - lastSeen;
    const status = idleMs < 15_000 ? "online" : idleMs < 10 * 60_000 ? "recent" : "dim";

    const age = (nowMs - node.enteredAt) / 1000;
    const entrance = Math.min(1, age / 1.6);
    node.scale += (entrance - node.scale) * 0.08;

    const twinkle = animate && status === "online"
      ? 0.75 + 0.25 * Math.sin(animClock * 0.0012 * style.twinkleSpeed + style.twinklePhase)
      : 1;
    const baseR = (isMe ? 7 : 4.6 * style.sizeJitter) * node.scale;
    node.core.scale.set(baseR, baseR, 1);
    node.core.material.opacity = (status === "dim" ? 0.35 : 0.95) * node.scale;

    const haloR = baseR * (status === "online" ? 6.5 : status === "recent" ? 4.5 : 2.4);
    node.halo.scale.set(haloR, haloR, 1);
    const haloAlpha = status === "online" ? 0.55 * twinkle : status === "recent" ? 0.3 : 0.08;
    node.halo.material.opacity = haloAlpha * node.scale;

    node.ring.material.opacity = isMe && connectMode ? 0.5 + 0.3 * Math.sin(nowMs * 0.006) : 0;
    const ringR = baseR * 2.6;
    node.ring.scale.set(ringR, ringR, 1);

    const dist = camera.position.distanceTo(node.group.position);
    const showLabel = (isMe || dist < 650 || hoverStarId === star.id) && status !== "dim" || hoverStarId === star.id;
    if (showLabel) {
      if (node.labelText !== star.pseudonym) {
        if (node.label) { node.group.remove(node.label); disposeSprite(node.label); }
        node.label = textSprite(star.pseudonym);
        node.label.position.set(0, baseR + 14, 0);
        node.group.add(node.label);
        node.labelText = star.pseudonym;
      }
      node.label.material.opacity = 0.8 * node.scale;
    } else if (node.label) {
      node.label.material.opacity = 0;
    }
  }

  updateConnections(animClock, drawState.edges);

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
  if (travel) {
    const t = Math.min(1, (nowMs - travel.start) / travel.duration);
    const a = physicsFor(travel.fromId), b = physicsFor(travel.toId);
    travelSprite.position.lerpVectors(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z), t);
    travelSprite.material.opacity = Math.sin(Math.PI * t) * 0.9;
    if (t >= 1) travel = null;
  } else {
    travelSprite.material.opacity = 0;
  }

  for (let i = spectacleLabels.length - 1; i >= 0; i--) {
    const sl = spectacleLabels[i];
    const p = physicsFor(sl.starId);
    sl.sprite.position.set(p.x, p.y + 26, p.z);
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
  if (!historyMode && !storyMode && hoverStarId) {
    const p = physicsFor(hoverStarId);
    const pull = Math.min(1, (nowMs - hoverSince) / 300) * 0.3;
    cam.desired.target.set(p.x * pull, p.y * pull, p.z * pull);
  } else if (!historyMode && !storyMode) {
    cam.desired.target.set(0, 0, 0);
  }

  if (hoverStarId && !historyMode && !storyMode) {
    const star = state.stars.find((s) => s.id === hoverStarId);
    if (star) {
      const p = physicsFor(star.id);
      const s = projectToScreen(new THREE.Vector3(p.x, p.y, p.z));
      const joinedDays = Math.floor((Date.now() - new Date(star.created_at).getTime()) / 86_400_000);
      const seenDays = Math.floor((Date.now() - new Date(star.last_seen_at).getTime()) / 86_400_000);
      const conns = state.edges.filter((e) => e.starA === star.id || e.starB === star.id).length;
      hoverLabel.style.left = `${s.x + 18}px`;
      hoverLabel.style.top = `${s.y - 10}px`;
      hoverLabel.innerHTML = `<span class="label-name">${escapeHtml(star.pseudonym)}</span>` +
        `<span class="label-meta">joined ${joinedDays <= 0 ? "today" : joinedDays + "d ago"} · ${conns} connection${conns === 1 ? "" : "s"}</span>` +
        (seenDays >= 1 ? `<span class="label-meta">last seen ${seenDays}d ago</span>` : "");
      hoverLabel.classList.remove("hidden");
    }
  } else {
    hoverLabel.classList.add("hidden");
  }

  if (!storyFlightActive) applyCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
