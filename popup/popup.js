(() => {
  "use strict";

  const FAVORITES_KEY = "wellceeApartmentFavorites";
  const NOTES_KEY = "wellceeApartmentNotes";
  const NOTE_DETAILS_KEY = "wellceeApartmentNoteDetails";
  const RATINGS_KEY = "wellceeApartmentRatings";
  const WELLCEE_ORIGIN = "https://www.wellcee.com";
  const BACKUP_FORMAT = "wellcee-notes-backup";
  const BACKUP_SCHEMA_VERSION = 2;
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const MAX_NOTE_LENGTH = 2000;
  const ACTIVE_LISTING_REQUEST = "wellcee:get-active-listing";
  const LISTING_CHANGED_MESSAGE = "wellcee:listing-changed";

  const favoriteTab = document.getElementById("favorite-tab");
  const noteTab = document.getElementById("note-tab");
  const viewTrack = document.getElementById("view-track");
  const favoritePanel = document.getElementById("favorite-panel");
  const notePanel = document.getElementById("note-panel");
  const favoriteList = document.getElementById("favorite-list");
  const noteList = document.getElementById("note-list");
  const favoriteEmptyState = document.getElementById("favorite-empty-state");
  const noteEmptyState = document.getElementById("note-empty-state");
  const favoriteCount = document.getElementById("favorite-count");
  const noteCount = document.getElementById("note-count");
  const sortDefaultButton = document.getElementById("sort-default");
  const sortRatingButton = document.getElementById("sort-rating");
  const openSidePanelButton = document.getElementById("open-side-panel");
  const exportButton = document.getElementById("export-data");
  const importButton = document.getElementById("import-data");
  const importFile = document.getElementById("import-file");
  const dataStatus = document.getElementById("data-status");

  let statusTimer = null;
  let activeTabId = null;
  let activeListingId = null;
  let activeListingRequest = 0;
  let hasRendered = false;
  let sortMode = "default";
  const isPopupSurface = document.body.dataset.surface === "popup";

  async function refreshActiveListing() {
    const request = ++activeListingRequest;
    let nextTabId = null;
    let nextListingId = null;

    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      if (activeTab?.id !== undefined) {
        nextTabId = activeTab.id;
        const response = await chrome.tabs.sendMessage(activeTab.id, {
          type: ACTIVE_LISTING_REQUEST
        });
        if (
          typeof response?.listingId === "string" &&
          /^\d+$/.test(response.listingId)
        ) {
          nextListingId = response.listingId;
        }
      }
    } catch {
      // Non-Wellcee tabs do not have the content script, so no item is active.
    }

    if (request !== activeListingRequest) {
      return;
    }

    const didChange =
      activeTabId !== nextTabId || activeListingId !== nextListingId;
    activeTabId = nextTabId;
    activeListingId = nextListingId;
    if (didChange || !hasRendered) {
      hasRendered = true;
      await render();
    }
  }

  async function openListing(url) {
    let opened = false;
    try {
      await chrome.tabs.create({ url });
      opened = true;
    } catch (error) {
      console.warn("[Wellcee Notes] 无法打开房源", error);
      setDataStatus("无法打开房源，请重试", "error");
    } finally {
      if (opened && isPopupSurface) {
        window.close();
      }
    }
  }

  function getStoredData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        {
          [FAVORITES_KEY]: {},
          [NOTES_KEY]: {},
          [NOTE_DETAILS_KEY]: {},
          [RATINGS_KEY]: {}
        },
        (result) => resolve(result)
      );
    });
  }

  function setStoredData(value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(value, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function isPlainRecord(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function assertListingId(listingId, label) {
    if (!/^\d+$/.test(listingId)) {
      throw new Error(`${label}中包含无效房源 ID`);
    }
  }

  function canonicalListingUrl(listingId, value, label) {
    if (value !== undefined) {
      if (typeof value !== "string") {
        throw new Error(`${label}中的房源链接格式不正确`);
      }

      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`${label}中的房源链接格式不正确`);
      }

      if (
        !["wellcee.com", "www.wellcee.com"].includes(url.hostname) ||
        url.pathname.replace(/\/$/, "") !== `/rent-apartment/${listingId}`
      ) {
        throw new Error(`${label}中包含非 Wellcee 房源链接`);
      }
    }

    return `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`;
  }

  function normalizedTitle(value, listingId, label) {
    if (value === undefined || value === "") {
      return `Wellcee 房源 ${listingId}`;
    }
    if (typeof value !== "string" || value.length > 500) {
      throw new Error(`${label}中的房源标题格式不正确`);
    }
    return value.trim() || `Wellcee 房源 ${listingId}`;
  }

  function normalizedTimestamp(value, label) {
    if (value === undefined) {
      return Date.now();
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label}中的时间格式不正确`);
    }
    return value;
  }

  function normalizeNotes(value) {
    if (!isPlainRecord(value)) {
      throw new Error("笔记数据格式不正确");
    }

    const normalized = {};
    Object.entries(value).forEach(([listingId, note]) => {
      assertListingId(listingId, "笔记数据");
      if (typeof note !== "string" || note.length > MAX_NOTE_LENGTH) {
        throw new Error(`房源 ${listingId} 的笔记格式不正确`);
      }
      if (note.trim()) {
        normalized[listingId] = note;
      }
    });
    return normalized;
  }

  function normalizeRatings(value) {
    if (!isPlainRecord(value)) {
      throw new Error("评分数据格式不正确");
    }

    const normalized = {};
    Object.entries(value).forEach(([listingId, rating]) => {
      assertListingId(listingId, "评分数据");
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error(`房源 ${listingId} 的评分必须是 1 到 5 星`);
      }
      normalized[listingId] = rating;
    });
    return normalized;
  }

  function normalizeListingRecords(value, label, timestampKey) {
    if (!isPlainRecord(value)) {
      throw new Error(`${label}格式不正确`);
    }

    const normalized = {};
    Object.entries(value).forEach(([listingId, listing]) => {
      assertListingId(listingId, label);
      if (!isPlainRecord(listing)) {
        throw new Error(`${label}中的房源数据格式不正确`);
      }
      if (listing.id !== undefined && String(listing.id) !== listingId) {
        throw new Error(`${label}中的房源 ID 不一致`);
      }

      normalized[listingId] = {
        id: listingId,
        title: normalizedTitle(listing.title, listingId, label),
        url: canonicalListingUrl(listingId, listing.url, label),
        [timestampKey]: normalizedTimestamp(listing[timestampKey], label)
      };
    });
    return normalized;
  }

  function parseBackup(text) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error("文件不是有效的 JSON");
    }

    if (
      !isPlainRecord(backup) ||
      backup.format !== BACKUP_FORMAT ||
      ![1, BACKUP_SCHEMA_VERSION].includes(backup.schemaVersion) ||
      !isPlainRecord(backup.data)
    ) {
      throw new Error("不是有效的 Wellcee Notes 备份文件");
    }

    const favorites = normalizeListingRecords(
      backup.data.favorites,
      "收藏数据",
      "createdAt"
    );
    const ratings =
      backup.schemaVersion === 1
        ? {}
        : normalizeRatings(backup.data.ratings);

    Object.keys(ratings).forEach((listingId) => {
      if (!favorites[listingId]) {
        throw new Error(`房源 ${listingId} 未收藏，不能导入评分`);
      }
    });

    return {
      notes: normalizeNotes(backup.data.notes),
      noteDetails: normalizeListingRecords(
        backup.data.noteDetails,
        "笔记房源数据",
        "updatedAt"
      ),
      favorites,
      ratings
    };
  }

  function setDataStatus(message, state = "idle") {
    window.clearTimeout(statusTimer);
    dataStatus.textContent = message;
    dataStatus.dataset.state = state;

    if (state !== "idle") {
      statusTimer = window.setTimeout(() => {
        dataStatus.textContent = "收藏和笔记仅保存在当前 Chrome";
        dataStatus.dataset.state = "idle";
      }, 4000);
    }
  }

  function setDataActionsBusy(isBusy) {
    exportButton.disabled = isBusy;
    importButton.disabled = isBusy;
  }

  async function exportData() {
    setDataActionsBusy(true);
    setDataStatus("正在生成备份…");

    try {
      const result = await getStoredData();
      const notes = result[NOTES_KEY] || {};
      const favorites = result[FAVORITES_KEY] || {};
      const ratings = result[RATINGS_KEY] || {};
      const backup = {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        extensionVersion: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        data: {
          notes,
          noteDetails: result[NOTE_DETAILS_KEY] || {},
          favorites,
          ratings
        }
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json"
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `wellcee-notes-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setDataStatus(
        `已导出 ${Object.keys(notes).length} 条笔记、${Object.keys(favorites).length} 条收藏、${Object.keys(ratings).length} 个评分`,
        "success"
      );
    } catch (error) {
      console.warn("[Wellcee Notes] 无法导出数据", error);
      setDataStatus("导出失败，请重试", "error");
    } finally {
      setDataActionsBusy(false);
    }
  }

  async function importData(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error("备份文件不能超过 5 MB");
    }

    const imported = parseBackup(await file.text());
    const current = await getStoredData();
    const mergedFavorites = {
      ...(current[FAVORITES_KEY] || {}),
      ...imported.favorites
    };
    const mergedRatings = {
      ...(current[RATINGS_KEY] || {}),
      ...imported.ratings
    };
    Object.keys(mergedRatings).forEach((listingId) => {
      if (!mergedFavorites[listingId]) {
        delete mergedRatings[listingId];
      }
    });

    await setStoredData({
      [NOTES_KEY]: {
        ...(current[NOTES_KEY] || {}),
        ...imported.notes
      },
      [NOTE_DETAILS_KEY]: {
        ...(current[NOTE_DETAILS_KEY] || {}),
        ...imported.noteDetails
      },
      [FAVORITES_KEY]: mergedFavorites,
      [RATINGS_KEY]: mergedRatings
    });

    return {
      noteCount: Object.keys(imported.notes).length,
      favoriteCount: Object.keys(imported.favorites).length,
      ratingCount: Object.keys(imported.ratings).length
    };
  }

  async function removeFavorite(listingId) {
    const result = await getStoredData();
    const favorites = result[FAVORITES_KEY] || {};
    const ratings = result[RATINGS_KEY] || {};
    delete favorites[listingId];
    delete ratings[listingId];
    await setStoredData({
      [FAVORITES_KEY]: favorites,
      [RATINGS_KEY]: ratings
    });
  }

  async function toggleFavorite(listingId, listing) {
    const result = await getStoredData();
    const favorites = result[FAVORITES_KEY] || {};
    const ratings = result[RATINGS_KEY] || {};

    if (favorites[listingId]) {
      delete favorites[listingId];
      delete ratings[listingId];
    } else {
      favorites[listingId] = {
        id: listingId,
        title: listing?.title || `Wellcee 房源 ${listingId}`,
        url:
          listing?.url ||
          `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`,
        createdAt: Date.now()
      };
    }

    await setStoredData({
      [FAVORITES_KEY]: favorites,
      [RATINGS_KEY]: ratings
    });
  }

  function appendCurrentListingStatus(item, link, listingId) {
    if (String(listingId) !== activeListingId) {
      return;
    }

    item.classList.add("favorite-item--current");
    const status = document.createElement("span");
    status.className = "favorite-item__current";
    status.textContent = "当前标签";
    link.appendChild(status);
  }

  function createRatingStatus(rating, isFavorite = true) {
    const status = document.createElement("span");
    status.className = "favorite-item__rating";

    if (!isFavorite) {
      status.classList.add("favorite-item__rating--unavailable");
      status.textContent = "未收藏";
    } else if (rating) {
      status.dataset.rated = "true";
      status.textContent = `${rating}/5`;
      status.setAttribute("aria-label", `评分 ${rating} 星`);
    } else {
      status.textContent = "未评分";
    }

    return status;
  }

  function createFavoriteItem(favorite, note, rating) {
    const item = document.createElement("article");
    item.className = "favorite-item";

    const link = document.createElement("a");
    link.className = "favorite-item__link";
    link.href = favorite.url;
    link.title = "打开房源";

    const title = document.createElement("strong");
    title.className = "favorite-item__title";
    title.textContent = favorite.title || `Wellcee 房源 ${favorite.id}`;

    const meta = document.createElement("span");
    meta.className = "favorite-item__meta";
    meta.textContent = `房源 #${favorite.id}`;

    const metaRow = document.createElement("div");
    metaRow.className = "favorite-item__meta-row";
    metaRow.append(meta, createRatingStatus(rating));

    appendCurrentListingStatus(item, link, favorite.id);
    link.append(title, metaRow);

    if (note?.trim()) {
      const noteText = document.createElement("p");
      noteText.className = "favorite-item__note";
      noteText.textContent = note;
      link.appendChild(noteText);
    }

    link.addEventListener("click", (event) => {
      event.preventDefault();
      openListing(favorite.url);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "favorite-item__remove";
    removeButton.setAttribute("aria-label", `取消收藏 ${favorite.title || favorite.id}`);
    removeButton.title = "取消收藏";
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      await removeFavorite(favorite.id);
      await render();
    });

    item.append(link, removeButton);
    return item;
  }

  function createNoteItem(listingId, note, details, favorite, rating) {
    const listing = details || favorite;
    const item = document.createElement("article");
    item.className = "favorite-item favorite-item--note";

    const link = document.createElement("a");
    link.className = "favorite-item__link";
    link.href = listing?.url || `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`;
    link.title = "打开房源";

    const title = document.createElement("strong");
    title.className = "favorite-item__title";
    title.textContent = listing?.title || `Wellcee 房源 ${listingId}`;

    const meta = document.createElement("span");
    meta.className = "favorite-item__meta";
    meta.textContent = `房源 #${listingId}`;

    const metaRow = document.createElement("div");
    metaRow.className = "favorite-item__meta-row";
    metaRow.append(meta, createRatingStatus(rating, Boolean(favorite)));

    const noteText = document.createElement("p");
    noteText.className = "favorite-item__note";
    noteText.textContent = note;

    appendCurrentListingStatus(item, link, listingId);
    link.append(title, metaRow, noteText);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openListing(link.href);
    });

    const favoriteButton = document.createElement("button");
    const isFavorite = Boolean(favorite);
    favoriteButton.type = "button";
    favoriteButton.className = "favorite-item__favorite-state";
    favoriteButton.setAttribute("aria-pressed", String(isFavorite));
    favoriteButton.setAttribute(
      "aria-label",
      isFavorite ? `取消收藏 ${title.textContent}` : `收藏 ${title.textContent}`
    );
    favoriteButton.title = isFavorite ? "取消收藏" : "收藏房源";
    favoriteButton.addEventListener("click", async () => {
      favoriteButton.disabled = true;
      await toggleFavorite(listingId, listing);
      await render();
    });

    item.append(link, favoriteButton);
    return item;
  }

  function selectView(view) {
    const showFavorites = view === "favorites";
    viewTrack.dataset.view = showFavorites ? "favorites" : "notes";
    favoritePanel.inert = !showFavorites;
    notePanel.inert = showFavorites;
    favoritePanel.setAttribute("aria-hidden", String(!showFavorites));
    notePanel.setAttribute("aria-hidden", String(showFavorites));
    favoriteTab.classList.toggle("is-active", showFavorites);
    noteTab.classList.toggle("is-active", !showFavorites);
    favoriteTab.setAttribute("aria-selected", String(showFavorites));
    noteTab.setAttribute("aria-selected", String(!showFavorites));
  }

  function selectSortMode(mode) {
    sortMode = mode === "rating" ? "rating" : "default";
    const sortByRating = sortMode === "rating";
    sortDefaultButton.classList.toggle("is-active", !sortByRating);
    sortRatingButton.classList.toggle("is-active", sortByRating);
    sortDefaultButton.setAttribute("aria-pressed", String(!sortByRating));
    sortRatingButton.setAttribute("aria-pressed", String(sortByRating));
    render();
  }

  async function render() {
    const result = await getStoredData();
    const ratings = result[RATINGS_KEY] || {};
    const defaultFavoriteOrder = (left, right) =>
      (right.createdAt || 0) - (left.createdAt || 0);
    const favorites = Object.values(result[FAVORITES_KEY] || {}).sort(
      sortMode === "rating"
        ? (left, right) =>
            (ratings[right.id] || 0) - (ratings[left.id] || 0) ||
            defaultFavoriteOrder(left, right)
        : defaultFavoriteOrder
    );
    const notes = result[NOTES_KEY] || {};
    const noteDetails = result[NOTE_DETAILS_KEY] || {};
    const defaultNoteOrder = ([leftId], [rightId]) =>
      (noteDetails[rightId]?.updatedAt || 0) -
      (noteDetails[leftId]?.updatedAt || 0);
    const noteEntries = Object.entries(notes)
      .filter(([, note]) => typeof note === "string" && note.trim())
      .reverse();
    const favoritesById = Object.fromEntries(
      favorites.map((favorite) => [String(favorite.id), favorite])
    );
    noteEntries.sort(
      sortMode === "rating"
        ? ([leftId], [rightId]) =>
            (favoritesById[rightId] ? ratings[rightId] || 0 : 0) -
              (favoritesById[leftId] ? ratings[leftId] || 0 : 0) ||
            defaultNoteOrder([leftId], [rightId])
        : defaultNoteOrder
    );

    favoriteList.replaceChildren();
    noteList.replaceChildren();
    favoriteCount.textContent = String(favorites.length);
    noteCount.textContent = String(noteEntries.length);
    favoriteEmptyState.hidden = favorites.length > 0;
    noteEmptyState.hidden = noteEntries.length > 0;

    favorites.forEach((favorite) => {
      favoriteList.appendChild(
        createFavoriteItem(favorite, notes[favorite.id], ratings[favorite.id])
      );
    });

    noteEntries.forEach(([listingId, note]) => {
      noteList.appendChild(
        createNoteItem(
          listingId,
          note,
          noteDetails[listingId],
          favoritesById[listingId],
          favoritesById[listingId] ? ratings[listingId] : 0
        )
      );
    });
  }

  favoriteTab.addEventListener("click", () => selectView("favorites"));
  noteTab.addEventListener("click", () => selectView("notes"));
  sortDefaultButton.addEventListener("click", () => selectSortMode("default"));
  sortRatingButton.addEventListener("click", () => selectSortMode("rating"));
  openSidePanelButton?.addEventListener("click", async () => {
    openSidePanelButton.disabled = true;
    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow.id === undefined) {
        throw new Error("无法获取当前 Chrome 窗口");
      }
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      window.close();
    } catch (error) {
      console.warn("[Wellcee Notes] 无法打开侧边栏", error);
      openSidePanelButton.disabled = false;
      setDataStatus("无法打开侧边栏，请重试", "error");
    }
  });
  exportButton.addEventListener("click", exportData);
  importButton.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) {
      return;
    }

    setDataActionsBusy(true);
    setDataStatus("正在导入备份…");
    try {
      const imported = await importData(file);
      await render();
      setDataStatus(
        `已导入 ${imported.noteCount} 条笔记、${imported.favoriteCount} 条收藏、${imported.ratingCount} 个评分`,
        "success"
      );
    } catch (error) {
      console.warn("[Wellcee Notes] 无法导入数据", error);
      setDataStatus(error.message || "导入失败，请检查文件", "error");
    } finally {
      setDataActionsBusy(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === "local" &&
      (changes[FAVORITES_KEY] ||
        changes[NOTES_KEY] ||
        changes[NOTE_DETAILS_KEY] ||
        changes[RATINGS_KEY])
    ) {
      render();
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    refreshActiveListing();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && changeInfo.status === "complete") {
      refreshActiveListing();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type === LISTING_CHANGED_MESSAGE &&
      sender.tab?.id === activeTabId
    ) {
      refreshActiveListing();
    }
  });

  refreshActiveListing();
})();
