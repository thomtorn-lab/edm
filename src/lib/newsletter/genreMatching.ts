import { matchesGenreSelection, type GenreFilterValue, type GenreSlug } from "../taxonomy";

/**
 * Event<->subscriber genre matching (newsletter MVP, 2026-10-05; genre
 * system revision 2026-10-24). Uses the site-wide genre rule
 * (matchesGenreSelection — the same one the homepage filter uses): an
 * event matches if it matches ANY of the subscriber's selected genres,
 * where a main genre includes its subgenres and a legacy set keeps its
 * original meaning. An empty selection means "all events" (the
 * subscription-model default, not a separate flag).
 */
export function eventMatchesGenres(eventSubgenres: GenreSlug[], selectedGenres: GenreFilterValue[]): boolean {
  if (selectedGenres.length === 0) return true;
  return selectedGenres.some((selection) => matchesGenreSelection(eventSubgenres, selection));
}
