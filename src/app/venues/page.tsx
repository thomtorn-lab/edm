import type { Metadata } from "next";
import Link from "next/link";
import { getEventsForVenue, getVenues } from "@/lib/queries";
import { isPastEvent } from "@/lib/datetime";
import { CURATED_VENUE_SLUGS, getPublicVenueGroupPrimaryId, PUBLIC_VENUE_GROUPS, publicVenueLabel } from "@/lib/data/venues";
import type { Venue } from "@/lib/types";

export const metadata: Metadata = {
  title: "Venues",
  description: "A curated guide to Copenhagen's electronic music venues: Culture Box, Hangaren, Den Anden Side, RUST and more.",
  alternates: { canonical: "/venues" },
};

export const revalidate = 0;

export default async function VenuesPage() {
  const registryVenues = await getVenues();
  const bySlug = new Map(registryVenues.map((v) => [v.slug, v]));

  const now = new Date();
  const curated = await Promise.all(
    CURATED_VENUE_SLUGS.map(async (slug) => {
      const venue = bySlug.get(slug);
      // Grouped venues (VEGA overall-venue presentation, 2026-09-11):
      // aggregate the upcoming count across the primary plus every group
      // member (e.g. VEGA + Ideal Bar) — each id names a distinct set of
      // events, so summing never double-counts.
      const groupMemberIds = venue ? (PUBLIC_VENUE_GROUPS[venue.id] ?? []) : [];
      const upcomingCount = venue
        ? (
            await Promise.all([venue.id, ...groupMemberIds].map((id) => getEventsForVenue(id)))
          )
            .flat()
            .filter((e) => !isPastEvent(e, now)).length
        : null;
      return { slug, venue, upcomingCount };
    }),
  );

  // Every other venue page (sitemap/link hygiene, 2026-10-09): non-curated
  // venues still have real, indexable /venues/[slug] pages listed in the
  // sitemap, so they get a plain crawlable link here — below, and visually
  // secondary to, the curated cards, which stay exactly as they are. Grouped
  // members (e.g. Ideal Bar) are skipped: their URL redirects to the group's
  // primary page.
  const curatedSlugs = new Set(CURATED_VENUE_SLUGS);
  const otherVenues = registryVenues
    .filter((v) => !curatedSlugs.has(v.slug) && !getPublicVenueGroupPrimaryId(v.id))
    .sort((a, b) => publicVenueLabel(a).localeCompare(publicVenueLabel(b), "da"));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-accent sm:text-4xl">
        Venues
      </h1>
      <p className="mt-2 max-w-xl text-sm text-text-secondary">
        A curated guide to Copenhagen venues dedicated to electronic music or regularly hosting standalone
        electronic events.
      </p>
      <p className="mt-2 max-w-xl text-xs text-text-tertiary">
        This is a highlights list, not a full directory — electronic events on this site may appear at other
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

      {otherVenues.length > 0 && (
        <section className="mt-10" aria-labelledby="other-venues">
          <h2 id="other-venues" className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            Other venues
          </h2>
          <ul aria-labelledby="other-venues" className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-text-secondary">
            {otherVenues.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/venues/${v.slug}`}
                  className="underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
                >
                  {publicVenueLabel(v)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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
