import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serveHopper } from "./server.ts";
import { Hopper } from "./hopper.ts";
import { banner, LETTERS_ONLY, MARK_ICON, MARK_PIXELS, MARK_SVG, SUMMARY, TAGLINE, WORDMARK, wantsColor } from "./banner.ts";

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const VERSION = (JSON.parse(file("package.json")) as { version: string }).version;
const info = { version: "1.2.3", commit: "0123456789abcdef", url: "http://127.0.0.1:5000", db: "/data/hopper.db", every: 30, color: false };

test("carries the person's tagline verbatim, and package.json's description is the summary", () => {
  assert.equal(TAGLINE, "Line up the work, and your agents take it from there.");
  assert.equal(SUMMARY, (JSON.parse(file("package.json")) as { description: string }).description);
});

test("sets the mark beside the letters, a row of text for each two of pixels", () => {
  assert.equal(MARK_PIXELS.length, 12);
  assert.deepEqual(new Set(MARK_PIXELS.map((row) => row.length)), new Set([18]));
  assert.ok(!MARK_PIXELS[0]!.includes("#") && !MARK_PIXELS.at(-1)!.includes("#"), "first and last rows blank");
  const lines = WORDMARK.split("\n");
  assert.equal(lines.length, 6);
  assert.match(lines[2]!, /^███████║.*  +▄{18}$/);
});

test("says what hopper is, where its page and API are, and where its data is", () => {
  assert.deepEqual(banner(info).split("\n"), [
    "",
    ...WORDMARK.split("\n"),
    "v1.2.3 (0123456)",
    "",
    TAGLINE,
    SUMMARY,
    "",
    "  ▸ Page      http://127.0.0.1:5000/",
    "  ▸ API       http://127.0.0.1:5000/queue",
    "",
    "  looking every 30s, data in /data/hopper.db",
    "  Ctrl+C to stop.",
    "",
  ]);
  assert.match(banner({ ...info, commit: "unknown" }), /\nv1\.2\.3\n/);
});

test("is painted in hopper's green only when color is on, and color is on only for a terminal without NO_COLOR", () => {
  assert.doesNotMatch(banner(info), /\x1b/);
  assert.match(banner({ ...info, color: true }), /\x1b\[38;5;70m/);
  assert.equal(wantsColor({}, true), true);
  assert.equal(wantsColor({ NO_COLOR: "1" }, true), false);
  assert.equal(wantsColor({}, false), false);
  assert.equal(wantsColor({}, undefined), false);
});

test("opens the README as hopper prints it, up to where its parts are", () => {
  const readme = file("README.md");
  const printed = banner({ ...info, url: "https://hopper.example.com", commit: "unknown", version: VERSION });
  const opening = printed.slice(0, printed.indexOf("\n\n", printed.indexOf("▸ API"))).replace(/^\n+/, "");
  assert.ok(readme.startsWith(`# hopper\n\n**${TAGLINE}**\n\n\`\`\`\n${opening}\n\`\`\`\n`), "README opens with the name, the tagline and the banner");
});

test("serves its favicon and its words without a token, and the page wears them", async () => {
  const h = new Hopper(":memory:", { task: async () => null, assign: async () => {}, request: async () => ({ id: "x", name: "x" }) });
  const server = serveHopper(h, "secret-token", { version: "0", commit: "x" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const icon = await fetch(`${base}/ui/mark.svg`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type") ?? "", /^image\/svg\+xml/);
    assert.equal(await icon.text(), MARK_ICON);
    assert.match(MARK_ICON, /prefers-color-scheme:dark/);
    const js = await fetch(`${base}/ui/banner.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /^text\/javascript/);
    const body = await js.text();
    for (const [name, value] of Object.entries({ LETTERS: LETTERS_ONLY, MARK_PIXELS, MARK_SVG, TAGLINE, SUMMARY })) {
      assert.ok(body.includes(`export const ${name} = ${JSON.stringify(value)};`), name);
    }
    assert.doesNotMatch(body, /secret-token/);
  } finally {
    server.close();
    h.close();
  }
  const page = file("ui/index.html");
  assert.ok(page.includes('<link rel="icon" type="image/svg+xml" href="./ui/mark.svg">'));
  assert.ok(page.includes(`<a class="brand" href="./">${MARK_SVG}hopper</a>`));
  assert.ok(page.includes('import { LETTERS, MARK_PIXELS, SUMMARY, TAGLINE } from "./ui/banner.js";'));
  assert.match(page, /--p:#3d7a1f;[\s\S]*--p:#9ad36a;/);
});
