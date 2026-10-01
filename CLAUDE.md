# Constellation — harness rules

## What this app is, in one line

A shared, persistent constellation: stars are people, edges are declared
connections, brightness comes from a log of events on that edge. See
`README.md` for the full pitch; this file is about how to work on the code.

## Rules I'm holding myself to

- **`edge_events` is append-only.** Never write code that deletes or edits a
  past event, even to "fix" a mistaken declaration — the point of the project
  is that the log is honest history. If a correction is ever needed, it's a
  new event, not an edit.
- **Don't reach for real-time push or structured logging yet.** `/api/state`
  is polled on purpose — genuine WebSocket push is crit 9's job and
  structured per-action logging is crit 10's. Adding either early blurs the
  week boundary the brief is deliberately testing; resist the temptation even
  if it's easy to bolt on.
- **The connection timeline stays public** (visible to anyone viewing the
  sky, not gated to the two people in it). This was a deliberate trade-off
  for demo reliability, decided explicitly — don't "fix" it into a private
  view without checking first, since that's a real feature change, not a bug.
- **Keep the visual register restrained.** Near-black background, soft-glow
  stars, no dashboard chrome (no stat counters, no leaderboards) on the main
  view. If a feature wants a stats page, it belongs behind `/readme/` or a
  separate route, not layered onto the sky.
- **`/readme/` must keep carrying every heading in `README.md`, in order.**
  `spec/invariants.test.ts` checks this and is not to be edited — if a README
  rewrite breaks it, fix the README's headings or the renderer, not the spec.
- **Database file lives at `/data/constellation.db`** (the one Fly volume).
  Local dev can override with `DB_PATH` if needed, but production always
  uses the mounted volume — never add a second storage backend.

## Stack, briefly

Plain Node (`node:http`, `node:sqlite`), `marked` for `/readme/`, vanilla
Canvas2D frontend — no framework, no bundler, no build step. This is a
deliberate choice for a 256 MB single machine, not an oversight; don't
introduce a framework or a bundler to "clean up" the frontend.
