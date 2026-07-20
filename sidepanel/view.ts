import { html, nothing } from "lit-html";
import {
  FAVORITES_KEY,
  NOTES_KEY,
  NOTE_DETAILS_KEY,
  RATINGS_KEY,
  WELLCEE_ORIGIN
} from "../src/constants.js";
import type {
  BrowseCursor,
  FavoriteListing,
  Favorites,
  ListingId,
  ListingSummary,
  NoteDetails,
  WellceeStorageData
} from "../src/types.js";
import type { UpdateCheckState } from "./update-check.js";

export type DataStatusState = "idle" | "success" | "error";
export type ViewMode = "favorites" | "notes";
export type SortMode = "default" | "rating";

export interface DataStatus {
  message: string;
  state: DataStatusState;
}

export interface SidePanelViewState {
  activeListingId: ListingId | null;
  browseCursor: BrowseCursor | null;
  busyListings: ReadonlySet<ListingId>;
  dataActionsBusy: boolean;
  dataStatus: DataStatus;
  openInNewTab: boolean;
  openModeBusy: boolean;
  sortMode: SortMode;
  storedData: WellceeStorageData;
  updateCheck: UpdateCheckState;
  viewMode: ViewMode;
}

export interface SidePanelViewActions {
  changeOpenMode(event: Event): void;
  exportData(): void;
  handleImport(event: Event): void;
  openListing(listingId: ListingId, url: string): void;
  openRelease(url: string): void;
  refreshUpdateCheck(): void;
  removeFavorite(listingId: ListingId): void;
  selectSortMode(mode: SortMode): void;
  selectView(view: ViewMode): void;
  toggleFavorite(
    listingId: ListingId,
    listing: ListingSummary | undefined
  ): void;
  updateActiveVisibility(event: Event): void;
}

function getViewModel(state: SidePanelViewState) {
  const { sortMode, storedData } = state;
  const ratings = storedData[RATINGS_KEY] || {};
  const defaultFavoriteOrder = (
    left: FavoriteListing,
    right: FavoriteListing
  ) => (right.createdAt || 0) - (left.createdAt || 0);
  const favorites = Object.values(storedData[FAVORITES_KEY] || {}).sort(
    sortMode === "rating"
      ? (left, right) =>
          (ratings[right.id] || 0) - (ratings[left.id] || 0) ||
          defaultFavoriteOrder(left, right)
      : defaultFavoriteOrder
  );
  const notes = storedData[NOTES_KEY] || {};
  const noteDetails = storedData[NOTE_DETAILS_KEY] || {};
  const defaultNoteOrder = (
    [leftId]: [ListingId, string],
    [rightId]: [ListingId, string]
  ) =>
    (noteDetails[rightId]?.updatedAt || 0) -
    (noteDetails[leftId]?.updatedAt || 0);
  const noteEntries = Object.entries(notes)
    .filter(([, note]) => typeof note === "string" && note.trim())
    .reverse();
  const favoritesById: Favorites = Object.fromEntries(
    favorites.map((favorite) => [String(favorite.id), favorite])
  );
  noteEntries.sort(
    sortMode === "rating"
      ? (left, right) => {
          const [leftId] = left;
          const [rightId] = right;
          const leftRating = favoritesById[leftId] ? ratings[leftId] || 0 : 0;
          const rightRating = favoritesById[rightId]
            ? ratings[rightId] || 0
            : 0;
          return rightRating - leftRating || defaultNoteOrder(left, right);
        }
      : defaultNoteOrder
  );

  return { favorites, favoritesById, notes, noteDetails, noteEntries, ratings };
}

function ratingStatusTemplate(rating: number, isFavorite = true) {
  if (!isFavorite) {
    return html`
      <span class="favorite-item__rating favorite-item__rating--unavailable">
        未收藏
      </span>
    `;
  }
  if (rating) {
    return html`
      <span
        class="favorite-item__rating"
        data-rated="true"
        aria-label=${`评分 ${rating} 星`}
      >${rating}/5</span>
    `;
  }
  return html`<span class="favorite-item__rating">未评分</span>`;
}

function currentListingTemplate(
  listingId: ListingId,
  activeListingId: ListingId | null
) {
  return html`
    <span
      class="favorite-item__current"
      aria-hidden=${String(String(listingId) !== activeListingId)}
    >当前浏览</span>
  `;
}

