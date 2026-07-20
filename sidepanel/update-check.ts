// Release status shown in the side panel header.
const LATEST_RELEASE_API =
  "https://api.github.com/repos/undermoonn/wellcee-apartment-notes/releases/latest";
const RELEASE_URL_PREFIX =
  "https://github.com/undermoonn/wellcee-apartment-notes/releases/";
const UPDATE_CACHE_KEY = "wellceeUpdateCheckCache";
const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "error";

export interface UpdateCheckState {
  currentVersion: string;
  latestVersion: string | null;
  message: string;
  releaseUrl: string | null;
  status: UpdateCheckStatus;
}

interface CachedRelease {
  checkedAt: number;
  latestVersion: string;
  releaseUrl: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function versionParts(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`无法识别版本号 ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (const index of [0, 1, 2] as const) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function isCachedRelease(value: unknown): value is CachedRelease {
  return (
    isPlainRecord(value) &&
    typeof value.checkedAt === "number" &&
    Number.isFinite(value.checkedAt) &&
    typeof value.latestVersion === "string" &&
    /^\d+\.\d+\.\d+$/.test(value.latestVersion) &&
    typeof value.releaseUrl === "string" &&
    value.releaseUrl.startsWith(RELEASE_URL_PREFIX)
  );
}

async function getCachedRelease(): Promise<CachedRelease | null> {
  const result = await chrome.storage.local.get(UPDATE_CACHE_KEY);
  const cached: unknown = result[UPDATE_CACHE_KEY];
  return isCachedRelease(cached) ? cached : null;
}

async function fetchLatestRelease(): Promise<CachedRelease> {
  const response = await fetch(LATEST_RELEASE_API, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub Release API 返回 ${response.status}`);
  }

  const release: unknown = await response.json();
  if (
    !isPlainRecord(release) ||
    typeof release.tag_name !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
    typeof release.html_url !== "string" ||
    !release.html_url.startsWith(RELEASE_URL_PREFIX)
  ) {
    throw new Error("GitHub Release 数据格式不正确");
  }

  const cachedRelease: CachedRelease = {
    checkedAt: Date.now(),
    latestVersion: release.tag_name.slice(1),
    releaseUrl: release.html_url
  };
  await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: cachedRelease });
  return cachedRelease;
}

export function createInitialUpdateState(): UpdateCheckState {
  const currentVersion = chrome.runtime.getManifest().version;
  return {
    currentVersion,
    latestVersion: null,
    message: "未检查",
    releaseUrl: null,
    status: "idle"
  };
}

export function createCheckingUpdateState(): UpdateCheckState {
  const currentVersion = chrome.runtime.getManifest().version;
  return {
    currentVersion,
    latestVersion: null,
    message: "检查中…",
    releaseUrl: null,
    status: "checking"
  };
}

export function createUpdateErrorState(): UpdateCheckState {
  const currentVersion = chrome.runtime.getManifest().version;
  return {
    currentVersion,
    latestVersion: null,
    message: "检查失败",
    releaseUrl: null,
    status: "error"
  };
}

export async function checkForUpdates(
  force = false
): Promise<UpdateCheckState> {
  const currentVersion = chrome.runtime.getManifest().version;
  const cachedRelease = force ? null : await getCachedRelease();
  const latestRelease =
    cachedRelease && Date.now() - cachedRelease.checkedAt < UPDATE_CACHE_TTL_MS
      ? cachedRelease
      : await fetchLatestRelease();
  const updateAvailable =
    compareVersions(latestRelease.latestVersion, currentVersion) > 0;

  return {
    currentVersion,
    latestVersion: latestRelease.latestVersion,
    message: updateAvailable
      ? `新版本 v${latestRelease.latestVersion}`
      : "已是最新",
    releaseUrl: latestRelease.releaseUrl,
    status: updateAvailable ? "available" : "current"
  };
}
