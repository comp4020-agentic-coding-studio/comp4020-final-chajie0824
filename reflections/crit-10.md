# Crit 10 reflection

## What was the breakthrough that moved the work forward?

Auditing before building. The brief reads like a logging task, and my first
instinct was to add log lines and move on. Instead I asked the agent to read
the server against the brief's failure case first: could one person change
what should be another's? It could. The cookie was just the star's id, and
every snapshot publishes every id, so anyone could copy one and become that
star. I had called the app multi-user since crit 8 because two browsers
looked different. Nobody had tried to be someone else, including me. Once
that was clear, the week reorganised itself: identity had to become a secret
the server checks, and only then would the logs mean anything, because a log
line saying "Alice did this" is worthless if anyone can be Alice.

## What did this work change about who I want to be as a software developer?

I want to test my own work like someone who wants to break it, not like
someone who wants it to pass. The tests were green for two weeks while the
hole sat there, because every test was written by a user acting honestly.
I also want to treat logging as part of the design rather than debugging
leftovers. Deciding what each line says forced me to decide who a "person"
is, and why a name alone isn't enough when two people can share one. And I
still want to choose the restrained option on purpose: an in-app activity
feed would have looked impressive in the crit, but the logs are for whoever
runs the app, so they stay out of the sky.
