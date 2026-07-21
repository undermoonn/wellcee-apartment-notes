import type {
  BrowseCursor,
  BrowseCursorKey,
  BrowseCursors,
  ListingId,
  ListingSortMode,
  ListingViewMode
} from "./types.js";

export const BROWSE_CURSOR_KEYS: readonly BrowseCursorKey[] = [
  "favorites:default",
  "favorites:rating",
  "notes:default",
  "notes:rating"
];

export function browseCursorKey(
  view: ListingViewMode,
  sort: ListingSortMode
): BrowseCursorKey {
  return `${view}:${sort}`;
}

export function findBrowseCursorIndex(
  cursor: BrowseCursor | null,
  listingIds: readonly ListingId[]
): number | null {
  if (!cursor) {
    return null;
  }

  const index = listingIds.indexOf(cursor.listingId);
  return index >= 0 ? index : null;
}

export function getBrowseCursor(
  cursors: BrowseCursors,
  view: ListingViewMode,
  sort: ListingSortMode
): BrowseCursor | null {
  return cursors[browseCursorKey(view, sort)] ?? null;
}
