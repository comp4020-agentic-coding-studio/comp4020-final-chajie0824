#!/usr/bin/env node
// One-off removal of named stars (owner-approved, 2026-10-14): chajie asked
// for HAO DAN and ZHAO LI to be taken out of the sky entirely, with every
// connection they were part of. Deletes each matching star (case-insensitive
// name) with its edges, those edges' events and its sessions. Run it --dry first.
// Usage (on the volume): node scripts/remove-stars.js /data/constellation.db "NAME" ["NAME" ...] [--dry]
// Like dedupe-stars.js, this is the owner-run exception to append-only
// recorded in CLAUDE.md — never app code.
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [dbPath, ...names] = args.filter((a) => a !== "--dry");
if (!dbPath || names.length === 0) {
  console.error('usage: node scripts/remove-stars.js <db> "NAME" ["NAME" ...] [--dry]');
  process.exit(1);
}
const db = new DatabaseSync(dbPath);

const doomed = [];
for (const name of names) {
  const rows = db.prepare("SELECT id, pseudonym FROM stars WHERE pseudonym = ? COLLATE NOCASE").all(name);
  if (rows.length === 0) console.log(`"${name}": no such star`);
  for (const r of rows) {
    const edges = db.prepare("SELECT id FROM edges WHERE star_a = ? OR star_b = ?").all(r.id, r.id);
    const events = edges.reduce((n, e) => n + db.prepare("SELECT COUNT(*) AS n FROM edge_events WHERE edge_id = ?").get(e.id).n, 0);
    console.log(`"${r.pseudonym}" ${r.id.slice(0, 6)}: ${edges.length} connection(s), ${events} event(s)`);
    doomed.push(r.id);
  }
}

if (doomed.length === 0) process.exit(0);
if (dry) {
  console.log(`dry run: would delete ${doomed.length} star(s)`);
  process.exit(0);
}

const backup = `${dbPath}.before-remove-${Date.now()}.db`;
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
