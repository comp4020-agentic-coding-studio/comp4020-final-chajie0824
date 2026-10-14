# Process overview

## From the brief to one sentence

I started by discussing the idea with the agent before writing code. I wanted
something more personal than a graph of dots and lines, but I was not sure
what that should be. The idea I settled on was that a good shared space
remembers the people who shaped it. This gave me a way to connect the brief's
multi-user, real-time and persistent requirements. It also helped me leave out
features like chat, profiles, likes and friend requests.

Shirky and Sloan helped me think about making software for a small group.
Appleton's writing on ambient co-presence influenced how people appear in the
sky. As the project grew, I found that keeping the scope small needed regular
attention. Sometimes I was the one asking for extra features, so the README
became a useful reminder of what I originally wanted.

The first version
([`8ae37b7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/8ae37b7))
established a decision I kept throughout: connections store a history of
declared events, and brightness is calculated from that history.

## Why this stack

I used plain Node `http` with `node:sqlite` for one 256 MB machine and one
volume. This kept the server simple and avoided adding a framework. The sky
started with Canvas2D, then moved to Three.js
([`3063865`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/3063865))
when I wanted depth and light travelling along curved connections. It loads
through a CDN import map, so there is no build step. The trade-off is that it
depends on the CDN and the visitor's GPU.

For crit 8, I used polling every four seconds. I had explicitly put off push
updates in `CLAUDE.md`. For crit 9, I changed this to server-sent events
([`4134be6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/4134be6)).
Updates only need to travel from the server to the browser, and `EventSource`
handles reconnection. This seemed simpler than adding WebSockets, as explained
in ADR 0001. Sound uses Web Audio
([`6b24ec5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/6b24ec5)),
which lets me generate it without audio files or another build step.

## How I work with the agent

I use Claude Code inside the repository. Usually I try the site first, then
describe what I saw and what felt wrong. The agent investigates and implements
the change. It commits changes separately and only pushes when I ask, because
pushing to `main` triggers deployment. I record decisions in `CLAUDE.md`,
including why they were needed. Larger decisions have an ADR.

I check changes with `spec/` on a temporary server, headless Chrome
screenshots, and my own use of the site. These checks catch different things.
Passing tests did not always mean I was happy with the result. The permission
problem showed that a test can miss a behaviour I have not thought to question.
The visual changes showed a different limit: the code can work as requested
while the overall result still feels wrong. These experiences helped me be
more specific about what I wanted each check to tell me.

## Who counts as a person

Before crit 10, I asked the agent to check the server against the brief's
failure case. It found that the cookie contained only the star's id. Since
every snapshot includes all star ids, someone could copy another id into their
cookie and act as that person. I had described the app as multi-user since
crit 8, but I had only checked that two browsers could use different stars.
I had not tried impersonating someone.

The fix uses a random session secret, with its hash checked by the server
([`0264917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/0264917)).
`spec/permissions.test.ts` now tries the old forged cookie and checks that it
fails. I considered a signed id, but wanted sessions that could be revoked.
Passwords were another option, but I wanted joining to require only a name.

## When adding more made it worse

The visual changes taught me the most. I thought the stars looked plain and
asked the agent for a richer appearance. I then accepted several suggestions:
bloom, redshift on old connections, a double helix for mutual connections,
cluster nebulae, a targeting reticle, shockwaves and a close-up stellar surface
([`bcf55bf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/bcf55bf)
to
[`85271b1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/85271b1)).
The individual screenshots looked fine, but using the whole scene felt too
busy. At first I could only say that I liked it less. I could not explain
which changes were responsible.

To compare properly, I had the old and new versions run with the same copy of
the live data. The base colours were the same. The main problems were the
helix covering the screen with waves, old connections turning pink, and purple
fog around clusters. I removed those effects
([`8c83b0b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/8c83b0b)),
then removed the blue background haze and reduced the stars' brightness
([`74f7237`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/74f7237)).
The brighter stars had looked cheap to me. Comparing again helped me decide
when to stop.

I added rules to `CLAUDE.md`: connections should stay plain arcs, stars should
stay quiet, and changes to the overall appearance need a comparison first
([`14e224f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/14e224f)).
Writing down the failed version made these rules more useful than simply
asking the agent to make the site calm.

![The same sky before the cleanup](docs/process/sky-busy.jpg)
![The same sky after the cleanup](docs/process/sky-calm.jpg)

I had a similar problem with sound. The first version made random pings,
changed chords every fourteen seconds and used bright bells for actions. I
found it restless. The rework
([`5fb95ac`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/5fb95ac))
removed random and percussive sounds and kept cues for the viewer's own
actions. I listened locally before deploying it.

The agent could implement the ideas I requested, but I still had to decide
whether they belonged. Having “calm” in the README had not been enough to guide
all those individual decisions.

## Smaller fixes

Hover jitter took three attempts
([`5ff7e97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/5ff7e97));
`docs/DESIGN-NOTES.md` records why the first two failed. Running the spec
against my preview database once added test strangers to the sky, so I added
a rule requiring a temporary database
([`561f3a2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/561f3a2)).
Presence also changed from “polled recently”, which kept stars lit for twenty
seconds after leaving, to having an open stream
([`4134be6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/4134be6)).
ADR 0001 records that decision
([`8b14b99`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-chajie0824/commit/8b14b99)).
