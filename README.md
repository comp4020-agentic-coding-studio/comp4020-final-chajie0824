# Constellation

Everyone who opens this is a star. Type a name once — the browser remembers
it, no account — and your star kindles in the dark before the camera pulls
back to show who's already here. Click your star, then someone else's, and
say what happened: *we know each other*, *we worked together*, *we hung out*.
Each declaration is one event on the line between you.

## What good means here

**A good shared space remembers the people who shaped it.** Three things
follow, and they're the brief's three requirements turned into a position:

- **Shared** — the sky only means something with other people in it. Nobody
  places their own star: weak forces pull connected people together, so
  clusters *emerge* from who declared what. Nobody draws the constellation.
- **Shaped** — when someone joins or declares, everyone watching sees it as
  an event: a star lighting up, a point of light travelling from one person
  to the other before the line appears.
- **Remembered** — a connection isn't a switch, it's a log. Brightness comes
  from how recent and how frequent the events are, so a friendship from last
  year is fainter old light, not deleted. History lives *in* the sky: drag the
  timeline back and watch it empty, then fill again.

Good also means restraint: dark, precise, luminous, and calm enough to leave
open on a screen in a room.

## What I read and looked at

- Maggie Appleton, [*Ambient Co-presence*](https://maggieappleton.com/ambient-copresence):
  small, always-on signals of who's around, without demanding attention.
- Robin Sloan, [*An app can be a home-cooked meal*](https://www.robinsloan.com/notes/home-cooked-app/):
  software made for a few specific people is a legitimate goal, not a toy.
- Clay Shirky, [*Situated Software*](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware):
  build for one group's actual social life instead of for scale.
- Noah Martin's [A1 globe](https://comp4020-agentic-coding-studio.github.io/comp4020-ass1-Noah-Martin1/):
  one immersive, manipulable object as the whole page, not a dashboard.

## What it deliberately doesn't do

No chat, profiles, avatars, likes, follower counts, notifications or friend
requests — each turns a sky into a feed. You can't drag your own star or
delete history. "Forget this star" unlinks the browser but leaves the old star
in the sky. Taking a name that's in use gets a gentle question, not a block.
Timelines are public to everyone looking, because this is meant to be shown
to a room.

## Which claims are checked, and which are judged

Enforced by `spec/` against the running app: a declared connection persists
and reads as one-sided until the other person declares back; declaring again
appends rather than replaces; forgetting never deletes a star; a taken name
warns rather than blocks. Judged, not tested: whether it feels alive, calm and
legible. I judged those by using it, and by having the agent drive a headless
browser through every flow and read back screenshots — which is how a
jumping Story camera and an invisible star mid-transition were caught.
`CLAUDE.md` holds the rules that keep both true.

## Honest about the data

The early sky is real people, but its history was backfilled by me from
memory: who I met when and roughly how often, entered with approximate dates
spread across days. Everything declared on the live site since is exactly as
it happened. Real-time is currently a 4-second poll; making it arrive within
a second is next week's work.
