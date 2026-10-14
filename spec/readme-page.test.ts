import { expect, inject, it } from "vitest";

// Markers start at /readme/, so it has to be readable to the end. The page
// shares style.css with the sky, which locks html/body to the viewport with
// overflow: hidden; once the README outgrew one screen the page stopped
// scrolling. The page's own style must turn scrolling back on.
const baseUrl = inject("baseUrl");

it("the /readme/ page overrides the sky's scroll lock", async () => {
  const html = await (await fetch(new URL("/readme/", baseUrl))).text();
  expect(html).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*auto/);
});
