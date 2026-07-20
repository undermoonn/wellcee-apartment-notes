import { render as renderTemplate } from "lit-html";
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  getErrorMessage,
  isPlainRecord,
  MAX_IMPORT_BYTES,
  parseBackup
} from "./backup.js";
import {
  ACTIVE_LISTING_REQUEST,
  BROWSE_CURSOR_KEY,
  FAVORITES_KEY,
  LISTING_CHANGED_MESSAGE,
  NOTES_KEY,
  NOTE_DETAILS_KEY,
  OPEN_IN_NEW_TAB_KEY,
  RATINGS_KEY,
  SORT_MODE_KEY,
  VIEW_MODE_KEY,
  WELLCEE_ORIGIN
} from "../src/constants.js";
import {
  createStorageDefaults,
  getStoredData,
  setStoredData
} from "../src/storage.js";
import {
  checkForUpdates,
  createCheckingUpdateState,
  createInitialUpdateState,
  createUpdateErrorState
} from "./update-check.js";
import type { UpdateCheckState } from "./update-check.js";
import { sidePanelTemplate } from "./view.js";
import type {
  DataStatus,
  DataStatusState,
  SidePanelViewActions,
  SortMode,
  ViewMode
} from "./view.js";
import type {
  BrowseCursor,
  ImportSummary,
  ListingId,
  ListingSummary,
  WellceeStorageData
} from "../src/types.js";

const IDLE_STATUS = "收藏和笔记仅保存在当前 Chrome";
const RESTORED_CURSOR_TOP_OFFSET = 12;

const appRootElement = document.getElementById("app");
if (!appRootElement) {
  throw new Error("Wellcee Notes app mount is missing");
}
const appRoot: HTMLElement = appRootElement;

let statusTimer: number | undefined;
let activeTabId: number | null = null;
let activeListingId: ListingId | null = null;
let activeListingRequest = 0;
let browseCursor: BrowseCursor | null = null;
let dataRequest = 0;
let updateRequest = 0;
let uiStateRestored = false;
let viewMode: ViewMode = "favorites";
let sortMode: SortMode = "default";
let openInNewTab = true;
let openModeBusy = false;
let dataActionsBusy = false;
let storedData: WellceeStorageData = createStorageDefaults();
let dataStatus: DataStatus = { message: IDLE_STATUS, state: "idle" };
let updateCheck: UpdateCheckState = createInitialUpdateState();
const busyListings = new Set<ListingId>();

function normalizedViewMode(value: unknown): ViewMode {
  return value === "notes" ? "notes" : "favorites";
}

function normalizedSortMode(value: unknown): SortMode {
  return value === "rating" ? "rating" : "default";
}

function normalizedBrowseCursor(value: unknown): BrowseCursor | null {
  if (
    !isPlainRecord(value) ||
    typeof value.listingId !== "string" ||
    !/^\d+$/.test(value.listingId) ||
    !Number.isInteger(value.position) ||
    Number(value.position) < 0 ||
    (value.view !== "favorites" && value.view !== "notes")
  ) {
    return null;
  }

  return {
    listingId: value.listingId,
    position: Number(value.position),
    view: value.view
  };
}

async function persistUiState(
  value: Partial<WellceeStorageData>
): Promise<void> {
  try {
    await setStoredData(value);
  } catch (error) {
    console.warn("[Wellcee Notes] 无法保存列表状态", error);
    setDataStatus("无法保存列表状态，请重试", "error");
  }
}

async function refreshData(): Promise<void> {
  const request = ++dataRequest;
  const result = await getStoredData();
  if (request !== dataRequest) {
    return;
  }
  storedData = result;
  openInNewTab = result[OPEN_IN_NEW_TAB_KEY] !== false;
  if (!uiStateRestored) {
    viewMode = normalizedViewMode(result[VIEW_MODE_KEY]);
    sortMode = normalizedSortMode(result[SORT_MODE_KEY]);
    browseCursor = normalizedBrowseCursor(result[BROWSE_CURSOR_KEY]);
    uiStateRestored = true;
  }
  renderApp();
  if (
    activeListingId !== null &&
    browseCursor?.listingId !== activeListingId
  ) {
    void rememberBrowseCursor(activeListingId);
    renderApp();
  }
}

function rememberBrowseCursor(listingId: ListingId): Promise<void> {
  const panelId = viewMode === "favorites" ? "favorite-panel" : "note-panel";
  const panel = appRoot.querySelector<HTMLElement>(`#${panelId}`);
  if (!panel) {
    return Promise.resolve();
  }

  const items = Array.from(
    panel.querySelectorAll<HTMLElement>(".favorite-item")
  );
  const position = items.findIndex(
    (item) => item.dataset.listingId === listingId
  );
  if (position >= 0) {
    browseCursor = { listingId, position, view: viewMode };
    return persistUiState({ [BROWSE_CURSOR_KEY]: browseCursor });
  }
  return Promise.resolve();
}

function updateActiveVisibility(panel: HTMLElement): void {
  panel
    .querySelectorAll<HTMLElement>("[data-sticky-position]")
    .forEach((item) => item.removeAttribute("data-sticky-position"));
  const activeItem = panel.querySelector<HTMLElement>(
    ".favorite-item--current"
  );
  if (!activeItem) {
    return;
  }

  const panelBounds = panel.getBoundingClientRect();
  const itemBounds = activeItem.getBoundingClientRect();
  if (itemBounds.top < panelBounds.top) {
    activeItem.dataset.stickyPosition = "above";
  } else if (itemBounds.bottom > panelBounds.bottom) {
    activeItem.dataset.stickyPosition = "below";
  }
}

