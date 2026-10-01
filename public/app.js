// Constellation — W9 slice. State is polled, not pushed (that's W10's job);
// this is just enough to feel alive across a handful of open tabs.

const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");

const claimScreen = document.getElementById("claim-screen");
const claimForm = document.getElementById("claim-form");
const hud = document.getElementById("hud");
const meName = document.getElementById("me-name");
const renameBtn = document.getElementById("rename-btn");
const renameModal = document.getElementById("rename-modal");
const renameForm = document.getElementById("rename-form");
const renameInput = document.getElementById("rename-input");
const renameCancel = document.getElementById("rename-cancel");
const connectModal = document.getElementById("connect-modal");
const connectForm = document.getElementById("connect-form");
const connectTarget = document.getElementById("connect-target");
const connectNote = document.getElementById("connect-note");
const connectCancel = document.getElementById("connect-cancel");
const timelinePanel = document.getElementById("timeline-panel");
const timelineTitle = document.getElementById("timeline-title");
const timelineList = document.getElementById("timeline-list");
const timelineClose = document.getElementById("timeline-close");
const animateCheckbox = document.getElementById("animate-checkbox");

let me = null;
let state = { stars: [], edges: [] };
let selectedStarId = null; // target for the next "declare a connection"

// --- animate toggle (purely a viewer preference, not server state) --------
let animate = true;
try {
  const saved = localStorage.getItem("constellation:animate");
  if (saved !== null) animate = saved === "1";
} catch { /* private browsing etc: fall back to the default */ }
animateCheckbox.checked = animate;
animateCheckbox.addEventListener("change", () => {
  animate = animateCheckbox.checked;
  try { localStorage.setItem("constellation:animate", animate ? "1" : "0"); } catch {}
});

// --- stable layout -----------------------------------------------------
// The server has no notion of position, so each star's spot in the sky is
// derived deterministically from its id: same id -> same spot, every poll,
// every reload, no jitter.
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
const positionCache = new Map();
function positionFor(id) {
  if (positionCache.has(id)) return positionCache.get(id);
  const rand = mulberry32(hashString(id));
  const angle = rand() * Math.PI * 2;
  const radius = 120 + rand() * 900;
  const pos = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  positionCache.set(id, pos);
  return pos;
}

// A person's star still sits at a fixed, meaningful spot (so it stays
// click-able and the "map" of the sky stays legible). But a real sky isn't
// just a handful of named dots on flat black — it has depth, dust, and
// thousands of background stars that aren't anyone in particular. This is
// purely decorative and purely client-side: a fixed seed so it looks the
// same on every visit, not regenerated per session.
const SKY_SEED = 1337;
function buildSky() {
  const rand = mulberry32(SKY_SEED);
  const layers = [[], [], []]; // far -> near, far layer parallaxes least
  const STAR_COLORS = [
    "232, 230, 240", // neutral white (most common, like our sun's neighbours)
    "173, 216, 255", // blue-white (hot, young stars)
    "255, 214, 170", // warm amber (cooler stars)
  ];
  for (let layer = 0; layer < 3; layer++) {
    const count = [90, 70, 50][layer];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 200 + rand() * 2600;
      layers[layer].push({
        angle,
        radius,
        r: 0.5 + rand() * (layer === 2 ? 1.6 : 0.9),
        color: STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)],
        baseAlpha: 0.25 + rand() * 0.5,
        twinkleSpeed: 0.3 + rand() * 0.9,
        twinklePhase: rand() * Math.PI * 2,
      });
    }
  }
  const nebulae = [];
  const NEBULA_COLORS = ["80, 70, 200", "40, 110, 190", "150, 60, 170"];
  for (let i = 0; i < 4; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 300 + rand() * 1400;
    nebulae.push({
      angle,
      radius,
      size: 650 + rand() * 900,
      color: NEBULA_COLORS[i % NEBULA_COLORS.length],
      alpha: 0.11 + rand() * 0.1,
      driftSpeed: 0.02 + rand() * 0.03,
      driftPhase: rand() * Math.PI * 2,
    });
  }
  return { layers, nebulae };
}
const sky = buildSky();
const PARALLAX = [0.25, 0.45, 0.7]; // how much each layer moves when you pan
const ROTATION_SPEED = (Math.PI * 2) / (1000 * 60 * 90); // one slow turn per ~90 min, idle ambiance only

// --- camera (pan/zoom) --------------------------------------------------
const camera = { x: 0, y: 0, scale: 1 };

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
}
window.addEventListener("resize", resize);
resize();

