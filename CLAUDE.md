# Constellation — harness rules

A shared, persistent constellation: stars are people, edges are declared
connections, brightness comes from a log of events on that edge. `README.md`
argues what good means here: **a good shared space remembers the people who
shaped it**, and is calm enough to leave open on a screen in a room. Every
rule below serves one part of that argument, and the section headings say
which. Detailed animation behaviour and the history behind it live in
`docs/DESIGN-NOTES.md`; the two larger decisions are ADRs in `docs/adr/`.

Many rules record a mistake that was made once. Keep that history in the
rule: it is what stops the same mistake being "simplified" back in.

## Remembered: history is honest

- **`edge_events` is append-only.** Never write code that deletes or edits a
  past event, even to "fix" a mistaken declaration. A correction is a new
  event, not an edit. Checked by `spec/promises.test.ts` (declaring again
  appends rather than replaces).
- **The one exception is owner-run data curation, and it never lives in app
  code.** It is a script committed under `scripts/`, run by hand on the
  volume, dry-run first and `VACUUM INTO` backup first, and disclosed in
  README.md ("Honest about the data"). The scripts so far:
  `curate-demo-history.js` (real approximate dates for the backfilled demo),
  `dedupe-stars.js` (duplicates left from before the name was the key),
  `remove-stars.js` and `remove-edges.js` (people and connections chajie asked
  to take out, to thin a crowded sky). Never run one against production
  without chajie confirming that exact run.
- **A pseudonym is renameable (`PATCH /api/me`); a star's `id` never
  changes.** Renaming only updates the label; it must never touch
  `edge_events.declared_by` or anything else keyed by id. That is what keeps
  history correct across a rename.
- **"Forget this star" (`POST /api/forget`) only unlinks the browser.** It
  deletes the session row and clears the `HttpOnly` cookie (which needed a
  real route, not a `document.cookie` hack), but never deletes the star or
  its history. Deleting the star would break append-only in spirit.
- **Admin backfill (`POST /api/admin/connect`) is the one route that declares
  for someone else.** It exists to enter real history that predates the site.
  It 404s unless `ADMIN_KEY` is set (unset by default), goes through the same
  `declareConnection()` path, and adds no delete or edit. Client-side it is
  behind `Shift+A` and a key kept in `localStorage`, never in the normal UI.
- **Database file lives at `/data/constellation.db`** (the one Fly volume).
  Local dev may override `DB_PATH`; never add a second storage backend.

## Shared: who is who

- **A browser acts as a star only through its `session` cookie**, a random
  secret whose sha256 is stored in `sessions`. Never trust a star id from a
  cookie, header or body as "who is asking": ids are public in every
  snapshot. A new write route resolves the actor with `currentStar(req)` and
  treats ids in the body only as the *other* party. The legacy `star_id`
  cookie is cleared, never read. This closed a real hole (copying an id made
  you that star) found by an audit before crit 10. Decision and table:
  ADR 0002; checked by `spec/permissions.test.ts`.
- **The name is the key: `POST /api/claim` with a name already in the sky
  enters that star (case-insensitive); it never makes a second one.** A
  deliberate demo trade-off: anyone who knows a name can act as it. The
  ADR 0002 amendment says why (a new browser couldn't reach its own star, so
  duplicates piled up). Names stay unique: a colliding rename is a 409.
  Don't reintroduce a duplicate-name prompt, and don't add a PIN or password
  without revisiting the amendment.
- **Every action and every refusal logs one line through `log()`, with
  `who=tag(star)` and `sid=`.** That is what `flyctl logs` is read from. A new
  write route isn't done until it logs both its success and its rejections.
  Short `key=value` text, readable aloud; never log the session token; no
  in-app activity feed (the logs are for the operator, not chrome on the sky).
- **The connection timeline stays public** to anyone viewing the sky. A
  connection is a public statement and the history is the point; don't "fix"
  it into a private view without checking first.

## Shaped: changes arrive live

- **Live state is pushed over SSE (`GET /api/stream`), always as a full
  snapshot.** Every write route (`claim`, `connect`, `admin/connect`,
  `PATCH /api/me`) must call `broadcast()` after it succeeds. Don't switch to
  WebSockets, add a push library, send diffs or replay missed events; History
  is the catch-up view. ADR 0001; checked by `spec/realtime.test.ts`.
