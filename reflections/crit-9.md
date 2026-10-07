# Crit 9 reflection

## What was the breakthrough that moved the work forward?

Separating the mechanism from the decision. I started out thinking the week
was about "adding real-time", and that the choice was WebSockets or
server-sent events. Once the agent checked the code, that choice turned out to
be nearly forced: a plain `node:http` server, traffic that only flows one
way, and a rule against adding frameworks all point to SSE. The real question
was how several people at once should *feel* in the sky. Of the three
candidates (presence, simultaneous edits, what a returning viewer sees), two
were already answered by decisions I'd made weeks ago. Declarations are
append-only, so they can't conflict, and History already lets you catch up.
That left presence. Choosing "light only" exposed a hidden lie in the old
version: a star stayed lit for twenty seconds after its owner left, because
"online" meant "polled recently". Defining it as "has the sky open right now"
made the glow true to the second.

## What did this work change about who I want to be as a software developer?

I want my early decisions to keep paying off, and this week showed they can.
Because the log was append-only from the first commit, a whole category of
multi-user problems never existed. I also want to be comfortable choosing the
less obvious option on purpose. A "who's here" list would be clearer, and I
expect the crit to argue for it, but it would contradict what my README says
good means. Being able to say why I'm not building it matters more than
building it. And I still trust what I see over what passes: the tests were
green, but only two real browsers updating each other showed it felt live.
