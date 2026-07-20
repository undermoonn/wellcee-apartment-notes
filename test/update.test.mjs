import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("checks the latest public GitHub Release with a local cache", async () => {
  const source = await readProjectFile("sidepanel/update-check.ts");

  assert.match(
    source,
    /api\.github\.com\/repos\/undermoonn\/wellcee-apartment-notes\/releases\/latest/
  );
  assert.match(source, /UPDATE_CACHE_TTL_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(source, /X-GitHub-Api-Version/);
  assert.match(source, /export function compareVersions/);
});

test("automatically checks for updates and exposes update actions", async () => {
  const [sidepanelSource, sidepanelView] = await Promise.all([
    readProjectFile("sidepanel/sidepanel.ts"),
    readProjectFile("sidepanel/view.ts")
  ]);

  assert.match(sidepanelSource, /void refreshUpdateCheck\(\)/);
  assert.match(sidepanelView, /state\.updateCheck\.status === "available"/);
  assert.match(sidepanelView, /actions\.refreshUpdateCheck/);
  assert.match(sidepanelView, /actions\.openRelease/);
  assert.match(sidepanelView, /state\.updateCheck\.currentVersion/);

  const headerStart = sidepanelView.indexOf('<header class="header">');
  const headerEnd = sidepanelView.indexOf("</header>", headerStart);
  const updateCheck = sidepanelView.indexOf('class="update-check"');
  const footerStart = sidepanelView.indexOf('<footer class="data-footer">');

  assert.ok(headerStart >= 0 && headerStart < updateCheck);
  assert.ok(updateCheck < headerEnd);
  assert.ok(headerEnd < footerStart);
});
