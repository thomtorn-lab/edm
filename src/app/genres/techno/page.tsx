import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedEventsWithVenue } from "@/lib/queries";
import { isPastEvent, sortByStart } from "@/lib/datetime";
import { GENRES, mainGenreOf, mainGenrePagePath, matchesMainGenre } from "@/lib/taxonomy";
import EventRow from "@/components/EventRow";
import EmptyState from "@/components/EmptyState";

// Genre landing page SEO pilot (2026-10-09): one static page for the Techno
// filter group only — no dynamic /genres/[slug] route until the pilot has
// proven itself. Which events count as Techno is decided by the exact same
// rule the homepage genre filter uses (matchesMainGenre), never a separate
// genre list.
const GENRE = "techno" as const;
const PATH = mainGenrePagePath(GENRE)!;

const TECHNO_PAGE_TITLE = "Techno Events in Copenhagen | Electronic CPH";
const TECHNO_PAGE_DESCRIPTION =
  "Upcoming techno events in Copenhagen: club nights and concerts tagged techno, industrial, melodic techno or minimal techno, listed by date.";

// Always read the current DB state, like every other DB-touching page.
export const revalidate = 0;

export const metadata: Metadata = {
  // absolute: the title already carries the brand, so the root layout's
  // "%s — Electronic CPH" template must not add it again.
  title: { absolute: TECHNO_PAGE_TITLE },
  description: TECHNO_PAGE_DESCRIPTION,
  alternates: { canonical: PATH },
};

/** "Techno, Melodic Techno, Minimal Techno or Industrial" — straight from the taxonomy, so the intro can't drift from the filter. */
function includedGenreLabels(): string {
  const labels = GENRES.filter((g) => mainGenreOf(g.slug) === GENRE).map((g) => g.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : labels.join("");
}

export default async function TechnoGenrePage() {
  const now = new Date();
  const events = await getPublishedEventsWithVenue();
  const upcoming = sortByStart(events.filter((e) => !isPastEvent(e, now) && matchesMainGenre(e.subgenres, GENRE)));

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
            {upcoming.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
