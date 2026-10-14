import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { marked } from "marked";
import {
  getStar,
  createStar,
  createSession,
  getSessionStar,
  deleteSession,
  findStarByPseudonym,
  touchStar,
  renameStar,
  declareConnection,
  getState,
  getEdgeTimeline,
} from "./db.js";

const PORT = Number(process.env.PORT ?? 8080);
// The cookie holds a random session secret, not the star's id. Ids are public
// (every snapshot lists them), so a cookie that was just the id let anyone
// become anyone. The old `star_id` cookie is cleared, never trusted.
const COOKIE_NAME = "session";
const LEGACY_COOKIE = "star_id";
const COOKIE_ATTRS = "Path=/; HttpOnly; SameSite=Lax; Secure";
// Lets the site owner backfill real history between two *other* people's
// stars (declaring on their behalf, e.g. "Alice and Bob met in July"),
// which the normal /api/connect flow can't do since it always declares from
// the logged-in star. Disabled unless ADMIN_KEY is set — unset in dev/prod
// by default, so this never widens the attack surface unless deliberately
// configured (`fly secrets set ADMIN_KEY=...`).
const ADMIN_KEY = process.env.ADMIN_KEY || null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const i = part.indexOf("=");
      return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
    }),
  );
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function currentStar(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const star = getSessionStar(token);
  if (!star) return null;
  touchStar(star.id);
  return star;
}

// One line per thing a person did, so `flyctl logs` reads as who-did-what.
// `who` is the pseudonym plus the first 6 characters of the star id, since
// two people can share a name. Anyone without a session is `anon`.
function tag(star) {
  return star ? `${JSON.stringify(star.pseudonym)}#${star.id.slice(0, 6)}` : "anon";
}

// A short, non-reversible label for one browser's session, so two people
// entering the same star still read as two lines in the log.
function sid(token) {
  return token ? createHash("sha256").update(token).digest("hex").slice(0, 4) : undefined;
}

