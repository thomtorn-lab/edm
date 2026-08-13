import type { EventRecord, Venue } from "./types";
import { getGenre } from "./taxonomy";

/** Free-text search over title, artists, lineup, venue and subgenre (spec section 5). */
export function eventMatchesQuery(event: EventRecord, venue: Venue | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    event.title,
    ...event.artists,
    venue?.name ?? "",
    ...(venue?.aliases ?? []),
    ...event.subgenres.map((g) => getGenre(g).label),
    getGenre(event.primaryGenre).label,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}
