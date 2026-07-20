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
  FAVORITES_KEY,
  LISTING_CHANGED_MESSAGE,
  NOTES_KEY,
  NOTE_DETAILS_KEY,
  OPEN_IN_NEW_TAB_KEY,
  RATINGS_KEY,
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
import { appTemplate } from "./view.js";
import type {
  DataStatus,
  DataStatusState,
  PopupViewActions,
  SortMode,
  ViewMode
} from "./view.js";
import type {
  ImportSummary,
  ListingId,
  ListingSummary,
  WellceeStorageData
} from "../src/types.js";

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
let updateRequest = 0;
let viewMode: ViewMode = "favorites";
let sortMode: SortMode = "default";
let openInNewTab = true;
let openModeBusy = false;
let sidePanelBusy = false;
let dataActionsBusy = false;
let storedData: WellceeStorageData = createStorageDefaults();
let dataStatus: DataStatus = { message: IDLE_STATUS, state: "idle" };
let updateCheck: UpdateCheckState = createInitialUpdateState();
const busyListings = new Set<ListingId>();

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
    if (isPopupSurface) {
      window.close();
    }
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
const viewActions: PopupViewActions = {
  changeOpenMode: (event) => void changeOpenMode(event),
  exportData: () => void exportData(),
  handleImport: (event) => void handleImport(event),
  openListing: (url) => void openListing(url),
  openRelease: (url) => void openRelease(url),
  openSidePanel: () => void openSidePanel(),
  refreshUpdateCheck: () => void refreshUpdateCheck(true),
  removeFavorite: (listingId) =>
    void runListingAction(listingId, () => removeFavorite(listingId)),
  selectSortMode,
  selectView,
  toggleFavorite: (listingId, listing) =>
    void runListingAction(listingId, () => toggleFavorite(listingId, listing))
};

function renderApp(): void {
  renderTemplate(
    appTemplate(
      {
        activeListingId,
        busyListings,
        dataActionsBusy,
        dataStatus,
        isPopupSurface,
        openInNewTab,
        openModeBusy,
        sidePanelBusy,
        sortMode,
        storedData,
        updateCheck,
        viewMode
      },
      viewActions
    ),
    appRoot
  );
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
void refreshUpdateCheck();
