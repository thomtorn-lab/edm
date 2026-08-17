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

/**
 * Editorial copy for the curated venues that aren't yet in the venue
 * registry (so there's no DB-backed description to fall back on). Grounded
 * in each venue's own site / Resident Advisor listing / established venue
 * directories — see the follow-up report for sources. Deliberately avoids
 * precise capacity, hours or genre-exclusivity claims that aren't clearly
 * and reliably sourced.
 */
const CURATED_VENUE_INFO: Record<string, string> = {
  module:
    "A basement club in central Copenhagen built specifically for house, techno and industrial sound, with a strict no-photo policy that keeps the focus on the music — one of the newer names driving the city's underground circuit.",
  baggen:
    "A bar, club and gallery in the Meatpacking District running house, techno and disco nights in a low-lit, industrial room — a reliably electronic-leaning stop in one of Copenhagen's densest nightlife pockets.",
  "klub werkstatt":
    "A bar and club on Refshaleøen built inside a former engine workshop, known for backing emerging local DJ talent alongside touring names across techno and electronic music.",
  basement:
    "An unassuming, music-first room favoured by techno purists for its raw, unpolished setting — one of the more deliberately low-key rooms on the city's underground circuit.",
  pumpehuset:
    "A former 19th-century pump station near City Hall that doubles as a concert hall and, on weekends, a late-night club — its programming crosses genres but regularly makes room for electronic nights.",
  poolen:
    "A large warehouse venue on Refshaleøen inside a former B&W industrial hall, built with a serious sound and lighting rig by the team behind Pumpehuset — increasingly a home for bigger electronic line-ups.",
  rust:
    "A three-floor bar, concert stage and club in Nørrebro running since 1989 — one of Copenhagen's longest-standing nightlife institutions, with weekend club floors moving through techno, house and electro.",
  h15:
    "A restored 1950s warehouse in the Meatpacking District turned bar, café and multi-use venue, mixing club nights with concerts, art and film under a community-first ethos.",
  bolsjefabrikken:
    "A self-run, non-commercial culture house in an old candy factory, hosting underground concerts and electronic parties alongside workshops and community events — DIY in spirit and pricing.",
  "odds and ends":
    "An industrial-scale event space in the developing Nordhavn district, with a large flexible hall and outdoor festival area increasingly used for club nights and bigger electronic line-ups.",
  mayhem:
    "A hard-to-find, artist-run underground venue known for scrappy, experimental programming spanning noise, techno and ambient — a genuine DIY fixture rather than a polished club.",
  tap1:
    "A large former Carlsberg-district distillery turned event hall, hosting big-room electronic line-ups and touring international DJs alongside its wider concert and festival programming.",
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
      return { name, venue, upcomingCount, fallbackInfo: CURATED_VENUE_INFO[key] };
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
        {curated.map(({ name, venue, upcomingCount, fallbackInfo }) => (
          <li key={name} className="border-b border-border py-5">
            <VenueEntry name={name} venue={venue} upcomingCount={upcomingCount} fallbackInfo={fallbackInfo} />
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
  fallbackInfo,
}: {
  name: string;
  venue: Venue | undefined;
  upcomingCount: number | null;
  fallbackInfo: string | undefined;
}) {
  if (!venue) {
    return (
      <>
        <p className="text-lg font-semibold text-text-primary">{name}</p>
        {fallbackInfo && (
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{fallbackInfo}</p>
        )}
      </>
    );
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
