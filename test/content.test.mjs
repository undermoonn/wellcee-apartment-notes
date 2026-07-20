import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentScript = await readFile(
  new URL("../src/content.ts", import.meta.url),
  "utf8"
);
const contentView = await readFile(
  new URL("../src/content-view.ts", import.meta.url),
  "utf8"
);

test("detail editor does not reorder Vue-managed native children", () => {
  assert.doesNotMatch(contentScript, /insertBefore\(mount\s*,\s*heading\)/);
  assert.match(contentScript, /heading\.parentElement\.appendChild\(mount\)/);
});

test("renders injected controls with lit-html templates", () => {
  assert.match(contentScript, /from "lit-html"/);
  assert.match(contentScript, /from "\.\/content-view\.js"/);
  assert.match(contentScript, /renderTemplate\(\s*listingDecorationTemplate/);
  assert.match(contentScript, /renderTemplate\(\s*editorTemplate/);
  assert.match(contentView, /export function listingDecorationTemplate/);
  assert.match(contentView, /export function editorTemplate/);
  assert.doesNotMatch(
    contentScript,
    /createFavoriteButton|createRatingControl|createEditor/
  );
});

test("shares storage and Wellcee page helpers across entry points", async () => {
  const [storage, pageHelpers] = await Promise.all([
    readFile(new URL("../src/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/wellcee-page.ts", import.meta.url), "utf8")
  ]);

  assert.match(contentScript, /from "\.\/storage\.js"/);
  assert.match(storage, /export function getStoredData/);
  assert.match(pageHelpers, /export function listingIdFromHref/);
});
