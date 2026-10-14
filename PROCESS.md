# Process overview

## From the brief to one sentence

Before writing code I worked the idea through in a long design conversation
and kept the result as a design document outside the repo. Its argument was
that a "social graph" demo becomes a student exercise the moment nodes sit
still and lines are straight, and that the brief's three requirements read
better as one position: **a good shared space remembers the people who shaped
it** (now the core of `README.md`). Shared, shaped and remembered became
multi-user, real-time and persistent. The document also set the scope: four
interactions (enter, explore, connect, watch it evolve) and a list of things
never to build — chat, profiles, likes, friend requests.

The first version, [`8ae37b7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/8ae37b7),
proved the deploy path and the one data decision I didn't want to revisit:
a connection is not a flag but an append-only log of declared events, and
brightness is computed from it.

## Why this stack

**Plain Node `http` plus `node:sqlite`, no framework.** The course gives one
shared-cpu machine with 256 MB and one volume. A SQLite file on that volume is
the only persistence the setup allows, and synchronous `DatabaseSync` is
simple and fast enough for one process on one machine. A framework would have
spent memory and given me nothing the routes needed.

**Three.js from a CDN, no bundler.** The first sky was Canvas2D. Once the
design needed depth, a slow physical layout and light travelling along curves,
I moved to Three.js
([`3063865`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/3063865)),
loaded through an import map. That costs zero server memory and adds no build
step. The trade-off is a CDN dependency and GPU work on visitors' machines.
`CLAUDE.md` records it as a deliberate revision of the earlier "no framework"
rule, whose reason was always the server's budget.

**Polling first, then server-sent events.** For crit 8 state was polled every
4 seconds, on purpose: `CLAUDE.md` forbade building push early, so each week's
requirement stayed its own decision. Crit 9 replaced the poll with SSE (see
below).

## How I work with the agent

I use Claude Code in the repo. The design document is the north star, and
`CLAUDE.md` holds the rules, written down when each decision is made, not
afterwards. I use the app myself and report exactly what I see. The agent
reproduces the problem, finds the root cause, commits each change, and never
pushes or touches production without my say-so. Deploys are by hand while the
repo is private.

Verification changed during the week. After the incident below, the agent only
runs the spec against a throwaway server. For anything visual it drives
headless Chrome through the real flows, samples the camera every frame, and
reads back screenshots. Several bugs were caught that way that unit-level
checks never would have.

## Corrections that landed in the harness

**Hover jitter took three attempts.** I worked out the cause myself: hovering a
star pans the camera toward it, the star moves, I follow it with the mouse,
and the hover drops and bounces. The agent's first fix widened the hit radius
([`44d0362`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/44d0362)).
I reported that it still bounced. The second fix hit-tested hover against a
camera the pan never moves
([`2ffa3d7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/2ffa3d7)).
That broke something worse: clicks used the live camera, so clicking my own
star to start connecting silently missed, and I couldn't connect at all. The
final version shares one "focus zone" between hover and click: a capsule from
where the star was to where it is now. It also holds the pan briefly when
focus drops
([`5ff7e97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/5ff7e97)).
The `CLAUDE.md` rule records why each earlier attempt failed, so it isn't
"simplified" back.

**The spec polluted my own sky.** Strangers named `spec-a-…` appeared, and a
new star seemed to grow from one of them. The cause was the agent running
`pnpm test` against my live preview database. We cleaned it up. `CLAUDE.md`
now forbids pointing the spec at any database someone uses, and
`spec/promises.test.ts` runs only against scratch servers.

**Reset left duplicates.** After using "forget this star" and typing my name
again, there were two of me. The agent confirmed this follows from the design:
forget never deletes. It gave me three options and I chose a gentle warning at
claim time
([`21e087a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/21e087a)).
That promise is now tested.

**Story jumped and wasn't continuous.** The camera was handed between separate
systems, one of which flew it *inside* a star, and scroll-snap stepped it. It
was rewritten as one continuous function of scroll position
([`5ff7e97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/5ff7e97)).
`CLAUDE.md` now forbids per-beat camera systems. A later screenshot caught a
blank frame mid-transition, which led to a "hop" outwards when two targets are
far apart
([`4942dc9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/4942dc9)).

**The birth animation and Story didn't join up.** I couldn't tell where one
ended and the other began, and after clicking during the animation, Story
never appeared. The real cause was a "seen it before" flag. Birth now *is*
Story's opening, every page load plays a short arrival, and both are
watch-only
([`1111331`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/1111331)).

