import type { Metadata } from "next";
import Link from "next/link";
import { getUpcomingEventCountsByVenue, getVenuesBySlugs } from "@/lib/queries";
import { CURATED_VENUE_SLUGS, PUBLIC_VENUE_GROUPS, publicVenueLabel } from "@/lib/data/venues";
import type { Venue } from "@/lib/types";

export const metadata: Metadata = {
  title: "Venues",
  description: "A curated guide to Copenhagen venues where electronic music is the main focus: Culture Box, Hangaren, Den Anden Side, MODULE and more.",
  alternates: { canonical: "/venues" },
};

export const revalidate = 0;

export default async function VenuesPage() {
  // Supabase egress work (2026-11-01): only the curated venues' rows, and
  // one narrow query for every upcoming count, instead of the whole venues
  // table plus a full events + venue read per listed venue.
  const registryVenues = await getVenuesBySlugs(CURATED_VENUE_SLUGS);
  const bySlug = new Map(registryVenues.map((v) => [v.slug, v]));

  // Grouped venues (VEGA overall-venue presentation, 2026-09-11):
  // aggregate the upcoming count across the primary plus every group
  // member (e.g. VEGA + Ideal Bar) — each id names a distinct set of
  // events, so summing never double-counts.
  const venueIdsFor = (venue: Venue) => [venue.id, ...(PUBLIC_VENUE_GROUPS[venue.id] ?? [])];
  const now = new Date();
  const counts = await getUpcomingEventCountsByVenue(registryVenues.flatMap(venueIdsFor), now);
  const curated = CURATED_VENUE_SLUGS.map((slug) => {
    const venue = bySlug.get(slug);
    const upcomingCount = venue ? venueIdsFor(venue).reduce((sum, id) => sum + (counts.get(id) ?? 0), 0) : null;
    return { slug, venue, upcomingCount };
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-accent sm:text-4xl">
        Venues
      </h1>
      <p className="mt-2 max-w-xl text-sm text-text-secondary">
        A curated guide to Copenhagen venues where electronic music is the main focus.
      </p>
      <p className="mt-2 max-w-xl text-xs text-text-tertiary">
        This is a highlights list, not a full directory - electronic events on this site may appear at other
        Copenhagen venues too.
      </p>

      <ul className="mt-8">
        {curated.map(({ slug, venue, upcomingCount }) =>
          venue ? (
            <li key={slug} className="border-b border-border py-5">
              <VenueEntry venue={venue} upcomingCount={upcomingCount} />
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

function VenueEntry({ venue, upcomingCount }: { venue: Venue; upcomingCount: number | null }) {
  return (
    <>
      <Link
        href={`/venues/${venue.slug}`}
        className="inline-flex cursor-pointer items-baseline gap-1.5 text-lg font-semibold text-text-primary transition-[filter] duration-150 hover:brightness-110 focus-visible:brightness-110"
      >
        {publicVenueLabel(venue)}
        <span aria-hidden="true" className="text-sm text-text-tertiary">→</span>
      </Link>
      <p className="mt-1 text-sm text-text-secondary">{venue.address}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        {venue.shortDescription ?? venue.description}
      </p>
      {/* A zero count is omitted rather than shown: it can just as easily mean
          Electronic CPH hasn't yet integrated or completed coverage for this
          venue as it can mean the venue genuinely has nothing upcoming, and
          only a positive count is evidence either way. */}
      {upcomingCount !== null && upcomingCount > 0 && (
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {upcomingCount} upcoming event{upcomingCount === 1 ? "" : "s"}
        </p>
      )}
    </>
  );
}