function worldToScreen(x, y) {
  return {
    x: canvas.width / 2 + (x - camera.x) * camera.scale,
    y: canvas.height / 2 + (y - camera.y) * camera.scale,
  };
}
function screenToWorld(sx, sy) {
  return {
    x: camera.x + (sx - canvas.width / 2) / camera.scale,
    y: camera.y + (sy - canvas.height / 2) / camera.scale,
  };
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const before = screenToWorld(e.clientX * devicePixelRatio, e.clientY * devicePixelRatio);
    const factor = Math.pow(1.0015, -e.deltaY);
    camera.scale = Math.min(4, Math.max(0.15, camera.scale * factor));
    const after = screenToWorld(e.clientX * devicePixelRatio, e.clientY * devicePixelRatio);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
  },
  { passive: false },
);

let dragging = false;
let dragStart = null;
canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragStart = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y, moved: false };
});
window.addEventListener("pointermove", (e) => {
  if (!dragging || !dragStart) return;
  const dx = (e.clientX - dragStart.x) * devicePixelRatio;
  const dy = (e.clientY - dragStart.y) * devicePixelRatio;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragStart.moved = true;
  camera.x = dragStart.camX - dx / camera.scale;
  camera.y = dragStart.camY - dy / camera.scale;
});
window.addEventListener("pointerup", (e) => {
  if (dragging && dragStart && !dragStart.moved) onCanvasClick(e);
  dragging = false;
  dragStart = null;
});

const STAR_HIT_RADIUS = 14;
const EDGE_HIT_RADIUS = 8;

function onCanvasClick(e) {
  const sx = e.clientX * devicePixelRatio;
  const sy = e.clientY * devicePixelRatio;

  for (const star of state.stars) {
    const p = positionFor(star.id);
    const s = worldToScreen(p.x, p.y);
    if (Math.hypot(s.x - sx, s.y - sy) <= STAR_HIT_RADIUS * camera.scale + 10) {
      if (me && star.id !== me.id) openConnectModal(star);
      return;
    }
  }

  for (const edge of state.edges) {
    const a = worldToScreen(...Object.values(positionFor(edge.starA)));
    const b = worldToScreen(...Object.values(positionFor(edge.starB)));
    const dist = pointToSegmentDistance(sx, sy, a.x, a.y, b.x, b.y);
    if (dist <= EDGE_HIT_RADIUS * camera.scale + 6) {
      openTimeline(edge);
      return;
    }
  }
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// --- per-star visual variety ----------------------------------------------
// Real stars aren't identical white dots — colour (temperature) and size
// vary. Each person's star gets a stable look derived from its id, so it
// never flickers between reloads, but the sky doesn't read as uniform.
const PERSON_COLORS = [
  { fill: "#f4f3fa", glow: "232, 230, 240" }, // neutral white
  { fill: "#cfe6ff", glow: "173, 216, 255" }, // blue-white
  { fill: "#ffe3c2", glow: "255, 214, 170" }, // warm amber
];
const styleCache = new Map();
function styleFor(id) {
  if (styleCache.has(id)) return styleCache.get(id);
  const rand = mulberry32(hashString(id) ^ 0x51ed270b);
  const style = {
    color: PERSON_COLORS[Math.floor(rand() * PERSON_COLORS.length)],
    sizeJitter: 0.8 + rand() * 0.6,
    twinklePhase: rand() * Math.PI * 2,
    twinkleSpeed: 0.4 + rand() * 0.5,
  };
  styleCache.set(id, style);
  return style;
}

// --- rendering -----------------------------------------------------------
function drawSky(t) {
  const rotation = animate ? t * ROTATION_SPEED : 0;

  for (const nebula of sky.nebulae) {
    const drift = animate ? Math.sin(t * 0.00005 * nebula.driftSpeed + nebula.driftPhase) * 60 : 0;
    const angle = nebula.angle + rotation;
    const wx = Math.cos(angle) * nebula.radius + drift;
    const wy = Math.sin(angle) * nebula.radius;
    const s = { x: canvas.width / 2 + (wx - camera.x * 0.15) * camera.scale, y: canvas.height / 2 + (wy - camera.y * 0.15) * camera.scale };
    const size = nebula.size * camera.scale;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, size);
    g.addColorStop(0, `rgba(${nebula.color}, ${nebula.alpha})`);
    g.addColorStop(1, `rgba(${nebula.color}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(s.x - size, s.y - size, size * 2, size * 2);
  }

  sky.layers.forEach((layer, i) => {
    const parallax = PARALLAX[i];
    for (const star of layer) {
      const angle = star.angle + rotation * (0.3 + i * 0.2);
      const wx = Math.cos(angle) * star.radius;
      const wy = Math.sin(angle) * star.radius;
      const s = {
        x: canvas.width / 2 + (wx - camera.x * parallax) * camera.scale,
        y: canvas.height / 2 + (wy - camera.y * parallax) * camera.scale,
      };
      if (s.x < -20 || s.x > canvas.width + 20 || s.y < -20 || s.y > canvas.height + 20) continue;
      const twinkle = animate ? 0.5 + 0.5 * Math.sin(t * 0.0012 * star.twinkleSpeed + star.twinklePhase) : 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, star.r * Math.min(1.3, camera.scale), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${star.color}, ${star.baseAlpha * twinkle})`;
      ctx.fill();
    }
  });
}