I also removed the speed control, because History already answers "watch the
sky change"
([`4942dc9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/4942dc9)).

## The data, honestly

The demo began with a seed script
([`afb6b43`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/afb6b43))
and an owner-only backfill route
([`d8fd8ca`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/d8fd8ca)).
Everything landed on one day, so History was useless. I gave the agent ranges:
who I met when, and how often we saw each other. `scripts/curate-demo-history.js`
spread that across distinct days. It was dry-run first and backed up first,
and is recorded in `CLAUDE.md` as the single exception to append-only. The
README says plainly that this history is backfilled.

## Crit 9: all at once

The crit asks for two things: changes reaching every open session in about a
second, and one defended decision about several people at once.

**Mechanism.** The 4-second poll became server-sent events
([`4134be6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/4134be6)).
Every write route calls `broadcast()`, which sends the full state to every
open `/api/stream`. SSE rather than WebSockets because the server is plain
`node:http`, the traffic only ever flows one way, and `EventSource`
reconnects on its own. No new dependency.

**The decision: presence is light only.** I chose it from three candidates
the agent laid out (presence, simultaneous edits, what a returning viewer
sees). The other two turned out to be answered by choices I'd already made:
declarations are append-only, so they can't conflict, and History is already
the way to catch up. Presence was the one with a real trade-off against the
README. A "who's here" list would be clearer, but it's the dashboard chrome
`CLAUDE.md` keeps off the sky. So a star glows and twinkles while its owner
has the sky open, and nothing else announces it. The reasoning and the
rejected alternatives are in `docs/adr/0001-multi-user-behaviour.md`, and the
rule is in `CLAUDE.md`.

**A correction that came from the decision.** Presence used to mean "made a
request in the last 20 seconds", fed by the poll. With no poll there was no
heartbeat, and even with one it kept a star lit for 20 seconds after someone
left. Presence now means "has a stream open right now", tracked on the server
per star, so it is true to the second. The stream identifies its owner from
the cookie when it opens, which surfaced one more thing: after claiming or
forgetting a star the browser has to reopen its stream, or your own star never
lights.

**Checking it.** `spec/realtime.test.ts` opens real SSE streams against a
scratch server and checks that a new star and a new declaration arrive within
a second, and that a star is online exactly while its owner's stream is open.
I also had the agent drive two headless Chrome sessions: one claimed a star
and the other's page updated in about 200 ms, with no console errors.

## Crit 10: fly by instruments

The crit asks the app to tell people apart, decide on the server what each
may see and change, and log who did what, so I can narrate a demo from
`flyctl logs` without touching the app.

**Audit before building.** I started by asking the agent to read the server
against the brief rather than add logging straight away. It found a real hole:
the cookie was the star's id, and every snapshot publishes every id. Setting
`star_id=<someone else's id>` let you rename them or declare connections as
them, which is exactly the brief's failure case. I'd been treating "multi-user"
as done since crit 8 because two browsers looked different, and nobody had
tried to be someone else.

**Fix: a session secret.** Claiming now mints a random token and stores only
its hash; every write resolves the actor from that token, and forget revokes
it on the server
([`0264917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/0264917)).
I chose that over signing the id because a signed id can't be revoked, and
over passwords because the README promises entering takes one name. The old
`star_id` cookie is cleared, never trusted, so my own demo browsers had to
claim fresh stars. The decision, the who-can-do-what table and the rejected
alternatives are in `docs/adr/0002-who-can-see-and-change-what.md`.

**Logging.** One `key=value` line per action and per refusal, naming the actor
as `"pseudonym"#id6` because names repeat. I kept it plain text rather than
JSON because the point is reading it aloud in the crit. An in-app activity
view was the obvious next step from the last "Next" note, and I dropped it:
it would be dashboard chrome on the sky, and the logs are for whoever runs the
app, not for visitors.

**Checking it.** `spec/permissions.test.ts` forges a `star_id` cookie and
checks it can neither rename nor connect, checks that renaming touches only
your own star, and that a copied cookie stops working after forget. I also had
the agent run two scripted users against a scratch server and read the log
back to confirm each line named the right person.

**Harness.** `CLAUDE.md` swapped the "logging is next crit's work" note for
two rules: actors come only from `currentStar()`, and a write route isn't done
until it logs both its success and its rejections.
