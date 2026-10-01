#!/usr/bin/env node
// One-off: seed the live constellation with people chajie actually knows, so
// the demo isn't an empty sky. Idempotent per pair (skips an edge that
// already has events) so running it again doesn't pile up duplicates.
// Run on the machine itself, against the real volume:
//   flyctl ssh sftp put scripts/seed-demo-data.js /tmp/seed-demo-data.js -a <app>
//   flyctl ssh console -a <app> -C "node /tmp/seed-demo-data.js"
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.DB_PATH ?? "/data/constellation.db";
const db = new DatabaseSync(DB_PATH);

const ME_PSEUDONYM = "CHAJIE";

const FRIENDS = ["ZIHAO LING", "SICHEN YE", "SEONGSU KIM", "ZIYUE WU", "HAO DAN", "KAZUNA", "CHETAN", "GENTO"];
const TEACHERS = ["Tom Griffiths", "Ben Swift"];

const TYPES = ["know", "worked_together", "met_today"];
const DAY = 86_400_000;

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

function getStarByPseudonym(pseudonym) {
  return db.prepare("SELECT * FROM stars WHERE pseudonym = ?").get(pseudonym) ?? null;
}

function findOrCreateStar(pseudonym) {
  const existing = getStarByPseudonym(pseudonym);
  if (existing) return existing;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO stars (id, pseudonym, created_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    id,
    pseudonym,
    now,
    now,
  );
  return { id, pseudonym, created_at: now, last_seen_at: now };
}

function pairKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

function findOrCreateEdge(starA, starB) {
  const [a, b] = pairKey(starA, starB);
  const existing = db.prepare("SELECT * FROM edges WHERE star_a = ? AND star_b = ?").get(a, b);
  if (existing) return existing;
  const id = randomUUID();
  db.prepare("INSERT INTO edges (id, star_a, star_b) VALUES (?, ?, ?)").run(id, a, b);
  return { id, star_a: a, star_b: b };
}

function edgeEventCount(edgeId) {
  return db.prepare("SELECT COUNT(*) AS n FROM edge_events WHERE edge_id = ?").get(edgeId).n;
}

function addEvent(edgeId, declaredBy, type, occurredOn) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO edge_events (id, edge_id, declared_by, type, occurred_on, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, edgeId, declaredBy, type, occurredOn, now);
}

function seedPair(meId, otherId, otherName, { eventCount, maxAgeDays }) {
  const edge = findOrCreateEdge(meId, otherId);
  if (edgeEventCount(edge.id) > 0) {
    console.log(`skip ${otherName}: edge already has events`);
    return;
  }
  const rand = mulberry32(hashString(otherName));
  for (let i = 0; i < eventCount; i++) {
    const ageDays = Math.round(rand() * maxAgeDays);
    const occurredOn = new Date(Date.now() - ageDays * DAY).toISOString().slice(0, 10);
    const type = TYPES[Math.floor(rand() * TYPES.length)];
    const declaredBy = i % 2 === 0 ? meId : otherId; // alternate so it reads as mutual
    addEvent(edge.id, declaredBy, type, occurredOn);
  }
  console.log(`seeded ${otherName}: ${eventCount} events`);
}

const me = getStarByPseudonym(ME_PSEUDONYM);
if (!me) {
  console.error(`no star named "${ME_PSEUDONYM}" — claim it in the browser first`);
  process.exit(1);
}

for (const name of FRIENDS) {
  const star = findOrCreateStar(name);
  seedPair(me.id, star.id, name, { eventCount: 4, maxAgeDays: 28 });
}

for (const name of TEACHERS) {
  const star = findOrCreateStar(name);
  seedPair(me.id, star.id, name, { eventCount: 2, maxAgeDays: 35 });
}

console.log("done");
