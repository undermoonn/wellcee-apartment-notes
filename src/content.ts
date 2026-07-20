import { html, nothing, render as renderTemplate } from "lit-html";
import type {
  Favorites,
  ListingId,
  NoteDetailsById,
  Notes,
  Ratings
} from "./types.js";

declare global {
  interface Window {
    __wellceeNotesLoaded?: boolean;
  }
}

type FavoritePlacement = "list" | "detail";
type SaveState = "idle" | "saving" | "saved" | "error";

interface DetailEditorState {
  listingId: ListingId;
  draft: string;
  saveMessage: string;
  saveState: SaveState;
}

(() => {
  "use strict";

  if (window.__wellceeNotesLoaded) {
    return;
  }
  window.__wellceeNotesLoaded = true;

  const STORAGE_KEY = "wellceeApartmentNotes";
  const NOTE_DETAILS_KEY = "wellceeApartmentNoteDetails";
  const FAVORITES_KEY = "wellceeApartmentFavorites";
  const RATINGS_KEY = "wellceeApartmentRatings";
  const NOTE_BADGE_CLASS = "wellcee-note-badge";
  const NOTE_ANCHOR_CLASS = "wellcee-note-anchor";
  const FAVORITE_BUTTON_CLASS = "wellcee-favorite-button";
  const FAVORITE_ANCHOR_CLASS = "wellcee-favorite-anchor";
  const LISTING_DECORATION_CLASS = "wellcee-listing-decoration";
  const EDITOR_ID = "wellcee-note-editor";
  const EDITOR_MOUNT_ID = "wellcee-note-editor-mount";
  const ACTIVE_LISTING_REQUEST = "wellcee:get-active-listing";
  const LISTING_CHANGED_MESSAGE = "wellcee:listing-changed";
  const MAX_NOTE_LENGTH = 2000;
  const SAVE_DELAY_MS = 400;

  let notes: Notes = {};
  let noteDetails: NoteDetailsById = {};
  let favorites: Favorites = {};
  let ratings: Ratings = {};
  let lastUrl = window.location.href;
  let refreshTimer: number | undefined;
  let saveTimer: number | undefined;
  let storageReady = false;
  let detailEditorState: DetailEditorState | null = null;
  let ratingBusy = false;
  const favoriteBusyIds = new Set<ListingId>();
  const pendingDetailTitleUpdates = new Set<ListingId>();
  const pendingDetailNoteUpdates = new Set<ListingId>();

  function isWellceeHost(hostname: string): boolean {
    return hostname === "wellcee.com" || hostname === "www.wellcee.com";
  }

  function listingIdFromPathname(pathname: string): ListingId | null {
    const match = pathname.match(/^\/rent-apartment\/(\d+)\/?$/);
    return match?.[1] ?? null;
  }

  function listingIdFromHref(href: string | null): ListingId | null {
    if (!href) {
      return null;
    }

    try {
      const url = new URL(href, window.location.origin);
      return isWellceeHost(url.hostname)
        ? listingIdFromPathname(url.pathname)
        : null;
    } catch {
      return null;
    }
  }

  function isListPage(): boolean {
    return /^\/rent-apartment\/[^/]+\/list\/?$/.test(window.location.pathname);
  }

  function currentListingId(): ListingId | null {
    return listingIdFromPathname(window.location.pathname);
  }

  function notifyListingChanged(): void {
    chrome.runtime.sendMessage(
      { type: LISTING_CHANGED_MESSAGE },
      () => void chrome.runtime.lastError
    );
  }

  function getStoredRecord<T extends object>(key: string): Promise<T> {
    return new Promise<T>((resolve) => {
      chrome.storage.local.get({ [key]: {} }, (result) => {
        if (chrome.runtime.lastError) {
          console.warn("[Wellcee Notes] 无法读取本地数据", chrome.runtime.lastError);
          resolve({} as T);
          return;
        }

        const stored = result[key];
        resolve(stored && typeof stored === "object" ? (stored as T) : ({} as T));
      });
    });
  }

  function setStoredRecord<T extends object>(key: string, value: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  async function saveNote(listingId: ListingId, value: string): Promise<void> {
    const [latestNotes, latestNoteDetails] = await Promise.all([
      getStoredRecord<Notes>(STORAGE_KEY),
      getStoredRecord<NoteDetailsById>(NOTE_DETAILS_KEY)
    ]);

    if (value.trim()) {
      latestNotes[listingId] = value;
      const previousDetails = latestNoteDetails[listingId];
      latestNoteDetails[listingId] = {
        ...(previousDetails ?? {}),
        id: listingId,
        title:
          detailPageTitle() ||
          previousDetails?.title ||
          `Wellcee 房源 ${listingId}`,
        url: `${window.location.origin}/rent-apartment/${listingId}`,
        updatedAt: Date.now()
      };
    } else {
      delete latestNotes[listingId];
      delete latestNoteDetails[listingId];
    }

    await Promise.all([
      setStoredRecord(STORAGE_KEY, latestNotes),
      setStoredRecord(NOTE_DETAILS_KEY, latestNoteDetails)
    ]);
    notes = latestNotes;
    noteDetails = latestNoteDetails;
  }

  async function saveRating(listingId: ListingId, value: number): Promise<void> {
    const [latestFavorites, latestRatings] = await Promise.all([
      getStoredRecord<Favorites>(FAVORITES_KEY),
      getStoredRecord<Ratings>(RATINGS_KEY)
    ]);

    if (!latestFavorites[listingId]) {
      throw new Error("只有收藏的房源可以评分");
    }

    if (Number.isInteger(value) && value >= 1 && value <= 5) {
      latestRatings[listingId] = value;
    } else {
      delete latestRatings[listingId];
    }

    await setStoredRecord(RATINGS_KEY, latestRatings);
    ratings = latestRatings;
  }

  function compactText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function priceFromAnchor(anchor: HTMLAnchorElement | null): string | null {
    if (!anchor) {
      return null;
    }

    const exactPricePattern = /^(?:\d{1,3}(?:,\d{3})+|\d{2,6})(?:\.\d+)?\s*RMB\s*\/\s*月$/i;
    const priceElement = Array.from(anchor.querySelectorAll<HTMLElement>("*")).find((element) =>
      exactPricePattern.test(compactText(element.textContent || ""))
    );

    if (priceElement) {
      return compactText(priceElement.textContent || "").replace(/\s+/g, " ");
    }

    const visibleText = anchor.innerText || "";
    const linePrice = visibleText
      .split("\n")
      .map(compactText)
      .find((line) => exactPricePattern.test(line));

    return linePrice || null;
  }

  function detailPageTitle(): string {
    return compactText(document.title).replace(/\s*-\s*Wellcee.*$/i, "");
  }

  function favoriteTitle(
    listingId: ListingId,
    anchor: HTMLAnchorElement | null = null
  ): string {
    if (currentListingId() === listingId) {
      const pageTitle = detailPageTitle();
      if (pageTitle) {
        return pageTitle;
      }
    }

    const anchorText = compactText(anchor?.textContent || "");
    const price = priceFromAnchor(anchor);
    if (price) {
      return `${price} · Wellcee 房源 ${listingId}`;
    }

    const heading = anchor?.querySelector<HTMLElement>(
      "h1, h2, h3, h4, [role='heading']"
    );
    const headingText = compactText(heading?.textContent || "");
    if (headingText) {
      return headingText.slice(0, 80);
    }

    return anchorText ? anchorText.slice(0, 80) : `Wellcee 房源 ${listingId}`;
  }

  async function updateFavoriteTitleFromDetail(listingId: ListingId): Promise<void> {
    const title = detailPageTitle();
    const currentFavorite = favorites[listingId];

    if (
      !title ||
      !currentFavorite ||
      currentFavorite.title === title ||
      pendingDetailTitleUpdates.has(listingId)
    ) {
      return;
    }

    pendingDetailTitleUpdates.add(listingId);
    try {
      const latestFavorites = await getStoredRecord<Favorites>(FAVORITES_KEY);
      const latestFavorite = latestFavorites[listingId];
      if (!latestFavorite || latestFavorite.title === title) {
        return;
      }

      latestFavorites[listingId] = {
        ...latestFavorite,
        title
      };
      await setStoredRecord(FAVORITES_KEY, latestFavorites);
      favorites = latestFavorites;
      syncFavoriteButtons();
    } finally {
      pendingDetailTitleUpdates.delete(listingId);
    }
  }

  async function updateNoteTitleFromDetail(listingId: ListingId): Promise<void> {
    const title = detailPageTitle();
    const currentDetails = noteDetails[listingId];

    if (
      !notes[listingId]?.trim() ||
      !title ||
      currentDetails?.title === title ||
      pendingDetailNoteUpdates.has(listingId)
    ) {
      return;
    }

    pendingDetailNoteUpdates.add(listingId);
    try {
      const [latestNotes, latestNoteDetails] = await Promise.all([
        getStoredRecord<Notes>(STORAGE_KEY),
        getStoredRecord<NoteDetailsById>(NOTE_DETAILS_KEY)
      ]);
      if (!latestNotes[listingId]?.trim()) {
        return;
      }

      const latestDetails = latestNoteDetails[listingId];
      if (latestDetails?.title === title) {
        noteDetails = latestNoteDetails;
        return;
      }

      latestNoteDetails[listingId] = {
        ...(latestDetails ?? {}),
        id: listingId,
        title,
        url: `${window.location.origin}/rent-apartment/${listingId}`,
        updatedAt: latestDetails?.updatedAt || Date.now()
      };
      await setStoredRecord(NOTE_DETAILS_KEY, latestNoteDetails);
      noteDetails = latestNoteDetails;
    } finally {
      pendingDetailNoteUpdates.delete(listingId);
    }
  }

  async function toggleFavorite(
    listingId: ListingId,
    anchor: HTMLAnchorElement | null = null
  ): Promise<void> {
    const [latestFavorites, latestRatings] = await Promise.all([
      getStoredRecord<Favorites>(FAVORITES_KEY),
      getStoredRecord<Ratings>(RATINGS_KEY)
    ]);

    if (latestFavorites[listingId]) {
      delete latestFavorites[listingId];
      delete latestRatings[listingId];
    } else {
      latestFavorites[listingId] = {
        id: listingId,
        title: favoriteTitle(listingId, anchor),
        url: `${window.location.origin}/rent-apartment/${listingId}`,
        createdAt: Date.now()
      };
    }

    await Promise.all([
      setStoredRecord(FAVORITES_KEY, latestFavorites),
      setStoredRecord(RATINGS_KEY, latestRatings)
    ]);
    favorites = latestFavorites;
    ratings = latestRatings;
    syncFavoriteButtons();
  }

  function syncFavoriteButtons(): void {
    renderListBadges();
    renderDetailEditor();
  }

  async function handleFavoriteClick(
    event: MouseEvent,
    listingId: ListingId,
    anchor: HTMLAnchorElement | null
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    favoriteBusyIds.add(listingId);
    syncFavoriteButtons();
    try {
      await toggleFavorite(listingId, anchor);
    } catch (error) {
      console.warn("[Wellcee Notes] 无法更新收藏", error);
    } finally {
      favoriteBusyIds.delete(listingId);
      syncFavoriteButtons();
    }
  }

  function favoriteButtonTemplate(
    listingId: ListingId,
    anchor: HTMLAnchorElement | null,
    placement: FavoritePlacement
  ) {
    const isFavorite = Boolean(favorites[listingId]);
    return html`
      <button
        class=${`${FAVORITE_BUTTON_CLASS} ${FAVORITE_BUTTON_CLASS}--${placement}`}
        type="button"
        aria-pressed=${String(isFavorite)}
        aria-label=${isFavorite ? "取消收藏此房源" : "收藏此房源"}
        title=${isFavorite ? "取消收藏" : "收藏房源"}
        ?disabled=${favoriteBusyIds.has(listingId)}
        @pointerdown=${(event: PointerEvent) => {
          event.stopPropagation();
        }}
        @click=${(event: MouseEvent) => handleFavoriteClick(event, listingId, anchor)}
      ></button>
    `;
  }

  function listingDecorationTemplate(
    listingId: ListingId,
    anchor: HTMLAnchorElement,
    note: string | undefined
  ) {
    return html`
      ${favoriteButtonTemplate(listingId, anchor, "list")}
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

  function removeListDecorations(): void {
    document
      .querySelectorAll<HTMLSpanElement>(`.${LISTING_DECORATION_CLASS}`)
      .forEach((host) => {
        renderTemplate(nothing, host);
        host.remove();
      });
    document
      .querySelectorAll<HTMLAnchorElement>(`.${FAVORITE_ANCHOR_CLASS}`)
      .forEach((anchor) => {
        anchor.classList.remove(FAVORITE_ANCHOR_CLASS);
      });
    document
      .querySelectorAll<HTMLAnchorElement>(`.${NOTE_ANCHOR_CLASS}`)
      .forEach((anchor) => {
        anchor.classList.remove(NOTE_ANCHOR_CLASS);
      });
  }

  function renderListBadges(): void {
    if (!isListPage()) {
      removeListDecorations();
      return;
    }

    const activeListingAnchors = new Set<HTMLAnchorElement>();

    document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      const listingId = listingIdFromHref(anchor.getAttribute("href"));
      if (!listingId) {
        return;
      }

      activeListingAnchors.add(anchor);
      anchor.classList.add(FAVORITE_ANCHOR_CLASS);
      const note = notes[listingId];
      anchor.classList.toggle(NOTE_ANCHOR_CLASS, Boolean(note?.trim()));

      let host = anchor.querySelector<HTMLSpanElement>(
        `:scope > .${LISTING_DECORATION_CLASS}`
      );
      if (!host) {
        host = document.createElement("span");
        host.className = LISTING_DECORATION_CLASS;
        anchor.appendChild(host);
      }
      renderTemplate(listingDecorationTemplate(listingId, anchor, note), host);
    });

    document
      .querySelectorAll<HTMLSpanElement>(`.${LISTING_DECORATION_CLASS}`)
      .forEach((host) => {
        const parentAnchor = host.parentElement;
        if (
          !(parentAnchor instanceof HTMLAnchorElement) ||
          !activeListingAnchors.has(parentAnchor)
        ) {
          host.parentElement?.classList.remove(
            FAVORITE_ANCHOR_CLASS,
            NOTE_ANCHOR_CLASS
          );
          renderTemplate(nothing, host);
          host.remove();
        }
      });
  }

  /*
   * UI below is rendered declaratively with lit-html. Mount nodes are the only
   * imperative DOM additions because they must coexist with Wellcee's Vue tree.
   */

  function normalizeText(value: string): string {
    return value.replace(/\s+/g, "").trim();
  }

  function findDetailsHeading(): HTMLElement | null {
    const headingSelectors = "h1, h2, h3, h4, [role='heading']";
    const semanticHeading = Array.from(
      document.querySelectorAll<HTMLElement>(headingSelectors)
    ).find((element) => normalizeText(element.textContent || "") === "详情");

    if (semanticHeading) {
      return semanticHeading;
    }

    return (
      Array.from(
        document.querySelectorAll<HTMLElement>("main div, main p, main span")
      ).find(
        (element) =>
          element.children.length === 0 &&
          normalizeText(element.textContent || "") === "详情"
      ) ?? null
    );
  }

  function setDetailSaveStatus(
    message: string,
    state: SaveState = "idle"
  ): void {
    if (!detailEditorState) {
      return;
    }
    detailEditorState.saveMessage = message;
    detailEditorState.saveState = state;
    renderDetailEditor();
  }

  function scheduleSave(listingId: ListingId): void {
    window.clearTimeout(saveTimer);
    setDetailSaveStatus("正在保存…", "saving");

    saveTimer = window.setTimeout(async () => {
      saveTimer = undefined;
      const value = detailEditorState?.listingId === listingId
        ? detailEditorState.draft
        : "";
      try {
        await saveNote(listingId, value);
        if (detailEditorState?.listingId === listingId) {
          setDetailSaveStatus("已保存到本机", "saved");
        }
        renderListBadges();
      } catch (error) {
        console.warn("[Wellcee Notes] 无法保存笔记", error);
        if (detailEditorState?.listingId === listingId) {
          setDetailSaveStatus("保存失败，请重试", "error");
        }
      }
    }, SAVE_DELAY_MS);
  }

  async function flushPendingNote(listingId: ListingId): Promise<void> {
    const editorState = detailEditorState;
    if (!saveTimer || editorState?.listingId !== listingId) {
      return;
    }
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    try {
      await saveNote(listingId, editorState.draft);
      setDetailSaveStatus("已保存到本机", "saved");
    } catch (error) {
      console.warn("[Wellcee Notes] 无法保存笔记", error);
      setDetailSaveStatus("保存失败，请重试", "error");
    }
  }

  function syncDetailRatingControl(): void {
    renderDetailEditor();
  }

  async function changeRating(
    listingId: ListingId,
    nextRating: number
  ): Promise<void> {
    const previousRating = Number(ratings[listingId]) || 0;
    const nextRatings = { ...ratings };
    if (nextRating) {
      nextRatings[listingId] = nextRating;
    } else {
      delete nextRatings[listingId];
    }
    ratings = nextRatings;
    ratingBusy = true;
    renderDetailEditor();

    try {
      await saveRating(listingId, nextRating);
    } catch (error) {
      console.warn("[Wellcee Notes] 无法保存评分", error);
      const restoredRatings = { ...ratings };
      if (previousRating) {
        restoredRatings[listingId] = previousRating;
      } else {
        delete restoredRatings[listingId];
      }
      ratings = restoredRatings;
    } finally {
      ratingBusy = false;
      renderDetailEditor();
    }
  }

  function ratingTemplate(listingId: ListingId) {
    const isFavorite = Boolean(favorites[listingId]);
    const rating = isFavorite ? Number(ratings[listingId]) || 0 : 0;
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
                  ?disabled=${!isFavorite || ratingBusy}
                  @click=${() => changeRating(listingId, starValue)}
                ></button>
              `
            )}
          </div>
          <button
            class="wellcee-rating__clear"
            type="button"
            ?hidden=${!isFavorite || rating === 0}
            ?disabled=${!isFavorite || ratingBusy}
            @click=${() => changeRating(listingId, 0)}
          >清除</button>
        </div>
      </div>
    `;
  }

  function editorTemplate(listingId: ListingId, editorState: DetailEditorState) {
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
            ${favoriteButtonTemplate(listingId, null, "detail")}
          </div>
        </div>
        ${ratingTemplate(listingId)}
        <textarea
          class="wellcee-note-editor__textarea"
          maxlength=${MAX_NOTE_LENGTH}
          rows="4"
          placeholder="例：采光不错；次卧临街，复看时确认隔音；可和房东谈到 1650。"
          aria-label="输入这套房源的私人笔记"
          .value=${editorState.draft}
          @input=${(event: InputEvent) => {
            editorState.draft = (event.currentTarget as HTMLTextAreaElement).value;
            scheduleSave(listingId);
          }}
          @blur=${() => flushPendingNote(listingId)}
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

  function renderDetailEditor(): void {
    const listingId = currentListingId();
    let mount = document.getElementById(EDITOR_MOUNT_ID);

    if (!listingId) {
      if (mount) {
        renderTemplate(nothing, mount);
        mount.remove();
      }
      detailEditorState = null;
      return;
    }

    if (favorites[listingId]) {
      updateFavoriteTitleFromDetail(listingId).catch((error) => {
        console.warn("[Wellcee Notes] 无法更新收藏标题", error);
      });
    }

    if (notes[listingId]?.trim()) {
      updateNoteTitleFromDetail(listingId).catch((error) => {
        console.warn("[Wellcee Notes] 无法更新笔记房源标题", error);
      });
    }

    if (detailEditorState?.listingId !== listingId) {
      detailEditorState = {
        listingId,
        draft: notes[listingId] || "",
        saveMessage: notes[listingId] ? "已保存到本机" : "自动保存",
        saveState: "idle"
      };
    }

    if (!mount) {
      const heading = findDetailsHeading();
      if (!heading?.parentElement) {
        return;
      }
      mount = document.createElement("div");
      mount.id = EDITOR_MOUNT_ID;
      // This container is managed by Vue with index-based child reconciliation.
      // Appending preserves every native child's index; inserting between them
      // causes Wellcee to apply each following sibling's classes to the wrong node.
      heading.parentElement.appendChild(mount);
    }

    renderTemplate(editorTemplate(listingId, detailEditorState), mount);
  }

  function refreshPage(): void {
    if (!storageReady) {
      return;
    }

    renderListBadges();
    renderDetailEditor();
  }

  function scheduleRefresh(): void {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshPage, 80);
  }

  const pageObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
      scheduleRefresh();
    }
  });

  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[FAVORITES_KEY]) {
      favorites =
        (changes[FAVORITES_KEY].newValue as Favorites | undefined) ?? {};
      syncFavoriteButtons();
    }

    if (changes[RATINGS_KEY]) {
      ratings = (changes[RATINGS_KEY].newValue as Ratings | undefined) ?? {};
      syncDetailRatingControl();
    }

    if (changes[NOTE_DETAILS_KEY]) {
      noteDetails =
        (changes[NOTE_DETAILS_KEY].newValue as NoteDetailsById | undefined) ?? {};
    }

    if (!changes[STORAGE_KEY]) {
      return;
    }

    notes = (changes[STORAGE_KEY].newValue as Notes | undefined) ?? {};
    renderListBadges();

    const listingId = currentListingId();
    const textarea = document.querySelector<HTMLTextAreaElement>(
      `#${EDITOR_ID} textarea`
    );
    if (
      listingId &&
      detailEditorState?.listingId === listingId &&
      document.activeElement !== textarea
    ) {
      detailEditorState.draft = notes[listingId] || "";
      detailEditorState.saveMessage = notes[listingId] ? "已保存到本机" : "自动保存";
      detailEditorState.saveState = "idle";
      renderDetailEditor();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== ACTIVE_LISTING_REQUEST) {
      return;
    }

    sendResponse({ listingId: currentListingId() });
  });

  window.setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
      removeListDecorations();
      const mount = document.getElementById(EDITOR_MOUNT_ID);
      if (mount) {
        renderTemplate(nothing, mount);
        mount.remove();
      }
      detailEditorState = null;
      scheduleRefresh();
      notifyListingChanged();
      return;
    }

    const listingId = currentListingId();
    if (listingId && favorites[listingId]) {
      updateFavoriteTitleFromDetail(listingId).catch((error) => {
        console.warn("[Wellcee Notes] 无法更新收藏标题", error);
      });
    }

    if (listingId && notes[listingId]?.trim()) {
      updateNoteTitleFromDetail(listingId).catch((error) => {
        console.warn("[Wellcee Notes] 无法更新笔记房源标题", error);
      });
    }
  }, 600);

  Promise.all([
    getStoredRecord<Notes>(STORAGE_KEY),
    getStoredRecord<NoteDetailsById>(NOTE_DETAILS_KEY),
    getStoredRecord<Favorites>(FAVORITES_KEY),
    getStoredRecord<Ratings>(RATINGS_KEY)
  ]).then(([storedNotes, storedNoteDetails, storedFavorites, storedRatings]) => {
    notes = storedNotes;
    noteDetails = storedNoteDetails;
    favorites = storedFavorites;
    ratings = storedRatings;
    storageReady = true;
    refreshPage();
  });
})();
