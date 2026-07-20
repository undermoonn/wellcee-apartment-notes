import { html, nothing, render as renderTemplate } from "lit-html";
import type {
  FavoriteListing,
  Favorites,
  ImportedBackupData,
  ImportSummary,
  ListingId,
  ListingSummary,
  NoteDetails,
  Notes,
  Ratings,
  WellceeStorageData
} from "../src/types.js";

type DataStatusState = "idle" | "success" | "error";
type ViewMode = "favorites" | "notes";
type SortMode = "default" | "rating";
type TimestampKey = "createdAt" | "updatedAt";
type TimestampedListing<Key extends TimestampKey> = ListingSummary &
  Record<Key, number>;

interface DataStatus {
  message: string;
  state: DataStatusState;
}

const FAVORITES_KEY = "wellceeApartmentFavorites";
const NOTES_KEY = "wellceeApartmentNotes";
const NOTE_DETAILS_KEY = "wellceeApartmentNoteDetails";
const RATINGS_KEY = "wellceeApartmentRatings";
const OPEN_IN_NEW_TAB_KEY = "wellceeOpenListingsInNewTab";
const WELLCEE_ORIGIN = "https://www.wellcee.com";
const BACKUP_FORMAT = "wellcee-notes-backup";
const BACKUP_SCHEMA_VERSION = 2;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_NOTE_LENGTH = 2000;
const ACTIVE_LISTING_REQUEST = "wellcee:get-active-listing";
const LISTING_CHANGED_MESSAGE = "wellcee:listing-changed";
const IDLE_STATUS = "收藏和笔记仅保存在当前 Chrome";

const appRootElement = document.getElementById("app");
if (!appRootElement) {
  throw new Error("Wellcee Notes app mount is missing");
}
const appRoot: HTMLElement = appRootElement;
const isPopupSurface = document.body.dataset.surface === "popup";

let statusTimer: number | undefined;
let activeTabId: number | null = null;
let activeListingId: ListingId | null = null;
let activeListingRequest = 0;
let dataRequest = 0;
let viewMode: ViewMode = "favorites";
let sortMode: SortMode = "default";
let openInNewTab = true;
let openModeBusy = false;
let sidePanelBusy = false;
let dataActionsBusy = false;
let storedData: WellceeStorageData = {
  [FAVORITES_KEY]: {},
  [NOTES_KEY]: {},
  [NOTE_DETAILS_KEY]: {},
  [RATINGS_KEY]: {},
  [OPEN_IN_NEW_TAB_KEY]: true
};
let dataStatus: DataStatus = { message: IDLE_STATUS, state: "idle" };
const busyListings = new Set<ListingId>();

function getStoredData(): Promise<WellceeStorageData> {
  return new Promise<WellceeStorageData>((resolve) => {
    chrome.storage.local.get(
      {
        [FAVORITES_KEY]: {},
        [NOTES_KEY]: {},
        [NOTE_DETAILS_KEY]: {},
        [RATINGS_KEY]: {},
        [OPEN_IN_NEW_TAB_KEY]: true
      },
      (result) => resolve(result as unknown as WellceeStorageData)
    );
  });
}

function setStoredData(value: Partial<WellceeStorageData>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

async function refreshData(): Promise<void> {
  const request = ++dataRequest;
  const result = await getStoredData();
  if (request !== dataRequest) {
    return;
  }
  storedData = result;
  openInNewTab = result[OPEN_IN_NEW_TAB_KEY] !== false;
  renderApp();
}

async function refreshActiveListing(): Promise<void> {
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
      const response: unknown = await chrome.tabs.sendMessage(activeTab.id, {
        type: ACTIVE_LISTING_REQUEST
      });
      if (
        isPlainRecord(response) &&
        typeof response.listingId === "string" &&
        /^\d+$/.test(response.listingId)
      ) {
        nextListingId = response.listingId;
      }
    }
  } catch {
    // Non-Wellcee tabs do not have the content script, so no item is active.
  }

  if (request === activeListingRequest) {
    activeTabId = nextTabId;
    activeListingId = nextListingId;
    renderApp();
  }
}

