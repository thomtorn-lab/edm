import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getEventsForVenue, getVenueById, getVenueBySlug } from "@/lib/queries";
import { isPastEvent, sortByStart } from "@/lib/datetime";
import { getPublicVenueGroupPrimaryId, PUBLIC_VENUE_GROUPS, publicVenueLabel } from "@/lib/data/venues";
import { buildVenueSeoDescription, buildVenueSeoTitle } from "@/lib/seoMetadata";
import EventRow from "@/components/EventRow";
import EmptyState from "@/components/EmptyState";
import VenueAddressLink from "@/components/VenueAddressLink";

export const revalidate = 0;

export async function generateMetadata({ params }: PageProps<"/venues/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug);
  if (!venue) return {};
  // A grouped member (e.g. Ideal Bar) hard-redirects below rather than
  // rendering — its own metadata is never served, so no canonical/title
  // needs computing for it here.
  if (getPublicVenueGroupPrimaryId(venue.id)) return {};
  const label = publicVenueLabel(venue);
  const seoInput = { label, address: venue.address, description: venue.description, shortDescription: venue.shortDescription };
  // Open Graph/Twitter previously inherited the page title/description;
  // pinned to those same values so the SEO work package (2026-10-06) stays
  // scoped to the HTML <title> and meta description. A page-level openGraph
  // replaces the layout's whole object, hence its fields are repeated here.
  const shareTitle = `${label} — Electronic CPH`;
  const shareDescription = `${label}, ${venue.address} — upcoming electronic music events. ${venue.shortDescription ?? venue.description}`;
  return {
    // absolute: the SEO title already ends in "| Electronic CPH", so the
    // root layout's "%s — Electronic CPH" template must not add it again.
    title: { absolute: buildVenueSeoTitle(seoInput) },
    description: buildVenueSeoDescription(seoInput),
    alternates: { canonical: `/venues/${venue.slug}` },
    openGraph: { type: "website", siteName: "Electronic CPH", locale: "en_GB", title: shareTitle, description: shareDescription },
    twitter: { card: "summary", title: shareTitle, description: shareDescription },
  };
}

export default async function VenueDetailPage({ params }: PageProps<"/venues/[slug]">) {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug);
  if (!venue) notFound();

  // VEGA overall-venue presentation (2026-09-11): a grouped member's own
  // URL (e.g. /venues/vega-ideal-bar) is never an indexable page of its
  // own — it permanently redirects to its group's primary URL, so there is
  // exactly one public page for the VEGA identity (Section 5: avoid
  // duplicate indexable venue pages, preserve a redirect rather than a
  // broken URL).
  const groupPrimaryId = getPublicVenueGroupPrimaryId(venue.id);
  if (groupPrimaryId) {
    const primary = await getVenueById(groupPrimaryId);
    if (primary) {
      permanentRedirect(`/venues/${primary.slug}`);
      return;
    }
  }

  const label = publicVenueLabel(venue);
  // A primary group venue's page (e.g. VEGA) aggregates upcoming events
  // across itself and every grouped member (e.g. Ideal Bar) — each id names
  // a distinct set of events, so concatenating never double-counts.
  const groupMemberIds = PUBLIC_VENUE_GROUPS[venue.id] ?? [];
  const now = new Date();
  const rawEvents = (await Promise.all([venue.id, ...groupMemberIds].map((id) => getEventsForVenue(id)))).flat();
  const upcoming = sortByStart(rawEvents.filter((e) => !isPastEvent(e, now)));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/venues" className="text-xs font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary">
        ← All venues
      </Link>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-accent">Venue</p>
      <h1 className="font-display mt-1 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        {label}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        <VenueAddressLink address={venue.address} />
      </p>
      {(venue.venueProfile || venue.description) && (
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-text-secondary">
          {venue.venueProfile || venue.description}
        </p>
      )}

      {venue.websiteUrl && (
        <a
          href={venue.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded border border-border-strong px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary"
        >
          Official website ↗<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Upcoming at {label}
      </h2>
      <div className="mt-2">
        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming events listed" hint="Check the official website for the latest programme." />
        ) : (
          <ul>
            {upcoming.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
