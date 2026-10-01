#!/usr/bin/env node
// Usage: node scripts/align-seeded-last-seen.js /data/constellation.db
// Seeded friends never actually visited: their last_seen_at was just the seed
// time. Align it with their last declared interaction. Skips the owner's own
// star and anyone not in the list (e.g. real visitors).
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
const FRIENDS = ["ZIHAO LING", "SICHEN YE", "ZHAO LI", "ZIYUE WU", "HAO DAN", "KAZUNA", "GENTO", "CHETAN", "Tom Griffiths", "Ben Swift"];
db.exec("BEGIN");
for (const name of FRIENDS) {
  const rows = db.prepare("SELECT id FROM stars WHERE pseudonym = ?").all(name);
  if (rows.length !== 1) { console.log(`skip ${name} (${rows.length} matches)`); continue; }
  const id = rows[0].id;
  const last = db.prepare(`SELECT max(ev.created_at) t FROM edge_events ev JOIN edges e ON e.id = ev.edge_id
    WHERE e.star_a = ? OR e.star_b = ?`).get(id, id).t;
  if (!last) { console.log(`skip ${name} (no events)`); continue; }
  db.prepare("UPDATE stars SET last_seen_at = ? WHERE id = ?").run(last, id);
  console.log(`${name.padEnd(14)} last_seen -> ${last}`);
}
db.exec("COMMIT");
