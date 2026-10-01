import { expect, inject, it } from "vitest";

// The promises README.md makes about history and identity, checked against
// the running app. Each one is a decision recorded in CLAUDE.md.
const baseUrl = inject("baseUrl");
const suffix = () => Math.random().toString(36).slice(2, 8);

async function post(path: string, body: unknown, cookie?: string) {
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
async function claim(pseudonym: string, confirmDuplicate = false) {
  const res = await post("/api/claim", { pseudonym, confirmDuplicate });
  expect(res.status).toBe(200);
  return { res, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}
async function state() {
  return (await fetch(new URL("/api/state", baseUrl))).json();
}

it("declaring again appends to an edge's history instead of replacing it", async () => {
  const s = suffix();
  const a = await claim(`spec-hist-a-${s}`);
  const b = await claim(`spec-hist-b-${s}`);
  for (const type of ["know", "hung_out"]) {
    expect((await post("/api/connect", { to: b.data.star.id, type }, a.cookie)).status).toBe(200);
  }
  const edge = (await state()).edges.find(
    (e: { starA: string; starB: string }) => [e.starA, e.starB].includes(a.data.star.id) && [e.starA, e.starB].includes(b.data.star.id),
  );
  expect(edge.eventCount, "both declarations should be in the log").toBe(2);
  expect(edge.events.map((e: { type: string }) => e.type).sort()).toEqual(["hung_out", "know"]);
});

it("forgetting a star unlinks the browser but never deletes the star", async () => {
  const me = await claim(`spec-forget-${suffix()}`);
  const res = await post("/api/forget", {}, me.cookie);
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie"), "the cookie is cleared").toMatch(/Max-Age=0/);
  const still = (await state()).stars.some((s: { id: string }) => s.id === me.data.star.id);
  expect(still, "the old star stays in the sky").toBe(true);
});

it("claiming a name that's taken is a gentle warning, not a block or a merge", async () => {
  const name = `spec-dup-${suffix()}`;
  const first = await claim(name);
  const warned = await claim(name);
  expect(warned.data, "first attempt only warns").toEqual({ duplicate: true });
  expect(warned.cookie, "and creates nothing").toBeFalsy();
  const second = await claim(name, true);
  expect(second.data.star.id, "confirming creates a separate star").not.toBe(first.data.star.id);
  const named = (await state()).stars.filter((s: { pseudonym: string }) => s.pseudonym === name);
  expect(named).toHaveLength(2);
});
