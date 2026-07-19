import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentScript = await readFile(
  new URL("../src/content.js", import.meta.url),
  "utf8"
);

test("detail editor does not reorder Vue-managed native children", () => {
  assert.doesNotMatch(contentScript, /insertBefore\(editor\s*,\s*heading\)/);
  assert.match(contentScript, /heading\.parentElement\.appendChild\(editor\)/);
});
