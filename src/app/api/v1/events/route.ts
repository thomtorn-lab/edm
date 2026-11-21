import { getUpcomingPublishedEventsForList, type ListEvent } from "@/lib/queries";
import { isPastEvent } from "@/lib/datetime";
import { cleanEventTitle, formatArtistName, subVenueLabel } from "@/lib/eventPresentation";
import { getExternalLinks, showFreeCta } from "@/lib/links";
import { getEventStatuses } from "@/components/StatusBadge";
import { SITE_URL } from "@/lib/siteUrl";
import type { AppEvent, AppEventsResponse } from "@/lib/appEvents";

/**
 * Public, read-only event list for the mobile app (mobile/). Reads the same
 * published-and-upcoming projection as the homepage, so publishing,
 * unpublishing and edits reach the app exactly as they reach the site.
 * Never prerendered (same stance as the public pages); the CDN may reuse a
 * response for up to 60s, which keeps database egress flat however many
 * phones open the app.
 */
export const revalidate = 0;

function toAppEvent(event: ListEvent): AppEvent {
  return {
    id: event.id,
    slug: event.slug,
    url: `${SITE_URL}/events/${event.slug}`,
    title: cleanEventTitle(event.title, event.venue.name),
    subVenue: subVenueLabel(event.title, event.venue.name, event.subVenue),
    lineup: event.artists.map(formatArtistName),
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    venue: { id: event.venue.id, name: event.venue.name, address: event.venue.address },
    subgenres: event.subgenres,
    statuses: getEventStatuses(event).map((s) => s.label),
    links: getExternalLinks(event),
    free: showFreeCta(event),
  };
}

export async function GET() {
  const now = new Date();
  const events = (await getUpcomingPublishedEventsForList(now))
    .filter((event) => !isPastEvent(event, now))
    .sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
  const body: AppEventsResponse = { events: events.map(toAppEvent) };
  return Response.json(body, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
