import type { Metadata } from "next";
import {
  getPreviewAvailabilityForEvents,
  getPublishedEventsWithVenue,
  getSoundcloudAvailabilityForEvents,
} from "@/lib/queries";
import { toHomepageEvent, upcomingForHomepage } from "@/lib/homepageEvents";
import EventExplorer from "@/components/EventExplorer";
import NewsletterSignupForm from "@/components/NewsletterSignupForm";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Events are admin-editable now; always read the current DB state rather
// than serving a stale prerendered page after a publish/edit/hide.
export const revalidate = 0;

export default async function HomePage() {
  // Computed here (server request time, same as /venues/[slug]) rather than
  // left for the client to fill in post-hydration — see EventExplorer's
  // `serverNow` prop doc comment for why. The same instant decides which
  // events are still upcoming below, so the server never ships an event
  // EventExplorer's own isPastEvent check would immediately drop.
  const now = new Date();
  const serverNow = now.toISOString();
  // Only upcoming events, as the minimal HomepageEvent projection
  // (performance work, 2026-10-10): past events and fields nothing on the
  // page reads used to make up most of this page's HTML/RSC payload.
  const events = upcomingForHomepage(await getPublishedEventsWithVenue(), now);
  // Homepage VIDEO indicator (2026-09-26): batched reads for every event
  // combined (never per-event — see getPreviewAvailabilityForEvents), using
  // the exact same rule as the event-detail page (getEventYoutubePreview:
  // per-event admin override first, then the automated artist match), so the
  // indicator only ever shows when that event's own detail page would
  // actually render a video. No YouTube API call and no matcher
  // execution happen here — this only reads the existing cache table.
  // AUDIO indicator: the same kind of single batched read, for the
  // venue-provided SoundCloud links (see getSoundcloudAvailabilityForEvents).
  const [previewAvailability, audioAvailability] = await Promise.all([
    getPreviewAvailabilityForEvents(events),
    getSoundcloudAvailabilityForEvents(events),
  ]);
  const homepageEvents = events.map((event, i) => toHomepageEvent(event, previewAvailability[i], audioAvailability[i]));

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
        {/* Newsletter signup (2026-10-05) — placed here, above
            EventExplorer's own sticky filter bar, deliberately: it costs
            one compact row of initial scroll height and then scrolls away
            like any other page content once browsing starts, rather than
            sitting inside/below the sticky bar where it would cost that
            space on every scroll position. Feature-flagged off by default
            (isNewsletterEnabled) until launch is approved — see
            src/lib/newsletter/featureFlag.ts. */}
        {isNewsletterEnabled() && (
          <div className="mt-4">
            <NewsletterSignupForm />
          </div>
        )}
      </div>
      <EventExplorer events={homepageEvents} serverNow={serverNow} />
    </div>
  );
}
