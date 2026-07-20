import { nothing, render as renderTemplate } from "lit-html";
import {
  ACTIVE_LISTING_REQUEST,
  FAVORITES_KEY,
  LISTING_CHANGED_MESSAGE,
  NOTES_KEY,
  NOTE_DETAILS_KEY,
  RATINGS_KEY
} from "./constants.js";
import {
  EDITOR_ID,
  EDITOR_MOUNT_ID,
  editorTemplate,
  FAVORITE_ANCHOR_CLASS,
  LISTING_DECORATION_CLASS,
  listingDecorationTemplate,
  NOTE_ANCHOR_CLASS
} from "./content-view.js";
import type {
  ContentViewActions,
  ContentViewState,
  DetailEditorState,
  SaveState
} from "./content-view.js";
import { getStoredRecord, setStoredRecord } from "./storage.js";
import {
  currentListingId,
  detailPageTitle,
  favoriteTitle,
  findDetailsHeading,
  isListPage,
  listingIdFromHref
} from "./wellcee-page.js";
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

(() => {
  "use strict";

  if (window.__wellceeNotesLoaded) {
    return;
  }
  window.__wellceeNotesLoaded = true;

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

  const contentViewActions: ContentViewActions = {
    changeRating: (listingId, nextRating) =>
      void changeRating(listingId, nextRating),
    favoriteClick: (event, listingId, anchor) =>
      void handleFavoriteClick(event, listingId, anchor),
    flushPendingNote: (listingId) => void flushPendingNote(listingId),
    scheduleSave
  };

  function getContentViewState(): ContentViewState {
    return {
      favoriteBusyIds,
      favorites,
      ratingBusy,
      ratings
    };
  }

  function notifyListingChanged(): void {
    chrome.runtime.sendMessage(
      { type: LISTING_CHANGED_MESSAGE },
      () => void chrome.runtime.lastError
    );
  }

  async function saveNote(listingId: ListingId, value: string): Promise<void> {
    const [latestNotes, latestNoteDetails] = await Promise.all([
      getStoredRecord<Notes>(NOTES_KEY),
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
      setStoredRecord(NOTES_KEY, latestNotes),
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
        getStoredRecord<Notes>(NOTES_KEY),
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
      renderTemplate(
        listingDecorationTemplate(
          listingId,
          anchor,
          note,
          getContentViewState(),
          contentViewActions
        ),
        host
      );
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

    renderTemplate(
      editorTemplate(
        listingId,
        detailEditorState,
        getContentViewState(),
        contentViewActions
      ),
      mount
    );
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

    if (!changes[NOTES_KEY]) {
      return;
    }

    notes = (changes[NOTES_KEY].newValue as Notes | undefined) ?? {};
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
    getStoredRecord<Notes>(NOTES_KEY),
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
