import { expect, inject, it } from "vitest";

// Who may change what, checked on the server: a browser acts only as the star
// its session secret belongs to. Star ids are public in every snapshot, so
// knowing one must never be enough to act as it. Decision:
// docs/adr/0002-who-can-see-and-change-what.md.
const baseUrl = inject("baseUrl");
const suffix = () => Math.random().toString(36).slice(2, 8);

async function call(method: string, path: string, body: unknown, cookie?: string) {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
async function claim(pseudonym: string) {
  const res = await call("POST", "/api/claim", { pseudonym, confirmDuplicate: true });
  const data = await res.json();
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("session="))!.split(";")[0];
  return { id: data.star.id as string, cookie };
}
async function pseudonymOf(id: string) {
  const state = await (await fetch(new URL("/api/state", baseUrl))).json();
  return state.stars.find((s: { id: string }) => s.id === id)?.pseudonym;
}

it("the session cookie is a secret, not the star's public id", async () => {
  const me = await claim(`spec-secret-${suffix()}`);
  expect(me.cookie).not.toContain(me.id);
});

it("knowing someone's star id doesn't let you act as them", async () => {
  const s = suffix();
  const victim = await claim(`spec-victim-${s}`);
  const other = await claim(`spec-other-${s}`);
  const forged = `star_id=${victim.id}`;

  expect((await call("PATCH", "/api/me", { pseudonym: "hijacked" }, forged)).status).toBe(401);
  expect((await call("POST", "/api/connect", { to: other.id, type: "know" }, forged)).status).toBe(401);
  expect(await pseudonymOf(victim.id), "victim's name is untouched").toBe(`spec-victim-${s}`);
});

it("renaming only ever changes your own star", async () => {
  const s = suffix();
  const a = await claim(`spec-ren-a-${s}`);
  const b = await claim(`spec-ren-b-${s}`);
  expect((await call("PATCH", "/api/me", { pseudonym: `spec-ren-a2-${s}` }, a.cookie)).status).toBe(200);
  expect(await pseudonymOf(a.id)).toBe(`spec-ren-a2-${s}`);
  expect(await pseudonymOf(b.id), "b is untouched").toBe(`spec-ren-b-${s}`);
});

it("forgetting revokes the session on the server, not just in the browser", async () => {
  const me = await claim(`spec-revoke-${suffix()}`);
  await call("POST", "/api/forget", {}, me.cookie);
  const after = await (await fetch(new URL("/api/me", baseUrl), { headers: { cookie: me.cookie } })).json();
  expect(after.star, "a copied cookie stops working after forget").toBeNull();
});
