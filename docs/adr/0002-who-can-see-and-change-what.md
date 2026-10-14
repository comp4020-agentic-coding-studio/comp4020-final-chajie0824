# ADR 0002: Who can see and change what

- Status: accepted, crit 10 (week 11); amended the same week — see
  "Amendment: the name is the key" below
- Decided by: chajie

## Context

Crit 10 asks the app to tell people apart, decide what each of them may see
and change, check that decision on the server, and log who did what. The
crit is run from the URL alone: two classmates in separate Chrome profiles,
while I narrate from `flyctl logs`.

A "person" here is already a **star**: a browser claims one with a
pseudonym, no account and no password. That stays. The README's position is
that the sky is a shared, public record of who shaped it, so the question
was never how to hide things. It was how to stop one person from speaking
as another.

Checking the existing code against that question found a hole. The
browser's cookie was the star's id, and every snapshot (`/api/state`,
`/api/stream`) publishes every star's id. Copying an id from the network tab
into a `star_id` cookie made you that star: you could rename them or declare
connections in their name. That is exactly the brief's failure case, "one of
them can change what should be the other's".

## Decision

**Everything in the sky is visible to everyone. Every change is made as
exactly one star, the one whose session secret the browser holds, and only
the server decides which star that is.**

| | Anyone (no star) | The star's owner | Anyone else with a star |
|---|---|---|---|
| See stars, edges, presence, every timeline | yes | yes | yes |
| Declare a connection *from* this star | no | yes | no |
| Rename this star | no | yes | no |
| Unlink this browser from the star (forget) | no | yes | no |
| Edit or delete a past declaration | no | no | no |

Concretely:

- **Identity is a session secret, not the id.** Claiming a star mints a
  random 256-bit token, sets it as an `HttpOnly; Secure; SameSite=Lax`
  cookie called `session`, and stores only its sha256 in `sessions`. Every
  write route resolves the star from that token (`currentStar()`); any id in
  the request body is only ever the *other* end of a connection.
- **The old `star_id` cookie is never trusted.** The server can't tell a
  real owner's old cookie from a forged one, so it is cleared on the next
  claim or forget. Browsers that held one (my own demo stars) lose their
  link and see the birth screen again; the stars themselves stay.
- **Forget revokes on the server.** It deletes the session row as well as
  clearing the cookie, so a copied cookie stops working too.
- **Timelines stay public.** Who declared what, and when, is visible to
  anyone, as decided for crit 8 (`CLAUDE.md`). A connection is a public
  statement, and the history is the point of the project.
- **Admin backfill is still the one exception**, and still off unless
  `ADMIN_KEY` is set (`CLAUDE.md`).

Every action, and every refusal, writes one log line naming who did it:

```
2026-10-14T07:06:18.311Z connect    who="Alice"#0e2b07 to="Bob"#b6f810 type=met_today edge=f67d71
2026-10-14T07:06:18.316Z reject     who=anon action=rename reason="no session"
```

`who` is the pseudonym plus the first six characters of the star id, since
two people can share a name and a star can be renamed. These lines go to
stdout, which is what Fly keeps and what `flyctl logs` shows.

## Alternatives considered

**Keep the id cookie but sign it (HMAC with a server secret).** Also closes
the hole, with no table. Rejected because a signed id can't be revoked:
forget could only clear the browser's copy, and the secret would be one more
thing to set with `fly secrets` and never lose.

**Accounts with passwords or a magic link.** The usual answer to "tell
people apart". Rejected: the crit runs from the URL in a fresh profile, and
the README promises entering takes one name. A password adds nothing a
classmate in a crit can't also type, and it makes the sky feel like a
service to sign up for.

**Private timelines, visible only to the two stars on an edge.** Considered
for crit 8 and rejected then; nothing in crit 10 changes it. Hiding history
would contradict "remembered", and would make the crit demo depend on being
logged in as the right person to see anything.

**A visible activity feed in the app for the logs.** Rejected for the same
reason ADR 0001 rejects a who's-here list: it is dashboard chrome on the sky.
The logs are an instrument for the person running the app, so they live in
`flyctl logs`, not on the page.

**Structured JSON log lines.** Easier for a machine, harder to read aloud.
The brief asks me to narrate from them in real time, so each line is short
`key=value` text that still greps cleanly.

## Consequences

- Copying a session cookie into another browser still moves the star with
  it. That is inherent to a password-less identity and accepted: the cookie
  is `HttpOnly`, so page scripts can't read it, and forget revokes it.
- Clearing cookies (or a new Chrome profile) means a new star. The old one
  stays in the sky, un-owned, as forget already worked.
- Session rows are never pruned. One short row per claim is negligible at
  this scale.
- `spec/permissions.test.ts` checks that the cookie isn't the id, that a
  forged `star_id` can't rename or connect, that renaming only touches your
  own star, and that forget revokes a copied cookie.

## Amendment: the name is the key

The first version above kept "clearing cookies means a new star". Using it
straight after the deploy, that was the worst part: my own star, with twelve
connections, was unreachable from any new browser, and the only way back
was a fresh, empty star with the same name. Two people (`CHAJIE ZHOU`,
`seong`) already had duplicates for exactly that reason.

So I changed it: **typing a name that is already in the sky enters that
star.** Matching ignores case. There is no longer a duplicate prompt, and a
rename that would collide with another star's name is refused (409), so
names stay unique from here on. The existing duplicates were removed by an
owner-run script (`scripts/dedupe-stars.js`), keeping the better-connected
star in each pair.

**What this gives up, deliberately.** Anyone who knows your name can now act
as you. That is the brief's failure case, and I'm accepting it for this app
because:

- It is a demo sky for a class and a few friends, shown in a room. The
  names in it are already public, and what someone could do "as you" is
  declare a connection or rename you — both visible to everyone and both
  logged.
- The README promises entering takes one name. Recovering your star in a
  new browser is the common case; impersonation in a room where everyone
  can see the screen is not.
- A PIN or recovery code was offered and rejected as friction at the door
  of the one flow every visitor goes through.

**What still holds.** The session is still a server-side secret, never the
id: knowing someone's id from a snapshot still gets you nothing, and forget
still revokes a copied cookie. Every entry mints its own session, and the
log now carries a 4-character `sid` per browser, so two people who typed
the same name still read as two distinct lines:

```
08:12:44.992Z connect    who="Mira"#fe2e76 sid=0fe2 to="Sat 1"#8699fc type=hung_out
08:12:44.995Z enter      who="Sat 2"#68983b sid=d2c0
```

The table above changes in one cell: "Declare a connection from this star"
and "Rename this star" are open to **whoever types its name**, not only to
the browser that first claimed it. Nothing else changes, and nothing can
edit or delete a past declaration.

If the sky were ever used beyond a room of people who know each other, the
first thing to add back would be a per-star PIN, checked in `/api/claim`.
