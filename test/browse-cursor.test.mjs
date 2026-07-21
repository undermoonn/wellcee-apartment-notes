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

test("keeps cursor positions at runtime but omits them from storage", () => {
  const storedCursorType = typesSource.match(
    /export interface StoredBrowseCursor \{(?<body>[\s\S]*?)\n\}/
  );
  assert.ok(storedCursorType?.groups?.body);
  assert.match(storedCursorType.groups.body, /listingId: ListingId/);
  assert.doesNotMatch(storedCursorType.groups.body, /position|index/);
  assert.match(
    typesSource,
    /interface BrowseCursor extends StoredBrowseCursor[\s\S]*?position: number \| null/
  );
  assert.match(sidepanelSource, /storedCursors\[key\] = \{ listingId: cursor\.listingId \}/);
});

test("keeps one cursor for every view and sort combination", () => {
  for (const key of [
    "favorites:default",
    "favorites:rating",
    "notes:default",
    "notes:rating"
  ]) {
    assert.match(cursorSource, new RegExp(`"${key}"`));
  }
  assert.match(viewSource, /getBrowseCursor\([\s\S]*?"favorites"[\s\S]*?state\.sortMode/);
  assert.match(viewSource, /getBrowseCursor\([\s\S]*?"notes"[\s\S]*?state\.sortMode/);
});

test("does not migrate the legacy single-cursor shape", () => {
  const normalizer = sidepanelSource.match(
    /function normalizedStoredBrowseCursors\([\s\S]*?\n\}/
  );
  assert.ok(normalizer);
  assert.doesNotMatch(normalizer[0], /value\.listingId|value\.view|legacy/);
});

test("retains the runtime position when the cursor item disappears", () => {
  assert.match(cursorSource, /listingIds\.indexOf\(cursor\.listingId\)/);
  assert.match(
    sidepanelSource,
    /if \(cursor && position !== null && position !== cursor\.position\)/
  );
  assert.match(viewSource, /Math\.min\(favoriteCursorPosition - 1, favorites\.length - 1\)/);
});

test("switching sort synchronizes its cursor without scrolling", () => {
  const selectSortMode = sidepanelSource.match(
    /function selectSortMode\([\s\S]*?\n\}/
  );
  assert.ok(selectSortMode);
  assert.match(selectSortMode[0], /syncBrowseCursorPositions\(\)/);
  assert.doesNotMatch(selectSortMode[0], /restoreActiveScrollPosition/);
});
