import { EVENTS } from "./data/events";
import { VENUES } from "./data/venues";
import type { EventRecord, Venue } from "./types";

export interface EventWithVenue extends EventRecord {
  venue: Venue;
}

function attachVenues(events: EventRecord[]): EventWithVenue[] {
  const byId = new Map(VENUES.map((v) => [v.id, v]));
  return events.flatMap((event) => {
    const venue = byId.get(event.venueId);
    if (!venue) return []; // an event with no resolvable venue never reaches the public site
    return [{ ...event, venue }];
  });
}

/**
 * All published events with their venue attached. Past-event filtering and
 * Tonight/Weekend filtering both depend on "now", which is deliberately
 * computed client-side (the browser's own clock) rather than baked in here,
 * so correctness never depends on cache/revalidation timing.
 */
export function getPublishedEventsWithVenue(): EventWithVenue[] {
  return attachVenues(EVENTS.filter((e) => e.published));
}

export function getEventBySlugWithVenue(slug: string): EventWithVenue | undefined {
  const event = EVENTS.find((e) => e.slug === slug && e.published);
  if (!event) return undefined;
  return attachVenues([event])[0];
}

export function getEventsForVenue(venueId: string): EventWithVenue[] {
  return attachVenues(EVENTS.filter((e) => e.published && e.venueId === venueId));
}
