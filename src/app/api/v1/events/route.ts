import { getUpcomingPublishedEventsForList, type ListEvent } from "@/lib/queries";
import { isPastEvent } from "@/lib/datetime";
import { cleanEventTitle, formatArtistName, subVenueLabel } from "@/lib/eventPresentation";
import { getExternalLinks, showFreeCta } from "@/lib/links";
import { getEventStatuses } from "@/components/StatusBadge";
import { SITE_URL } from "@/lib/siteUrl";
import type { AppEvent, AppEventsResponse } from "@/lib/appEvents";

/**
 * Public, read-only event list for the iPhone app (PR #231, mobile/). Reads the same
 * published-and-upcoming projection as the homepage, so publishing,
 * unpublishing and edits reach the app exactly as they reach the site.
 * Never prerendered (same stance as the public pages).
 *
 * Caching, chosen so an unpublished event stops being served quickly:
 * - s-maxage=60: Vercel's CDN may reuse a response for at most 60 s, which
 *   keeps database egress flat however many phones open the app. No
 *   stale-while-revalidate, so an expired response is never served again.
 * - max-age=0: the phone itself never reuses a response without asking.
 * The app re-fetches whenever its copy is older than 60 s (PR #231).
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
    headers: { "Cache-Control": "public, max-age=0, s-maxage=60" },
  });
}
