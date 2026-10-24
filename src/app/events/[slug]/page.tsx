import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventBySlugWithVenue, getEventYoutubePreview, getSoundcloudLinksForLineup } from "@/lib/queries";
import { formatFullDateLabel, formatFullDateRangeLabel, formatTimeLabel } from "@/lib/format";
import { displayGenres, genreLabelPagePath } from "@/lib/taxonomy";
import { getExternalLinks } from "@/lib/links";
import { cleanEventTitle, shouldShowArtistPreview, subVenueLabel } from "@/lib/eventPresentation";
import { buildEventJsonLd } from "@/lib/jsonld";
import { SITE_URL } from "@/lib/siteUrl";
import { buildEventSeoDescription, buildEventSeoTitle } from "@/lib/seoMetadata";
import StatusBadge, { getEventStatuses } from "@/components/StatusBadge";
import VenueAddressLink from "@/components/VenueAddressLink";
import ShareButton from "@/components/ShareButton";
import AddToCalendar from "@/components/AddToCalendar";
import BackToEventsLink from "@/components/BackToEventsLink";
import ArtistVideoPreview from "@/components/ArtistVideoPreview";
import SoundcloudLinks from "@/components/SoundcloudLinks";
import EventDescription from "@/components/EventDescription";

// Events are admin-editable now (publish/hide/correct/cancel); render fresh
// on every request rather than risk serving a stale prebuilt page.
export const revalidate = 0;

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlugWithVenue(slug);
  if (!event) return {};

  const title = cleanEventTitle(event.title, event.venue.name);
  const genreLabels = displayGenres(event.subgenres).map((g) => g.label);
  const genres = genreLabels.join(" · ");
  // Open Graph keeps its existing title/description — the SEO work package
  // (2026-10-06) is scoped to the HTML <title> and meta description only.
  const ogDescription = `${title}${event.artists.length ? `: ${event.artists.join(", ")}` : ""} — ${genres} at ${event.venue.name}, ${event.venue.city}, on ${formatFullDateLabel(event.startDatetime)}.`;
  const seoInput = {
    title,
    venueName: event.venue.name,
    startDatetime: event.startDatetime,
    artists: event.artists,
    genres: genreLabels,
    showArtists: shouldShowArtistPreview(title, event.artists),
  };

  return {
    // absolute: the SEO title already ends in "| Electronic CPH", so the
    // root layout's "%s — Electronic CPH" template must not add it again.
    title: { absolute: buildEventSeoTitle(seoInput) },
    description: buildEventSeoDescription(seoInput),
    alternates: { canonical: `/events/${event.slug}` },
    openGraph: {
      title,
      description: ogDescription,
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
  // 2026-09-26; fallback narrowed 2026-09-26 review): computed independently
  // of getExternalLinks's own `primary` flag, which is NOT the same thing —
  // it always marks "Official event" as primary when present, even alongside
  // a Tickets link. Product rule here is the opposite: a verified Tickets
  // destination always outranks Official event. Deliberately only ever
  // Tickets or Official event — a bare "Source" (or any other) link is never
  // promoted to the filled-accent primary treatment merely because neither
  // of those exists; it still renders, just with the ordinary secondary/
  // outline treatment (see secondaryLinks below). Never modifies links.ts
  // itself — this is a purely additive, presentation-only re-ranking of its
  // unchanged output.
  const primaryLink = links.find((l) => l.label === "Tickets") ?? links.find((l) => l.label === "Official event") ?? null;
  const secondaryLinks = primaryLink ? links.filter((l) => l !== primaryLink) : links;
  const statuses = getEventStatuses(event);
  const title = cleanEventTitle(event.title, event.venue.name);
  const subVenue = subVenueLabel(event.title, event.venue.name, event.subVenue);
  const showArtistPreview = shouldShowArtistPreview(title, event.artists);
  const [artistVideoPreview, soundcloudArtists] = await Promise.all([
    getEventYoutubePreview(event),
    getSoundcloudLinksForLineup(event.id, event.artists),
  ]);
  // Tickets + Official event (or any primary with exactly one other button)
  // split the row on mobile; see the action row below.
  const splitActionRow = primaryLink !== null && secondaryLinks.length === 1;
  const hasMusic = artistVideoPreview !== null || soundcloudArtists.length > 0;
  const canonicalUrl = `${SITE_URL}/events/${event.slug}`;
  // English-only About text (2026-10-24): the public query already
  // replaced `description` with the text the public site may show (English
  // or null — see withPublicDescriptions in src/lib/queries.ts); it is used
  // for the About section, JSON-LD and calendar exports alike.
  const description = event.description;
  // Practical-only text (cloakroom, access, contact — src/lib/aboutContent.ts)
  // is shown under its own label and kept out of the structured-data
  // description, which should describe the event itself.
  const practicalOnly = event.aboutKind === "practical";
  const jsonLd = buildEventJsonLd({ ...event, title, description: practicalOnly ? null : description }, canonicalUrl);

  const calendarInput = {
    title,
    description,
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

      <BackToEventsLink
        eventPath={`/events/${event.slug}`}
        className="text-xs font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary"
      />

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

      {/* Core event facts plus the primary outbound actions, inside one
          bordered block (event-page action layout, 2026-10-17): Tickets/
          Official event sit directly under the genre tags, above the block's
          lower rule, so the user's primary task reads as part of "what /
          when / where". The rules moved from the <dl> to this wrapper because
          the action row can't live inside a <dl> (only dt/dd groups can). */}
      <div className="mt-6 border-y border-border py-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
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
                {genres.map((g) => {
                  const className = "rounded-[3px] border border-border-strong px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-text-secondary";
                  const href = genreLabelPagePath(g.slug);
                  // Only a genre with its own landing page (Techno so far)
                  // links; the tag looks the same either way.
                  return href ? (
                    <Link key={g.slug} href={href} className={`${className} transition-colors duration-150 hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary`}>
                      {g.label}
                    </Link>
                  ) : (
                    <span key={g.slug} className={className}>
                      {g.label}
                    </span>
                  );
                })}
              </dd>
            </div>
          )}
        </dl>

        {/* Primary + secondary outbound event actions (event-detail CTA
            hierarchy work, 2026-09-26; placement revised 2026-10-17). Tickets
            outranks Official event when both exist (primaryLink/secondaryLinks
            above); never renders a button for a link that doesn't exist. When
            neither Tickets nor Official event exists (e.g. a bare "Source"
            fallback), there is no primary CTA at all — every link then renders
            with the ordinary secondary/outline treatment, never promoted to the
            filled accent style. Primary is filled accent, secondary outline.
            Layout: natural width, left-aligned, ~44px tall on every screen
            (min-w keeps a lone short label like "TICKETS ↗" from looking
            cramped). The one mobile exception: when there are exactly two
            buttons and one of them is primary (Tickets + Official event), they
            split the row 50/50 below `sm` for two large, even tap targets;
            whitespace-nowrap + flex-wrap let them stack instead of squeezing a
            label onto two lines on a very narrow screen. */}
        {links.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2 sm:gap-3">
            {primaryLink && (
              <a
                href={primaryLink.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-11 min-w-[8.5rem] items-center justify-center whitespace-nowrap rounded bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-on transition-colors hover:bg-accent-strong focus-visible:bg-accent-strong ${splitActionRow ? "flex-1 sm:flex-none" : ""}`}
              >
                {primaryLink.label} ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {secondaryLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-11 min-w-[8.5rem] items-center justify-center whitespace-nowrap rounded border border-border-strong px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-strong transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary ${splitActionRow ? "flex-1 sm:flex-none" : ""}`}
              >
                {link.label} ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Secondary actions (event-page action layout, 2026-10-17): Add to
          calendar — the same AddToCalendar component the event rows use,
          here as a labelled ~44px button whose options open as a bottom
          sheet on mobile and a left-anchored dropdown from `sm` — and Share,
          moved here unchanged (same icon, same behaviour: icon-only below
          `sm`, icon + label from `sm`; only its mobile size went from 40 to
          44px). Left-aligned, never stretched across the column. The row
          always renders, like Share always has. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <AddToCalendar
          event={calendarInput}
          icsHref={`/events/${event.slug}/calendar.ics`}
          labelAlwaysVisible
          menuAlign="start"
          buttonClassName="inline-flex min-h-11 items-center gap-1.5 rounded border border-border-strong px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary"
        />
        <ShareButton
          title={title}
          url={canonicalUrl}
          className="inline-flex h-11 w-11 items-center justify-center rounded border border-border-strong text-xs font-semibold uppercase tracking-wide text-text-secondary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary sm:h-auto sm:w-auto sm:min-h-[2.75rem] sm:gap-1.5 sm:px-4 sm:py-2"
        />
      </div>

      {/* "Get a taste" (event-page action layout, 2026-10-17): one section
          for the music — the YouTube Artist Preview as the primary element,
          then the venue-provided SoundCloud links with their own "Listen on
          SoundCloud" sub-heading after some extra air. Rendered only when
          there is at least one of the two. `#video` (homepage VIDEO badge)
          now targets this section, so the jump lands with its heading in
          view; it only exists when there is a video, exactly as before.
          `#soundcloud` (AUDIO badge) stays on the SoundCloud block. */}
      {hasMusic && (
        <section
          id={artistVideoPreview ? "video" : undefined}
          aria-labelledby="get-a-taste"
          className="mt-8 scroll-mt-4 sm:mt-10"
        >
          <h2 id="get-a-taste" className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            Get a taste
          </h2>
          {artistVideoPreview && (
            <ArtistVideoPreview
              artistName={artistVideoPreview.artistName}
              videoId={artistVideoPreview.videoId}
              videoTitle={artistVideoPreview.videoTitle}
            />
          )}
          {soundcloudArtists.length > 0 && (
            <SoundcloudLinks artists={soundcloudArtists} className={artistVideoPreview ? "mt-8 sm:mt-10" : "mt-3"} />
          )}
        </section>
      )}

      {description && (
        <div className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            {practicalOnly ? "Practical information" : "About"}
          </h2>
          {/* Structured, link-safe rendering of the stored text — see
              src/components/EventDescription.tsx. Artist names and the title
              are passed only as hints for recognising headings. */}
          <EventDescription text={description} headingHints={[...event.artists, title]} />
        </div>
      )}

      {/* No public per-event "Source:"/"Sources:" provenance line (removed
          2026-10-16): it only linked to discovery/aggregator listings that
          duplicated the Official event/Tickets CTAs above. Provenance stays
          internal — source_event_links and admin/diagnostics are untouched —
          and the general sourcing note below remains the public disclosure.
          The last-resort "Source ↗" CTA (getExternalLinks) is unaffected. */}
      <p className="mt-10 text-xs text-text-tertiary">
        Times shown in Europe/Copenhagen. Details are drawn from official and verified sources — if something here looks
        wrong, <Link href="/contact" className="underline hover:text-text-secondary">let us know</Link>.
      </p>
    </div>
  );
}
