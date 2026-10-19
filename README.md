# Constellation

I made Constellation as a place where a group can see its connections grow.
Everyone is represented by a star. After entering your name, you move out into
the shared sky and can select your star, then another person's, to record
something between you. That might be knowing each other, working on something
together or spending time together. The sky keeps these events over time.

## The idea behind the sky

I wanted to make a shared space that remembers the people who shaped it. This
became my way of approaching the brief's requirements for multiple users,
real-time interaction and persistence.

The arrangement of stars comes from people's connections. Users cannot place
their stars manually; stars with connections move towards one another. I liked
the idea that the group would gradually produce its own shape through using
the site.

Changes also need to be visible to everyone looking at the sky. When somebody
arrives, their star lights up. When a connection is declared, a light travels
between the two stars and a line appears. These animations let people notice
what is happening within the space.

Each connection has an event history. Repeated declarations add to it, and the
line's brightness reflects how frequent and recent those events are. Older
relationships fade visually while their history remains available. Moving the
history slider lets you see earlier stages of the same sky.

I wanted the result to be something I could comfortably leave open in a room.
Trying a version with stronger glow, animated lines, fog and brighter sounds
helped me work out how much activity felt right.

## How the reading influenced my choices

Clay Shirky's
[*Situated Software*](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware)
and Robin Sloan's
[*An app can be a home-cooked meal*](https://www.robinsloan.com/notes/home-cooked-app/)
gave me a reason to build around classmates and friends. A small audience felt
appropriate for this idea. I still found it easy to request extra features,
so keeping that scope needed attention throughout development.

Maggie Appleton's
[*Ambient Co-presence*](https://maggieappleton.com/ambient-copresence)
helped me think about showing who is around. Someone viewing the page has a
glowing star, which makes their presence noticeable within the sky.

[*Designing Calm Technology*](https://calmtech.com/papers/designing-calm-technology.html),
by Mark Weiser and John Seely Brown, influenced the pace of the scene. There
is gentle movement in the background, with more visible movement for new
events. Brian Eno's
[*Music for Airports* liner notes](http://music.hyperreal.org/artists/brian_eno/MFA-txt.html)
influenced the audio: a slow drone sits underneath soft sounds caused by the
viewer's own actions.

## Keeping the focus on connections

I chose to leave out chat, profiles, likes, follower counts and notifications.
A star develops some extra structure as its connections grow, without a visible
score. There is no separate online list. The app also keeps past declarations:
users can record a correction as another event, but cannot edit or delete the
original through the interface.

## How I check the result

Tests in `spec/` cover history being added to, stars surviving “forget”,
rejection of a forged identity, updates arriving in another browser within a
second, and presence matching an open stream.

For appearance, I use the site and compare screenshots with identical data.
This was how I decided to remove the waving lines and fog. The decisions and
the reasons for them are kept in `CLAUDE.md`.
