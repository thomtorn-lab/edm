import { mainGenreOf, type GenreSlug, type MainGenreSlug } from "../taxonomy";

/**
 * Event<->subscriber genre matching (newsletter MVP, 2026-10-05). Mirrors
 * EventExplorer.tsx's own Genre filter predicate exactly
 * (`subgenres.some((s) => mainGenreOf(s) === genre)`), extended from a
 * single selected genre to a subscriber's multiple selected genres via
 * `.includes()` — an event matches if ANY of its (up to two, per the
 * max-two-genres-per-event model) subgenres maps to ANY of the
 * subscriber's selected MainGenreSlug groups. An empty selection means
 * "all events" (the subscription-model default, not a separate flag).
 */
export function eventMatchesGenres(eventSubgenres: GenreSlug[], selectedGenres: MainGenreSlug[]): boolean {
  if (selectedGenres.length === 0) return true;
  return eventSubgenres.some((slug) => selectedGenres.includes(mainGenreOf(slug)));
}
