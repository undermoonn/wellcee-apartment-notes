import type { ListingId } from "./types.js";

export function isWellceeHost(hostname: string): boolean {
  return hostname === "wellcee.com" || hostname === "www.wellcee.com";
}

export function listingIdFromPathname(pathname: string): ListingId | null {
  return pathname.match(/^\/rent-apartment\/(\d+)\/?$/)?.[1] ?? null;
}

export function listingIdFromHref(href: string | null): ListingId | null {
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

export function isListPage(): boolean {
  return /^\/rent-apartment\/[^/]+\/list\/?$/.test(window.location.pathname);
}

export function currentListingId(): ListingId | null {
  return listingIdFromPathname(window.location.pathname);
}

export function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function priceFromAnchor(anchor: HTMLAnchorElement | null): string | null {
  if (!anchor) {
    return null;
  }

  const exactPricePattern = /^(?:\d{1,3}(?:,\d{3})+|\d{2,6})(?:\.\d+)?\s*RMB\s*\/\s*月$/i;
  const priceElement = Array.from(
    anchor.querySelectorAll<HTMLElement>("*")
  ).find((element) =>
    exactPricePattern.test(compactText(element.textContent || ""))
  );

  if (priceElement) {
    return compactText(priceElement.textContent || "").replace(/\s+/g, " ");
  }

  return (
    (anchor.innerText || "")
      .split("\n")
      .map(compactText)
      .find((line) => exactPricePattern.test(line)) ?? null
  );
}

export function detailPageTitle(): string {
  return compactText(document.title).replace(/\s*-\s*Wellcee.*$/i, "");
}

export function favoriteTitle(
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function findDetailsHeading(): HTMLElement | null {
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
