# Constellation — design notes and decision history

Detailed implementation behaviour and the reasoning/failed-attempts behind it.
`CLAUDE.md` keeps only the short, load-bearing constraints that should shape
every session; this file is for when you need the "why" behind a specific
animation or interaction.

## Story Mode

Story Mode follows the design doc's six-beat guided journey (you entered →
you are not alone → connections shape the sky → old light remains → the sky
remembers → nothing here is fixed). Copy sits fixed on the right, numbered,
faded in by progress so each line arrives *with* the camera, not scrolled past
it. Beats 01–02 always centre on your own star; the travel beat uses your
connection if you have one, else any. Every new star's birth *is* Story's
opening (see the intros section below), so Story continues straight on from a
claim with no hand-off; otherwise it's opt-in via the `story` button. Beat 01
dims everyone but you (`revealMul` follows progress up to beat 02), in Story
and birth alike. It's mutually exclusive with History (entering one exits the
other), both being single "alternate mode" overlays on top of Explore.

The Story camera is one continuous function of (smoothed) scroll progress,
`storyPose(p)`, evaluated every frame from live star positions — spherical
keyframes interpolated with smoothstep, the travel stretch sliding the
look-target along one real connection's Bezier curve at a fixed viewing angle.
An earlier version switched between discrete per-beat systems (orbit easing
for some beats, a direct on-curve flight for another) and jumped at every
hand-off — the flight put the camera *inside* the star it started from. Don't
reintroduce separate per-beat camera systems or `scroll-snap`; keep every
keyframe boundary continuous by construction, and keep the final keyframe
equal to Explore's default pose so leaving Story never snaps. `lerpPose`
"hops" (pulls back by a `sin(πt)` bump, zero at both ends) when two targets
are far apart for the radius, so a transition never pans across empty space
with neither star in frame. The memory stretch drives
`historyMode`/`historicalState()` from progress — rewinding to the empty
pre-history sky, then replaying forward to today — same reconstruction and
decay math as the History slider.

## Explore interactions

**Clicks**: a star focuses, a connection travels, empty sky lets go. Clicking
someone else's star sets `focusStarId` (camera target locks on, radius ≤ 360)
until empty sky or Esc. Clicking a connection flies the camera along its curve
(`flyAlongEdge`/`stepFlight`, starting from the focused end, else the end
nearer the click), then focuses the far star and opens the timeline — the
timeline is reached *through* travel, not instead of it. Your own star still
toggles connect mode.

**Gravity of attention** has three parts: the camera leans toward the hovered
star, everyone unrelated dims (`node.attn` → 0.4) while the focused star's own
connections brighten, and its neighbours' names surface one by one (~180ms
apart). All of it eases; nothing pops. The floating label reads like the
design doc ("NAME / joined 14 Sep / N connections / last seen … / ← connected
to you N days ago").

**Identity is a fingerprint, never an avatar**: colour temperature, size, halo
size, pulse rate, a faint four-point diffraction spike (angle/length) and 0–4
orbiting motes, all derived from its id. Status transitions (online → recent
→ dim) ease over a couple of seconds. "Currently active" = declared something
in the last 10 minutes (`declaredAt` on events, from `edge_events.created_at`)
and shows as an occasional flare of the spike — no badges, no "ONLINE" text.

**A new connection is born as light first, line second**: the travelling
light arcs from declarer to recipient with a dotted trail, and the new strand
is held at zero (`travelInFlight`) until it arrives, then fades in.

**A focused (hovered) star stays focused anywhere in a capsule** from the
screen point where it was when focus began (`hoverAnchor`) to where it's
rendered now — so the cursor can stay put *or* follow the star as
gravity-of-attention pans it toward centre. Hover and click must share this
one test (`findStarAt` → `inFocusZone`). Earlier attempts: live-camera hover
alone made a jitter loop (pan moves the star off the cursor → hover drops →
pan reverts → hover again); a separate never-panned hit camera for hover with
live-camera clicks meant hovering your own star panned it away from the
cursor, so clicking it to enter connect mode silently missed. When focus
drops, the pan holds for `HOVER_RELEASE_MS` before easing back — without that,
reaching from your star to someone else's slid their star out from under the
cursor mid-reach and connecting became a chase. There's no loop: once focus
drops, the star only travels back along the capsule the cursor just left.
Dragging the view clears focus.

**There is no speed control** — removed on purpose. It once scaled idle
motion, but History already answers "watch the sky change", and two time-ish
controls side by side read as redundant. Idle motion runs on `animClock`
(real dt, clamped); don't let History scrubbing touch it, and don't
reintroduce a speed multiplier without asking.

## Intros

Intros are watch-only, and there are exactly two (`startIntro` / `stepIntro`).
`#input-blocker` swallows pointer, wheel and keys and the HUD stays hidden
until they finish — clicking mid-animation used to be able to knock things
off course, so don't add an "interrupt" path.

- **arrival** — every page load with an existing star: your star kindles in
  the dark, then the camera pulls back (holding on your star before drifting
  to centre) while everyone else fades in, landing exactly on Explore's
  default pose. No Story. The canvas stays invisible until the first state fetch and
  `/api/me` resolve, so the full sky never flashes first.
- **birth** — right after a claim: the *same* kindle, but it *is* Story's
  opening: beat 01 copy fades in once your star has kindled, then it unlocks
  right there on page 01 with "scroll to continue" — the reader's own scroll
  pulls back into beat 02 and reveals the sky. (It used to auto-scroll to
  beat 02 before unlocking, which read as "Story starts on page 2".) A
  separate birth animation followed by a separate Story used to snap the
  camera back in at the seam (birth ended wide, beat 01 starts close), and
  gating Story on a "seen it" flag meant a returning browser silently skipped
  it. On claim, `me` is set *before* the first state fetch, and `startIntro` purges
  any "joined the sky" label on your own star — otherwise your own birth was
  announced to you as a stranger, a giant cut-off label at close range.

## History

History starts before the first star and fades links in after stars. The
slider's left end is a little before the earliest `created_at`, so it opens
on an empty sky; each event's strand fades in over a short stretch of history
after its date (`historyEdgeRampMs`), so even a star whose birthday equals its
first connection reads as "star, then link". Star nodes absent from the
historical sky actively fade out — the frame loop used to just skip them,
which left them frozen at full brightness. Dates read "01 SEP 2026", with the
slider's start date and "NOW" under its ends.

Other viewers see a travelling light for every new declaration, not just the
declarer: the snapshot diff (`noteSpectacle`, run on every SSE push) fires `beginTravel` from whoever
declared the newest event, alongside "X joined the sky".

## Stack history

Frontend is Three.js, loaded in the browser via a pinned CDN URL through a
native `<script type="importmap">` in `public/index.html` — no npm
dependency, no bundler, no build step; the browser resolves the bare `"three"`
specifier itself. This replaced an earlier vanilla-Canvas2D frontend once the
design called for real depth, a semi-physical layout, and per-event light
travelling along curves — things Canvas2D can't do well. It's a conscious,
documented revision of `CLAUDE.md`'s former "no framework" line, not a silent
departure from it: that line's actual reasoning was always the 256 MB
**server**-process budget, and a CDN-loaded, browser-only library spends none
of that budget — it adds zero server memory, zero server process, zero
install step (`fly.toml` itself notes the stack is ours to choose; Fly just
runs whatever the Dockerfile produces). If a future change needs an actual
npm-installed frontend *build* step (bundler, JSX, etc.), that's a bigger
decision than this one and should get the same explicit, written-down
treatment here rather than creeping in quietly.
