import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

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
  const stars = db.prepare("SELECT id, pseudonym, last_seen_at FROM stars").all();

  const edges = db.prepare("SELECT * FROM edges").all().map((edge) => {
    const events = db
      .prepare("SELECT declared_by, type, occurred_on FROM edge_events WHERE edge_id = ? ORDER BY occurred_on")
      .all(edge.id);
    if (events.length === 0) return null;

    const declaredBy = new Set(events.map((e) => e.declared_by));
    const mutual = declaredBy.has(edge.star_a) && declaredBy.has(edge.star_b);

    const now = Date.now();
    const mostRecent = Math.max(...events.map((e) => new Date(e.occurred_on).getTime()));
    const ageDays = Math.max(0, (now - mostRecent) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const frequency = Math.min(1, events.length / 8);
    const brightness = Math.max(0.08, Math.min(1, recency * 0.75 + frequency * 0.25));

    return {
      id: edge.id,
      starA: edge.star_a,
      starB: edge.star_b,
      mutual,
      brightness,
      eventCount: events.length,
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
