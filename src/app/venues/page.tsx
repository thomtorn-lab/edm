import type { Metadata } from "next";
import Link from "next/link";
import { VENUES } from "@/lib/data/venues";
import { getEventsForVenue } from "@/lib/queries";
import { isPastEvent } from "@/lib/datetime";

export const metadata: Metadata = {
  title: "Venues",
  description: "Copenhagen and Frederiksberg venues that regularly host electronic music: Culture Box, Hangaren, Den Anden Side, Gravity and more.",
  alternates: { canonical: "/venues" },
};

export default function VenuesPage() {
  const venues = [...VENUES].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Venues
      </h1>
      <p className="mt-2 max-w-xl text-sm text-text-secondary">
        Copenhagen and Frederiksberg rooms that regularly host electronic music, from intimate bars to warehouse-scale halls.
      </p>

      <ul className="mt-8">
        {venues.map((venue) => {
          const now = new Date();
          const upcomingCount = getEventsForVenue(venue.id).filter((e) => !isPastEvent(e, now)).length;
          return (
            <li key={venue.id} className="border-b border-border py-5">
              <Link href={`/venues/${venue.slug}`} className="text-lg font-semibold text-text-primary hover:text-accent-strong">
                {venue.name}
              </Link>
              <p className="mt-1 text-sm text-text-secondary">{venue.address}</p>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{venue.description}</p>
              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {upcomingCount} upcoming event{upcomingCount === 1 ? "" : "s"}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
