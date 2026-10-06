import type { EventWithVenue } from "../queries";
import { isPastEvent, sortByStart } from "../datetime";
import { eventMatchesGenres } from "./genreMatching";
import type { GenreSlug, MainGenreSlug } from "../taxonomy";

export const NEWSLETTER_WINDOW_DAYS = 7;
export const NEWSLETTER_MAX_EVENTS = 20;

/**
 * The window of events eligible for ANY subscriber's newsletter this week
 * — computed ONCE per send run and reused across every subscriber (never
 * per-subscriber), matching this codebase's established "one batched
 * computation, never N+1" convention (e.g.
 * getArtistPreviewAvailabilityForLineups's own doc comment).
 *
 * Callers pass already-published events (getPublishedEventsWithVenue) — a
 * cancelled event is unpublished entirely by the existing admin/
 * source-cancellation flows, so no separate `cancelled` check is needed
 * here. `postponed` is excluded outright: its real date is unknown, so it
 * can't meaningfully sit in a dated, chronologically-ordered list — it
 * reappears automatically once rescheduled into a future window.
 * `isPastEvent` (the existing nightlife-aware freshness predicate) excludes
 * anything already effectively over. Sold-out events are INCLUDED — still
 * a real, relevant event; see emailContent.ts for how it's marked.
 */
export function selectUpcomingEventsForNewsletter(
  events: EventWithVenue[],
  now: Date,
  windowDays: number = NEWSLETTER_WINDOW_DAYS,
): EventWithVenue[] {
  const windowEnd = new Date(now.getTime() + windowDays * 86_400_000);
  const inWindow = events.filter((e) => {
    if (e.postponed) return false;
    const start = new Date(e.startDatetime);
    if (start < now || start >= windowEnd) return false;
    if (isPastEvent(e, now)) return false;
    return true;
  });
  return sortByStart(inWindow);
}

/**
 * This subscriber's own list for the week: genre-filtered, deduped by id
 * (defensive — `windowEvents` already comes from one distinct-by-id query,
 * but an explicit dedupe here directly satisfies "never duplicate events"
 * at the one place that builds a subscriber-facing list, the same way
 * displayGenres() defensively dedupes genres even though its own callers
 * already guarantee uniqueness), capped at `max`, in the window's existing
 * chronological order.
 */
export function selectEventsForSubscriber(
  windowEvents: EventWithVenue[],
  selectedGenres: MainGenreSlug[],
  max: number = NEWSLETTER_MAX_EVENTS,
): EventWithVenue[] {
  const seen = new Set<string>();
  const result: EventWithVenue[] = [];
  for (const event of windowEvents) {
    if (result.length >= max) break;
    if (seen.has(event.id)) continue;
    if (!eventMatchesGenres(event.subgenres as GenreSlug[], selectedGenres)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}
