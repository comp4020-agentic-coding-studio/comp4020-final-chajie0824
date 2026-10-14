# Constellation

Constellation is a shared sky where each person has a star. You enter a name,
and the camera moves out to show the other people there. Click your star and
then someone else's to record a connection, such as knowing each other,
working together or hanging out. Each declaration becomes an event in your
shared history.

## What good means here

My main idea is that a good shared space remembers the people who shaped it.
This helped me connect the brief's three requirements: multi-user, real-time
and persistent.

- **Shared.** People do not choose where to place their stars. Connected stars
  gradually move closer together, so the layout comes from the connections
  people record. I wanted the sky to show relationships within a group.
- **Shaped.** When someone joins or records a connection, other people viewing
  the sky see it happen. A new star lights up, or a light travels between two
  stars before a line appears. I chose this because the change happens in the
  space itself, where people are already looking.
- **Remembered.** A connection stores a series of events. There is no friend
  or unfriend button. Its brightness depends on how often and how recently
  people have connected. Older connections become fainter but remain in the
  history. The history slider lets you look back at how the sky developed.

I also wanted it to feel calm enough to leave open in a room. I tried adding
more glow, moving lines, coloured fog and brighter sounds. Seeing them together
helped me realise that I preferred the quieter version.

## What I read, and what I did with it

- Clay Shirky's
  [*Situated Software*](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware)
  and Robin Sloan's
  [*An app can be a home-cooked meal*](https://www.robinsloan.com/notes/home-cooked-app/)
  helped me see value in making software for a small group. I imagined this
  sky being used by my classmates and friends. Keeping that audience in mind
  helped me decide which features belonged. I also found that keeping the app
  small took effort, because it was easy to keep asking for more features.
- Maggie Appleton's
  [*Ambient Co-presence*](https://maggieappleton.com/ambient-copresence)
  influenced how I show presence. A person's star glows while they have the
  page open, so you can notice them without checking a separate list.
- Mark Weiser and John Seely Brown's
  [*Designing Calm Technology*](https://calmtech.com/papers/designing-calm-technology.html)
  helped me think about attention. The sky moves slowly in the background,
  while a new event creates a more noticeable movement.
- Brian Eno's
  [*Music for Airports* liner notes](http://music.hyperreal.org/artists/brian_eno/MFA-txt.html)
  influenced the sound. I used a slow background drone and kept action sounds
  limited to what the viewer does.

## What it deliberately doesn't do

I left out chat, profiles, likes, follower counts and notifications because I
wanted the focus to stay on the sky. Stars gain a little visual structure as
connections grow, without displaying a score. Past declarations cannot be
edited or deleted through the app; corrections are recorded as new events.
Presence appears through the stars themselves.

## Which claims are checked, and which are judged

The tests in `spec/` check that declarations add to history, forgetting a star
preserves it, a forged id cannot act as another person, updates reach another
browser within a second, and presence follows an open connection.

I judge the appearance through using the site and comparing screenshots of
versions with the same data. That comparison helped me remove the waving lines
and fog. `CLAUDE.md` records these decisions and the problems behind them.
