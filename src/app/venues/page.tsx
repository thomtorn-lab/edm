import type { Metadata } from "next";
import Link from "next/link";
import { getEventsForVenue, getVenues } from "@/lib/queries";
import { isPastEvent } from "@/lib/datetime";
import type { Venue } from "@/lib/types";

export const metadata: Metadata = {
  title: "Venues",
  description: "A curated guide to Copenhagen's electronic music venues: Culture Box, Hangaren, Den Anden Side, RUST and more.",
  alternates: { canonical: "/venues" },
};

export const revalidate = 0;

/**
 * A fixed editorial list, not a database query — see the product-rule note
 * rendered below. Keep in the exact order/spelling given; do not extend
 * without explicit approval. Matching aliases handle registry venues whose
 * DB name differs slightly (e.g. "Jolene" here vs. "Jolene Bar" in the
 * registry) so real entries link through without renaming DB data.
 */
const CURATED_VENUE_NAMES = [
  "Culture Box",
  "Hangaren",
  "Den Anden Side",
  "MODULE",
  "Jolene",
  "Baggen",
  "Klub Werkstatt",
  "Basement",
  "Pumpehuset",
  "Poolen",
  "RUST",
  "H15",
  "Bolsjefabrikken",
  "Odds and Ends",
  "Mayhem",
  "TAP1",
] as const;

const REGISTRY_NAME_ALIASES: Record<string, string> = {
  jolene: "jolene bar",
};

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export default async function VenuesPage() {
  const registryVenues = await getVenues();
  const byNormalizedName = new Map(registryVenues.map((v) => [normalize(v.name), v]));

  const now = new Date();
  const curated = await Promise.all(
    CURATED_VENUE_NAMES.map(async (name) => {
      const key = normalize(name);
      const venue = byNormalizedName.get(REGISTRY_NAME_ALIASES[key] ?? key);
      const upcomingCount = venue
        ? (await getEventsForVenue(venue.id)).filter((e) => !isPastEvent(e, now)).length
        : null;
      return { name, venue, upcomingCount };
    }),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Venues
      </h1>
      <p className="mt-2 max-w-xl text-sm text-text-secondary">
        A curated guide to Copenhagen rooms that regularly host electronic music, from intimate bars to
        warehouse-scale halls.
      </p>
      <p className="mt-2 max-w-xl text-xs text-text-tertiary">
        This is a highlights list, not a full directory — electronic events on this site may appear at other
        Copenhagen venues too.
      </p>

      <ul className="mt-8">
        {curated.map(({ name, venue, upcomingCount }) => (
          <li key={name} className="border-b border-border py-5">
            <VenueEntry name={name} venue={venue} upcomingCount={upcomingCount} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function VenueEntry({
  name,
  venue,
  upcomingCount,
}: {
  name: string;
  venue: Venue | undefined;
  upcomingCount: number | null;
}) {
  if (!venue) {
    return <p className="text-lg font-semibold text-text-primary">{name}</p>;
  }

  return (
    <>
      <Link href={`/venues/${venue.slug}`} className="text-lg font-semibold text-text-primary hover:text-accent-strong">
        {name}
      </Link>
      <p className="mt-1 text-sm text-text-secondary">{venue.address}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{venue.description}</p>
      {upcomingCount !== null && (
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {upcomingCount} upcoming event{upcomingCount === 1 ? "" : "s"}
        </p>
      )}
    </>
  );
}
