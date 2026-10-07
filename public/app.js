// Constellation — Three.js redesign. State is pushed over SSE; this file
// turns each snapshot into a semi-physical, deep, luminous
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
  // Everything here is a stable fingerprint: colour temperature, halo size,
  // pulse rate, a faint diffraction spike (angle/length), and how many tiny
  // motes orbit it — so a person reads as "their" star, never an avatar.
  const style = {
    color: PERSON_COLORS[Math.floor(rand() * PERSON_COLORS.length)],
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x05070b, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 6000);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
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
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  if (mid) grad.addColorStop(0.6, mid);
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

// faint four-point diffraction spike: two thin, centre-weighted crossed lines
const spikeTexture = (() => {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  for (const horizontal of [true, false]) {
    const grad = horizontal
      ? g.createLinearGradient(0, 0, size, 0)
      : g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    if (horizontal) g.fillRect(0, size / 2 - 1.5, size, 3);
    else g.fillRect(size / 2 - 1.5, 0, 3, size);
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
    group.add(halo, spike, core, ring);
    scene.add(group);
    node = {
      group, core, halo, ring, spike, motes, label: null, labelText: null, scale: 0,
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
      strand.line.material.opacity = Math.min(0.95, ev.brightness * 0.55 * pulse * visible);

      if (animate) {
        const speed = 0.00005 + (seed % 97) / 97 * 0.00006;
        const phase = (seed % 1000) / 1000;
        const frac = (nowMs * speed + phase) % 1;
        quadBezier(tmpA, tmpM, tmpB, frac, tmpP);
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

async function claim(pseudonym, confirmDuplicate) {
  const res = await fetch("/api/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym, confirmDuplicate }),
  });
  return { res, data: await res.json() };
}

birthForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pseudonym = document.getElementById("pseudonym").value;
  let { res, data } = await claim(pseudonym, false);
  if (res.ok && data.duplicate) {
    // Gentle heads-up, not a hard block: a reused name after "forget" (or
    // two different people sharing a name) both land here. No forced
    // rename, no merging — just make sure it's a deliberate choice.
    const proceed = confirm(
      `"${pseudonym.trim()}" is already a star in this sky. Is that you coming back, or someone else with the same name? Either way, continuing creates a new star.`,
    );
    if (!proceed) return;
    ({ res, data } = await claim(pseudonym, true));
  }
  if (res.ok) {
    // set who you are *before* the poll, or noteSpectacle announces your own
    // new star as "X joined the sky" — a giant, cut-off label at birth range
    me = data.star;
    await pollState();
    await refreshMe();
    connectStream();
    startIntro("birth");
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
    `<span class="label-meta">${conns} connection${conns === 1 ? "" : "s"}</span>`,
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
      if (!knownStarIds.has(s.id) && !(me && s.id === me.id)) spawnSpectacleLabel(s.id, `${s.pseudonym} joined the sky`);
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
    const baseR = (isMe ? 7 : 4.6 * style.sizeJitter) * node.scale;
    node.core.scale.set(baseR, baseR, 1);
    node.coreA += ((status === "dim" ? 0.35 : 0.95) - node.coreA) * 0.03;
    node.core.material.opacity = node.coreA * vis;

    const haloTargetR = style.haloScale * (status === "online" ? 6.5 : status === "recent" ? 4.5 : 2.4);
    node.haloR += (haloTargetR - node.haloR) * 0.03;
    node.halo.scale.set(baseR * node.haloR, baseR * node.haloR, 1);
    node.haloA += ((status === "online" ? 0.55 : status === "recent" ? 0.3 : 0.08) - node.haloA) * 0.03;
    node.halo.material.opacity = node.haloA * twinkle * vis;

    // "currently active" (declared something recently): an occasional flare
    // of the diffraction spike, on a per-star rhythm
    let flare = 0;
    if (activeIds.has(star.id) && animate) {
      const phase = ((animClock / 1000 + style.moteSeed) % FLARE_PERIOD_S) / 0.9;
      if (phase < 1) flare = Math.sin(Math.PI * phase);
    }
    const spikeBase = status === "online" ? 0.16 : status === "recent" ? 0.08 : 0.02;
    node.spike.material.opacity = (spikeBase + flare * 0.75) * vis;
    const spikeR = baseR * style.spikeLen * (1 + flare * 0.9);
    node.spike.scale.set(spikeR, spikeR, 1);

    for (let i = 0; i < node.motes.length; i++) {
      const mote = node.motes[i];
      const orbit = baseR * (2.4 + i * 0.8);
      const ang = (animate ? animClock * 0.00025 * (1 + i * 0.35) : 0) + style.moteSeed + i * 2.1;
      mote.position.set(Math.cos(ang) * orbit, Math.sin(ang * 0.7) * orbit * 0.4, Math.sin(ang) * orbit);
      mote.scale.set(baseR * 0.45, baseR * 0.45, 1);
      mote.material.opacity = (status === "dim" ? 0.1 : 0.45) * vis;
    }

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
    node.ring.material.opacity = 0;
    node.labelA *= 0.88;
    if (node.label) node.label.material.opacity *= 0.88;
  }

  updateConnections(animClock, drawState.edges, focusId);

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
  if (labelStar) {
    const s = screenPosOf(labelStar.id, camera);
    hoverLabel.style.left = `${s.x + 18}px`;
    hoverLabel.style.top = `${s.y - 10}px`;
    hoverLabel.innerHTML = starInfoHtml(labelStar);
    hoverLabel.classList.toggle("hidden", s.behind);
  } else if (!storyMode) {
    hoverLabel.classList.add("hidden");
  }

  if (introDrivesCamera) { /* arrival placed the camera already */ }
  else if (storyMode) stepStory(dt);
  else applyCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
