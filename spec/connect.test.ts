import { expect, inject, it } from "vitest";

// Ours: the running app actually persists a declared connection, not just the
// two baked-in checks in invariants.test.ts.
const baseUrl = inject("baseUrl");

async function claim(pseudonym: string): Promise<{ id: string; cookie: string }> {
  const res = await fetch(new URL("/api/claim", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudonym }),
  });
  expect(res.status, "claim should succeed").toBe(200);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie, "claim should set a cookie").toBeTruthy();
  const { star } = await res.json();
  return { id: star.id, cookie: cookie! };
}

it("a declared connection shows up in /api/state", async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const a = await claim(`spec-a-${suffix}`);
  const b = await claim(`spec-b-${suffix}`);

  const connectRes = await fetch(new URL("/api/connect", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ to: b.id, type: "met_today" }),
  });
  expect(connectRes.status).toBe(200);

  const stateRes = await fetch(new URL("/api/state", baseUrl));
  const state = await stateRes.json();
  const edge = state.edges.find(
    (e: { starA: string; starB: string }) =>
      (e.starA === a.id && e.starB === b.id) || (e.starA === b.id && e.starB === a.id),
  );
  expect(edge, "the declared edge should appear in /api/state").toBeTruthy();
  expect(edge.mutual, "only one side declared, so it shouldn't read as mutual").toBe(false);
});
