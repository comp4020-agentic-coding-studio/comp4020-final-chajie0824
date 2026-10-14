#!/usr/bin/env node
// One-off removal of named connections (owner-approved, 2026-10-14): chajie
// asked for about half of CHAJIE ZHOU's connections to go, picked at random,
// because that corner of the sky had become too busy to read. Each pair is
// "NAME A|NAME B" (case-insensitive); the edge between them is deleted with
// all its events. Both stars stay. Run it --dry first.
// Usage (on the volume): node scripts/remove-edges.js /data/constellation.db "A|B" ["A|B" ...] [--dry]
// Like remove-stars.js, this is the owner-run exception to append-only
// recorded in CLAUDE.md — never app code.
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [dbPath, ...pairs] = args.filter((a) => a !== "--dry");
if (!dbPath || pairs.length === 0) {
  console.error('usage: node scripts/remove-edges.js <db> "A|B" ["A|B" ...] [--dry]');
  process.exit(1);
}
const db = new DatabaseSync(dbPath);
const idOf = (name) => db.prepare("SELECT id FROM stars WHERE pseudonym = ? COLLATE NOCASE").get(name)?.id;

const doomed = [];
for (const pair of pairs) {
  const [a, b] = pair.split("|");
  const ia = idOf(a), ib = idOf(b);
  const edge = ia && ib
    ? db.prepare("SELECT id FROM edges WHERE (star_a = ? AND star_b = ?) OR (star_a = ? AND star_b = ?)").get(ia, ib, ib, ia)
    : null;
  if (!edge) { console.log(`"${a}" <-> "${b}": no such connection`); continue; }
  const n = db.prepare("SELECT COUNT(*) AS n FROM edge_events WHERE edge_id = ?").get(edge.id).n;
  console.log(`"${a}" <-> "${b}": ${n} event(s)`);
  doomed.push(edge.id);
}

if (doomed.length === 0) process.exit(0);
if (dry) {
  console.log(`dry run: would delete ${doomed.length} connection(s)`);
  process.exit(0);
}

const backup = `${dbPath}.before-remove-edges-${Date.now()}.db`;
db.exec(`VACUUM INTO '${backup}'`);
console.log(`backed up to ${backup}`);

db.exec("BEGIN");
try {
  for (const id of doomed) {
    db.prepare("DELETE FROM edge_events WHERE edge_id = ?").run(id);
    db.prepare("DELETE FROM edges WHERE id = ?").run(id);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
console.log(`deleted ${doomed.length} connection(s)`);
