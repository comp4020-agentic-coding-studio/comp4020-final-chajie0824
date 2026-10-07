# ADR 0001: What several people at once looks like

- Status: accepted, crit 9 (week 10)
- Decided by: chajie

## Context

Crit 9 asks for changes to reach every open session in about a second,
without a reload, and for one decision about how the app behaves when several
people use it at the same moment. The README's position is that a good shared
space **remembers the people who shaped it**, and that the sky should stay
calm enough to leave open in a room: no feed, no counters, no chat.

The mechanism mostly follows from the stack. The server is plain `node:http`
on one 256 MB machine, all writes already go through ordinary POSTs, and
nothing ever needs to flow from a viewer to the server except those writes.
Server-sent events fit that exactly: one long-lived response per viewer,
written to with `res.write()`, no dependency, and `EventSource` reconnects by
itself. WebSockets would add a library and a two-way channel nothing uses.

The decision that matters is one level up.

## Decision

**Presence is shown only as light: a star whose owner has the sky open right
now glows and twinkles. There is no list of who's here, no "X is online"
message, and no typing or cursor indicators.**

Concretely:

- "Here" means *has an open stream right now*, not *made a request in the
  last N seconds*. The server tracks open streams per star and puts their
  ids in every snapshot as `online`. A star lights up the moment its owner
  opens the sky and starts to dim the moment the last tab closes.
- The three visual states stay as they were: **online** (bright halo,
  twinkle), **recent** (closed within ten minutes, softer halo), **dim**
  (older). Only what feeds "online" changed.
- Hovering a lit star says "here now" instead of a time; that is the only
  text presence ever produces.
- Anonymous viewers who haven't claimed a star are counted in the existing
  observers line but have no star to light.

Two smaller choices follow from the same position and from the data model:

- **Simultaneous declarations never conflict.** Every declaration is a new
  row in the append-only `edge_events` log, so if two people declare the same
  connection in the same second, both events are kept and both strands of
  light appear. Nothing is merged or rejected. The only overwriting write in
  the app is a rename, which is last-write-wins: a pseudonym is a label on a
  fixed id, so the stakes of a lost rename are a label.
- **Every push is the full state, and a returning viewer just gets the
  current sky.** On (re)connect the first message is a complete snapshot; the
  client diffs it against what it last saw and animates only the difference.
  There is no replay of missed events. Catching up on what happened while you
  were away is what History (the timeline scrubber) is for.

## Alternatives considered

**A visible "who's here" list or presence bar.** The most legible option, and
what most collaborative tools do. Rejected because it is exactly the
dashboard chrome `CLAUDE.md` keeps off the sky, and it turns presence into
something to check rather than something you notice. In a room, a few stars
breathing is enough to know who's around.

**Arrival and departure messages** ("Alice is here"). Already half-built: a
new *star* gets a three-second label. Extending it to every arrival would make
a busy crit room a stream of notifications, the feed the README refuses.
Joining the sky for the first time is an event worth announcing; opening a
tab is not.

**Presence from recent activity** (the old behaviour: seen in the last 20 s,
fed by the 4 s poll). Cheap and needs no connection tracking, but it lies for
up to 20 seconds after someone leaves, and with no poll there is no heartbeat
to feed it. Tying presence to the open stream makes it true to the second.

**Replaying missed events on reconnect.** It would let a returning viewer see
each new strand of light arrive in order. Rejected because a laptop opened
after an hour would replay a burst of animations at once, and the timeline
already does this properly, at a pace the viewer controls.

**WebSockets instead of SSE.** Would also meet the one-second bar. Rejected
for the reasons in Context: an extra dependency for a channel the app only
uses in one direction.

## Consequences

- Presence is ambient but easy to miss for someone who doesn't know what the
  glow means. That is accepted: Story already explains bright vs. faint light.
- Each viewer holds one open connection. On a 256 MB machine that is fine for
  a room of people; every write rebuilds `getState()` once and sends it to all
  streams, which would need to become a diff if the sky grew to thousands.
- An open stream keeps the Fly machine awake, which it should while someone
  is watching. A 20-second keep-alive comment stops Fly's proxy from closing
  idle streams.
- The browser re-opens its stream after claiming or forgetting a star, since
  the server identifies a stream's owner from the cookie at connect time.
- `spec/realtime.test.ts` checks that a new star and a new declaration reach
  an open stream within a second, and that a star is online exactly while its
  owner's stream is open.
