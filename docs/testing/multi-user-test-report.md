# Multi-user test report

Run before crit 10, against a scratch server (`DB_PATH=/tmp/… PORT=5190`,
never the preview or production database — see `CLAUDE.md`). Scripts lived
outside the repo as throwaway test clients; this file records what they
checked and what the logs looked like, which is the artefact that matters.

## 1–2. Logging and deploy

Every write route already logged its success and its rejections
(`server/index.js`, `log()`). Two gaps were added here, because they're part
of "who did what and when" even though they're not actions:

- `broadcast`: one line per push to open streams, with how many viewers got
  it. Added at `server/index.js` (`broadcast()`).
- `snapshot`: one line per `GET /api/state` (the one-shot fetch on page load),
  naming who asked. Added in the `/api/state` handler.

Example log, two browsers open, one connects:

```
02:17:29.573Z connect    who="CritCarol..."#c4dc0e sid=9ecd to="CritBob..."#eec25d type=met_today edge=319be6
02:17:29.574Z broadcast  viewers=2
```

## 3–4. Users join

`mise exec -- flyctl logs -a comp4020-final-chajie0824`, two browsers (or
Chrome profiles) hitting the deployed URL and typing a name each. Verified
locally first against a throwaway server — see below.

## 5. Scenarios

Each scenario below was run as a Node script against the scratch server
(real HTTP + real SSE, not mocked), then separately confirmed to still pass
`pnpm check` against the same server.

| Scenario | Result | Notes |
|---|---|---|
| a) two users join | ✅ pass | both claim, both open `/api/stream`, both get an initial snapshot |
| b) one user's action reaches the other | ✅ pass | A declares a connection; B's open stream receives it in ~10ms (well under the "about a second" bar) |
| c) simultaneous actions (same second) | ✅ pass | a rename and a connect fired with `Promise.all` (no ordering) both succeeded and both landed in the next broadcast; SQLite's single writer serialises them, so nothing is lost or corrupted |
| d) late joiner | ✅ pass | a brand-new, anonymous `/api/stream` connection receives the two pre-existing stars and their edge in its very first snapshot — there's no "replay", only ever a full current snapshot (ADR 0001) |
| e) leave & return | ✅ pass | closing a stream removes that star from `online` within ~400ms; reopening restores it; the star and its history are untouched throughout (`forget`-style unlinking isn't even needed for this — just closing the tab does it) |
| f) isolated room joins | **N/A** | this app has no rooms — it's one shared sky, by design (README, "Shared") |
| g) scale to two machines | **skipped, deliberately** | the one volume holds a single SQLite file (`fly.toml`, `CLAUDE.md`: "never add a second storage backend"). Two machines would each see their own copy of `/data`, which isn't eventual consistency, it's silent data loss — two people on different machines would each think they were talking to the same sky and would see different, diverging ones. `min_machines_running = 0` and Fly's single-machine scaling already prevent this in production; actually running `fly scale count 2` against prod to "test" it would risk a real split-brain write. The constraint, not the behaviour under it, is the finding here. |
| h) restart mid-session | ✅ pass | killed and restarted the server process against the same database file, mid-session, with 5 stars / 3 edges already declared: the restarted server answered 200 and reported the exact same state. This is the realistic version of "the machine restarted between visits" the brief's persistence requirement describes. |
