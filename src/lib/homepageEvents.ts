import { isPastEvent } from "./datetime";
import type { EventRecord, Venue } from "./types";

/**
 * Homepage event projection (performance work, 2026-10-10). The homepage
 * hands its whole event list to the client-side EventExplorer, so every
 * field on these objects is serialized into the page's RSC payload. It used
 * to send every published event — past ones included — with the full
 * EventRecord and Venue (admin/audit metadata, venue profiles, …), most of
 * which nothing on the page reads. These types name exactly what the page
 * does read; toHomepageEvent copies only those fields.
 */

/** What an event row (EventRow) and its helpers read: title/lineup, date/time, links, status badges, genres and the calendar button. */
export type EventRowFields = Pick<
  EventRecord,
  | "id"
  | "slug"
  | "title"
  | "description" // calendar button (Google/Outlook/ICS details) — kept whole, never truncated
  | "artists"
  | "startDatetime"
  | "endDatetime"
  | "subVenue"
  | "subgenres"
  | "officialEventUrl"
  | "ticketUrl"
  | "facebookUrl"
  | "residentAdvisorUrl"
  | "otherSourceUrls"
  | "canonicalSourceId" // link labelling (officialUrlRole)
  | "overriddenFields" // link labelling (officialUrlRole)
  | "priceFrom"
  | "soldOut"
  | "postponed"
  | "dateChanged"
>;

/** The venue fields an event row, the venue filter and search read: link, label, calendar location and search aliases. */
export type EventRowVenue = Pick<Venue, "id" | "slug" | "name" | "address" | "aliases">;

export interface EventRowEvent extends EventRowFields {
  venue: EventRowVenue;
  /** Set by the homepage only (VIDEO indicator) — see EventRow. */
  hasArtistPreview?: boolean;
}

/** An EventRow event plus what EventExplorer's search also reads. */
export interface HomepageEvent extends EventRowEvent {
  primaryGenre: EventRecord["primaryGenre"];
}

/** Copies exactly the HomepageEvent fields — nothing else from the full record reaches the client. */
export function toHomepageEvent(event: EventRecord & { venue: Venue }, hasArtistPreview: boolean): HomepageEvent {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    artists: event.artists,
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    subVenue: event.subVenue,
    primaryGenre: event.primaryGenre,
    subgenres: event.subgenres,
    officialEventUrl: event.officialEventUrl,
    ticketUrl: event.ticketUrl,
    facebookUrl: event.facebookUrl,
    residentAdvisorUrl: event.residentAdvisorUrl,
    otherSourceUrls: event.otherSourceUrls,
    canonicalSourceId: event.canonicalSourceId,
    overriddenFields: event.overriddenFields,
    priceFrom: event.priceFrom,
    soldOut: event.soldOut,
    postponed: event.postponed,
    dateChanged: event.dateChanged,
    venue: {
      id: event.venue.id,
      slug: event.venue.slug,
      name: event.venue.name,
      address: event.venue.address,
      aliases: event.venue.aliases,
    },
    hasArtistPreview,
  };
}

/**
 * The events the homepage lists: not yet over at `now`, by the same
 * isPastEvent rule (Europe/Copenhagen nightlife day, 06:00 cutoff for
 * events without a trustworthy end) that EventExplorer itself applies on
 * the client. Filtering here only stops already-past events from being
 * shipped; EventExplorer keeps re-applying the rule as its clock advances.
 */
export function upcomingForHomepage<T extends Pick<EventRecord, "startDatetime" | "endDatetime">>(events: T[], now: Date): T[] {
  return events.filter((event) => !isPastEvent(event, now));
}
