import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";

const DB_PATH = process.env.DB_PATH ?? "/data/constellation.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS stars (
    id TEXT PRIMARY KEY,
    pseudonym TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    star_a TEXT NOT NULL REFERENCES stars(id),
    star_b TEXT NOT NULL REFERENCES stars(id),
    UNIQUE(star_a, star_b)
  );

  CREATE TABLE IF NOT EXISTS edge_events (
    id TEXT PRIMARY KEY,
    edge_id TEXT NOT NULL REFERENCES edges(id),
    declared_by TEXT NOT NULL REFERENCES stars(id),
    type TEXT NOT NULL,
    occurred_on TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- A browser proves it owns a star with a random secret, never with the
  -- star's id: ids are public in every snapshot. Only the hash is stored.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    star_id TEXT NOT NULL REFERENCES stars(id),
    created_at TEXT NOT NULL
  );
`);

// `note` was added after the first deploy; the live volume's table predates
// it, so add it defensively rather than assuming a fresh schema.
try {
  db.exec("ALTER TABLE edge_events ADD COLUMN note TEXT");
} catch (err) {
  if (!String(err.message).includes("duplicate column")) throw err;
}

const EVENT_TYPES = new Set(["know", "worked_together", "met_today", "hung_out"]);
const MAX_NOTE_LENGTH = 140;

function pairKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function createStar(pseudonym) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO stars (id, pseudonym, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
  ).run(id, pseudonym, now, now);
  return { id, pseudonym, created_at: now, last_seen_at: now };
}

export function getStar(id) {
  return db.prepare("SELECT * FROM stars WHERE id = ?").get(id) ?? null;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(starId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, star_id, created_at) VALUES (?, ?, ?)").run(
    hashToken(token),
    starId,
    new Date().toISOString(),
  );
  return token;
}

export function getSessionStar(token) {
  const row = db.prepare("SELECT star_id FROM sessions WHERE token_hash = ?").get(hashToken(token));
  return row ? getStar(row.star_id) : null;
}

export function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

// A name is the key to its star (demo trade-off, ADR 0002): matching is
// case-insensitive, and if duplicates predate this rule the best-connected
// one wins.
export function findStarByPseudonym(pseudonym) {
  return db.prepare(`
    SELECT s.* FROM stars s
    WHERE s.pseudonym = ? COLLATE NOCASE
    ORDER BY (SELECT COUNT(*) FROM edges e WHERE e.star_a = s.id OR e.star_b = s.id) DESC, s.created_at
    LIMIT 1
  `).get(pseudonym) ?? null;
}

export function touchStar(id) {
  db.prepare("UPDATE stars SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function renameStar(id, pseudonym) {
  db.prepare("UPDATE stars SET pseudonym = ? WHERE id = ?").run(pseudonym, id);
  return getStar(id);
}

function findOrCreateEdge(starA, starB) {
  const [a, b] = pairKey(starA, starB);
  const existing = db.prepare("SELECT * FROM edges WHERE star_a = ? AND star_b = ?").get(a, b);
  if (existing) return existing;
  const id = randomUUID();
  db.prepare("INSERT INTO edges (id, star_a, star_b) VALUES (?, ?, ?)").run(id, a, b);
  return { id, star_a: a, star_b: b };
}

export function declareConnection(fromStarId, toStarId, type, occurredOn, note) {
  if (fromStarId === toStarId) throw new Error("a star cannot connect to itself");
  if (!EVENT_TYPES.has(type)) throw new Error(`unknown connection type: ${type}`);
  if (!getStar(toStarId)) throw new Error("that star doesn't exist");
  const cleanNote = String(note ?? "").trim().slice(0, MAX_NOTE_LENGTH) || null;

  const edge = findOrCreateEdge(fromStarId, toStarId);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO edge_events (id, edge_id, declared_by, type, occurred_on, created_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, edge.id, fromStarId, type, occurredOn ?? now.slice(0, 10), now, cleanNote);
  return edge;
}

// Brightness decays with time since the most recent event and grows with how
// many events an edge has accumulated. Both-sides-declared edges render solid;
// one-sided edges render dashed, since only half the relationship has spoken.
const HALF_LIFE_DAYS = 21;

export function getState() {
  const stars = db.prepare("SELECT id, pseudonym, created_at, last_seen_at FROM stars").all();

  const edges = db.prepare("SELECT * FROM edges").all().map((edge) => {
    const rows = db
      .prepare("SELECT declared_by, type, occurred_on, created_at FROM edge_events WHERE edge_id = ? ORDER BY occurred_on, created_at")
      .all(edge.id);
    if (rows.length === 0) return null;

    const declaredBy = new Set(rows.map((e) => e.declared_by));
    const mutual = declaredBy.has(edge.star_a) && declaredBy.has(edge.star_b);

    const now = Date.now();
    // Every event gets its own decayed brightness — the client draws one line
    // per event, not one aggregated line per edge, so "we hung out five times"
    // visibly looks like five strands of light, not a number nobody sees.
    const events = rows.map((e) => {
      const ageDays = Math.max(0, (now - new Date(e.occurred_on).getTime()) / 86_400_000);
      const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      return {
        declaredBy: e.declared_by,
        type: e.type,
        occurredOn: e.occurred_on,
        // when it was declared (vs. when it happened) — lets the client tell
        // who's "currently active" for the flare, and which event is newest
        declaredAt: e.created_at,
        brightness: Math.max(0.12, Math.min(1, recency)),
      };
    });

    const mostRecent = Math.max(...rows.map((e) => new Date(e.occurred_on).getTime()));
    const ageDays = Math.max(0, (now - mostRecent) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const frequency = Math.min(1, rows.length / 8);
    const brightness = Math.max(0.08, Math.min(1, recency * 0.75 + frequency * 0.25));

    return {
      id: edge.id,
      starA: edge.star_a,
      starB: edge.star_b,
      mutual,
      brightness,
      eventCount: rows.length,
      events,
    };
  }).filter(Boolean);

  return { stars, edges };
}

export function getEdgeTimeline(edgeId) {
  const edge = db.prepare("SELECT * FROM edges WHERE id = ?").get(edgeId);
  if (!edge) return null;
  const events = db
    .prepare(
      "SELECT declared_by, type, occurred_on, created_at, note FROM edge_events WHERE edge_id = ? ORDER BY occurred_on, created_at",
    )
    .all(edgeId);
  return { edge, events };
}
