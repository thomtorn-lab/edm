import Link from "next/link";
import type { EventWithVenue } from "@/lib/queries";
import { formatRowDateRangeLabel, formatTimeRangeLabel } from "@/lib/format";
import { displayGenres } from "@/lib/taxonomy";
import { getExternalLinks, showFreeCta } from "@/lib/links";
import { cleanEventTitle, shouldShowArtistPreview, subVenueLabel } from "@/lib/eventPresentation";
import { getSoundcloudPilotArtists } from "@/lib/soundcloudPilot";
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
type EventRowEvent = EventWithVenue & { hasArtistPreview?: boolean };

export default function EventRow({ event }: { event: EventRowEvent }) {
  const genres = displayGenres(event.subgenres);
  const links = getExternalLinks(event, 2);
  const isFree = showFreeCta(event);
  const statuses = getEventStatuses(event);
  const title = cleanEventTitle(event.title, event.venue.name);
  const subVenue = subVenueLabel(event.title, event.venue.name, event.subVenue);
  const showArtistPreview = shouldShowArtistPreview(title, event.artists);
  const lineup = showArtistPreview ? `: ${event.artists.join(" / ")}` : "";
  // One-event SoundCloud UX pilot (2026-10-09) — empty for every event
  // except the single hand-picked pilot event; see soundcloudPilot.ts's own
  // doc comment for the full scope/verification discipline.
  const soundcloudPilotArtists = getSoundcloudPilotArtists(event.id, event.artists);
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

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-col gap-2.5 py-4 sm:flex-row sm:items-start sm:gap-5 sm:py-3.5">
        <div className="flex shrink-0 items-baseline gap-2 sm:w-[7.5rem] sm:flex-col sm:items-start sm:gap-0.5">
          <span className="font-display text-sm font-bold uppercase tracking-wide text-text-primary">
            {formatRowDateRangeLabel(event)}
          </span>
          <span className="text-xs tabular-nums text-text-tertiary">
            {formatTimeRangeLabel(event)}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <Link
            href={eventHref}
            className="block cursor-pointer text-[15px] font-semibold leading-snug text-text-primary underline decoration-1 decoration-transparent underline-offset-4 transition-[filter,text-decoration-color] duration-150 hover:brightness-110 hover:decoration-current focus-visible:brightness-110 focus-visible:decoration-current active:decoration-current sm:line-clamp-2"
          >
            {title}
            <span className="font-normal text-text-secondary-strong">{lineup}</span>
            {/* Discreet internal-navigation cue, mobile only (desktop already
                has the hover/focus underline as its affordance): a plain →
                distinguishes this as Electronic CPH's own event-detail page,
                never the ↗ glyph used for Official event/Tickets/Source,
                which always means "leaves the site". Purely decorative — the
                link's accessible name stays the title (+ lineup); no-underline
                keeps the hover-decoration line from drawing through the glyph. */}
            <span aria-hidden="true" className="ml-1 font-normal text-text-secondary-strong no-underline sm:hidden">
              →
            </span>
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Link
              href={`/venues/${event.venue.slug}`}
              className="text-text-secondary-strong underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
            >
              {event.venue.name}
            </Link>
            {subVenue && (
              <>
                <span aria-hidden className="text-text-tertiary">·</span>
                <span className="font-medium text-text-secondary-strong">{subVenue}</span>
              </>
            )}
            {genres.length > 0 && (
              <>
                <span aria-hidden className="text-text-tertiary">·</span>
                <span className="font-medium uppercase tracking-wide text-text-tertiary">
                  {genres.map((g) => g.shortLabel).join(" · ")}
                </span>
              </>
            )}
            {event.hasArtistPreview && (
              <>
                <span aria-hidden className="text-text-tertiary">·</span>
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
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary"
                >
                  <span aria-hidden="true" className="text-accent">▶</span>
                  Video
                </Link>
              </>
            )}
            {soundcloudPilotArtists.length > 0 && (
              <>
                <span aria-hidden className="text-text-tertiary">·</span>
                {/* One-event SoundCloud UX pilot (2026-10-09), relabeled to
                    "AUDIO" per UI-refinement round — same pill
                    shape/typography/spacing as the VIDEO badge above, so the
                    two read as siblings. Deep-links to the event page's own
                    SoundCloud section (`#soundcloud`, unchanged — only the
                    visible/accessible label changed), exactly like VIDEO's
                    `#video` deep-link — never straight to soundcloud.com
                    from the overview. */}
                <Link
                  href={`${eventHref}#soundcloud`}
                  aria-label={`Go to audio links for ${title}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary"
                >
                  <span aria-hidden="true" className="text-accent">♫</span>
                  Audio
                </Link>
              </>
            )}
            {statuses.map((s) => (
              <StatusBadge key={s.label} {...s} />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 sm:gap-y-1">
          {(links.length > 0 || isFree) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium uppercase tracking-wide">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-secondary-strong transition-colors duration-150 hover:text-text-primary focus-visible:text-text-primary"
                >
                  {link.label} ↗<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ))}
              {/* FREE is an admission/status badge, not a link — rendered
                  after the links so it always sits to the right of Official
                  Event, in white to carry comparable visual weight. */}
              {isFree && <span className="font-semibold text-text-primary">Free</span>}
            </div>
          )}
          <AddToCalendar event={calendarInput} icsHref={`/events/${event.slug}/calendar.ics`} />
        </div>
      </div>
    </li>
  );
}
