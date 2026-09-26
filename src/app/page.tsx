import type { Metadata } from "next";
import { getArtistPreviewAvailabilityForLineups, getPublishedEventsWithVenue } from "@/lib/queries";
import EventExplorer from "@/components/EventExplorer";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Events are admin-editable now; always read the current DB state rather
// than serving a stale prerendered page after a publish/edit/hide.
export const revalidate = 0;

export default async function HomePage() {
  const events = await getPublishedEventsWithVenue();
  // Homepage VIDEO indicator (2026-09-26): ONE batched query for every
  // event's lineup combined (never per-event — see
  // getArtistPreviewAvailabilityForLineups's own doc comment), reusing the
  // exact same acceptance predicate the event-detail page relies on, so the
  // indicator only ever shows when that event's own detail page would
  // actually render an Artist Preview. No YouTube API call and no matcher
  // execution happen here — this only reads the existing cache table.
  const previewAvailability = await getArtistPreviewAvailabilityForLineups(events.map((e) => e.artists));
  const eventsWithPreview = events.map((event, i) => ({ ...event, hasArtistPreview: previewAvailability[i] }));
  // Computed here (server request time, same as /venues/[slug]) rather than
  // left for the client to fill in post-hydration — see EventExplorer's
  // `serverNow` prop doc comment for why.
  const serverNow = new Date().toISOString();

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6 sm:pt-8">
        <h1 className="font-display text-2xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-[2rem]">
          Electronic music in Copenhagen
        </h1>
        <p className="mt-1.5 max-w-xl text-sm text-text-secondary">
          Techno, house, trance, drum &amp; bass and more — a continuously updated,
          curated guide to electronic music in Copenhagen.
        </p>
      </div>
      <EventExplorer events={eventsWithPreview} serverNow={serverNow} />
    </div>
  );
}
