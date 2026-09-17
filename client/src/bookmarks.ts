/**
 * Saved coordinate bookmarks, persisted per-browser in localStorage.
 * Anonymous + per-device, which suits a public canvas with no accounts.
 */
export interface Bookmark {
  name: string;
  x: number;
  y: number;
}

const KEY = "wwc:bookmarks";
const MAX = 50;

/** Pure: normalize an untrusted JSON string into a valid Bookmark[]. */
export function parseBookmarks(raw: string | null): Bookmark[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (b): b is Bookmark =>
          !!b && typeof b.name === "string" && Number.isInteger(b.x) && Number.isInteger(b.y),
      )
      .map((b) => ({ name: b.name.slice(0, 40), x: b.x, y: b.y }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function loadBookmarks(): Bookmark[] {
  try {
    return parseBookmarks(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveBookmarks(list: Bookmark[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* private mode / storage disabled — bookmarks just won't persist */
  }
}
