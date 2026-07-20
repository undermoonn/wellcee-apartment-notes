import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("pins lit-html, TypeScript 7, and the current Rolldown release", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));
  assert.equal(packageJson.dependencies["lit-html"], "3.3.3");
  assert.equal(packageJson.devDependencies.rolldown, "1.2.0");
  assert.equal(packageJson.devDependencies.typescript, "7.0.2");
  assert.match(packageJson.scripts.typecheck, /tsc --noEmit/);
  assert.match(packageJson.scripts.build, /rolldown -c/);
});

test("extension pages use the bundled declarative UI", async () => {
  const [popupHtml, sidepanelHtml, popupSource] = await Promise.all([
    readProjectFile("dist/popup/popup.html"),
    readProjectFile("dist/sidepanel/sidepanel.html"),
    readProjectFile("popup/popup.ts")
  ]);

  assert.match(popupHtml, /<div id="app"><\/div>/);
  assert.match(popupHtml, /src="\.\.\/popup\.js"/);
  assert.match(sidepanelHtml, /src="\.\.\/popup\.js"/);
  assert.match(popupSource, /from "lit-html"/);
  assert.match(popupSource, /renderTemplate\(appTemplate\(\), appRoot\)/);
});

test("Rolldown outputs self-contained classic scripts", async () => {
  const [contentBundle, popupBundle] = await Promise.all([
    readProjectFile("dist/content.js"),
    readProjectFile("dist/popup.js")
  ]);

  for (const bundle of [contentBundle, popupBundle]) {
    assert.doesNotMatch(bundle, /^\s*import\s/m);
    assert.match(bundle, /\$lit\$/);
  }
});