function favoriteItemTemplate(
  favorite: FavoriteListing,
  note: string | undefined,
  rating: number,
  hasBrowseBoundary: boolean,
  state: SidePanelViewState,
  actions: SidePanelViewActions
) {
  const listingId = String(favorite.id);
  const isCurrent = listingId === state.activeListingId;
  const title = favorite.title || `Wellcee 房源 ${favorite.id}`;
  return html`
    <article
      class=${`favorite-item${isCurrent ? " favorite-item--current" : ""}${hasBrowseBoundary ? " favorite-item--browse-boundary" : ""}`}
      data-listing-id=${listingId}
    >
      <a
        class="favorite-item__link"
        href=${favorite.url}
        title="打开房源"
        @click=${(event: MouseEvent) => {
          event.preventDefault();
          actions.openListing(listingId, favorite.url);
        }}
      >
        ${currentListingTemplate(listingId, state.activeListingId)}
        <strong class="favorite-item__title">${title}</strong>
        <div class="favorite-item__meta-row">
          <span class="favorite-item__meta">房源 #${favorite.id}</span>
          ${ratingStatusTemplate(rating)}
        </div>
        ${note?.trim()
          ? html`<p class="favorite-item__note">${note}</p>`
          : nothing}
      </a>
      <button
        class="favorite-item__remove"
        type="button"
        aria-label=${`取消收藏 ${title}`}
        title="取消收藏"
        ?disabled=${state.busyListings.has(listingId)}
        @click=${() => actions.removeFavorite(listingId)}
      ></button>
    </article>
  `;
}

function noteItemTemplate(
  listingId: ListingId,
  note: string,
  details: NoteDetails | undefined,
  favorite: FavoriteListing | undefined,
  rating: number,
  hasBrowseBoundary: boolean,
  state: SidePanelViewState,
  actions: SidePanelViewActions
) {
  const listing = details || favorite;
  const url = listing?.url || `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`;
  const title = listing?.title || `Wellcee 房源 ${listingId}`;
  const isFavorite = Boolean(favorite);
  const isCurrent = String(listingId) === state.activeListingId;
  return html`
    <article
      class=${`favorite-item favorite-item--note${isCurrent ? " favorite-item--current" : ""}${hasBrowseBoundary ? " favorite-item--browse-boundary" : ""}`}
      data-listing-id=${String(listingId)}
    >
      <a
        class="favorite-item__link"
        href=${url}
        title="打开房源"
        @click=${(event: MouseEvent) => {
          event.preventDefault();
          actions.openListing(listingId, url);
        }}
      >
        ${currentListingTemplate(listingId, state.activeListingId)}
        <strong class="favorite-item__title">${title}</strong>
        <div class="favorite-item__meta-row">
          <span class="favorite-item__meta">房源 #${listingId}</span>
          ${ratingStatusTemplate(rating, isFavorite)}
        </div>
        <p class="favorite-item__note">${note}</p>
      </a>
      <button
        class="favorite-item__favorite-state"
        type="button"
        aria-pressed=${String(isFavorite)}
        aria-label=${isFavorite ? `取消收藏 ${title}` : `收藏 ${title}`}
        title=${isFavorite ? "取消收藏" : "收藏房源"}
        ?disabled=${state.busyListings.has(String(listingId))}
        @click=${() => actions.toggleFavorite(listingId, listing)}
      ></button>
    </article>
  `;
}

function emptyStateTemplate(type: "favorite" | "note") {
  const favorite = type === "favorite";
  return html`
    <div class="empty-state">
      <span
        class=${`empty-state__icon empty-state__icon--${type}`}
        aria-hidden="true"
      ></span>
      <strong>${favorite ? "还没有收藏房源" : "还没有房源笔记"}</strong>
      <p>
        ${favorite
          ? "在 Wellcee 列表或详情页点击收藏按钮，房源链接就会出现在这里。"
          : "在 Wellcee 房源详情页输入笔记后，对应房源会出现在这里。"}
      </p>
    </div>
  `;
}