function log(event, fields) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" && !/^"/.test(v) && /\s/.test(v) ? JSON.stringify(v) : v}`);
  console.log([new Date().toISOString(), event.padEnd(10), ...parts].join(" "));
}

// Real-time push over server-sent events. Every open /api/stream is a viewer;
// presence is "has a stream open right now", not "polled recently", so a star
// lights up and dims within a second of a tab opening or closing. See
// docs/adr/0001-multi-user-behaviour.md for why it's SSE and full snapshots.
const streams = new Set();
const openStreamsByStar = new Map();

function snapshot() {
  return { ...getState(), online: [...openStreamsByStar.keys()], observers: streams.size };
}

function broadcast() {
  if (streams.size === 0) return;
  const frame = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of streams) res.write(frame);
}

function openStream(req, res) {
  const star = currentStar(req);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");
  streams.add(res);
  log("open", { who: tag(star), sid: sid(parseCookies(req)[COOKIE_NAME]), viewers: streams.size });
  if (star) openStreamsByStar.set(star.id, (openStreamsByStar.get(star.id) ?? 0) + 1);
  // Fly's proxy drops idle connections, so keep a comment line flowing.
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    streams.delete(res);
    log("close", { who: tag(star), sid: sid(parseCookies(req)[COOKIE_NAME]), viewers: streams.size });
    if (star) {
      const left = (openStreamsByStar.get(star.id) ?? 1) - 1;
      if (left > 0) openStreamsByStar.set(star.id, left);
      else openStreamsByStar.delete(star.id);
      touchStar(star.id);
    }
    broadcast();
  });
  broadcast();
}

let readmeCache = null;
async function renderReadme() {
  const md = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const body = marked.parse(md);
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Constellation — about</title>
<link rel="stylesheet" href="/style.css" />
<style>
  main.readme { max-width: 44rem; margin: 3rem auto; padding: 0 1.5rem 4rem; color: #e8e6f0; }
  main.readme h1, main.readme h2 { color: #fff; }
  main.readme a { color: #9ad1ff; }
  main.readme code { background: #1a1a24; padding: 0.1em 0.3em; border-radius: 4px; }
</style>
</head>
<body style="background:#07070b;">
<main class="readme">${body}</main>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(await readFile(new URL("../public/index.html", import.meta.url)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/readme/") {
      if (!readmeCache || process.env.NODE_ENV !== "production") {
        readmeCache = await renderReadme();
      }
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(readmeCache);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/app.js" || url.pathname === "/style.css")) {
      const ext = url.pathname.endsWith(".js") ? ".js" : ".css";
      res.writeHead(200, { "content-type": MIME[ext] });
      res.end(await readFile(new URL(`../public${url.pathname}`, import.meta.url)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const star = currentStar(req);
      return send(res, 200, { star: star ? { id: star.id, pseudonym: star.pseudonym } : null });
    }

    // Unlinks this browser from its star so it can claim a brand new one and
    // see the birth screen again. Doesn't delete the star or its history —
    // that'd fight the append-only principle above — it just clears the
    // cookie; the old star stays in the sky, now un-owned by any browser.
    if (req.method === "POST" && url.pathname === "/api/forget") {
      const star = currentStar(req);
      const token = parseCookies(req)[COOKIE_NAME];
      if (token) deleteSession(token);
      res.setHeader("set-cookie", [
        `${COOKIE_NAME}=; ${COOKIE_ATTRS}; Max-Age=0`,
        `${LEGACY_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`,
      ]);
      log("forget", { who: tag(star), sid: sid(parseCookies(req)[COOKIE_NAME]) });
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/claim") {
      const already = currentStar(req);
      if (already) {
        log("reject", { who: tag(already), action: "claim", reason: "already has a star" });
        return send(res, 400, { error: "already claimed a star in this browser" });
      }
      const { pseudonym } = await readJsonBody(req);
      const name = String(pseudonym ?? "").trim().slice(0, 40);
      if (!name) {
        log("reject", { who: "anon", action: "claim", reason: "empty pseudonym" });
        return send(res, 400, { error: "pseudonym can't be empty" });
      }
      // Typing a name that's already in the sky enters that star instead of
      // making a second one: the name is the key (ADR 0002). Each entry
      // still gets its own session, so the logs tell two browsers apart.
      const existing = findStarByPseudonym(name);
      const star = existing ?? createStar(name);
      const token = createSession(star.id);
      res.setHeader("set-cookie", [
        `${COOKIE_NAME}=${token}; ${COOKIE_ATTRS}; Max-Age=31536000`,
        `${LEGACY_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`,
      ]);
      log(existing ? "enter" : "claim", { who: tag(star), sid: sid(token) });
      send(res, 200, { star: { id: star.id, pseudonym: star.pseudonym }, returning: !!existing });
      return broadcast();
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(res, 200, snapshot());
    }

    if (req.method === "GET" && url.pathname === "/api/stream") {
      return openStream(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/connect") {
      const star = currentStar(req);
      if (!star) {
        log("reject", { who: "anon", action: "connect", reason: "no session" });
        return send(res, 401, { error: "claim a star first" });
      }
      const { to, type, occurredOn, note } = await readJsonBody(req);
      const target = getStar(String(to ?? ""));
      try {
        const edge = declareConnection(star.id, to, type, occurredOn, note);
        log("connect", { who: tag(star), sid: sid(parseCookies(req)[COOKIE_NAME]), to: tag(target), type, on: occurredOn, edge: edge.id.slice(0, 6) });
        send(res, 200, { edge });
        return broadcast();
      } catch (err) {
        log("reject", { who: tag(star), action: "connect", sid: sid(parseCookies(req)[COOKIE_NAME]), to: target ? tag(target) : String(to ?? ""), reason: err.message });
        return send(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/admin/connect") {
      if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) {
        if (ADMIN_KEY) log("reject", { who: tag(currentStar(req)), action: "admin", reason: "bad admin key" });
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("not found");
      }
      const { fromId, toId, type, occurredOn, note, mutual } = await readJsonBody(req);
      try {
        const edge = declareConnection(fromId, toId, type, occurredOn, note);
        if (mutual) declareConnection(toId, fromId, type, occurredOn, note);
        log("admin", { from: tag(getStar(fromId)), to: tag(getStar(toId)), type, on: occurredOn, mutual: !!mutual });
        send(res, 200, { edge });
        return broadcast();
      } catch (err) {
        log("reject", { who: "admin", action: "admin", reason: err.message });
        return send(res, 400, { error: err.message });
      }
    }

    if (req.method === "PATCH" && url.pathname === "/api/me") {
      const star = currentStar(req);
      if (!star) {
        log("reject", { who: "anon", action: "rename", reason: "no session" });
        return send(res, 401, { error: "claim a star first" });
      }
      const { pseudonym } = await readJsonBody(req);
      const name = String(pseudonym ?? "").trim().slice(0, 40);
      if (!name) return send(res, 400, { error: "pseudonym can't be empty" });
      const holder = findStarByPseudonym(name);
      if (holder && holder.id !== star.id) {
        log("reject", { who: tag(star), action: "rename", sid: sid(parseCookies(req)[COOKIE_NAME]), reason: "name taken" });
        return send(res, 409, { error: "that name is already a star in this sky" });
      }
      const updated = renameStar(star.id, name);
      log("rename", { who: tag(star), sid: sid(parseCookies(req)[COOKIE_NAME]), to: JSON.stringify(name) });
      send(res, 200, { star: { id: updated.id, pseudonym: updated.pseudonym } });
      return broadcast();
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/edges/")) {
      const edgeId = url.pathname.slice("/api/edges/".length);
      const timeline = getEdgeTimeline(edgeId);
      if (!timeline) return send(res, 404, { error: "no such edge" });
      return send(res, 200, timeline);
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (err) {
    log("error", { path: req.url, reason: err.message });
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`constellation listening on 0.0.0.0:${PORT}`);
});
