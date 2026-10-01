# Constellation

Everyone who opens this app is a star. Claim a pseudonym once — your browser
remembers it, no account, no password — and you're in the sky.

When you recognise another star, you can declare it: *I know this person*,
*we worked together*, *we met today*. That declaration is one-sided and it
doesn't need the other person to agree; it just gets logged. If they declare
back, the line between you changes — from a thin dashed thread (one of you
has spoken) to a solid one (you've both said something). Declare again later
— a new event, same edge — and the line stays bright. Stop, and it fades.
Nothing ever disappears; a star that's gone quiet just dims, the way an old
friendship does rather than being deleted like a dead account.

## Why this shape

Most "social" demos treat a connection as a switch: friended or not,
following or not. That's a bad fit for anything that actually grows between
people over a term — who you know isn't binary, and how close you are to
them changes week to week. So an edge here isn't a flag, it's a log:
`edge_events`, append-only, one row per declared moment. Brightness is a
function of that log — recent and frequent beats old and once — rather than
a fact anyone sets directly. The whole point is that the constellation this
pod/friend-group forms is actually *theirs*, built from what really happened,
not a seeded demo dataset.

This only means anything with more than one person in it at once, and only
stays meaningful if what's declared persists past a single session — which is
exactly the brief's multi-user/real-time/persistent triangle, not bolted on
for the assignment's sake.

## What's here for crit 8 ("it's alive")

This first version proves the deploy path and the data model:

- claim a star, see the whole sky, declare connections, watch brightness and
  line style respond to what's been declared
- everything survives a reload — it's in SQLite on the one persistent volume
  this app gets
- the sky is pannable and zoomable; click any line to see the dated timeline
  of what happened between those two stars

What it *doesn't* do yet, on purpose: the sky updates by polling every few
seconds, not a live push, and there's no structured action log beyond what
SQLite already holds. Those are crit 9 and crit 10's jobs respectively — this
version is deliberately rough where the brief doesn't ask for more yet.

## A deliberate trade-off

Clicking a connection's timeline shows it to anyone looking at the sky, not
just the two people in it. A more private version would gate that to the two
endpoints. We chose the public version anyway, because this is a demo meant
to be shown live to a room — a version that might show nothing because the
viewer isn't one of the two people in it is a worse demo than one that's
honest about being public. Worth revisiting if this ever left the course.

## On the idea

The shape of this — ambient, low-effort, persistent markers of who's around
and who's connected to whom — owes a lot to Maggie Appleton's
[*Ambient Co-presence*](https://maggieappleton.com/ambient-copresence), which
argues that the small, long-running, atmosphere-first web tools (a shared
whiteboard that's just always on, a status light in the corner of a screen)
do something chat and feeds don't: they let people feel like they're in the
same room without demanding anyone's attention. A constellation that slowly
fills in over a term is the same idea pointed at a group of people instead of
a single shared document.
