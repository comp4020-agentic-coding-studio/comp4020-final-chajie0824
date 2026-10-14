#!/usr/bin/env node
// One-off removal of duplicate-name stars (owner-approved, 2026-10-14), done
// when the name became the key to its star (ADR 0002 amendment). For each
// name held by more than one star (case-insensitive), keeps the one with the
// most connections (oldest on a tie) and deletes the others together with
// their edges, those edges' events and their sessions. Run it --dry first.
// Usage (on the volume): node scripts/dedupe-stars.js /data/constellation.db [--dry]
// Like curate-demo-history.js, this is the owner-run exception to
// append-only recorded in CLAUDE.md — never app code.
import { DatabaseSync } from "node:sqlite";

const [dbPath, flag] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/dedupe-stars.js <db> [--dry]");
  process.exit(1);
}
const dry = flag === "--dry";
const db = new DatabaseSync(dbPath);

const stars = db.prepare(`
  SELECT s.id, s.pseudonym, s.created_at,
    (SELECT COUNT(*) FROM edges e WHERE e.star_a = s.id OR e.star_b = s.id) AS degree
  FROM stars s
`).all();

const byName = new Map();
for (const s of stars) {
  const key = s.pseudonym.trim().toLowerCase();
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(s);
}

const doomed = [];
for (const group of byName.values()) {
  if (group.length < 2) continue;
  group.sort((a, b) => b.degree - a.degree || a.created_at.localeCompare(b.created_at));
  const [keep, ...drop] = group;
  console.log(`"${keep.pseudonym}": keep ${keep.id.slice(0, 6)} (${keep.degree} connections)`);
  for (const d of drop) {
    console.log(`  delete ${d.id.slice(0, 6)} (${d.degree} connections, created ${d.created_at})`);
    doomed.push(d.id);
  }
}

if (doomed.length === 0) {
  console.log("no duplicate names");
  process.exit(0);
}
if (dry) {
  console.log(`dry run: would delete ${doomed.length} star(s)`);
  process.exit(0);
}

const backup = `${dbPath}.before-dedupe-${Date.now()}.db`;
db.exec(`VACUUM INTO '${backup}'`);
console.log(`backed up to ${backup}`);

db.exec("BEGIN");
try {
  for (const id of doomed) {
    const edges = db.prepare("SELECT id FROM edges WHERE star_a = ? OR star_b = ?").all(id, id);
    for (const e of edges) {
      db.prepare("DELETE FROM edge_events WHERE edge_id = ?").run(e.id);
      db.prepare("DELETE FROM edges WHERE id = ?").run(e.id);
    }
    db.prepare("DELETE FROM sessions WHERE star_id = ?").run(id);
    db.prepare("DELETE FROM stars WHERE id = ?").run(id);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
console.log(`deleted ${doomed.length} star(s)`);
