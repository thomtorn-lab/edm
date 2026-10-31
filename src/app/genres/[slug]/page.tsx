import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedEventsWithVenue, getSoundcloudAvailabilityForEvents } from "@/lib/queries";
import { isPastEvent, sortByStart } from "@/lib/datetime";
import { INDEXABLE_GENRE_PAGES, genrePagePath, getGenre, indexableGenreForUrlSlug, matchesGenreSelection } from "@/lib/taxonomy";
import { GENRE_PAGE_CONTENT, genrePageIncludedLabels } from "@/lib/genrePages";
import EventRow from "@/components/EventRow";
import EmptyState from "@/components/EmptyState";

// Genre landing pages (SEO pilot 2026-10-09; shared route 2026-10-31). One
// route for every allowlisted genre (taxonomy.ts INDEXABLE_GENRE_PAGES):
// only those slugs are generated and dynamicParams = false turns every
// other /genres/* URL into a real 404 — no genre gets an indexable page
// automatically. Which events a page lists is decided by the exact same
// rule the homepage genre filter uses (matchesGenreSelection): a main genre
// lists itself and its subgenres (Techno includes Hard, Industrial,
// Hypnotic, Melodic and Minimal Techno — never the standalone Industrial
// genre). Copy lives in src/lib/genrePages.ts.

// Always read the current DB state, like every other DB-touching page.
export const revalidate = 0;
export const dynamicParams = false;

export function generateStaticParams() {
  return INDEXABLE_GENRE_PAGES.map((slug) => ({ slug: getGenre(slug).urlSlug }));
}

export async function generateMetadata({ params }: PageProps<"/genres/[slug]">): Promise<Metadata> {
  const genre = indexableGenreForUrlSlug((await params).slug);
  if (!genre) return {};
  const content = GENRE_PAGE_CONTENT[genre];
  const path = genrePagePath(genre)!;
  // A page-level openGraph replaces the layout's whole object, hence its
  // fields are repeated here (same pattern as the venue pages).
  const shareTitle = `${content.h1} — Electronic CPH`;
  return {
    // absolute: the SEO title already carries the brand, so the root
    // layout's "%s — Electronic CPH" template must not add it again.
    title: { absolute: content.seoTitle },
    description: content.description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Electronic CPH", locale: "en_GB", url: path, title: shareTitle, description: content.description },
    twitter: { card: "summary", title: shareTitle, description: content.description },
  };
}

export default async function GenrePage({ params }: PageProps<"/genres/[slug]">) {
  const genre = indexableGenreForUrlSlug((await params).slug);
  if (!genre) notFound();
  const content = GENRE_PAGE_CONTENT[genre];

  const now = new Date();
  const events = await getPublishedEventsWithVenue();
  const upcoming = sortByStart(events.filter((e) => !isPastEvent(e, now) && matchesGenreSelection(e.subgenres, genre)));
  const audioAvailability = await getSoundcloudAvailabilityForEvents(upcoming);
  const otherGenres = INDEXABLE_GENRE_PAGES.filter((slug) => slug !== genre);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="text-xs font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary">
        ← All events
      </Link>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-accent">Genre</p>
      <h1 className="font-display mt-1 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        {content.h1}
      </h1>
      <div className="mt-4 max-w-2xl space-y-3 text-sm leading-relaxed text-text-secondary">
        {content.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p>
          Upcoming events are listed in date order. The list includes every published event tagged{" "}
          {genrePageIncludedLabels(genre)}.
        </p>
      </div>

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Upcoming {content.eventsNoun}</h2>
      <div className="mt-2">
        {upcoming.length === 0 ? (
          <EmptyState title={`No upcoming ${content.eventsNoun} listed`} hint="New events are added continuously — check back soon." />
        ) : (
          <ul>
            {upcoming.map((event, i) => (
              <EventRow key={event.id} event={{ ...event, hasAudioLinks: audioAvailability[i] }} />
            ))}
          </ul>
        )}
      </div>

      {otherGenres.length > 0 && (
        <p className="mt-10 text-xs text-text-tertiary">
          More genres:{" "}
          {otherGenres.map((slug, i) => (
            <span key={slug}>
              {i > 0 && " · "}
              <Link href={genrePagePath(slug)!} className="hover:text-text-secondary">
                {GENRE_PAGE_CONTENT[slug].h1}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
