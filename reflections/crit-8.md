# Crit 8 reflection

## What was the breakthrough that moved the work forward?

The camera kept "twitching" whenever I hovered a star, and the agent's first
fix only made the hit area wider. What moved things on was working out the
cause myself: hovering pulls the camera toward the star, the star slides, my
mouse follows it, and the hover breaks and snaps back. Once I could describe
that loop, I could reject a fix that only tolerated it and ask for one that
removed it. It took two more rounds. The second "fixed" version quietly made
it impossible to click my own star, which is why I couldn't connect to
anyone. Each round, the reason the last attempt failed went into `CLAUDE.md`.
The breakthrough wasn't code. It was realising that a precise description of
what I see is the most useful thing I can give the agent, and that "it still
does it" is a complete bug report.

## What did this work change about who I want to be as a software developer?

I want to be the one who makes the calls, not the one who accepts the first
working version. This week the important moments were decisions, not features.
Reset shouldn't delete people, but a reused name gets a gentle warning. Speed
goes, because History already does its job. The birth animation should *be*
the start of Story rather than sit next to it. The data shouldn't pretend:
when I backfilled our real history with approximate dates, the README had to
say so. I also want to keep verifying with my own eyes. Tests passing never
told me the camera jumped; looking did.
