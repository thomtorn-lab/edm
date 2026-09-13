import { NextRequest } from "next/server";
import { getEventBySlugWithVenue } from "@/lib/queries";
import { cleanEventTitle } from "@/lib/eventPresentation";
import { buildIcsFile } from "@/lib/ics";

const SITE_URL = "https://electroniccph.com";

// Real HTTP endpoint for the ICS download (mobile Apple Calendar fix,
// 2026-09-13): iOS Safari does not honor the `download` attribute on a
// `data:` URL anchor, so tapping "Apple Calendar / ICS" silently did
// nothing on iPhone even though the same link worked everywhere else.
// A same-origin route with a real Content-Disposition header downloads
// reliably on iOS. Same freshness stance as the event detail page (admin-
// editable events, no prebuilt/stale response).
export const revalidate = 0;

export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const event = await getEventBySlugWithVenue(slug);
  if (!event) {
    return new Response("Event not found", { status: 404 });
  }

  const ics = buildIcsFile({
    title: cleanEventTitle(event.title, event.venue.name),
    description: event.description,
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    venue: event.venue,
    eventUrl: `${SITE_URL}/events/${event.slug}`,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}.ics"`,
    },
  });
}
