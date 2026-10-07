import { expect, inject, it } from "vitest";

// Crit 9: a change reaches every open session in about a second, no reload,
// and presence is "has the sky open right now". Checked over real SSE streams.
const baseUrl = inject("baseUrl");
const suffix = () => Math.random().toString(36).slice(2, 8);

type Snapshot = {
  stars: { id: string }[];
  edges: { starA: string; starB: string; eventCount: number }[];
  online: string[];
};

function openStream(cookie?: string) {
  const controller = new AbortController();
  const snapshots: Snapshot[] = [];
  const waiters: (() => void)[] = [];
  const ready = fetch(new URL("/api/stream", baseUrl), {
    headers: cookie ? { cookie } : {},
    signal: controller.signal,
  }).then(async (res) => {
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = frame.split("\n").find((l) => l.startsWith("data: "));
            if (data) {
              snapshots.push(JSON.parse(data.slice(6)));
              waiters.splice(0).forEach((w) => w());
            }
          }
        }
      } catch {
        // aborted
      }
    })();
  });
  async function until(pred: (s: Snapshot) => boolean, ms: number, from = 0) {
    const deadline = Date.now() + ms;
    for (;;) {
      if (snapshots.slice(from).some(pred)) return true;
      const left = deadline - Date.now();
      if (left <= 0) return false;
      await Promise.race([new Promise<void>((r) => waiters.push(r)), new Promise((r) => setTimeout(r, left))]);
    }
  }
  return { ready, until, count: () => snapshots.length, close: () => controller.abort() };
}

async function claim(pseudonym: string) {
  const res = await fetch(new URL("/api/claim", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym, confirmDuplicate: true }),
  });
  const data = await res.json();
  return { id: data.star.id as string, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

it("a new star and a new declaration reach an open session within a second", async () => {
  const watcher = openStream();
  await watcher.ready;
  const a = await claim(`spec-live-a-${suffix()}`);
  expect(await watcher.until((s) => s.stars.some((x) => x.id === a.id), 1000), "new star pushed").toBe(true);

  const b = await claim(`spec-live-b-${suffix()}`);
  const from = watcher.count();
  await fetch(new URL("/api/connect", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ to: b.id, type: "know" }),
  });
  const arrived = await watcher.until(
    (s) => s.edges.some((e) => [e.starA, e.starB].includes(a.id) && [e.starA, e.starB].includes(b.id)),
    1000,
    from,
  );
  watcher.close();
  expect(arrived, "declaration pushed").toBe(true);
});

it("a star is online exactly while its owner has the sky open", async () => {
  const me = await claim(`spec-presence-${suffix()}`);
  const watcher = openStream();
  await watcher.ready;
  const mine = openStream(me.cookie);
  await mine.ready;
  expect(await watcher.until((s) => s.online.includes(me.id), 1000), "lights up on open").toBe(true);
  const from = watcher.count();
  mine.close();
  expect(await watcher.until((s) => !s.online.includes(me.id), 1000, from), "dims on close").toBe(true);
  watcher.close();
});
