import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("pins lit-html, TypeScript 7, and the current Rolldown release", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.dependencies["lit-html"], "3.3.3");
  assert.equal(packageJson.devDependencies.rolldown, "1.2.0");
  assert.equal(packageJson.devDependencies.typescript, "7.0.2");
  assert.match(packageJson.scripts.typecheck, /tsc --noEmit/);
  assert.match(packageJson.scripts.build, /rolldown -c/);
});

test("includes the MIT license in the distribution", async () => {
  const license = await readProjectFile("dist/LICENSE");

  assert.match(license, /^MIT License$/m);
  assert.match(license, /Wellcee Apartment Notes contributors/);
});

test("the side panel uses the bundled declarative UI", async () => {
  const [sidepanelHtml, sidepanelSource, sidepanelView] = await Promise.all([
    readProjectFile("dist/sidepanel/sidepanel.html"),
    readProjectFile("sidepanel/sidepanel.ts"),
    readProjectFile("sidepanel/view.ts")
  ]);

  assert.match(sidepanelHtml, /<div id="app"><\/div>/);
  assert.match(sidepanelHtml, /src="\.\.\/sidepanel\.js"/);
  assert.match(sidepanelSource, /from "lit-html"/);
  assert.match(sidepanelSource, /from "\.\/view\.js"/);
  assert.match(sidepanelSource, /renderTemplate\(\s*sidePanelTemplate\(/);
  assert.match(sidepanelView, /export function sidePanelTemplate/);
});

test("Rolldown outputs self-contained classic scripts", async () => {
  const [contentBundle, sidepanelBundle, backgroundBundle] = await Promise.all([
    readProjectFile("dist/content.js"),
    readProjectFile("dist/sidepanel.js"),
    readProjectFile("dist/background.js")
  ]);

  for (const bundle of [contentBundle, sidepanelBundle, backgroundBundle]) {
    assert.doesNotMatch(bundle, /^\s*import\s/m);
  }
  for (const bundle of [contentBundle, sidepanelBundle]) {
    assert.match(bundle, /\$lit\$/);
  }
  assert.match(backgroundBundle, /openPanelOnActionClick/);
});
