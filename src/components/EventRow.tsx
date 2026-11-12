import { Fragment } from "react";
import Link from "next/link";
import type { EventRowEvent } from "@/lib/homepageEvents";
import { formatRowDateRangeLabel, formatTimeRangeLabel } from "@/lib/format";
import { displayGenres, genreLabelPagePath } from "@/lib/taxonomy";
import { getExternalLinks, showFreeCta } from "@/lib/links";
import { cleanEventTitle, shouldShowArtistPreview, subVenueLabel } from "@/lib/eventPresentation";
import AddToCalendar from "./AddToCalendar";
import StatusBadge, { getEventStatuses } from "./StatusBadge";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * hasArtistPreview (homepage VIDEO indicator work, 2026-09-26) is computed
 * once, batched, by the homepage (src/app/page.tsx) and attached to each
 * event object before it reaches EventExplorer/EventRow — optional so venue
 * pages (src/app/venues/[slug]/page.tsx), which don't compute it, keep
 * passing plain EventWithVenue objects unchanged and simply render no
 * indicator (a safe default, not a regression).
 */

export default function EventRow({ event }: { event: EventRowEvent }) {
  const genres = displayGenres(event.subgenres);
  const links = getExternalLinks(event, 2);
  const isFree = showFreeCta(event);
  const statuses = getEventStatuses(event);
  const title = cleanEventTitle(event.title, event.venue.name);
  const subVenue = subVenueLabel(event.title, event.venue.name, event.subVenue);
  const showArtistPreview = shouldShowArtistPreview(title, event.artists);
  const lineup = showArtistPreview ? event.artists.join(" / ") : "";
  // Single source of truth for this row's own event-detail URL (mobile/video
  // affordance polish, 2026-09-26) — reused by both the title link and the
  // VIDEO badge link below, so there is only ever one place that constructs
  // it.
  const eventHref = `/events/${event.slug}`;
  const calendarInput = {
    title,
    description: event.description,
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    venue: event.venue,
    eventUrl: `${SITE_URL}${eventHref}`,
  };

  // Mobile vs desktop structure (2026-11-12). Desktop is the existing
  // three-column row (date | title/lineup/metadata | actions), unchanged
  // apart from the inline LINEUP label. Mobile reorders the same DOM — no
  // duplicated links — into: date → title → genres → LINEUP + artists →
  // venue (+ sub-venue, status badges) → divider → actions (Official
  // event, Tickets, Free, Calendar, then Video/Audio). It does that by
  // making the middle column, the metadata row, the action column and the
  // link group `display: contents` below `sm`, so their children become
  // items of the row's own wrapping flexbox, sequenced with negative
  // `order` (info lines are basis-full; actions keep their natural width
  // and wrap side by side; mr-2/ml-2 restore their 16px spacing on top of
  // the row's 8px gap). At `sm` every container is a real box again and
  // every order/margin resets, so desktop renders exactly as before.
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-4 sm:flex-nowrap sm:items-start sm:gap-5 sm:py-3.5">
        <div className="-order-6 flex shrink-0 basis-full items-baseline gap-2 sm:order-none sm:w-[7.5rem] sm:basis-auto sm:flex-col sm:items-start sm:gap-0.5">
          <span className="font-display text-sm font-bold uppercase tracking-wide text-text-primary">
            {formatRowDateRangeLabel(event)}
          </span>
          <span className="text-xs tabular-nums text-text-tertiary">
            {formatTimeRangeLabel(event)}
          </span>
        </div>

        <div className="contents sm:block sm:min-w-0 sm:flex-1">
          <Link
            href={eventHref}
            className="-order-5 mt-1 block basis-full cursor-pointer text-[15px] font-semibold leading-snug text-text-primary underline decoration-1 decoration-transparent underline-offset-4 transition-[filter,text-decoration-color] duration-150 hover:brightness-110 hover:decoration-current focus-visible:brightness-110 focus-visible:decoration-current active:decoration-current sm:order-none sm:mt-0 sm:line-clamp-2"
          >
            {title}
            {/* Discreet internal-navigation cue, mobile only (desktop already
                has the hover/focus underline as its affordance): a plain →
                distinguishes this as Electronic CPH's own event-detail page,
                never the ↗ glyph used for Official event/Tickets/Source,
                which always means "leaves the site". Purely decorative — the
                link's accessible name stays the title; no-underline
                keeps the hover-decoration line from drawing through the glyph. */}
            <span aria-hidden="true" className="ml-1 font-normal text-text-secondary-strong no-underline sm:hidden">
              →
            </span>
          </Link>
          {/* Lineup under the title (2026-11-12), outside the title link
              (not clickable), never clamped so the full lineup always wraps
              into view; break-words keeps long names inside the column.
              Mobile: a small purple LINEUP label on its own line, then the
              artists at 12.5px. Desktop: the label inline before the artists,
              same 14px as the lineup, accent purple, semibold — no pill,
              background or border on either. Display only — event.artists
              itself is untouched. */}
          {lineup && (
            <p className="-order-3 basis-full break-words text-[12.5px] leading-snug text-text-secondary-strong sm:order-none sm:mt-0.5 sm:text-[14px]">
              <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-accent sm:mb-0 sm:mr-1 sm:inline sm:text-[14px]">
                Lineup
              </span>{" "}
              {lineup}
            </p>
          )}
          <div className="contents text-xs sm:mt-1 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
            <Link
              href={`/venues/${event.venue.slug}`}
              className="-order-2 text-text-secondary-strong underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current sm:order-none"
            >
              {event.venue.name}
            </Link>
            {subVenue && (
              <>
                <span aria-hidden className="-order-2 text-text-tertiary sm:order-none">·</span>
                <span className="-order-2 font-medium text-text-secondary-strong sm:order-none">{subVenue}</span>
              </>
            )}
            {genres.length > 0 && (
              <>
                <span aria-hidden className="hidden text-text-tertiary sm:inline">·</span>
                <span className="-order-4 basis-full font-medium uppercase tracking-wide text-text-tertiary sm:order-none sm:basis-auto">
                  {/* A genre that has its own landing page (only Techno so
                      far) is a plain crawlable link to it, a sibling of the
                      title link rather than nested in it; every other genre
                      stays plain text. The homepage genre filter is separate
                      UI and unaffected. */}
                  {genres.map((g, i) => {
                    const href = genreLabelPagePath(g.slug);
                    return (
                      <Fragment key={g.slug}>
                        {i > 0 && " · "}
                        {href ? (
                          <Link
                            href={href}
                            className="underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
                          >
                            {g.shortLabel}
                          </Link>
                        ) : (
                          g.shortLabel
                        )}
                      </Fragment>
                    );
                  })}
                </span>
              </>
            )}
            {event.hasArtistPreview && (
              <>
                <span aria-hidden className="hidden text-text-tertiary sm:inline">·</span>
                {/* Minimal availability signal (homepage VIDEO indicator,
                    2026-09-26; made clickable, mobile/video affordance
                    polish 2026-09-26; deep-links to the Artist Preview
                    section, 2026-09-26) — a real, semantic link, same-tab, no
                    external-link ↗ glyph since it never leaves the site.
                    Deep-links straight to the event page's Artist Preview
                    section (`#video`, the id on ArtistVideoPreview's own
                    wrapper) rather than the plain eventHref the title link
                    still uses — only this badge deep-links, ordinary
                    title/row navigation is unaffected. Kept deliberately
                    restrained (small outlined pill, no thumbnail/logo) so it
                    still never competes with Official event/Tickets in the
                    CTA column. It sits as a sibling of the title link, not
                    nested inside it, so there's no nested-link markup and no
                    conflicting click handlers. aria-label gives it one
                    clean, title-specific accessible name instead of the
                    visible glyph + "Video" being read out separately. */}
                <Link
                  href={`${eventHref}#video`}
                  aria-label={`Go to artist preview video for ${title}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 ml-2 sm:order-none sm:ml-0"
                >
                  <span aria-hidden="true" className="text-accent">▶</span>
                  Video
                </Link>
              </>
            )}
            {event.hasAudioLinks && (
              <>
                <span aria-hidden className="hidden text-text-tertiary sm:inline">·</span>
                {/* hasAudioLinks: venue-provided SoundCloud links, set by the
                    listing page via getSoundcloudAvailabilityForEvents
                    (2026-10-13; first shipped as the 2026-10-09 pilot,
                    relabeled to "AUDIO" per UI-refinement round) — same pill
                    shape/typography/spacing as the VIDEO badge above, so the
                    two read as siblings. Deep-links to the event page's own
                    SoundCloud section (`#soundcloud`, unchanged — only the
                    visible/accessible label changed), exactly like VIDEO's
                    `#video` deep-link — never straight to soundcloud.com
                    from the overview. */}
                <Link
                  href={`${eventHref}#soundcloud`}
                  aria-label={`Go to audio links for ${title}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 ml-2 sm:order-none sm:ml-0"
                >
                  <span aria-hidden="true" className="text-accent">♫</span>
                  Audio
                </Link>
              </>
            )}
            {statuses.map((s) => (
              <span key={s.label} className="-order-2 sm:contents sm:order-none">
                <StatusBadge {...s} />
              </span>
            ))}
          </div>
          {/* Mobile-only divider between event info and actions. */}
          <div aria-hidden className="-order-1 my-1 h-px basis-full bg-border sm:hidden" />
        </div>

        <div className="contents sm:flex sm:shrink-0 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
          {(links.length > 0 || isFree) && (
            <div className="contents text-xs font-medium uppercase tracking-wide sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-2 text-text-secondary-strong transition-colors duration-150 hover:text-text-primary focus-visible:text-text-primary sm:mr-0"
                >
                  {link.label} ↗<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ))}
              {/* FREE is an admission/status badge, not a link — rendered
                  after the links so it always sits to the right of Official
                  Event, in white to carry comparable visual weight. */}
              {isFree && <span className="mr-2 font-semibold text-text-primary sm:mr-0">Free</span>}
            </div>
          )}
          <AddToCalendar event={calendarInput} icsHref={`/events/${event.slug}/calendar.ics`} />
        </div>
      </div>
    </li>
  );
}
