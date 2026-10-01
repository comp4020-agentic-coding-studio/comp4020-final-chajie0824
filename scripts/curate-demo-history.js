#!/usr/bin/env node
// One-off curation of the demo history (owner-approved, 2026-10-01).
// Rewrites the backfilled history between chajie and friends to the ranges
// chajie gave (who met when, how often), spread over distinct days so History
// reads as a sky forming rather than one day of everything. Run it --dry first.
// Usage (on the volume): node scripts/curate-demo-history.js /data/constellation.db [--dry]
// Matches stars by pseudonym; rewrites only the listed pairs' events; leaves
// every other star/edge (e.g. real visitors) untouched. Deterministic (fixed seed).
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const [dbPath, flag] = process.argv.slice(2);
const dry = flag === "--dry";
const db = new DatabaseSync(dbPath);

let seed = 20260701;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const DAY = 86_400_000;
const d = (s) => new Date(s + "T00:00:00Z").getTime();
const iso = (ms) => new Date(ms).toISOString();
const day = (ms) => iso(ms).slice(0, 10);
const atTime = (ms, h0 = 9, h1 = 22) => ms + Math.floor((h0 + rand() * (h1 - h0)) * 3600_000);

const ME = "CHAJIE ZHOU";
const STARS = {
  [ME]: "2025-07-02", "ZIHAO LING": "2025-07-05", "SICHEN YE": "2025-07-08", "ZHAO LI": "2025-07-11",
  "ZIYUE WU": "2025-07-15", "HAO DAN": "2025-07-20", "KAZUNA": "2025-07-25", "GENTO": "2026-02-03",
  "CHETAN": "2026-02-17", "Tom Griffiths": "2026-07-27", "Ben Swift": "2026-07-28",
};

// [a, b, phases] — each phase: from/to dates, how many events, which types
const SOCIAL = ["hung_out", "hung_out", "hung_out", "met_today"];
const PAIRS = [
  [ME, "ZIHAO LING", [{ met: "2025-07-06" }, { from: "2025-07-12", to: "2025-11-28", n: 9, types: SOCIAL }]],
  [ME, "SICHEN YE", [{ met: "2025-07-09" }, { from: "2025-08-20", to: "2025-12-10", n: 2, types: SOCIAL }, { from: "2026-02-02", to: "2026-06-28", n: 10, types: SOCIAL }]],
  [ME, "ZHAO LI", [{ met: "2025-07-12" }, { from: "2025-07-20", to: "2026-09-28", n: 13, types: SOCIAL, recent: true }]],
  [ME, "ZIYUE WU", [{ met: "2025-07-17" }, { from: "2025-07-28", to: "2026-09-26", n: 11, types: SOCIAL, recent: true }]],
  [ME, "HAO DAN", [{ met: "2025-07-22" }, { from: "2025-09-01", to: "2026-09-24", n: 3, types: SOCIAL, recent: true }]],
  [ME, "KAZUNA", [{ met: "2025-07-27" }, { from: "2025-09-10", to: "2026-06-25", n: 3, types: SOCIAL }]],
  [ME, "GENTO", [{ met: "2026-02-06" }, { from: "2026-03-01", to: "2026-06-27", n: 3, types: SOCIAL }]],
  [ME, "CHETAN", [{ met: "2026-02-19" }, { from: "2026-04-01", to: "2026-06-20", n: 1, types: SOCIAL }]],
  [ME, "Tom Griffiths", [{ met: "2026-07-29", type: "worked_together" }, { from: "2026-08-12", to: "2026-09-23", n: 2, types: ["worked_together"] }]],
  [ME, "Ben Swift", [{ met: "2026-07-30", type: "worked_together" }, { from: "2026-08-19", to: "2026-09-30", n: 2, types: ["worked_together", "know"] }]],
  ["ZIHAO LING", "SICHEN YE", [{ met: "2025-08-02" }, { from: "2025-10-01", to: "2026-04-30", n: 2, types: SOCIAL }]],
];

