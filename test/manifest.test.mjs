import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("uses Manifest V3 and local storage", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  assert.equal(manifest.side_panel.default_path, "sidepanel/sidepanel.html");
});

test("runs only on Wellcee web pages", () => {
  const matches = manifest.content_scripts.flatMap((script) => script.matches);
  assert.deepEqual(matches.sort(), [
    "https://wellcee.com/*",
    "https://www.wellcee.com/*"
  ]);
});

test("all referenced extension assets exist", async () => {
  const contentScript = manifest.content_scripts[0];
  const paths = [
    ...Object.values(manifest.icons),
    manifest.action.default_popup,
    ...contentScript.js,
    ...contentScript.css,
    "popup/popup.js",
    "popup/popup.css",
    manifest.side_panel.default_path,
    "sidepanel/sidepanel.css"
  ];

  await Promise.all(paths.map((path) => access(new URL(`../${path}`, import.meta.url))));
});
