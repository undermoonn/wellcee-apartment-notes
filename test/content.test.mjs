import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentScript = await readFile(
  new URL("../src/content.ts", import.meta.url),
  "utf8"
);

test("detail editor does not reorder Vue-managed native children", () => {
  assert.doesNotMatch(contentScript, /insertBefore\(mount\s*,\s*heading\)/);
  assert.match(contentScript, /heading\.parentElement\.appendChild\(mount\)/);
});

test("renders injected controls with lit-html templates", () => {
  assert.match(contentScript, /from "lit-html"/);
  assert.match(contentScript, /renderTemplate\(listingDecorationTemplate/);
  assert.match(contentScript, /renderTemplate\(editorTemplate/);
  assert.doesNotMatch(contentScript, /createFavoriteButton|createRatingControl|createEditor/);
});
