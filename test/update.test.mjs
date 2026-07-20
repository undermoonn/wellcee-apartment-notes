import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("checks the latest public GitHub Release with a local cache", async () => {
  const source = await readProjectFile("popup/update-check.ts");

  assert.match(
    source,
    /api\.github\.com\/repos\/undermoonn\/wellcee-apartment-notes\/releases\/latest/
  );
  assert.match(source, /UPDATE_CACHE_TTL_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(source, /X-GitHub-Api-Version/);
  assert.match(source, /export function compareVersions/);
});

test("automatically checks for updates and exposes update actions", async () => {
  const [popupSource, popupView] = await Promise.all([
    readProjectFile("popup/popup.ts"),
    readProjectFile("popup/view.ts")
  ]);

  assert.match(popupSource, /void refreshUpdateCheck\(\)/);
  assert.match(popupView, /state\.updateCheck\.status === "available"/);
  assert.match(popupView, /actions\.refreshUpdateCheck/);
  assert.match(popupView, /actions\.openRelease/);
  assert.match(popupView, /state\.updateCheck\.currentVersion/);

  const headerStart = popupView.indexOf('<header class="header">');
  const headerEnd = popupView.indexOf("</header>", headerStart);
  const updateCheck = popupView.indexOf('class="update-check"');
  const footerStart = popupView.indexOf('<footer class="data-footer">');

  assert.ok(headerStart >= 0 && headerStart < updateCheck);
  assert.ok(updateCheck < headerEnd);
  assert.ok(headerEnd < footerStart);
});
