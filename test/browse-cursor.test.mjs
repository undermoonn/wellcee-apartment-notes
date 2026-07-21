import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [cursorSource, sidepanelSource, typesSource, viewSource] =
  await Promise.all([
    readFile(new URL("../src/browse-cursor.ts", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel/sidepanel.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel/view.ts", import.meta.url), "utf8")
  ]);

test("stores browse cursor identity without a sort-dependent index", () => {
  const browseCursorType = typesSource.match(
    /export interface BrowseCursor \{(?<body>[\s\S]*?)\n\}/
  );
  assert.ok(browseCursorType?.groups?.body);
  assert.match(browseCursorType.groups.body, /listingId: ListingId/);
  assert.match(browseCursorType.groups.body, /view: ListingViewMode/);
  assert.doesNotMatch(browseCursorType.groups.body, /position|index/);
  assert.match(sidepanelSource, /browseCursor = \{ listingId, view: viewMode \}/);
});

test("derives the cursor index from each currently sorted listing array", () => {
  assert.match(cursorSource, /listingIds\.indexOf\(cursor\.listingId\)/);
  assert.match(viewSource, /favorites\.map\(\(favorite\) => String\(favorite\.id\)\)/);
  assert.match(viewSource, /noteEntries\.map\(\(\[listingId\]\) => listingId\)/);
});
