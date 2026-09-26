import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArtistYoutubePreviewForLineup, getEventBySlugWithVenue, getSourceEventLinksForEvent } from "@/lib/queries";
import { formatFullDateLabel, formatFullDateRangeLabel, formatTimeLabel } from "@/lib/format";
import { displayGenres } from "@/lib/taxonomy";
import { getExternalLinks, getSourceProvenance } from "@/lib/links";
import { cleanEventTitle, shouldShowArtistPreview, subVenueLabel } from "@/lib/eventPresentation";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/ics";
import { buildEventJsonLd } from "@/lib/jsonld";
import StatusBadge, { getEventStatuses } from "@/components/StatusBadge";
import VenueAddressLink from "@/components/VenueAddressLink";
import ShareButton from "@/components/ShareButton";
import ArtistVideoPreview from "@/components/ArtistVideoPreview";

// Events are admin-editable now (publish/hide/correct/cancel); render fresh
// on every request rather than risk serving a stale prebuilt page.
export const revalidate = 0;

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlugWithVenue(slug);
  if (!event) return {};

  const title = cleanEventTitle(event.title, event.venue.name);
  const genres = displayGenres(event.subgenres).map((g) => g.label).join(" · ");
  const description = `${title}${event.artists.length ? `: ${event.artists.join(", ")}` : ""} — ${genres} at ${event.venue.name}, ${event.venue.city}, on ${formatFullDateLabel(event.startDatetime)}.`;

  return {
    title,
    description,
    alternates: { canonical: `/events/${event.slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      images: event.imageUrl ? [event.imageUrl] : undefined,
    },
  };
}

export default async function EventDetailPage({ params }: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const event = await getEventBySlugWithVenue(slug);
  if (!event) notFound();

  const genres = displayGenres(event.subgenres);
  const links = getExternalLinks(event);
  // Primary/secondary CTA hierarchy (event-detail CTA hierarchy work,
  // 2026-09-26): computed independently of getExternalLinks's own `primary`
  // flag, which is NOT the same thing — it always marks "Official event" as
  // primary when present, even alongside a Tickets link. Product rule here
  // is the opposite: a verified Tickets destination always outranks Official
  // event. Never modifies links.ts itself — this is a purely additive,
  // presentation-only re-ranking of its unchanged output.
  const primaryLink = links.find((l) => l.label === "Tickets") ?? links.find((l) => l.label === "Official event") ?? links[0] ?? null;
  const secondaryLinks = primaryLink ? links.filter((l) => l !== primaryLink) : [];
  const sourceLinks = await getSourceEventLinksForEvent(event.id);
  const sourceProvenance = getSourceProvenance(sourceLinks);
  const statuses = getEventStatuses(event);
  const title = cleanEventTitle(event.title, event.venue.name);
  const subVenue = subVenueLabel(event.title, event.venue.name, event.subVenue);
  const showArtistPreview = shouldShowArtistPreview(title, event.artists);
  const artistVideoPreview = await getArtistYoutubePreviewForLineup(event.artists);
  const canonicalUrl = `https://electroniccph.com/events/${event.slug}`;
  const jsonLd = buildEventJsonLd({ ...event, title }, canonicalUrl);

  const calendarInput = {
    title,
    description: event.description,
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    venue: event.venue,
    eventUrl: canonicalUrl,
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link href="/" className="text-xs font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary">
        ← All events
      </Link>

      {statuses.length > 0 && (
        <div className="mt-4 flex gap-2">
          {statuses.map((s) => (
            <StatusBadge key={s.label} {...s} />
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-accent">Event</p>
      <h1 className="font-display mt-1 text-3xl font-extrabold uppercase leading-[1.05] tracking-tight text-text-primary sm:text-5xl">
        {title}
      </h1>

      {showArtistPreview && (
        <p className="mt-3 text-lg text-text-secondary">{event.artists.join(" / ")}</p>
      )}

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-y border-border py-6 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Date &amp; time</dt>
          <dd className="mt-1 text-sm text-text-primary">
            {formatFullDateRangeLabel(event)}
            <br />
            {formatTimeLabel(event.startDatetime)}
            {event.endDatetime && (
              <>
                {" – "}
                {formatTimeLabel(event.endDatetime)}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Venue</dt>
          <dd className="mt-1 text-sm text-text-primary">
            <Link
              href={`/venues/${event.venue.slug}`}
              className="underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
            >
              {event.venue.name}
            </Link>
            {subVenue && <span className="text-text-secondary"> · {subVenue}</span>}
            <br />
            <VenueAddressLink address={event.venue.address} className="text-text-secondary" />
          </dd>
        </div>
        {genres.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Genre</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {genres.map((g) => (
                <span key={g.slug} className="rounded-[3px] border border-border-strong px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
                  {g.label}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      {/* Primary + secondary outbound event actions (event-detail CTA
          hierarchy work, 2026-09-26) — placed immediately after the core
          event facts, ahead of About/Artist Preview, since these are the
          user's primary task on this page. Tickets outranks Official event
          when both exist (primaryLink/secondaryLinks above); never renders a
          button for a link that doesn't exist. Primary gets a filled accent
          treatment, secondary an outline treatment — visibly subordinate,
          neither oversized. min-h-[2.75rem] (44px, matching the same mobile
          tap-target convention already used elsewhere — see
          EventExplorer.tsx's own filter-apply button) and text-base hold on
          mobile; both relax to the previous compact desktop sizing at sm:. */}
      {primaryLink && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={primaryLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[2.75rem] items-center justify-center rounded bg-accent px-5 text-base font-semibold uppercase tracking-wide text-accent-on transition-colors hover:bg-accent-strong focus-visible:bg-accent-strong sm:min-h-0 sm:px-4 sm:py-2 sm:text-xs"
          >
            {primaryLink.label} ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
          {secondaryLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded border border-border-strong px-5 text-base font-semibold uppercase tracking-wide text-text-secondary-strong transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary sm:min-h-0 sm:px-4 sm:py-2 sm:text-xs"
            >
              {link.label} ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </div>
      )}

      {event.description && (
        <div className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">About</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-secondary">{event.description}</p>
        </div>
      )}

      {artistVideoPreview && (
        <ArtistVideoPreview
          artistName={artistVideoPreview.artistName}
          videoId={artistVideoPreview.videoId}
          videoTitle={artistVideoPreview.videoTitle}
        />
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <ShareButton
          title={title}
          url={canonicalUrl}
          className="inline-flex items-center gap-1.5 rounded border border-border-strong px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary"
        />
      </div>

      <div className="mt-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Add to calendar</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          <a href={googleCalendarUrl(calendarInput)} target="_blank" rel="noopener noreferrer" className="rounded border border-border-strong px-4 py-2 hover:border-accent-dim hover:text-text-primary">
            Google Calendar<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href={outlookCalendarUrl(calendarInput)} target="_blank" rel="noopener noreferrer" className="rounded border border-border-strong px-4 py-2 hover:border-accent-dim hover:text-text-primary">
            Outlook<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href={`/events/${event.slug}/calendar.ics`} className="rounded border border-border-strong px-4 py-2 hover:border-accent-dim hover:text-text-primary">
            Apple Calendar / ICS
          </a>
        </div>
      </div>

      {/* Discreet, non-CTA provenance (public source-link visibility work
          package, 2026-09-07; revised same day to read from ALL of the
          event's real source_event_links, not only its canonical
          source — see getSourceProvenance's own doc comment): identifies
          every qualifying discovery/aggregator source by its clean
          public brand name — deliberately small/muted text, never a
          button, so it never competes with Official event/Tickets above.
          Moved to its own final section, alongside the report-incorrect-info
          disclaimer below, as of the CTA hierarchy work (2026-09-26) — it's
          provenance/source metadata, not an outbound action, so it no
          longer sits inside the primary-CTA block. Compact "Sources: A · B"
          form when more than one qualifying source exists — never a source
          browser. */}
      {sourceProvenance.length > 0 && (
        <p className="mt-8 text-[11px] text-text-tertiary">
          {sourceProvenance.length === 1 ? "Source:" : "Sources:"}{" "}
          {sourceProvenance.map((s, i) => (
            <span key={s.sourceName}>
              {i > 0 && " · "}
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-1 underline-offset-2 hover:text-text-secondary"
              >
                {s.sourceName}
              </a>
            </span>
          ))}
        </p>
      )}

      <p className="mt-10 text-xs text-text-tertiary">
        Times shown in Europe/Copenhagen. Details are drawn from official and verified sources — if something here looks
        wrong, <Link href="/contact" className="underline hover:text-text-secondary">let us know</Link>.
      </p>
    </div>
  );
}
