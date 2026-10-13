import { MAIN_GENRES, type MainGenreSlug } from "./taxonomy";

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
 * homepage, just without that one filter.
 */

export type ExplorerMode = "all" | "tonight" | "weekend" | "next-weekend";

export const EXPLORER_DATE_MODES = ["tonight", "weekend", "next-weekend"] as const;

/** Filter state as the URL carries it. `venueSlug` is resolved to a venue id by EventExplorer against the venues it actually lists. */
export interface ExplorerUrlFilters {
  mode: ExplorerMode;
  genre: MainGenreSlug | "all";
  venueSlug: string | null;
  query: string;
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
  const genre = MAIN_GENRES.some((g) => g.slug === rawGenre) ? (rawGenre as MainGenreSlug) : "all";

  const rawVenue = params.get(KEYS.venue)?.trim() ?? "";
  const venueSlug = /^[a-z0-9-]{1,100}$/.test(rawVenue) ? rawVenue : null;

  const query = (params.get(KEYS.query) ?? "").slice(0, MAX_QUERY_LENGTH);

  return { mode, genre, venueSlug, query };
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
  if (filters.genre !== "all") params.set(KEYS.genre, filters.genre);
  if (filters.venueSlug) params.set(KEYS.venue, filters.venueSlug);
  if (filters.query.trim() !== "") params.set(KEYS.query, filters.query);
  return params.toString();
}

/**
 * "← All events" return target (see BackToEventsLink): when a visitor opens
 * an event from the homepage list, the list records which event was opened
 * and the list URL it was opened from, in sessionStorage (per tab, gone when
 * the tab closes). The event page only uses that URL when it is the SAME
 * event the visitor opened from the list — a direct visit, a new tab, or a
 * different event reached some other way always gets the plain "/".
 */
export const LIST_RETURN_STORAGE_KEY = "ecph:list-return";

export interface ListReturn {
  eventPath: string;
  listUrl: string;
}

/** Only ever a same-site homepage URL ("/" or "/?…") — anything else stored under the key is ignored. */
export function isSafeListUrl(url: unknown): url is string {
  return typeof url === "string" && (url === "/" || url.startsWith("/?")) && url.length <= 1000;
}

export function readListReturn(raw: string | null, eventPath: string): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ListReturn>;
    if (parsed.eventPath !== eventPath || !isSafeListUrl(parsed.listUrl)) return null;
    return parsed.listUrl;
  } catch {
    return null;
  }
}
