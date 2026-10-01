#!/usr/bin/env node
// One-off: apply the two data corrections chajie asked for on 2026-10-01 —
// remove a seeded star that shouldn't be there, and rename chajie's own star
// now that the rename feature exists. Run against the real volume:
//   flyctl ssh sftp put scripts/fixup-2026-10-01.js /tmp/fixup-2026-10-01.js -a <app>
//   flyctl ssh console -a <app> -C "node /tmp/fixup-2026-10-01.js"
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.DB_PATH ?? "/data/constellation.db";
const db = new DatabaseSync(DB_PATH);

function removeStarByPseudonym(pseudonym) {
  const star = db.prepare("SELECT * FROM stars WHERE pseudonym = ?").get(pseudonym);
  if (!star) {
    console.log(`no star named "${pseudonym}", nothing to remove`);
    return;
  }
  const edges = db
    .prepare("SELECT id FROM edges WHERE star_a = ? OR star_b = ?")
    .all(star.id, star.id);
  for (const edge of edges) {
    db.prepare("DELETE FROM edge_events WHERE edge_id = ?").run(edge.id);
    db.prepare("DELETE FROM edges WHERE id = ?").run(edge.id);
  }
  db.prepare("DELETE FROM stars WHERE id = ?").run(star.id);
  console.log(`removed "${pseudonym}" (${edges.length} edge(s), its events)`);
}

function renameByPseudonym(from, to) {
  const star = db.prepare("SELECT * FROM stars WHERE pseudonym = ?").get(from);
  if (!star) {
    console.log(`no star named "${from}", nothing to rename`);
    return;
  }
  db.prepare("UPDATE stars SET pseudonym = ? WHERE id = ?").run(to, star.id);
  console.log(`renamed "${from}" -> "${to}"`);
}

removeStarByPseudonym("SEONGSU KIM");
renameByPseudonym("CHAJIE", "CHAJIE ZHOU");

console.log("done");
