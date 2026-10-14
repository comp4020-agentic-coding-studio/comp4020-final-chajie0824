# Process overview

## From the brief to one sentence

Before writing code I worked the idea through in a long design conversation,
kept outside the repo. Its argument was that a "social graph" demo becomes a
student exercise the moment nodes sit still and lines are straight, and that
the brief's three requirements read better as one position: **a good shared
space remembers the people who shaped it** (now the core of `README.md`).
Shared, shaped and remembered became multi-user, real-time and persistent. It
also set a list of things never to build: chat, profiles, likes, friend
requests.

That position comes from the small-scale reading. Shirky's *Situated
Software* and Sloan's *home-cooked meal* argue for software built for one
group's actual social life rather than for scale; Appleton's *Ambient
Co-presence* argues for signals you notice rather than check. I take them
further than they go on one point: at small scale, **restraint is a feature
you have to defend, not a default you fall into**. Every week the obvious
addition (a who's-here list, an activity feed, accounts) was a scale-shaped
answer, and each time the README was the reason to refuse it.

The first version
([`8ae37b7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/8ae37b7))
proved the deploy path and the one data decision I didn't want to revisit: a
connection is not a flag but an append-only log of declared events, and
brightness is computed from it. Most of what followed leaned on that.

## Why this stack

**Plain Node `http` plus `node:sqlite`, no framework.** The course gives one
256 MB machine and one volume. A SQLite file on that volume is the only
persistence allowed, and synchronous `DatabaseSync` is fast enough for one
process. A framework would spend memory and give the routes nothing.

**Three.js from a CDN, no bundler.** The sky started as Canvas2D. Once the
design needed depth, a slow physical layout and light travelling along curves,
it moved to Three.js
([`3063865`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/3063865))
through an import map: zero server memory, no build step, at the cost of a CDN
dependency and GPU work on visitors' machines.

**Poll, then server-sent events.** Crit 8 polled every 4 seconds on purpose,
because `CLAUDE.md` forbade building push early. Crit 9 replaced it with SSE
([`4134be6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/4134be6)):
traffic only flows one way, `EventSource` reconnects by itself, and there is
no new dependency. WebSockets would add a library for a channel nothing uses.

## How I work with the agent

I use Claude Code in the repo. `CLAUDE.md` holds rules, written when a
decision is made rather than afterwards; the reasoning behind each larger
decision is an ADR in `docs/adr/`. I use the app myself and report exactly
what I see. The agent reproduces the problem, finds the root cause, commits
each change, and never pushes or deploys without my say-so.

Verification has three layers: `spec/` against a scratch server, headless
Chrome driven through real flows with screenshots read back, and my own use.
Each layer caught things the others missed.

## Corrections that landed in the harness

**Hover jitter took three attempts.** Hovering a star pans the camera toward
it, so the star moves out from under the mouse. Widening the hit radius
([`44d0362`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/44d0362))
didn't hold. Hit-testing against a camera the pan never moves
([`2ffa3d7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/2ffa3d7))
broke clicking, so I couldn't connect at all. The fix that stuck shares one
focus zone between hover and click
([`5ff7e97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/5ff7e97)),
and `docs/DESIGN-NOTES.md` records why each earlier attempt failed so it
isn't "simplified" back.

**The spec polluted my own sky.** Strangers named `spec-a-…` appeared because
the agent ran the tests against my preview database. `CLAUDE.md` now forbids
pointing the spec at any database someone uses.

**Reset left duplicates.** "Forget this star" never deletes, so typing my name
again made two of me. Of three options I chose a gentle warning at claim time
([`21e087a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/21e087a)),
now a rule and a test.

**Presence lied for twenty seconds.** It meant "polled recently", so a star
stayed lit after its owner left. Deciding presence for crit 9 exposed it; it
now means "has a stream open right now"
([`4134be6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/4134be6)),
recorded in ADR 0001 and checked by `spec/realtime.test.ts`.

**Anyone could be anyone.** The biggest correction came from an audit rather
than a bug report. Before adding logging for crit 10, I had the agent read the
server against the brief's failure case. The cookie was the star's id, and
every snapshot publishes every id, so copying one let you rename that star or
declare connections as it. I had called the app multi-user since crit 8
because two browsers looked different; nobody had tried to be someone else.
Identity is now a random session secret whose hash the server checks, and
forget revokes it
([`0264917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/0264917)).
I chose that over signing the id, which can't be revoked, and over passwords,
which break the README's promise that entering takes one name.
`CLAUDE.md` now says actors come only from the session, and
`spec/permissions.test.ts` forges the old cookie to prove it fails.

## Several people at once

Two decisions, each defended in an ADR. **Presence is light only** (ADR 0001):
a star glows while its owner has the sky open, with no who's-here list,
because a list is the dashboard chrome the README keeps off the sky.
Simultaneous declarations never conflict, because the log is append-only.
**Everything is visible, every change is made as one star** (ADR 0002):
timelines stay public, since a connection is a public statement, but only
the server decides who is asking.

Every action and refusal now writes one log line naming the actor as
`"pseudonym"#id6`, since names repeat. I kept it plain `key=value` text rather
than JSON so it can be read aloud in the crit, and kept it out of the page:
an in-app activity feed was the obvious next step and I dropped it, because
the logs are for whoever runs the app, not for visitors.

## The data, honestly

The demo history was entered by me through a seed script and an owner-only
backfill route
([`d8fd8ca`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/d8fd8ca)),
then spread across real approximate dates by
`scripts/curate-demo-history.js`, dry-run and backed up first. It is the single
recorded exception to append-only, and the README says plainly that this
history is backfilled.