async function openListing(url: string): Promise<void> {
  let opened = false;
  try {
    if (openInNewTab) {
      await chrome.tabs.create({ url });
    } else {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      if (activeTab?.id === undefined) {
        throw new Error("无法获取当前标签页");
      }
      await chrome.tabs.update(activeTab.id, { url });
    }
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function assertListingId(listingId: string, label: string): void {
  if (!/^\d+$/.test(listingId)) {
    throw new Error(`${label}中包含无效房源 ID`);
  }
}

function canonicalListingUrl(
  listingId: ListingId,
  value: unknown,
  label: string
): string {
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

function normalizedTitle(
  value: unknown,
  listingId: ListingId,
  label: string
): string {
  if (value === undefined || value === "") {
    return `Wellcee 房源 ${listingId}`;
  }
  if (typeof value !== "string" || value.length > 500) {
    throw new Error(`${label}中的房源标题格式不正确`);
  }
  return value.trim() || `Wellcee 房源 ${listingId}`;
}

function normalizedTimestamp(value: unknown, label: string): number {
  if (value === undefined) {
    return Date.now();
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}中的时间格式不正确`);
  }
  return value;
}

function normalizeNotes(value: unknown): Notes {
  if (!isPlainRecord(value)) {
    throw new Error("笔记数据格式不正确");
  }

  const normalized: Notes = {};
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

function normalizeRatings(value: unknown): Ratings {
  if (!isPlainRecord(value)) {
    throw new Error("评分数据格式不正确");
  }

  const normalized: Ratings = {};
  Object.entries(value).forEach(([listingId, rating]) => {
    assertListingId(listingId, "评分数据");
    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      throw new Error(`房源 ${listingId} 的评分必须是 1 到 5 星`);
    }
    normalized[listingId] = rating;
  });
  return normalized;
}

function normalizeListingRecords<Key extends TimestampKey>(
  value: unknown,
  label: string,
  timestampKey: Key
): Record<ListingId, TimestampedListing<Key>> {
  if (!isPlainRecord(value)) {
    throw new Error(`${label}格式不正确`);
  }

  const normalized: Record<ListingId, TimestampedListing<Key>> = {};
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
    } as unknown as TimestampedListing<Key>;
  });
  return normalized;
}

function parseBackup(text: string): ImportedBackupData {
  let backup: unknown;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }

  if (
    !isPlainRecord(backup) ||
    backup.format !== BACKUP_FORMAT ||
    (backup.schemaVersion !== 1 &&
      backup.schemaVersion !== BACKUP_SCHEMA_VERSION) ||
    !isPlainRecord(backup.data)
  ) {
    throw new Error("不是有效的 Wellcee Notes 备份文件");
  }

  const backupData = backup.data;
  const favorites = normalizeListingRecords(
    backupData.favorites,
    "收藏数据",
    "createdAt"
  );
  const ratings: Ratings =
    backup.schemaVersion === 1 ? {} : normalizeRatings(backupData.ratings);

  Object.keys(ratings).forEach((listingId) => {
    if (!favorites[listingId]) {
      throw new Error(`房源 ${listingId} 未收藏，不能导入评分`);
    }
  });

  return {
    notes: normalizeNotes(backupData.notes),
    noteDetails: normalizeListingRecords(
      backupData.noteDetails,
      "笔记房源数据",
      "updatedAt"
    ),
    favorites,
    ratings
  };
}

function setDataStatus(
  message: string,
  state: DataStatusState = "idle"
): void {
  window.clearTimeout(statusTimer);
  dataStatus = { message, state };
  renderApp();

  if (state !== "idle") {
    statusTimer = window.setTimeout(() => {
      dataStatus = { message: IDLE_STATUS, state: "idle" };
      renderApp();
    }, 4000);
  }
}

function setDataActionsBusy(isBusy: boolean): void {
  dataActionsBusy = isBusy;
  renderApp();
}

async function exportData(): Promise<void> {
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

async function importData(file: File): Promise<ImportSummary> {
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

async function removeFavorite(listingId: ListingId): Promise<void> {
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

async function toggleFavorite(
  listingId: ListingId,
  listing: ListingSummary | undefined
): Promise<void> {
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
      url: listing?.url || `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`,
      createdAt: Date.now()
    };
  }

  await setStoredData({
    [FAVORITES_KEY]: favorites,
    [RATINGS_KEY]: ratings
  });
}

async function runListingAction(
  listingId: ListingId,
  action: () => Promise<void>
): Promise<void> {
  busyListings.add(listingId);
  renderApp();
  try {
    await action();
    await refreshData();
  } catch (error) {
    console.warn("[Wellcee Notes] 无法更新收藏", error);
    setDataStatus("无法更新收藏，请重试", "error");
  } finally {
    busyListings.delete(listingId);
    renderApp();
  }
}

function selectView(view: ViewMode): void {
  viewMode = view === "notes" ? "notes" : "favorites";
  renderApp();
}

function selectSortMode(mode: SortMode): void {
  sortMode = mode === "rating" ? "rating" : "default";
  renderApp();
}

async function changeOpenMode(event: Event): Promise<void> {
  const previousMode = openInNewTab;
  openInNewTab = (event.currentTarget as HTMLInputElement).checked;
  openModeBusy = true;
  renderApp();
  try {
    await setStoredData({ [OPEN_IN_NEW_TAB_KEY]: openInNewTab });
  } catch (error) {
    console.warn("[Wellcee Notes] 无法保存打开方式", error);
    openInNewTab = previousMode;
    setDataStatus("无法保存打开方式，请重试", "error");
  } finally {
    openModeBusy = false;
    renderApp();
  }
}

async function openSidePanel(): Promise<void> {
  sidePanelBusy = true;
  renderApp();
  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.id === undefined) {
      throw new Error("无法获取当前 Chrome 窗口");
    }
    await chrome.sidePanel.open({ windowId: currentWindow.id });
    window.close();
  } catch (error) {
    console.warn("[Wellcee Notes] 无法打开侧边栏", error);
    sidePanelBusy = false;
    setDataStatus("无法打开侧边栏，请重试", "error");
  }
}

async function handleImport(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }

  setDataActionsBusy(true);
  setDataStatus("正在导入备份…");
  try {
    const imported = await importData(file);
    await refreshData();
    setDataStatus(
      `已导入 ${imported.noteCount} 条笔记、${imported.favoriteCount} 条收藏、${imported.ratingCount} 个评分`,
      "success"
    );
  } catch (error) {
    console.warn("[Wellcee Notes] 无法导入数据", error);
    setDataStatus(getErrorMessage(error, "导入失败，请检查文件"), "error");
  } finally {
    setDataActionsBusy(false);
  }
}

function getViewModel() {
  const ratings = storedData[RATINGS_KEY] || {};
  const defaultFavoriteOrder = (
    left: FavoriteListing,
    right: FavoriteListing
  ) =>
    (right.createdAt || 0) - (left.createdAt || 0);
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

function currentListingTemplate(listingId: ListingId) {
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
  rating: number
) {
  const listingId = String(favorite.id);
  const isCurrent = listingId === activeListingId;
  const title = favorite.title || `Wellcee 房源 ${favorite.id}`;
  return html`
    <article
      class=${`favorite-item${isCurrent ? " favorite-item--current" : ""}`}
      data-listing-id=${listingId}
    >
      <a
        class="favorite-item__link"
        href=${favorite.url}
        title="打开房源"
        @click=${(event: MouseEvent) => {
          event.preventDefault();
          openListing(favorite.url);
        }}
      >
        ${currentListingTemplate(listingId)}
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
        ?disabled=${busyListings.has(listingId)}
        @click=${() =>
          runListingAction(listingId, () => removeFavorite(listingId))}
      ></button>
    </article>
  `;
}

function noteItemTemplate(
  listingId: ListingId,
  note: string,
  details: NoteDetails | undefined,
  favorite: FavoriteListing | undefined,
  rating: number
) {
  const listing = details || favorite;
  const url = listing?.url || `${WELLCEE_ORIGIN}/rent-apartment/${listingId}`;
  const title = listing?.title || `Wellcee 房源 ${listingId}`;
  const isFavorite = Boolean(favorite);
  const isCurrent = String(listingId) === activeListingId;
  return html`
    <article
      class=${`favorite-item favorite-item--note${isCurrent ? " favorite-item--current" : ""}`}
      data-listing-id=${String(listingId)}
    >
      <a
        class="favorite-item__link"
        href=${url}
        title="打开房源"
        @click=${(event: MouseEvent) => {
          event.preventDefault();
          openListing(url);
        }}
      >
        ${currentListingTemplate(listingId)}
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
        ?disabled=${busyListings.has(String(listingId))}
        @click=${() =>
          runListingAction(listingId, () =>
            toggleFavorite(listingId, listing)
          )}
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

function appTemplate() {
  const { favorites, favoritesById, notes, noteDetails, noteEntries, ratings } =
    getViewModel();
  const showFavorites = viewMode === "favorites";
  const sortByRating = sortMode === "rating";

  return html`
    <header class="header">
      <div>
        <span class="eyebrow">WELLCEE NOTES</span>
        <h1>我的房源</h1>
      </div>
      ${isPopupSurface
        ? html`
            <button
              id="open-side-panel"
              class="open-side-panel"
              type="button"
              ?disabled=${sidePanelBusy}
              @click=${openSidePanel}
            >侧边栏</button>
          `
        : html`<p class="sidepanel-intro">收藏与私人笔记</p>`}
    </header>

    <nav class="view-tabs" role="tablist" aria-label="房源列表">
      <button
        id="favorite-tab"
        class=${`view-tab${showFavorites ? " is-active" : ""}`}
        type="button"
        role="tab"
        aria-selected=${String(showFavorites)}
        aria-controls="favorite-panel"
        @click=${() => selectView("favorites")}
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
        @click=${() => selectView("notes")}
      >
        有笔记
        <span class="view-tab__count" aria-hidden="true">${noteEntries.length}</span>
      </button>
    </nav>

    <div class="sort-bar" aria-label="列表设置">
      <div class="open-mode" aria-label="房源打开方式">
        <span class=${`open-mode__choice${openInNewTab ? "" : " is-active"}`}>
          当前页面
        </span>
        <label class="open-mode__switch">
          <input
            id="open-in-new-tab"
            class="open-mode__input"
            type="checkbox"
            role="switch"
            aria-label="使用新标签页打开房源"
            .checked=${openInNewTab}
            ?disabled=${openModeBusy}
            @change=${changeOpenMode}
          >
          <span class="open-mode__track" aria-hidden="true"></span>
        </label>
        <span class=${`open-mode__choice${openInNewTab ? " is-active" : ""}`}>
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
            @click=${() => selectSortMode("default")}
          >默认</button>
          <button
            class=${`sort-toggle__button${sortByRating ? " is-active" : ""}`}
            type="button"
            aria-pressed=${String(sortByRating)}
            @click=${() => selectSortMode("rating")}
          >评分</button>
        </div>
      </div>
    </div>

    <main>
      <div class="view-track" data-view=${viewMode}>
        <section
          id="favorite-panel"
          class="view-panel"
          role="tabpanel"
          aria-labelledby="favorite-tab"
          aria-hidden=${String(!showFavorites)}
          ?inert=${!showFavorites}
        >
          ${favorites.length
            ? html`
                <div class="listing-list" aria-live="polite">
                  ${favorites.map((favorite) =>
                    favoriteItemTemplate(
                      favorite,
                      notes[favorite.id],
                      ratings[favorite.id] ?? 0
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
        >
          ${noteEntries.length
            ? html`
                <div class="listing-list" aria-live="polite">
                  ${noteEntries.map(([listingId, note]) =>
                    noteItemTemplate(
                      listingId,
                      note,
                      noteDetails[listingId],
                      favoritesById[listingId],
                      favoritesById[listingId] ? ratings[listingId] ?? 0 : 0
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
          ?disabled=${dataActionsBusy}
          @click=${exportData}
        >导出数据</button>
        <button
          class="data-action"
          type="button"
          ?disabled=${dataActionsBusy}
          @click=${() => document.getElementById("import-file")?.click()}
        >导入数据</button>
        <input
          id="import-file"
          type="file"
          accept=".json,application/json"
          hidden
          @change=${handleImport}
        >
      </div>
      <span
        class="data-status"
        role="status"
        aria-live="polite"
        data-state=${dataStatus.state}
      >${dataStatus.message}</span>
    </footer>
  `;
}

function renderApp(): void {
  renderTemplate(appTemplate(), appRoot);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes[OPEN_IN_NEW_TAB_KEY]) {
    openInNewTab = changes[OPEN_IN_NEW_TAB_KEY].newValue !== false;
    renderApp();
  }
  if (
    changes[FAVORITES_KEY] ||
    changes[NOTES_KEY] ||
    changes[NOTE_DETAILS_KEY] ||
    changes[RATINGS_KEY]
  ) {
    refreshData().catch((error) => {
      console.warn("[Wellcee Notes] 无法刷新数据", error);
    });
  }
});

chrome.tabs.onActivated.addListener(refreshActiveListing);
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

renderApp();
refreshData().catch((error) => {
  console.warn("[Wellcee Notes] 无法读取本地数据", error);
  setDataStatus("无法读取本地数据，请重试", "error");
});
refreshActiveListing();
