import type {
  BrowseCursor,
  ListingId,
  ListingViewMode
} from "./types.js";

export function findBrowseCursorIndex(
  cursor: BrowseCursor | null,
  view: ListingViewMode,
  listingIds: readonly ListingId[]
): number | null {
  if (cursor?.view !== view) {
    return null;
  }

  const index = listingIds.indexOf(cursor.listingId);
  return index >= 0 ? index : null;
}
