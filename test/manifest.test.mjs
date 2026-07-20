import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectManifestUrl = new URL("../manifest.json", import.meta.url);
const distributionRootUrl = new URL("../dist/", import.meta.url);
const distributionManifestUrl = new URL("manifest.json", distributionRootUrl);
const manifest = JSON.parse(await readFile(projectManifestUrl, "utf8"));

test("uses Manifest V3 and local storage", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(!manifest.permissions.includes("tabs"));
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

test("dist is a self-contained loadable extension directory", async () => {
  const distributedManifest = JSON.parse(
    await readFile(distributionManifestUrl, "utf8")
  );
  assert.deepEqual(distributedManifest, manifest);

  const contentScript = distributedManifest.content_scripts[0];
  const paths = [
    ...Object.values(distributedManifest.icons),
    distributedManifest.action.default_popup,
    ...contentScript.js,
    ...contentScript.css,
    "popup.js",
    "popup/popup.css",
    distributedManifest.side_panel.default_path,
    "sidepanel/sidepanel.css"
  ];

  await Promise.all(paths.map((path) => access(new URL(path, distributionRootUrl))));

  const extensionPages = [
    new URL(distributedManifest.action.default_popup, distributionRootUrl),
    new URL(distributedManifest.side_panel.default_path, distributionRootUrl)
  ];
  for (const pageUrl of extensionPages) {
    const html = await readFile(pageUrl, "utf8");
    for (const [, assetPath] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const assetUrl = new URL(assetPath, pageUrl);
      assert.ok(
        assetUrl.href.startsWith(distributionRootUrl.href),
        `${assetPath} must stay inside dist/`
      );
      await access(assetUrl);
    }
  }
});
