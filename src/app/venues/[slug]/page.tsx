import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventsForVenue, getVenueBySlug } from "@/lib/queries";
import { isPastEvent, sortByStart } from "@/lib/datetime";
import EventRow from "@/components/EventRow";
import EmptyState from "@/components/EmptyState";

export const revalidate = 0;

export async function generateMetadata({ params }: PageProps<"/venues/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug);
  if (!venue) return {};
  return {
    title: venue.name,
    description: `${venue.name}, ${venue.address} — upcoming electronic music events. ${venue.shortDescription ?? venue.description}`,
    alternates: { canonical: `/venues/${venue.slug}` },
  };
}

export default async function VenueDetailPage({ params }: PageProps<"/venues/[slug]">) {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug);
  if (!venue) notFound();

  const now = new Date();
  const upcoming = sortByStart((await getEventsForVenue(venue.id)).filter((e) => !isPastEvent(e, now)));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/venues" className="text-xs font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary">
        ← All venues
      </Link>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-accent">Venue</p>
      <h1 className="font-display mt-1 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        {venue.name}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">{venue.address}</p>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-text-secondary">
        {venue.venueProfile ?? venue.description}
      </p>

      {venue.websiteUrl && (
        <a
          href={venue.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded border border-border-strong px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary"
        >
          Official website ↗
        </a>
      )}

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Upcoming at {venue.name}
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
