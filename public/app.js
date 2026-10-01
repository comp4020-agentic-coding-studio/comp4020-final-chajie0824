// Constellation — W9 slice. State is polled, not pushed (that's W10's job);
// this is just enough to feel alive across a handful of open tabs.

const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");

const claimScreen = document.getElementById("claim-screen");
const claimForm = document.getElementById("claim-form");
const hud = document.getElementById("hud");
const meName = document.getElementById("me-name");
const connectModal = document.getElementById("connect-modal");
const connectForm = document.getElementById("connect-form");
const connectTarget = document.getElementById("connect-target");
const connectCancel = document.getElementById("connect-cancel");
const timelinePanel = document.getElementById("timeline-panel");
const timelineTitle = document.getElementById("timeline-title");
const timelineList = document.getElementById("timeline-list");
const timelineClose = document.getElementById("timeline-close");

let me = null;
let state = { stars: [], edges: [] };
let selectedStarId = null; // target for the next "declare a connection"

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

// --- rendering -----------------------------------------------------------
function draw() {
  ctx.fillStyle = "#05050a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const edge of state.edges) {
    const a = worldToScreen(...Object.values(positionFor(edge.starA)));
    const b = worldToScreen(...Object.values(positionFor(edge.starB)));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = (edge.mutual ? 1.4 : 1) * camera.scale;
    ctx.strokeStyle = `rgba(154, 209, 255, ${edge.brightness * (edge.mutual ? 0.85 : 0.45)})`;
    ctx.setLineDash(edge.mutual ? [] : [4 * camera.scale, 5 * camera.scale]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const star of state.stars) {
    const p = positionFor(star.id);
    const s = worldToScreen(p.x, p.y);
    const isMe = me && star.id === me.id;
    const r = (isMe ? 5 : 3.2) * Math.sqrt(camera.scale);

    const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 6);
    glow.addColorStop(0, isMe ? "rgba(255, 225, 150, 0.9)" : "rgba(232, 230, 240, 0.65)");
    glow.addColorStop(1, "rgba(232, 230, 240, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(s.x - r * 6, s.y - r * 6, r * 12, r * 12);

    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isMe ? "#ffe196" : "#f4f3fa";
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
  connectModal.classList.remove("hidden");
}
connectCancel.addEventListener("click", () => connectModal.classList.add("hidden"));
connectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = connectForm.querySelector("input[name=type]:checked").value;
  await fetch("/api/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: selectedStarId, type }),
  });
  connectModal.classList.add("hidden");
  await pollState();
});

// --- timeline panel ------------------------------------------------------
const TYPE_LABEL = {
  know: "said they know",
  worked_together: "said they worked together",
  met_today: "said they met up",
};

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
    li.innerHTML = `<span class="date">${ev.occurred_on}</span>${who} ${TYPE_LABEL[ev.type] ?? ev.type}`;
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
