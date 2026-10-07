# Crit 9 reflection

<!--
DRAFT NOTES, NOT THE REFLECTION. Rewrite in your own words (150-300 words)
before the crit 9 cutoff, then delete this comment and the bullets.
The cutoff sweep reads this exact filename.
-->

## What was the breakthrough that moved the work forward?

- Realising the "mechanism vs. decision" split: SSE vs WebSockets was nearly
  forced by the stack (plain node:http, one-way traffic) — the real choice was
  how presence should *feel*.
- Two of the three candidate decisions (simultaneous edits, reconnect) were
  already answered by earlier choices: append-only log, History as catch-up.
  The earlier decisions paid off.
- Presence used to mean "requested in the last 20 s"; with no poll there was
  no heartbeat, and it lied for 20 s after someone left. Redefining it as
  "has a stream open" made it true to the second.
- (Your own moment: what did you notice when you opened it on two devices?)

## What did this work change about who I want to be as a software developer?

- Choosing the less legible option (glow, not a list) on purpose, because it
  matches what the README says "good" means — and being ready to argue the
  other side at the crit.
- Tests passed, but only two real browsers showed it actually felt live.
- (Your own view: what do you want to keep doing next crit?)