- **Presence is light only.** "Online" means the owner has a stream open right
  now (`snapshot().online`), never "made a request recently" (that version
  kept a star lit for twenty seconds after its owner left). It shows as glow
  and "here now" on hover: no who's-here list, no arrival messages, no typing
  or cursor indicators.
- **Idle motion (the `animate` toggle) is theatre, not the real-time
  requirement.** A `localStorage` viewer preference that never gates a
  feature. Stars seed at `hashString(id)` and relax under a damped force
  simulation; hit-testing re-projects the current position every frame, so
  motion must never make clicking imprecise.

## Calm: the look and the sound

The register is still and quiet. A first round of spectacle was built and
then mostly taken back (2026-10-14), so these rules exist because the louder
version was tried.

- **No dashboard chrome on the sky**: no stat counters, leaderboards, level
  badges or XP bars. A stats page would belong behind `/readme/` or its own
  route.
- **Stars stay quiet.** Bloom is low, halos small and faint, diffraction
  spikes barely there, and the tier size range is narrow (0.9–1.85). Brighter,
  blown-out stars were tried and chajie found them cheap-looking. A higher
  tier reads as a little more structure, never a much brighter blob.
- **A star's look has two sources that must not mix: colour (spectral class)
  from its id, structure and size (magnitude tier) from its connections.**
  Tier counts distinct people connected, not events. The tier name appears
  only in the hover label. See `docs/DESIGN-NOTES.md` ("Magnitude").
- **Connections stay plain arcs in their declarer's colour.** A double helix
  on mutual edges, redshift toward red for old strands, and a tinted nebula
  behind each cluster were built and removed: together they turned the sky
  into noise. Don't bring back a per-edge shape or colour effect without the
  screenshot comparison below.
- **The background stays black.** Decorative dust is client-side, seeded with
  `SKY_SEED`, and smaller and dimmer than any person-star. There is no nebula
  wash: zoomed out it read as blue haze over the whole sky.
- **Sound is synthesised in `public/audio.js` with the Web Audio API: no audio
  files, no library.** One master gain behind the `sound` toggle (a viewer
  preference like `animate`). It tries to start on page load so the bed is
  already playing on the name screen; where the browser blocks that, the
  first key press starts it. The bed is a drone, a slow pad (a chord change
  about every 30 s) and faint noise, with **nothing random or percussive** —
  the first version had random pings, fast chord changes and glassy bells, and
  read as restless. Only the viewer's own actions make a sound (focus,
  connect, travel, enter); hover and other people's activity stay silent.
  Cues are soft sine swells under a low-pass, never a sharp attack.

## How to work on it

- **Commit every real change as its own commit**, with a message about the
  change, not the conversation. **Never push or deploy without chajie asking**:
  a push to `main` deploys to production through CI.
- **Never point the spec at a database anyone is using.** Run it only against
  a throwaway server (`DB_PATH=/tmp/<scratch>.db PORT=5179 node server/index.js`,
  then `APP_URL=http://localhost:5179 pnpm check`). Running it against the
  preview once filled the sky with `spec-a-…` strangers.
- **A visual change is checked by eye, not just by the build.** Drive headless
  Chrome through the flow on a copy of the live database and read the
  screenshots back. For anything that changes the overall look, put a
  screenshot of the current version beside the new one before calling it
  better; that comparison is how the helix and redshift were judged.
- **`/readme/` must carry every heading in `README.md`, in order.**
  `spec/invariants.test.ts` checks this and is not to be edited; fix the
  README or the renderer instead.
- **A new static file must be added to the server's whitelist** in
  `server/index.js`, or it 404s in production.

## Stack, briefly

Server: plain Node (`node:http`, `node:sqlite`), `marked` for `/readme/`. No
framework, no bundler, no build step: a deliberate choice for one 256 MB
machine. Don't introduce one to "clean up" anything.

Frontend: Three.js from a pinned CDN URL through a native import map, plus
its post-processing addons for bloom. No npm dependency, no bundler, no build
step. `docs/DESIGN-NOTES.md` ("Stack history") says why this doesn't break
the server's no-framework rule, and what would.
