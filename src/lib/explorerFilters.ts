import { genreFilterUrlValue, parseGenreFilterUrlValue, type GenreFilterValue } from "./taxonomy";

/**
 * URL-backed homepage filter state (homepage search/navigation work,
 * 2026-10-13). The filters a visitor sets on the homepage live in the URL's
 * query string, so browser back/forward from an event page, a reload, and a
 * shared link all restore the same view:
 *
 *   /?when=weekend&genre=house&venue=culture-box&q=tim
 *
 * The page's canonical stays "/" (see src/app/page.tsx), so these views are
 * never indexed as separate pages. Unknown or invalid values are ignored
 * rather than rejected — a stale or hand-edited link still opens the
 * homepage, just without that one filter (an unknown genre is reported on
 * screen — see `unknownGenre`).
 */

export type ExplorerMode = "all" | "tonight" | "weekend" | "next-weekend";

export const EXPLORER_DATE_MODES = ["tonight", "weekend", "next-weekend"] as const;

/** Filter state as the URL carries it. `venueSlug` is resolved to a venue id by EventExplorer against the venues it actually lists. */
export interface ExplorerUrlFilters {
  mode: ExplorerMode;
  genre: GenreFilterValue | "all";
  venueSlug: string | null;
  query: string;
  /**
   * A `genre` value the URL carried that is no known genre (a typo or a
   * genre since removed). The filter then falls back to all genres, and
   * EventExplorer says so on screen rather than silently listing
   * everything. Never written back to the URL.
   */
  unknownGenre?: string;
}

export const DEFAULT_EXPLORER_URL_FILTERS: ExplorerUrlFilters = {
  mode: "all",
  genre: "all",
  venueSlug: null,
  query: "",
};

/** The query-string keys this module owns; every other key (e.g. utm_*) is left untouched. */
const KEYS = { mode: "when", genre: "genre", venue: "venue", query: "q" } as const;

const MAX_QUERY_LENGTH = 200;

type ParamsLike = Pick<URLSearchParams, "get">;

export function parseExplorerFilters(params: ParamsLike | null | undefined): ExplorerUrlFilters {
  if (!params) return DEFAULT_EXPLORER_URL_FILTERS;

  const rawMode = params.get(KEYS.mode);
  const mode: ExplorerMode = (EXPLORER_DATE_MODES as readonly string[]).includes(rawMode ?? "")
    ? (rawMode as ExplorerMode)
    : "all";

  const rawGenre = params.get(KEYS.genre);
  // A genre's public urlSlug (or alias) resolves to its internal id; the
  // three legacy sets resolve to themselves (see taxonomy.ts).
  const genre = parseGenreFilterUrlValue(rawGenre) ?? "all";
  const unknownGenre = rawGenre && rawGenre !== "all" && genre === "all" ? rawGenre.slice(0, 100) : undefined;

  const rawVenue = params.get(KEYS.venue)?.trim() ?? "";
  const venueSlug = /^[a-z0-9-]{1,100}$/.test(rawVenue) ? rawVenue : null;

  const query = (params.get(KEYS.query) ?? "").slice(0, MAX_QUERY_LENGTH);

  return { mode, genre, venueSlug, query, ...(unknownGenre ? { unknownGenre } : {}) };
}

/**
 * Returns `current` with this module's keys rewritten for `filters` (in a
 * fixed order, defaults omitted) and every other key preserved as-is. The
 * result has no leading "?" and is "" when nothing is left.
 */
export function serializeExplorerFilters(filters: ExplorerUrlFilters, current = ""): string {
  const params = new URLSearchParams(current);
  for (const key of Object.values(KEYS)) params.delete(key);
  if (filters.mode !== "all") params.set(KEYS.mode, filters.mode);
  if (filters.genre !== "all") params.set(KEYS.genre, genreFilterUrlValue(filters.genre));
  if (filters.venueSlug) params.set(KEYS.venue, filters.venueSlug);
  if (filters.query.trim() !== "") params.set(KEYS.query, filters.query);
  return params.toString();
}

/**
 * "← All events" return target (see BackToEventsLink): when a visitor opens
 * an event from the homepage list with a plain click, the list records which
 * event was opened and the list URL it was opened from, in sessionStorage
 * (per tab, gone when the tab closes). The event page only uses that URL
 * when it is the SAME event the visitor opened from the list, and only for
 * LIST_RETURN_MAX_AGE_MS — a direct visit, a new tab, a different event
 * reached some other way, or a stale/old-format record always gets "/".
 */
export const LIST_RETURN_STORAGE_KEY = "ecph:list-return";

/** How long a record stays usable — long enough for a browsing session, short enough that a tab left open overnight doesn't resurrect yesterday's filters. */
export const LIST_RETURN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface ListReturn {
  eventPath: string;
  listUrl: string;
  /** Date.now() when the event was opened from the list. */
  savedAt: number;
}

/** Only ever a same-site homepage URL ("/" or "/?…") — anything else stored under the key is ignored. */
export function isSafeListUrl(url: unknown): url is string {
  return typeof url === "string" && (url === "/" || url.startsWith("/?")) && url.length <= 1000;
}

function parseListReturn(raw: string | null): ListReturn | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ListReturn>;
    if (typeof parsed.eventPath !== "string" || !isSafeListUrl(parsed.listUrl) || typeof parsed.savedAt !== "number") return null;
    return { eventPath: parsed.eventPath, listUrl: parsed.listUrl, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function readListReturn(raw: string | null, eventPath: string, now = Date.now()): string | null {
  const record = parseListReturn(raw);
  if (!record || record.eventPath !== eventPath) return null;
  const age = now - record.savedAt;
  if (age < 0 || age > LIST_RETURN_MAX_AGE_MS) return null;
  return record.listUrl;
}

// sessionStorage can be unavailable or throw (private mode, blocked
// storage); every failure just means the link falls back to "/".
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeListReturn(record: ListReturn): void {
  try {
    storage()?.setItem(LIST_RETURN_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore
  }
}

/** Points an existing record at the list's current URL (keeping its event and time); no record, nothing to do. */
export function updateListReturnUrl(listUrl: string): void {
  try {
    const store = storage();
    const record = parseListReturn(store?.getItem(LIST_RETURN_STORAGE_KEY) ?? null);
    if (!store || !record || record.listUrl === listUrl) return;
    store.setItem(LIST_RETURN_STORAGE_KEY, JSON.stringify({ ...record, listUrl }));
  } catch {
    // ignore
  }
}
