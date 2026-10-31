import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedEventsWithVenue, getSoundcloudAvailabilityForEvents } from "@/lib/queries";
import { isPastEvent, sortByStart } from "@/lib/datetime";
import { genrePagePath, getGenre, matchesGenreSelection, subgenresOf } from "@/lib/taxonomy";
import EventRow from "@/components/EventRow";
import EmptyState from "@/components/EmptyState";

// Genre landing page SEO pilot (2026-10-09): one static page for Techno
// only — no dynamic /genres/[slug] route until a new page is approved.
// Which events count as Techno is decided by the exact same rule the
// homepage genre filter uses (matchesGenreSelection): Techno is a main
// genre, so the page lists events tagged Techno or any techno subgenre
// (Hard, Industrial, Hypnotic, Melodic, Minimal Techno) — never the
// standalone Industrial genre.
const GENRE = "techno" as const;
const PATH = genrePagePath(GENRE)!;

const TECHNO_PAGE_TITLE = "Techno Events in Copenhagen | Electronic CPH";
const TECHNO_PAGE_DESCRIPTION =
  "Upcoming techno events in Copenhagen: club nights and concerts tagged techno or a techno subgenre, listed by date.";

// Always read the current DB state, like every other DB-touching page.
export const revalidate = 0;

export const metadata: Metadata = {
  // absolute: the title already carries the brand, so the root layout's
  // "%s — Electronic CPH" template must not add it again.
  title: { absolute: TECHNO_PAGE_TITLE },
  description: TECHNO_PAGE_DESCRIPTION,
  alternates: { canonical: PATH },
};

/** "Techno, Hard Techno, …, or Minimal Techno" — straight from the taxonomy, so the intro can't drift from the filter. */
function includedGenreLabels(): string {
  const labels = [GENRE, ...subgenresOf(GENRE)].map((slug) => getGenre(slug).label);
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

export default async function TechnoGenrePage() {
  const now = new Date();
  const events = await getPublishedEventsWithVenue();
  const upcoming = sortByStart(events.filter((e) => !isPastEvent(e, now) && matchesGenreSelection(e.subgenres, GENRE)));
  const audioAvailability = await getSoundcloudAvailabilityForEvents(upcoming);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="text-xs font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary">
        ← All events
      </Link>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-accent">Genre</p>
      <h1 className="font-display mt-1 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Techno Events in Copenhagen
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-text-secondary">
        Upcoming techno nights at Copenhagen clubs and venues, in date order. The list includes every published
        event tagged {includedGenreLabels()}.
      </p>

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Upcoming techno events</h2>
      <div className="mt-2">
        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming techno events listed" hint="New events are added continuously — check back soon." />
        ) : (
          <ul>
            {upcoming.map((event, i) => (
              <EventRow key={event.id} event={{ ...event, hasAudioLinks: audioAvailability[i] }} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
