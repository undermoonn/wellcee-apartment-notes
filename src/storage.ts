import {
  FAVORITES_KEY,
  NOTES_KEY,
  NOTE_DETAILS_KEY,
  OPEN_IN_NEW_TAB_KEY,
  RATINGS_KEY
} from "./constants.js";
import type { WellceeStorageData } from "./types.js";

export function createStorageDefaults(): WellceeStorageData {
  return {
    [FAVORITES_KEY]: {},
    [NOTES_KEY]: {},
    [NOTE_DETAILS_KEY]: {},
    [RATINGS_KEY]: {},
    [OPEN_IN_NEW_TAB_KEY]: true
  };
}

export function getStoredData(): Promise<WellceeStorageData> {
  return new Promise<WellceeStorageData>((resolve) => {
    chrome.storage.local.get(
      createStorageDefaults() as unknown as Record<string, unknown>,
      (result) => {
        resolve(result as unknown as WellceeStorageData);
      }
    );
  });
}

export function setStoredData(
  value: Partial<WellceeStorageData>
): Promise<void> {
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

export function getStoredRecord<T extends object>(key: string): Promise<T> {
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

export function setStoredRecord<T extends object>(
  key: string,
  value: T
): Promise<void> {
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
