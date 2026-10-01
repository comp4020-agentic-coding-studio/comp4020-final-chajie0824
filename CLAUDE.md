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
- **Keep the visual register restrained, not plain.** No dashboard chrome
  (no stat counters, no leaderboards) on the main view — if a feature wants a
  stats page, it belongs behind `/readme/` or a separate route, not layered
  onto the sky. But "restrained" is about clutter, not fidelity: the sky
  itself (background starfield, nebula wash, per-star colour/size variety,
  glow) is allowed to be as rich as it wants, since that's the whole point of
  the thing. Decorative background stars/nebula are purely client-side and
  seeded with a fixed constant (`SKY_SEED`), not derived from real data — they
  must stay visually distinct from (smaller/dimmer than) actual people-stars.
- **Idle motion is real-time theatre, not the real-time requirement, and it's
  opt-in.** The "animate sky" toggle (twinkle, travelling light on
  connections, background drift) is a purely client-side,
  `localStorage`-persisted viewer preference — never gate any actual feature
  on it. This used to mean people-stars/edges stayed at fixed deterministic
  positions; since the Three.js redesign (below) that's no longer true on
  purpose — stars now *seed* at a deterministic spot (same `hashString(id)`
  every load) and then relax under a small, heavily-damped force simulation
  (repulsion between all stars, weak spring attraction along edges, gentle
  centering), so the social graph visibly, slowly shapes the sky. Hit-testing
  always re-projects the *current* simulated position each frame, so this
  must never make clicking imprecise — if a future change makes stars drift
  fast enough that clicks miss, that's a bug in the damping, not an
  acceptable tradeoff.
- **`/readme/` must keep carrying every heading in `README.md`, in order.**
  `spec/invariants.test.ts` checks this and is not to be edited — if a README
  rewrite breaks it, fix the README's headings or the renderer, not the spec.
- **Database file lives at `/data/constellation.db`** (the one Fly volume).
  Local dev can override with `DB_PATH` if needed, but production always
  uses the mounted volume — never add a second storage backend.
- **A pseudonym is renameable (`PATCH /api/me`), but a star's `id` never
  changes.** Renaming only updates the display label; it must never touch
  `edge_events.declared_by` or anything else keyed by id — that's what keeps
  append-only history correct across a rename.
- **Admin backfill (`POST /api/admin/connect`) is a deliberate, narrow
  exception to "connections are always declared by the logged-in star."** It
  exists so the site owner can enter real history that predates the site or
  involves people who can't log in themselves to declare it (e.g. "these two
  met last year"). It's disabled unless the `ADMIN_KEY` env var is set — unset
  in dev and prod by default, so the route 404s until someone deliberately
  runs `fly secrets set ADMIN_KEY=...`. It still goes through the same
  `declareConnection()` + append-only `edge_events` path as a normal
  connection (optionally called twice, once per direction, for a mutual
  backfill) — it does not add any delete/edit capability, so it doesn't
  weaken the append-only rule above. Client-side it's gated behind a
  `Shift+A` shortcut + a key typed once into `localStorage`, not surfaced in
  the normal UI.

## Stack, briefly

Server: plain Node (`node:http`, `node:sqlite`), `marked` for `/readme/` — no
framework, no bundler, no build step. This is a deliberate choice for a
256 MB single machine, not an oversight; don't introduce a framework or a
bundler on the server to "clean up" anything.

Frontend: Three.js, loaded in the browser via a pinned CDN URL through a
native `<script type="importmap">` in `public/index.html` — no npm
dependency, no bundler, no build step; the browser resolves the bare `"three"`
specifier itself. This replaced an earlier vanilla-Canvas2D frontend once the
design called for real depth, a semi-physical layout, and per-event light
travelling along curves — things Canvas2D can't do well. It's a conscious,
documented revision of this file's former "no framework" line, not a silent
departure from it: that line's actual reasoning was always the 256 MB
**server**-process budget, and a CDN-loaded, browser-only library spends none
of that budget — it adds zero server memory, zero server process, zero
install step (`fly.toml` itself notes the stack is ours to choose; Fly just
runs whatever the Dockerfile produces). If a future change needs an actual
npm-installed frontend *build* step (bundler, JSX, etc.), that's a bigger
decision than this one and should get the same explicit, written-down
treatment here rather than creeping in quietly.