function updateVisibleActiveVisibility(): void {
  const panelId = viewMode === "favorites" ? "favorite-panel" : "note-panel";
  const panel = appRoot.querySelector<HTMLElement>(`#${panelId}`);
  if (panel) {
    updateActiveVisibility(panel);
  }
}

function restoreActiveScrollPosition(): void {
  const panelId = viewMode === "favorites" ? "favorite-panel" : "note-panel";
  const panel = appRoot.querySelector<HTMLElement>(`#${panelId}`);
  if (!panel) {
    return;
  }

  const listingIds = [activeListingId, browseCursor?.listingId].filter(
    (listingId): listingId is ListingId =>
      listingId !== null && listingId !== undefined
  );
  const items = Array.from(
    panel.querySelectorAll<HTMLElement>(".favorite-item")
  );
  const anchorItem = listingIds
    .map((listingId) =>
      items.find((item) => item.dataset.listingId === listingId)
    )
    .find((item) => item !== undefined);
  if (!anchorItem) {
    return;
  }

  anchorItem.removeAttribute("data-sticky-position");
  const panelBounds = panel.getBoundingClientRect();
  const itemBounds = anchorItem.getBoundingClientRect();
  panel.scrollTop +=
    itemBounds.top - panelBounds.top - RESTORED_CURSOR_TOP_OFFSET;
  updateActiveVisibility(panel);
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
    if (
      nextListingId !== null &&
      browseCursor?.listingId !== nextListingId
    ) {
      void rememberBrowseCursor(nextListingId);
    }
    activeTabId = nextTabId;
    activeListingId = nextListingId;
    renderApp();
  }
}

async function openListing(
  listingId: ListingId,
  url: string
): Promise<void> {
  const previousBrowseCursor = browseCursor;
  const cursorPersistence = rememberBrowseCursor(listingId);
  renderApp();
  try {
    await cursorPersistence;
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
  } catch (error) {
    console.warn("[Wellcee Notes] 无法打开房源", error);
    browseCursor = previousBrowseCursor;
    void persistUiState({ [BROWSE_CURSOR_KEY]: browseCursor });
    setDataStatus("无法打开房源，请重试", "error");
  }
}

async function refreshUpdateCheck(force = false): Promise<void> {
  const request = ++updateRequest;
  updateCheck = createCheckingUpdateState();
  renderApp();
  try {
    const result = await checkForUpdates(force);
    if (request === updateRequest) {
      updateCheck = result;
    }
  } catch (error) {
    console.warn("[Wellcee Notes] 无法检查更新", error);
    if (request === updateRequest) {
      updateCheck = createUpdateErrorState();
    }
  }
  if (request === updateRequest) {
    renderApp();
  }
}

async function openRelease(url: string): Promise<void> {
  try {
    await chrome.tabs.create({ url });
  } catch (error) {
    console.warn("[Wellcee Notes] 无法打开 Release 页面", error);
    setDataStatus("无法打开更新页面，请重试", "error");
  }
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
  void persistUiState({ [VIEW_MODE_KEY]: viewMode });
}

function selectSortMode(mode: SortMode): void {
  sortMode = mode === "rating" ? "rating" : "default";
  renderApp();
  void persistUiState({ [SORT_MODE_KEY]: sortMode });
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
const sidePanelActions: SidePanelViewActions = {
  changeOpenMode: (event) => void changeOpenMode(event),
  exportData: () => void exportData(),
  handleImport: (event) => void handleImport(event),
  openListing: (listingId, url) => void openListing(listingId, url),
  openRelease: (url) => void openRelease(url),
  refreshUpdateCheck: () => void refreshUpdateCheck(true),
  removeFavorite: (listingId) =>
    void runListingAction(listingId, () => removeFavorite(listingId)),
  selectSortMode,
  selectView,
  toggleFavorite: (listingId, listing) =>
    void runListingAction(listingId, () => toggleFavorite(listingId, listing)),
  updateActiveVisibility: (event) =>
    updateActiveVisibility(event.currentTarget as HTMLElement)
};

function renderApp(): void {
  renderTemplate(
    sidePanelTemplate(
      {
        activeListingId,
        browseCursor,
        busyListings,
        dataActionsBusy,
        dataStatus,
        openInNewTab,
        openModeBusy,
        sortMode,
        storedData,
        updateCheck,
        viewMode
      },
      sidePanelActions
    ),
    appRoot
  );
  updateVisibleActiveVisibility();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes[OPEN_IN_NEW_TAB_KEY]) {
    openInNewTab = changes[OPEN_IN_NEW_TAB_KEY].newValue !== false;
    renderApp();
  }
  if (changes[VIEW_MODE_KEY]) {
    viewMode = normalizedViewMode(changes[VIEW_MODE_KEY].newValue);
    renderApp();
  }
  if (changes[SORT_MODE_KEY]) {
    sortMode = normalizedSortMode(changes[SORT_MODE_KEY].newValue);
    renderApp();
  }
  if (changes[BROWSE_CURSOR_KEY]) {
    browseCursor = normalizedBrowseCursor(
      changes[BROWSE_CURSOR_KEY].newValue
    );
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
window.addEventListener("resize", updateVisibleActiveVisibility);

async function initialize(): Promise<void> {
  try {
    await refreshData();
  } catch (error) {
    console.warn("[Wellcee Notes] 无法读取本地数据", error);
    uiStateRestored = true;
    renderApp();
    setDataStatus("无法读取本地数据，请重试", "error");
  }
  await refreshActiveListing();
  await nextAnimationFrame();
  restoreActiveScrollPosition();
  void refreshUpdateCheck();
}

void initialize();
