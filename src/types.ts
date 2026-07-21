export type ListingId = string;
export type ListingViewMode = "favorites" | "notes";
export type ListingSortMode = "default" | "rating";

export interface BrowseCursor {
  listingId: ListingId;
  view: ListingViewMode;
}

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
  wellceeListingsBrowseCursor: BrowseCursor | null;
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