function draw(t) {
  const bg = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75,
  );
  bg.addColorStop(0, "#0b0b18");
  bg.addColorStop(1, "#040408");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawSky(t);

  for (const edge of state.edges) {
    const a = worldToScreen(...Object.values(positionFor(edge.starA)));
    const b = worldToScreen(...Object.values(positionFor(edge.starB)));
    const pulse = animate ? 0.9 + 0.1 * Math.sin(t * 0.0015 + hashString(edge.id ?? edge.starA + edge.starB)) : 1;
    const alpha = edge.brightness * (edge.mutual ? 0.85 : 0.45) * pulse;

    if (edge.mutual) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = 4.5 * camera.scale;
      ctx.strokeStyle = `rgba(154, 209, 255, ${alpha * 0.18})`;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = (edge.mutual ? 1.4 : 1) * camera.scale;
    ctx.strokeStyle = `rgba(154, 209, 255, ${alpha})`;
    ctx.setLineDash(edge.mutual ? [] : [4 * camera.scale, 5 * camera.scale]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const star of state.stars) {
    const p = positionFor(star.id);
    const s = worldToScreen(p.x, p.y);
    const isMe = me && star.id === me.id;
    const style = styleFor(star.id);
    const twinkle = animate ? 0.85 + 0.15 * Math.sin(t * 0.0018 * style.twinkleSpeed + style.twinklePhase) : 1;
    const r = (isMe ? 5 : 3.2 * style.sizeJitter) * Math.sqrt(camera.scale);

    if (isMe && animate) {
      const ringR = r * (3 + 0.6 * Math.sin(t * 0.0012));
      ctx.beginPath();
      ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 225, 150, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    const glowColor = isMe ? "255, 225, 150" : style.color.glow;
    const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 6);
    glow.addColorStop(0, `rgba(${glowColor}, ${0.9 * twinkle})`);
    glow.addColorStop(1, `rgba(${glowColor}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(s.x - r * 6, s.y - r * 6, r * 12, r * 12);

    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? "#ffe196" : style.color.fill;
    ctx.fill();

    if (camera.scale > 0.5 || isMe) {
      ctx.font = `${12 * Math.min(1.4, camera.scale)}px ui-sans-serif, system-ui`;
      ctx.fillStyle = "rgba(232, 230, 240, 0.75)";
      ctx.textAlign = "center";
      ctx.fillText(star.pseudonym, s.x, s.y + r + 16);
    }
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// --- claim flow ------------------------------------------------------------
async function refreshMe() {
  const res = await fetch("/api/me");
  const data = await res.json();
  me = data.star;
  if (me) {
    claimScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    meName.textContent = me.pseudonym;
  } else {
    claimScreen.classList.remove("hidden");
    hud.classList.add("hidden");
  }
}

claimForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pseudonym = document.getElementById("pseudonym").value;
  const res = await fetch("/api/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym }),
  });
  if (res.ok) {
    await refreshMe();
    await pollState();
  } else {
    const { error } = await res.json();
    alert(error);
  }
});

// --- connect modal -----------------------------------------------------
function openConnectModal(star) {
  selectedStarId = star.id;
  connectTarget.textContent = star.pseudonym;
  connectNote.value = "";
  connectModal.classList.remove("hidden");
}
connectCancel.addEventListener("click", () => connectModal.classList.add("hidden"));
connectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = connectForm.querySelector("input[name=type]:checked").value;
  const note = connectNote.value;
  await fetch("/api/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: selectedStarId, type, note }),
  });
  connectModal.classList.add("hidden");
  await pollState();
});

// --- rename ----------------------------------------------------------------
renameBtn.addEventListener("click", () => {
  renameInput.value = me?.pseudonym ?? "";
  renameModal.classList.remove("hidden");
  renameInput.focus();
});
renameCancel.addEventListener("click", () => renameModal.classList.add("hidden"));
renameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pseudonym = renameInput.value;
  const res = await fetch("/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym }),
  });
  if (res.ok) {
    renameModal.classList.add("hidden");
    await refreshMe();
  } else {
    const { error } = await res.json();
    alert(error);
  }
});

// --- timeline panel ------------------------------------------------------
const TYPE_LABEL = {
  know: "said they know",
  worked_together: "said they worked together",
  met_today: "said they met up",
  hung_out: "said they hung out",
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

// --- polling ---------------------------------------------------------------
async function pollState() {
  const res = await fetch("/api/state");
  state = await res.json();
}
pollState();
setInterval(pollState, 4000);
refreshMe();
