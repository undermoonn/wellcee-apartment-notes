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
  const EDITOR_ID = "wellcee-note-editor";
  const ACTIVE_LISTING_REQUEST = "wellcee:get-active-listing";
  const LISTING_CHANGED_MESSAGE = "wellcee:listing-changed";
  const MAX_NOTE_LENGTH = 2000;
  const SAVE_DELAY_MS = 400;

  let notes = {};
  let noteDetails = {};
  let favorites = {};
  let ratings = {};
  let lastUrl = window.location.href;
  let refreshTimer = null;
  let saveTimer = null;
  let storageReady = false;
  const pendingDetailTitleUpdates = new Set();
  const pendingDetailNoteUpdates = new Set();

  function isWellceeHost(hostname) {
    return hostname === "wellcee.com" || hostname === "www.wellcee.com";
  }

  function listingIdFromPathname(pathname) {
    const match = pathname.match(/^\/rent-apartment\/(\d+)\/?$/);
    return match ? match[1] : null;
  }

  function listingIdFromHref(href) {
    try {
      const url = new URL(href, window.location.origin);
      return isWellceeHost(url.hostname)
        ? listingIdFromPathname(url.pathname)
        : null;
    } catch {
      return null;
    }
  }

  function isListPage() {
    return /^\/rent-apartment\/[^/]+\/list\/?$/.test(window.location.pathname);
  }

  function currentListingId() {
    return listingIdFromPathname(window.location.pathname);
  }

  function notifyListingChanged() {
    chrome.runtime.sendMessage(
      { type: LISTING_CHANGED_MESSAGE },
      () => void chrome.runtime.lastError
    );
  }

  function getStoredRecord(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [key]: {} }, (result) => {
        if (chrome.runtime.lastError) {
          console.warn("[Wellcee Notes] 无法读取本地数据", chrome.runtime.lastError);
          resolve({});
          return;
        }

        const stored = result[key];
        resolve(stored && typeof stored === "object" ? stored : {});
      });
    });
  }

  function setStoredRecord(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  async function saveNote(listingId, value) {
    const [latestNotes, latestNoteDetails] = await Promise.all([
      getStoredRecord(STORAGE_KEY),
      getStoredRecord(NOTE_DETAILS_KEY)
    ]);

    if (value.trim()) {
      latestNotes[listingId] = value;
      const previousDetails = latestNoteDetails[listingId] || {};
      latestNoteDetails[listingId] = {
        ...previousDetails,
        id: listingId,
        title:
          detailPageTitle() ||
          previousDetails.title ||
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

  async function saveRating(listingId, value) {
    const [latestFavorites, latestRatings] = await Promise.all([
      getStoredRecord(FAVORITES_KEY),
      getStoredRecord(RATINGS_KEY)
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

  function compactText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function priceFromAnchor(anchor) {
    if (!anchor) {
      return null;
    }

    const exactPricePattern = /^(?:\d{1,3}(?:,\d{3})+|\d{2,6})(?:\.\d+)?\s*RMB\s*\/\s*月$/i;
    const priceElement = Array.from(anchor.querySelectorAll("*")).find((element) =>
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

  function detailPageTitle() {
    return compactText(document.title).replace(/\s*-\s*Wellcee.*$/i, "");
  }

  function favoriteTitle(listingId, anchor = null) {
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

    const heading = anchor?.querySelector("h1, h2, h3, h4, [role='heading']");
    const headingText = compactText(heading?.textContent || "");
    if (headingText) {
      return headingText.slice(0, 80);
    }

    return anchorText ? anchorText.slice(0, 80) : `Wellcee 房源 ${listingId}`;
  }

  async function updateFavoriteTitleFromDetail(listingId) {
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
      const latestFavorites = await getStoredRecord(FAVORITES_KEY);
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

  async function updateNoteTitleFromDetail(listingId) {
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
        getStoredRecord(STORAGE_KEY),
        getStoredRecord(NOTE_DETAILS_KEY)
      ]);
      if (!latestNotes[listingId]?.trim()) {
        return;
      }

      const latestDetails = latestNoteDetails[listingId] || {};
      if (latestDetails.title === title) {
        noteDetails = latestNoteDetails;
        return;
      }

      latestNoteDetails[listingId] = {
        ...latestDetails,
        id: listingId,
        title,
        url: `${window.location.origin}/rent-apartment/${listingId}`,
        updatedAt: latestDetails.updatedAt || Date.now()
      };
      await setStoredRecord(NOTE_DETAILS_KEY, latestNoteDetails);
      noteDetails = latestNoteDetails;
    } finally {
      pendingDetailNoteUpdates.delete(listingId);
    }
  }

  async function toggleFavorite(listingId, anchor = null) {
    const [latestFavorites, latestRatings] = await Promise.all([
      getStoredRecord(FAVORITES_KEY),
      getStoredRecord(RATINGS_KEY)
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

  function syncFavoriteButton(button) {
    const listingId = button.dataset.listingId;
    const isFavorite = Boolean(favorites[listingId]);
    button.setAttribute("aria-pressed", String(isFavorite));
    button.setAttribute("aria-label", isFavorite ? "取消收藏此房源" : "收藏此房源");
    button.title = isFavorite ? "取消收藏" : "收藏房源";
  }

  function syncFavoriteButtons() {
    document.querySelectorAll(`.${FAVORITE_BUTTON_CLASS}`).forEach(syncFavoriteButton);
    syncDetailRatingControl();
  }

  function createFavoriteButton(listingId, anchor, placement) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${FAVORITE_BUTTON_CLASS} ${FAVORITE_BUTTON_CLASS}--${placement}`;
    button.dataset.listingId = listingId;
    syncFavoriteButton(button);

    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;

      try {
        await toggleFavorite(listingId, anchor);
      } catch (error) {
        console.warn("[Wellcee Notes] 无法更新收藏", error);
      } finally {
        button.disabled = false;
      }
    });

    return button;
  }

  function removeListDecorations() {
    document.querySelectorAll(`.${NOTE_BADGE_CLASS}`).forEach((badge) => badge.remove());
    document
      .querySelectorAll(`.${FAVORITE_BUTTON_CLASS}--list`)
      .forEach((button) => button.remove());
    document.querySelectorAll(`.${FAVORITE_ANCHOR_CLASS}`).forEach((anchor) => {
      anchor.classList.remove(FAVORITE_ANCHOR_CLASS);
    });
    document.querySelectorAll(`.${NOTE_ANCHOR_CLASS}`).forEach((anchor) => {
      anchor.classList.remove(NOTE_ANCHOR_CLASS);
    });
  }

  function renderListBadges() {
    if (!isListPage()) {
      removeListDecorations();
      return;
    }

    const activeAnchors = new Set();
    const activeListingAnchors = new Set();

    document.querySelectorAll("a[href]").forEach((anchor) => {
      const listingId = listingIdFromHref(anchor.getAttribute("href"));
      if (!listingId) {
        return;
      }

      activeListingAnchors.add(anchor);
      anchor.classList.add(FAVORITE_ANCHOR_CLASS);
      let favoriteButton = anchor.querySelector(
        `:scope > .${FAVORITE_BUTTON_CLASS}--list`
      );
      if (!favoriteButton) {
        favoriteButton = createFavoriteButton(listingId, anchor, "list");
        anchor.appendChild(favoriteButton);
      }
      syncFavoriteButton(favoriteButton);

      const note = notes[listingId];
      let badge = anchor.querySelector(`:scope > .${NOTE_BADGE_CLASS}`);

      if (!note || !note.trim()) {
        badge?.remove();
        anchor.classList.remove(NOTE_ANCHOR_CLASS);
        return;
      }

      activeAnchors.add(anchor);
      anchor.classList.add(NOTE_ANCHOR_CLASS);

      if (!badge) {
        badge = document.createElement("span");
        badge.className = NOTE_BADGE_CLASS;
        badge.setAttribute("aria-label", "我的房源笔记");
        anchor.appendChild(badge);
      }

      if (badge.textContent !== note) {
        badge.textContent = note;
      }
      if (badge.title !== note) {
        badge.title = note;
      }
    });

    document.querySelectorAll(`.${NOTE_ANCHOR_CLASS}`).forEach((anchor) => {
      if (!activeAnchors.has(anchor)) {
        anchor.querySelector(`:scope > .${NOTE_BADGE_CLASS}`)?.remove();
        anchor.classList.remove(NOTE_ANCHOR_CLASS);
      }
    });

    document.querySelectorAll(`.${FAVORITE_BUTTON_CLASS}--list`).forEach((button) => {
      if (!activeListingAnchors.has(button.parentElement)) {
        button.parentElement?.classList.remove(FAVORITE_ANCHOR_CLASS);
        button.remove();
      }
    });
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, "").trim();
  }

  function findDetailsHeading() {
    const headingSelectors = "h1, h2, h3, h4, [role='heading']";
    const semanticHeading = Array.from(document.querySelectorAll(headingSelectors)).find(
      (element) => normalizeText(element.textContent || "") === "详情"
    );

    if (semanticHeading) {
      return semanticHeading;
    }

    return Array.from(document.querySelectorAll("main div, main p, main span")).find(
      (element) =>
        element.children.length === 0 &&
        normalizeText(element.textContent || "") === "详情"
    );
  }

  function updateCharacterCount(textarea, countElement) {
    countElement.textContent = `${textarea.value.length}/${MAX_NOTE_LENGTH}`;
  }

  function setSaveStatus(statusElement, message, state = "idle") {
    statusElement.textContent = message;
    statusElement.dataset.state = state;
  }

  function scheduleSave(listingId, textarea, statusElement) {
    window.clearTimeout(saveTimer);
    setSaveStatus(statusElement, "正在保存…", "saving");

    saveTimer = window.setTimeout(async () => {
      saveTimer = null;
      try {
        await saveNote(listingId, textarea.value);
        setSaveStatus(statusElement, "已保存到本机", "saved");
        renderListBadges();
      } catch (error) {
        console.warn("[Wellcee Notes] 无法保存笔记", error);
        setSaveStatus(statusElement, "保存失败，请重试", "error");
      }
    }, SAVE_DELAY_MS);
  }

  function syncRatingControl(control, listingId) {
    if (!control) {
      return;
    }

    const isFavorite = Boolean(favorites[listingId]);
    const rating = isFavorite ? Number(ratings[listingId]) || 0 : 0;
    const value = control.querySelector(".wellcee-rating__value");
    const clearButton = control.querySelector(".wellcee-rating__clear");

    control.dataset.locked = String(!isFavorite);
    if (value) {
      value.textContent = isFavorite
        ? rating
          ? `${rating}/5`
          : "未评分"
        : "收藏后可评分";
    }

    control.querySelectorAll(".wellcee-rating__star").forEach((button) => {
      const starValue = Number(button.dataset.rating);
      button.disabled = !isFavorite;
      button.classList.toggle("is-active", starValue <= rating);
      button.setAttribute("aria-checked", String(starValue === rating));
    });

    if (clearButton) {
      clearButton.hidden = !isFavorite || rating === 0;
      clearButton.disabled = !isFavorite;
    }
  }

  function syncDetailRatingControl() {
    const editor = document.getElementById(EDITOR_ID);
    const listingId = editor?.dataset.listingId;
    if (!listingId) {
      return;
    }
    syncRatingControl(editor.querySelector(".wellcee-rating"), listingId);
  }

  function createRatingControl(listingId) {
    const control = document.createElement("div");
    control.className = "wellcee-rating";

    const labelGroup = document.createElement("div");
    labelGroup.className = "wellcee-rating__label-group";

    const label = document.createElement("span");
    label.className = "wellcee-rating__label";
    label.textContent = "我的评分";

    const value = document.createElement("span");
    value.className = "wellcee-rating__value";
    labelGroup.append(label, value);

    const actions = document.createElement("div");
    actions.className = "wellcee-rating__actions";

    const stars = document.createElement("div");
    stars.className = "wellcee-rating__stars";
    stars.setAttribute("role", "radiogroup");
    stars.setAttribute("aria-label", "给收藏房源评分");

    for (let rating = 1; rating <= 5; rating += 1) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = "wellcee-rating__star";
      star.dataset.rating = String(rating);
      star.setAttribute("role", "radio");
      star.setAttribute("aria-label", `${rating} 星`);
      star.addEventListener("click", async () => {
        const previousRating = Number(ratings[listingId]) || 0;
        ratings = { ...ratings, [listingId]: rating };
        syncRatingControl(control, listingId);
        try {
          await saveRating(listingId, rating);
          syncRatingControl(control, listingId);
        } catch (error) {
          console.warn("[Wellcee Notes] 无法保存评分", error);
          if (previousRating) {
            ratings = { ...ratings, [listingId]: previousRating };
          } else {
            const nextRatings = { ...ratings };
            delete nextRatings[listingId];
            ratings = nextRatings;
          }
          syncRatingControl(control, listingId);
        }
      });
      stars.appendChild(star);
    }

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "wellcee-rating__clear";
    clearButton.textContent = "清除";
    clearButton.addEventListener("click", async () => {
      const previousRating = Number(ratings[listingId]) || 0;
      const nextRatings = { ...ratings };
      delete nextRatings[listingId];
      ratings = nextRatings;
      syncRatingControl(control, listingId);
      try {
        await saveRating(listingId, 0);
      } catch (error) {
        console.warn("[Wellcee Notes] 无法清除评分", error);
        if (previousRating) {
          ratings = { ...ratings, [listingId]: previousRating };
        }
        syncRatingControl(control, listingId);
      }
    });

    actions.append(stars, clearButton);
    control.append(labelGroup, actions);
    syncRatingControl(control, listingId);
    return control;
  }

  function createEditor(listingId) {
    const panel = document.createElement("section");
    panel.id = EDITOR_ID;
    panel.className = "wellcee-note-editor";
    panel.setAttribute("aria-labelledby", "wellcee-note-editor-title");

    const header = document.createElement("div");
    header.className = "wellcee-note-editor__header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "wellcee-note-editor__title-group";

    const eyebrow = document.createElement("span");
    eyebrow.className = "wellcee-note-editor__eyebrow";
    eyebrow.textContent = "PRIVATE NOTE";

    const title = document.createElement("h2");
    title.id = "wellcee-note-editor-title";
    title.className = "wellcee-note-editor__title";
    title.textContent = "我的房源笔记";

    const status = document.createElement("span");
    status.className = "wellcee-note-editor__status";
    setSaveStatus(status, notes[listingId] ? "已保存到本机" : "自动保存");

    const headerActions = document.createElement("div");
    headerActions.className = "wellcee-note-editor__actions";

    const favoriteButton = createFavoriteButton(listingId, null, "detail");

    titleGroup.append(eyebrow, title);
    headerActions.append(status, favoriteButton);
    header.append(titleGroup, headerActions);

    const textarea = document.createElement("textarea");
    textarea.className = "wellcee-note-editor__textarea";
    textarea.maxLength = MAX_NOTE_LENGTH;
    textarea.rows = 4;
    textarea.placeholder = "例：采光不错；次卧临街，复看时确认隔音；可和房东谈到 1650。";
    textarea.value = notes[listingId] || "";
    textarea.setAttribute("aria-label", "输入这套房源的私人笔记");

    const footer = document.createElement("div");
    footer.className = "wellcee-note-editor__footer";

    const privacy = document.createElement("span");
    privacy.className = "wellcee-note-editor__privacy";
    privacy.textContent = "仅保存在当前 Chrome，不会发送给 Wellcee";

    const count = document.createElement("span");
    count.className = "wellcee-note-editor__count";
    updateCharacterCount(textarea, count);

    footer.append(privacy, count);
    panel.append(header, createRatingControl(listingId), textarea, footer);

    textarea.addEventListener("input", () => {
      updateCharacterCount(textarea, count);
      scheduleSave(listingId, textarea, status);
    });

    textarea.addEventListener("blur", () => {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
        saveNote(listingId, textarea.value)
          .then(() => setSaveStatus(status, "已保存到本机", "saved"))
          .catch(() => setSaveStatus(status, "保存失败，请重试", "error"));
      }
    });

    return panel;
  }

  function renderDetailEditor() {
    const listingId = currentListingId();
    const existingEditor = document.getElementById(EDITOR_ID);

    if (!listingId) {
      existingEditor?.remove();
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

    if (existingEditor?.dataset.listingId === listingId) {
      return;
    }

    existingEditor?.remove();
    const heading = findDetailsHeading();
    if (!heading?.parentElement) {
      return;
    }

    const editor = createEditor(listingId);
    editor.dataset.listingId = listingId;
    // This container is managed by Vue with index-based child reconciliation.
    // Appending preserves every native child's index; inserting between them
    // causes Wellcee to apply each following sibling's classes to the wrong node.
    heading.parentElement.appendChild(editor);
  }

  function refreshPage() {
    if (!storageReady) {
      return;
    }

    renderListBadges();
    renderDetailEditor();
  }

  function scheduleRefresh() {
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
      favorites = changes[FAVORITES_KEY].newValue || {};
      syncFavoriteButtons();
    }

    if (changes[RATINGS_KEY]) {
      ratings = changes[RATINGS_KEY].newValue || {};
      syncDetailRatingControl();
    }

    if (changes[NOTE_DETAILS_KEY]) {
      noteDetails = changes[NOTE_DETAILS_KEY].newValue || {};
    }

    if (!changes[STORAGE_KEY]) {
      return;
    }

    notes = changes[STORAGE_KEY].newValue || {};
    renderListBadges();

    const editor = document.getElementById(EDITOR_ID);
    const listingId = currentListingId();
    const textarea = editor?.querySelector("textarea");
    if (listingId && textarea && document.activeElement !== textarea) {
      textarea.value = notes[listingId] || "";
      const count = editor.querySelector(".wellcee-note-editor__count");
      if (count) {
        updateCharacterCount(textarea, count);
      }
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
      saveTimer = null;
      removeListDecorations();
      document.getElementById(EDITOR_ID)?.remove();
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
    getStoredRecord(STORAGE_KEY),
    getStoredRecord(NOTE_DETAILS_KEY),
    getStoredRecord(FAVORITES_KEY),
    getStoredRecord(RATINGS_KEY)
  ]).then(([storedNotes, storedNoteDetails, storedFavorites, storedRatings]) => {
    notes = storedNotes;
    noteDetails = storedNoteDetails;
    favorites = storedFavorites;
    ratings = storedRatings;
    storageReady = true;
    refreshPage();
  });
})();