export function sidePanelTemplate(
  state: SidePanelViewState,
  actions: SidePanelViewActions
) {
  const { favorites, favoritesById, notes, noteDetails, noteEntries, ratings } =
    getViewModel(state);
  const showFavorites = state.viewMode === "favorites";
  const sortByRating = state.sortMode === "rating";
  const favoriteCursorPosition =
    state.browseCursor?.view === "favorites"
      ? state.browseCursor.position
      : null;
  const noteCursorPosition =
    state.browseCursor?.view === "notes" ? state.browseCursor.position : null;
  const favoriteBoundaryIndex =
    favoriteCursorPosition === null || favorites.length === 0
      ? -1
      : Math.min(favoriteCursorPosition - 1, favorites.length - 1);
  const noteBoundaryIndex =
    noteCursorPosition === null || noteEntries.length === 0
      ? -1
      : Math.min(noteCursorPosition - 1, noteEntries.length - 1);

  return html`
    <header class="header">
      <div class="header__title">
        <span class="eyebrow">WELLCEE NOTES</span>
        <h1>我的房源</h1>
      </div>
      <div class="header__actions">
        <div class="update-check" data-state=${state.updateCheck.status}>
          <div class="update-check__summary">
            <strong class="update-check__version">
              v${state.updateCheck.currentVersion}
            </strong>
            <span class="update-check__message" role="status" aria-live="polite">
              ${state.updateCheck.message}
            </span>
          </div>
          ${state.updateCheck.status === "available" &&
          state.updateCheck.releaseUrl
            ? html`
                <button
                  class="update-check__action update-check__action--available"
                  type="button"
                  @click=${() =>
                    actions.openRelease(state.updateCheck.releaseUrl || "")}
                >更新</button>
              `
            : html`
                <button
                  class="update-check__action"
                  type="button"
                  ?disabled=${state.updateCheck.status === "checking"}
                  @click=${actions.refreshUpdateCheck}
                >${state.updateCheck.status === "checking"
                  ? "检查中"
                  : state.updateCheck.status === "error"
                    ? "重试"
                    : "检查更新"}</button>
              `}
        </div>
      </div>
    </header>

    <nav class="view-tabs" role="tablist" aria-label="房源列表">
      <button
        id="favorite-tab"
        class=${`view-tab${showFavorites ? " is-active" : ""}`}
        type="button"
        role="tab"
        aria-selected=${String(showFavorites)}
        aria-controls="favorite-panel"
        @click=${() => actions.selectView("favorites")}
      >
        收藏
        <span class="view-tab__count" aria-hidden="true">${favorites.length}</span>
      </button>
      <button
        id="note-tab"
        class=${`view-tab${showFavorites ? "" : " is-active"}`}
        type="button"
        role="tab"
        aria-selected=${String(!showFavorites)}
        aria-controls="note-panel"
        @click=${() => actions.selectView("notes")}
      >
        有笔记
        <span class="view-tab__count" aria-hidden="true">${noteEntries.length}</span>
      </button>
    </nav>

    <div class="sort-bar" aria-label="列表设置">
      <div class="open-mode" aria-label="房源打开方式">
        <span class=${`open-mode__choice${state.openInNewTab ? "" : " is-active"}`}>
          当前页面
        </span>
        <label class="open-mode__switch">
          <input
            id="open-in-new-tab"
            class="open-mode__input"
            type="checkbox"
            role="switch"
            aria-label="使用新标签页打开房源"
            .checked=${state.openInNewTab}
            ?disabled=${state.openModeBusy}
            @change=${actions.changeOpenMode}
          >
          <span class="open-mode__track" aria-hidden="true"></span>
        </label>
        <span class=${`open-mode__choice${state.openInNewTab ? " is-active" : ""}`}>
          新标签页
        </span>
      </div>
      <div class="sort-bar__group">
        <span class="sort-bar__label">排序</span>
        <div class="sort-toggle" role="group" aria-label="选择排序方式">
          <button
            class=${`sort-toggle__button${sortByRating ? "" : " is-active"}`}
            type="button"
            aria-pressed=${String(!sortByRating)}
            @click=${() => actions.selectSortMode("default")}
          >默认</button>
          <button
            class=${`sort-toggle__button${sortByRating ? " is-active" : ""}`}
            type="button"
            aria-pressed=${String(sortByRating)}
            @click=${() => actions.selectSortMode("rating")}
          >评分</button>
        </div>
      </div>
    </div>

    <main>
      <div class="view-track" data-view=${state.viewMode}>
        <section
          id="favorite-panel"
          class="view-panel"
          role="tabpanel"
          aria-labelledby="favorite-tab"
          aria-hidden=${String(!showFavorites)}
          ?inert=${!showFavorites}
          @scroll=${actions.updateActiveVisibility}
        >
          ${favorites.length
            ? html`
                <div
                  class=${`listing-list${favoriteCursorPosition === 0 ? " listing-list--browse-boundary-start" : ""}`}
                  aria-live="polite"
                >
                  ${favorites.map((favorite, index) =>
                    favoriteItemTemplate(
                      favorite,
                      notes[favorite.id],
                      ratings[favorite.id] ?? 0,
                      index === favoriteBoundaryIndex,
                      state,
                      actions
                    )
                  )}
                </div>
              `
            : emptyStateTemplate("favorite")}
        </section>

        <section
          id="note-panel"
          class="view-panel"
          role="tabpanel"
          aria-labelledby="note-tab"
          aria-hidden=${String(showFavorites)}
          ?inert=${showFavorites}
          @scroll=${actions.updateActiveVisibility}
        >
          ${noteEntries.length
            ? html`
                <div
                  class=${`listing-list${noteCursorPosition === 0 ? " listing-list--browse-boundary-start" : ""}`}
                  aria-live="polite"
                >
                  ${noteEntries.map(([listingId, note], index) =>
                    noteItemTemplate(
                      listingId,
                      note,
                      noteDetails[listingId],
                      favoritesById[listingId],
                      favoritesById[listingId] ? ratings[listingId] ?? 0 : 0,
                      index === noteBoundaryIndex,
                      state,
                      actions
                    )
                  )}
                </div>
              `
            : emptyStateTemplate("note")}
        </section>
      </div>
    </main>

    <footer class="data-footer">
      <div class="data-actions">
        <button
          class="data-action"
          type="button"
          ?disabled=${state.dataActionsBusy}
          @click=${actions.exportData}
        >导出数据</button>
        <button
          class="data-action"
          type="button"
          ?disabled=${state.dataActionsBusy}
          @click=${() => document.getElementById("import-file")?.click()}
        >导入数据</button>
        <input
          id="import-file"
          type="file"
          accept=".json,application/json"
          hidden
          @change=${actions.handleImport}
        >
      </div>
      <span
        class="data-status"
        role="status"
        aria-live="polite"
        data-state=${state.dataStatus.state}
      >${state.dataStatus.message}</span>
    </footer>
  `;
}
