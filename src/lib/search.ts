import type { EventRecord, Venue } from "./types";
import { getGenre, withDerivedParents } from "./taxonomy";

/**
 * Free-text search over title, artists, lineup, venue and genre (spec
 * section 5). Genre text covers the event's own tags plus their derived
 * parent genres (taxonomy.ts withDerivedParents), so "drum & bass" also
 * finds a Jungle event — the same hierarchy the genre filter uses. A
 * standalone genre gets no parent: "techno" never matches an
 * Industrial-only event.
 */
export function eventMatchesQuery(
  event: Pick<EventRecord, "title" | "artists" | "subgenres" | "primaryGenre">,
  venue: Pick<Venue, "name" | "aliases"> | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    event.title,
    ...event.artists,
    venue?.name ?? "",
    ...(venue?.aliases ?? []),
    ...withDerivedParents([event.primaryGenre, ...event.subgenres]).map((g) => getGenre(g).label),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}