const usedDays = new Set();
function freeDay(ms, lo, hi) {
  for (let k = 0; k < 20; k++) {
    const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
    const t = ms + off * DAY;
    if (t >= lo && t <= hi && !usedDays.has(day(t))) { usedDays.add(day(t)); return t; }
  }
  usedDays.add(day(ms));
  return ms;
}
function planPair([a, b, phases]) {
  const events = [];
  for (const ph of phases) {
    if (ph.met) {
      // both sides say they know each other, a day or two apart
      const t0 = freeDay(d(ph.met), d(ph.met), d(ph.met) + 3 * DAY);
      const t1 = freeDay(t0 + DAY, t0 + DAY, t0 + 5 * DAY);
      const type = ph.type ?? "know";
      events.push({ by: a, type, on: t0 }, { by: b, type: type === "worked_together" ? "know" : type, on: t1 });
      continue;
    }
    const lo = d(ph.from), hi = d(ph.to), step = (hi - lo) / ph.n;
    for (let i = 0; i < ph.n; i++) {
      // "until now" relationships end with something in the last week or so
      const base = ph.recent && i === ph.n - 1 ? hi - rand() * 6 * DAY : lo + step * (i + 0.5) + (rand() - 0.5) * step * 0.6;
      const t = freeDay(Math.round(base / DAY) * DAY, lo, hi);
      events.push({ by: rand() < 0.55 ? a : b, type: ph.types[Math.floor(rand() * ph.types.length)], on: t });
    }
  }
  return events.sort((x, y) => x.on - y.on);
}

const byName = (name) => db.prepare("SELECT * FROM stars WHERE pseudonym = ?").all(name);
const report = [];
db.exec("BEGIN");
try {
  const ids = {};
  for (const [name, born] of Object.entries(STARS)) {
    const rows = byName(name);
    if (rows.length > 1) throw new Error(`ambiguous pseudonym ${name} (${rows.length} stars)`);
    const createdAt = iso(atTime(d(born)));
    if (rows.length === 0) {
      const id = randomUUID();
      db.prepare("INSERT INTO stars (id, pseudonym, created_at, last_seen_at) VALUES (?, ?, ?, ?)").run(id, name, createdAt, createdAt);
      ids[name] = id;
      report.push(`+ star ${name} (new) born ${createdAt.slice(0, 10)}`);
    } else {
      ids[name] = rows[0].id;
      db.prepare("UPDATE stars SET created_at = ? WHERE id = ?").run(createdAt, rows[0].id);
      report.push(`~ star ${name} born ${rows[0].created_at.slice(0, 10)} -> ${createdAt.slice(0, 10)}`);
    }
  }
  for (const pair of PAIRS) {
    const [a, b] = pair;
    const [x, y] = ids[a] < ids[b] ? [ids[a], ids[b]] : [ids[b], ids[a]];
    let edge = db.prepare("SELECT * FROM edges WHERE star_a = ? AND star_b = ?").get(x, y);
    if (!edge) {
      edge = { id: randomUUID() };
      db.prepare("INSERT INTO edges (id, star_a, star_b) VALUES (?, ?, ?)").run(edge.id, x, y);
    }
    const removed = db.prepare("DELETE FROM edge_events WHERE edge_id = ?").run(edge.id).changes;
    const events = planPair(pair);
    for (const ev of events) {
      db.prepare("INSERT INTO edge_events (id, edge_id, declared_by, type, occurred_on, created_at, note) VALUES (?, ?, ?, ?, ?, ?, NULL)")
        .run(randomUUID(), edge.id, ids[ev.by], ev.type, day(ev.on), iso(atTime(ev.on, 18, 23)));
    }
    report.push(`= ${a} <-> ${b}: replaced ${removed} events with ${events.length}: ` + events.map((e) => `${day(e.on)} ${e.type}${e.by === a ? "" : "*"}`).join(", "));
  }
  if (dry) db.exec("ROLLBACK"); else db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
console.log(report.join("\n"));
console.log(dry ? "DRY RUN — rolled back" : "COMMITTED");
