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
- **There is no speed control — removed on purpose.** It once scaled idle
  motion, but History already answers "watch the sky change", and two
  time-ish controls side by side read as redundant. Idle motion runs on
  `animClock` (real dt, clamped); don't let History scrubbing touch it, and
  don't reintroduce a speed multiplier without asking.
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

- **Story Mode follows the design doc's six-beat guided journey** (you
  entered → you are not alone → connections shape the sky → old light
  remains → the sky remembers → nothing here is fixed). Copy sits fixed on
  the right, numbered, faded in by progress so each line arrives *with* the
  camera, not scrolled past it. Beats 01–02 always centre on your own star;
  the travel beat uses your connection if you have one, else any. It plays
  **once automatically right after a first-ever birth** (`storySeen` in
  localStorage) — this replaced an earlier "never auto-play" call, because
  starting it *after* the birth sequence ends avoids the collision that
  call worried about; otherwise it's opt-in via the `story` button. It's mutually
  exclusive with History (entering one exits the other), both being single
  "alternate mode" overlays on top of Explore. **The Story camera is one
  continuous function of (smoothed) scroll progress, `storyPose(p)`,
  evaluated every frame from live star positions** — spherical keyframes
  interpolated with smoothstep, the travel stretch sliding the look-target
  along one real connection's Bezier curve at a fixed viewing angle. An
  earlier version switched between discrete per-beat systems (orbit easing
  for some beats, a direct on-curve flight for another) and jumped at every
  hand-off — the flight put the camera *inside* the star it started from.
  Don't reintroduce separate per-beat camera systems or `scroll-snap`; keep
  every keyframe boundary continuous by construction, and keep the final
  keyframe equal to Explore's default pose so leaving Story never snaps.
  `lerpPose` "hops" (pulls back by a `sin(πt)` bump, zero at both ends) when
  two targets are far apart for the radius, so a transition never pans
  across empty space with neither star in frame. The memory stretch drives
  `historyMode`/`historicalState()` from progress —
  rewinding to the empty pre-history sky, then replaying forward to today —
  same reconstruction and decay math as the History slider.

- **Explore clicks: a star focuses, a connection travels, empty sky lets
  go.** Clicking someone else's star sets `focusStarId` (camera target
  locks on, radius ≤ 360) until empty sky or Esc. Clicking a connection
  flies the camera along its curve (`flyAlongEdge`/`stepFlight`, starting
  from the focused end, else the end nearer the click), then focuses the far
  star and opens the timeline — the timeline is reached *through* travel,
  not instead of it. Your own star still toggles connect mode.

- **Gravity of attention has three parts**: the camera leans toward the
  hovered star, everyone unrelated dims (`node.attn` → 0.4) while the
  focused star's own connections brighten, and its neighbours' names
  surface one by one (~180ms apart). All of it eases; nothing pops. The
  floating label reads like the design doc ("NAME / joined 14 Sep / N
  connections / last seen … / ← connected to you N days ago").

- **A star's identity is a fingerprint, never an avatar**: colour
  temperature, size, halo size, pulse rate, a faint four-point diffraction
  spike (angle/length) and 0–4 orbiting motes, all derived from its id.
  Status transitions (online → recent → dim) ease over a couple of seconds.
  "Currently active" = declared something in the last 10 minutes
  (`declaredAt` on events, from `edge_events.created_at`) and shows as an
  occasional flare of the spike — no badges, no "ONLINE" text.

- **A new connection is born as light first, line second**: the travelling
  light arcs from declarer to recipient with a dotted trail, and the new
  strand is held at zero (`travelInFlight`) until it arrives, then fades in.

- **"Forget this star" (`POST /api/forget`, the &#8634; button next to rename)
  only unlinks the browser's cookie — it never deletes the star or any of its
  history.** The cookie is `HttpOnly`, so a client-side fix alone can't clear
  it; this needed a real server route, not a `document.cookie` hack. Deleting
  the star to "start fresh" would contradict the append-only rule above in
  spirit, even though it's not literally an `edge_events` edit — so the old
  star just stays in the sky, now un-owned by any browser, and the birth
  screen reappears for a brand new one.

- **Claiming an already-used pseudonym gets a gentle confirm, never a hard
  reject or a silent merge.** Because "forget" never deletes the old star
  (above), reusing a name after a reset will always collide with the star
  you just orphaned — and two unrelated people can legitimately share a
  name anyway. `POST /api/claim` checks `pseudonymExists()` and, unless the
  request carries `confirmDuplicate: true`, responds `200 { duplicate: true }`
  instead of creating a star; the client shows one `confirm()` (same pattern
  as the forget button) asking whether this is the same person coming back
  or someone else, then resubmits with `confirmDuplicate: true` to actually
  create it. No automatic rename, no identity merging — the new star is
  always fully independent of the old one, same as any other same-name
  collision.

- **A focused (hovered) star stays focused anywhere in a capsule from the
  screen point where it was when focus began (`hoverAnchor`) to where it's
  rendered now** — so the cursor can stay put *or* follow the star as
  gravity-of-attention pans it toward centre. Hover and click must share this
  one test (`findStarAt` → `inFocusZone`). Earlier attempts: live-camera
  hover alone made a jitter loop (pan moves the star off the cursor → hover
  drops → pan reverts → hover again); a separate never-panned hit camera
  for hover with live-camera clicks meant hovering your own star panned it
  away from the cursor, so clicking it to enter connect mode silently missed.
  When focus drops, the pan **holds for `HOVER_RELEASE_MS`** before easing
  back — without that, reaching from your star to someone else's slid their
  star out from under the cursor mid-reach and connecting became a chase.
  There's no loop: once focus drops, the star only travels back along the
  capsule the cursor just left. Dragging the view clears focus.

- **Birth is a camera sequence locked onto your own new star, not the sky's
  centre** (`startBirth`/`stepBirth`): close-up on your star with everything
  else (other stars, connections, background dust) dimmed to near-black →
  pull back while the rest of the sky fades in (`revealMul`) → release the
  target to the normal origin/gravity behaviour. Gravity-of-attention and
  hover are suspended while the birth sequence owns the target.

- **History starts before the first star and fades links in after stars.**
  The slider's left end is a little before the earliest `created_at`, so it
  opens on an empty sky; each event's strand fades in over a short stretch
  of history after its date (`historyEdgeRampMs`), so even a star whose
  birthday equals its first connection reads as "star, then link". Star
  nodes absent from the historical sky actively fade out — the frame loop
  used to just skip them, which left them frozen at full brightness. Dates
  read "01 SEP 2026", with the slider's start date and "NOW" under its ends.

- **Other viewers see a travelling light for every new declaration**, not
  just the declarer: the poll diff (`noteSpectacle`) fires `beginTravel`
  from whoever declared the newest event, alongside "X joined the sky".

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
