import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { marked } from "marked";
import {
  createStar,
  getStar,
  touchStar,
  renameStar,
  declareConnection,
  getState,
  getEdgeTimeline,
} from "./db.js";

const PORT = Number(process.env.PORT ?? 8080);
const COOKIE_NAME = "star_id";
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
  const id = parseCookies(req)[COOKIE_NAME];
  if (!id) return null;
  const star = getStar(id);
  if (!star) return null;
  touchStar(id);
  return star;
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
      res.setHeader("set-cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/claim") {
      if (currentStar(req)) return send(res, 400, { error: "already claimed a star in this browser" });
      const { pseudonym } = await readJsonBody(req);
      const name = String(pseudonym ?? "").trim().slice(0, 40);
      if (!name) return send(res, 400, { error: "pseudonym can't be empty" });
      const star = createStar(name);
      res.setHeader(
        "set-cookie",
        `${COOKIE_NAME}=${star.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      );
      return send(res, 200, { star: { id: star.id, pseudonym: star.pseudonym } });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(res, 200, getState());
    }

    if (req.method === "POST" && url.pathname === "/api/connect") {
      const star = currentStar(req);
      if (!star) return send(res, 401, { error: "claim a star first" });
      const { to, type, occurredOn, note } = await readJsonBody(req);
      try {
        const edge = declareConnection(star.id, to, type, occurredOn, note);
        return send(res, 200, { edge });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/admin/connect") {
      if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("not found");
      }
      const { fromId, toId, type, occurredOn, note, mutual } = await readJsonBody(req);
      try {
        const edge = declareConnection(fromId, toId, type, occurredOn, note);
        if (mutual) declareConnection(toId, fromId, type, occurredOn, note);
        return send(res, 200, { edge });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }

    if (req.method === "PATCH" && url.pathname === "/api/me") {
      const star = currentStar(req);
      if (!star) return send(res, 401, { error: "claim a star first" });
      const { pseudonym } = await readJsonBody(req);
      const name = String(pseudonym ?? "").trim().slice(0, 40);
      if (!name) return send(res, 400, { error: "pseudonym can't be empty" });
      const updated = renameStar(star.id, name);
      return send(res, 200, { star: { id: updated.id, pseudonym: updated.pseudonym } });
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
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`constellation listening on 0.0.0.0:${PORT}`);
});
