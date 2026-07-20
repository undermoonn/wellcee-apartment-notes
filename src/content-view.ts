import { html, nothing } from "lit-html";
import { MAX_NOTE_LENGTH } from "./constants.js";
import { compactText } from "./wellcee-page.js";
import type { Favorites, ListingId, Ratings } from "./types.js";

export const NOTE_BADGE_CLASS = "wellcee-note-badge";
export const NOTE_ANCHOR_CLASS = "wellcee-note-anchor";
export const FAVORITE_BUTTON_CLASS = "wellcee-favorite-button";
export const FAVORITE_ANCHOR_CLASS = "wellcee-favorite-anchor";
export const LISTING_DECORATION_CLASS = "wellcee-listing-decoration";
export const EDITOR_ID = "wellcee-note-editor";
export const EDITOR_MOUNT_ID = "wellcee-note-editor-mount";

type FavoritePlacement = "list" | "detail";
export type SaveState = "idle" | "saving" | "saved" | "error";

export interface DetailEditorState {
  listingId: ListingId;
  draft: string;
  saveMessage: string;
  saveState: SaveState;
}

export interface ContentViewState {
  favoriteBusyIds: ReadonlySet<ListingId>;
  favorites: Favorites;
  ratingBusy: boolean;
  ratings: Ratings;
}

export interface ContentViewActions {
  changeRating(listingId: ListingId, nextRating: number): void;
  favoriteClick(
    event: MouseEvent,
    listingId: ListingId,
    anchor: HTMLAnchorElement | null
  ): void;
  flushPendingNote(listingId: ListingId): void;
  scheduleSave(listingId: ListingId): void;
}

function favoriteButtonTemplate(
  listingId: ListingId,
  anchor: HTMLAnchorElement | null,
  placement: FavoritePlacement,
  state: ContentViewState,
  actions: ContentViewActions
) {
  const isFavorite = Boolean(state.favorites[listingId]);
  return html`
    <button
      class=${`${FAVORITE_BUTTON_CLASS} ${FAVORITE_BUTTON_CLASS}--${placement}`}
      type="button"
      aria-pressed=${String(isFavorite)}
      aria-label=${isFavorite ? "取消收藏此房源" : "收藏此房源"}
      title=${isFavorite ? "取消收藏" : "收藏房源"}
      ?disabled=${state.favoriteBusyIds.has(listingId)}
      @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
      @click=${(event: MouseEvent) =>
        actions.favoriteClick(event, listingId, anchor)}
    ></button>
  `;
}

export function listingDecorationTemplate(
  listingId: ListingId,
  anchor: HTMLAnchorElement,
  note: string | undefined,
  state: ContentViewState,
  actions: ContentViewActions
) {
  return html`
    ${favoriteButtonTemplate(listingId, anchor, "list", state, actions)}
    ${note?.trim()
      ? html`
          <span
            class=${NOTE_BADGE_CLASS}
            aria-label=${`我的房源笔记：${compactText(note)}`}
          >${note}</span>
        `
      : nothing}
  `;
}

function ratingTemplate(
  listingId: ListingId,
  state: ContentViewState,
  actions: ContentViewActions
) {
  const isFavorite = Boolean(state.favorites[listingId]);
  const rating = isFavorite ? Number(state.ratings[listingId]) || 0 : 0;
  return html`
    <div class="wellcee-rating" data-locked=${String(!isFavorite)}>
      <div class="wellcee-rating__label-group">
        <span class="wellcee-rating__label">我的评分</span>
        <span class="wellcee-rating__value">
          ${isFavorite ? (rating ? `${rating}/5` : "未评分") : "收藏后可评分"}
        </span>
      </div>
      <div class="wellcee-rating__actions">
        <div
          class="wellcee-rating__stars"
          role="radiogroup"
          aria-label="给收藏房源评分"
        >
          ${[1, 2, 3, 4, 5].map(
            (starValue) => html`
              <button
                class=${`wellcee-rating__star${starValue <= rating ? " is-active" : ""}`}
                type="button"
                role="radio"
                aria-label=${`${starValue} 星`}
                aria-checked=${String(starValue === rating)}
                ?disabled=${!isFavorite || state.ratingBusy}
                @click=${() => actions.changeRating(listingId, starValue)}
              ></button>
            `
          )}
        </div>
        <button
          class="wellcee-rating__clear"
          type="button"
          ?hidden=${!isFavorite || rating === 0}
          ?disabled=${!isFavorite || state.ratingBusy}
          @click=${() => actions.changeRating(listingId, 0)}
        >清除</button>
      </div>
    </div>
  `;
}

export function editorTemplate(
  listingId: ListingId,
  editorState: DetailEditorState,
  state: ContentViewState,
  actions: ContentViewActions
) {
  return html`
    <section
      id=${EDITOR_ID}
      class="wellcee-note-editor"
      data-listing-id=${listingId}
      aria-labelledby="wellcee-note-editor-title"
    >
      <div class="wellcee-note-editor__header">
        <div class="wellcee-note-editor__title-group">
          <span class="wellcee-note-editor__eyebrow">PRIVATE NOTE</span>
          <h2 id="wellcee-note-editor-title" class="wellcee-note-editor__title">
            我的房源笔记
          </h2>
        </div>
        <div class="wellcee-note-editor__actions">
          <span
            class="wellcee-note-editor__status"
            data-state=${editorState.saveState}
          >${editorState.saveMessage}</span>
          ${favoriteButtonTemplate(listingId, null, "detail", state, actions)}
        </div>
      </div>
      ${ratingTemplate(listingId, state, actions)}
      <textarea
        class="wellcee-note-editor__textarea"
        maxlength=${MAX_NOTE_LENGTH}
        rows="4"
        placeholder="例：采光不错；次卧临街，复看时确认隔音；可和房东谈到 1650。"
        aria-label="输入这套房源的私人笔记"
        .value=${editorState.draft}
        @input=${(event: InputEvent) => {
          editorState.draft = (event.currentTarget as HTMLTextAreaElement).value;
          actions.scheduleSave(listingId);
        }}
        @blur=${() => actions.flushPendingNote(listingId)}
      ></textarea>
      <div class="wellcee-note-editor__footer">
        <span class="wellcee-note-editor__privacy">
          仅保存在当前 Chrome，不会发送给 Wellcee
        </span>
        <span class="wellcee-note-editor__count">
          ${editorState.draft.length}/${MAX_NOTE_LENGTH}
        </span>
      </div>
    </section>
  `;
}
