# Constellation — harness rules

## What this app is, in one line

A shared, persistent constellation: stars are people, edges are declared
connections, brightness comes from a log of events on that edge. See
`README.md` for the full pitch; this file is about how to work on the code.
Detailed animation/interaction behaviour and the decision history behind it
live in `docs/DESIGN-NOTES.md` — read that when you need the "why", not here.

## Rules I'm holding myself to

- **`edge_events` is append-only.** Never write code that deletes or edits a
  past event, even to "fix" a mistaken declaration — the point of the project
  is that the log is honest history. If a correction is ever needed, it's a
  new event, not an edit. **The one exception is owner-run data curation of
  the backfilled demo history**, done by hand on the volume with a script
  committed under `scripts/` (dry-run first, `VACUUM INTO` backup first) and
  disclosed in README.md — e.g. `scripts/curate-demo-history.js`, which
  replaced placeholder seed events with approximate real dates chajie gave.
  Never in app code, never to a real visitor's declarations.
- **Never point the spec at a database anyone is using.** The `spec/` tests
  write real stars and connections through the API. Run them only against a
  throwaway server (`DB_PATH=/tmp/<scratch>.db PORT=5179 node server/index.js`,
  then `APP_URL=http://localhost:5179 pnpm check`), never the local preview DB
  and never production. Running them against the preview once filled the sky
  with `spec-a-…`/`spec-b-…` strangers and "pulled" a new star's connections
  from them.
- **Live state is pushed over SSE (`GET /api/stream`), always as a full
  snapshot.** Every write route (`claim`, `connect`, `admin/connect`,
  `PATCH /api/me`) must call `broadcast()` after it succeeds, or other viewers
  won't see it. Don't switch to WebSockets or add a push library; don't send
  diffs or replay missed events on reconnect — History is the catch-up view.
  Decision and alternatives: `docs/adr/0001-multi-user-behaviour.md`.
- **Presence is light only.** "Online" means the star's owner has a stream
  open right now (`snapshot().online`), never "made a request recently". It
  shows as glow/twinkle and "here now" on hover — no who's-here list, no
  arrival/departure messages, no typing or cursor indicators. Those were
  considered and rejected in the ADR; don't add them without revisiting it.
- **Structured logging with a live activity view is the next crit's work
  ("Fly by instruments"), not something to fold in early.** Re-check the course
  site for the week before relying on it.
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
- **Idle motion ("animate sky" toggle) is real-time theatre, not the
  real-time requirement, and it's opt-in.** It's a purely client-side,
  `localStorage`-persisted viewer preference — never gate any actual feature
  on it. Stars *seed* at a deterministic spot (`hashString(id)`) and then
  relax under a small, heavily-damped force simulation; hit-testing always
  re-projects the *current* simulated position each frame, so this must never
  make clicking imprecise. See `docs/DESIGN-NOTES.md` for the full behaviour.
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
- **"Forget this star" (`POST /api/forget`) only unlinks the browser's
  cookie — it never deletes the star or any of its history.** The cookie is
  `HttpOnly`, so a client-side fix alone can't clear it; this needed a real
  server route, not a `document.cookie` hack. Deleting the star to "start
  fresh" would contradict the append-only rule above in spirit, even though
  it's not literally an `edge_events` edit — so the old star just stays in
  the sky, now un-owned by any browser, and the birth screen reappears for a
  brand new one.
- **Claiming an already-used pseudonym gets a gentle confirm, never a hard
  reject or a silent merge.** Because "forget" never deletes the old star,
  reusing a name after a reset will always collide with the star you just
  orphaned — and two unrelated people can legitimately share a name anyway.
  `POST /api/claim` responds `200 { duplicate: true }` unless the request
  carries `confirmDuplicate: true`; the client shows one `confirm()` asking
  whether this is the same person coming back or someone else, then
  resubmits to actually create it. No automatic rename, no identity merging.

## Stack, briefly

Server: plain Node (`node:http`, `node:sqlite`), `marked` for `/readme/` — no
framework, no bundler, no build step. This is a deliberate choice for a
256 MB single machine, not an oversight; don't introduce a framework or a
bundler on the server to "clean up" anything.

Frontend: Three.js via a pinned CDN URL and a native importmap — no npm
dependency, no bundler, no build step. See `docs/DESIGN-NOTES.md` ("Stack
history") for why this doesn't violate the server's "no framework" rule
above, and for what would (an actual npm-installed frontend build step).
