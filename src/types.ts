export type ListingId = string;
export type ListingViewMode = "favorites" | "notes";
export type ListingSortMode = "default" | "rating";
export type BrowseCursorKey = `${ListingViewMode}:${ListingSortMode}`;

export interface StoredBrowseCursor {
  listingId: ListingId;
}

export interface BrowseCursor extends StoredBrowseCursor {
  position: number | null;
}

export type StoredBrowseCursors = Partial<
  Record<BrowseCursorKey, StoredBrowseCursor>
>;
export type BrowseCursors = Partial<Record<BrowseCursorKey, BrowseCursor>>;

export interface ListingSummary {
  id: ListingId;
  title: string;
  url: string;
}

export interface FavoriteListing extends ListingSummary {
  createdAt: number;
}

export interface NoteDetails extends ListingSummary {
  updatedAt: number;
}

export type Notes = Record<ListingId, string>;
export type Favorites = Record<ListingId, FavoriteListing>;
export type NoteDetailsById = Record<ListingId, NoteDetails>;
export type Ratings = Record<ListingId, number>;

export interface WellceeStorageData {
  wellceeApartmentFavorites: Favorites;
  wellceeApartmentNotes: Notes;
  wellceeApartmentNoteDetails: NoteDetailsById;
  wellceeApartmentRatings: Ratings;
  wellceeOpenListingsInNewTab: boolean;
  wellceeListingsViewMode: ListingViewMode;
  wellceeListingsSortMode: ListingSortMode;
  wellceeListingsBrowseCursor: StoredBrowseCursors;
}

export interface ImportedBackupData {
  notes: Notes;
  noteDetails: NoteDetailsById;
  favorites: Favorites;
  ratings: Ratings;
}

export interface ImportSummary {
  noteCount: number;
  favoriteCount: number;
  ratingCount: number;
}
