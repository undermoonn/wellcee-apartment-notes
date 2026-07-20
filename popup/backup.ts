import { MAX_NOTE_LENGTH, WELLCEE_ORIGIN } from "../src/constants.js";
import type {
  ImportedBackupData,
  ListingId,
  ListingSummary,
  Notes,
  Ratings
} from "../src/types.js";

export const BACKUP_FORMAT = "wellcee-notes-backup";
export const BACKUP_SCHEMA_VERSION = 2;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

type TimestampKey = "createdAt" | "updatedAt";
type TimestampedListing<Key extends TimestampKey> = ListingSummary &
  Record<Key, number>;

export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function getErrorMessage(error: unknown, fallback: string): string {
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

    let url: URL;
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

export function parseBackup(text: string): ImportedBackupData {
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
