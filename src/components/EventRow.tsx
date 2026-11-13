import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import type { EventRowEvent } from "@/lib/homepageEvents";
import { formatRowDateRangeLabel, formatTimeRangeLabel } from "@/lib/format";
import { displayGenres, genreLabelPagePath } from "@/lib/taxonomy";
import { getExternalLinks, showFreeCta } from "@/lib/links";
import { cleanEventTitle, formatArtistName, shouldShowArtistPreview, subVenueLabel } from "@/lib/eventPresentation";
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

/**
 * Listing-row calendar button (2026-11-12). Mobile: the same small outlined
 * pill as the VIDEO/AUDIO badges (10px semibold uppercase, rounded-full,
 * border-strong, tertiary text) with a short "Calendar" label. sm and up:
 * exactly AddToCalendar's default row button (36px, rounded, 11px medium).
 */
const CALENDAR_BUTTON_CLASSES =
  "inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-[1.3333] tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary sm:min-h-[2.25rem] sm:gap-1.5 sm:rounded sm:px-2.5 sm:py-1 sm:text-[11px] sm:font-medium sm:normal-case sm:leading-normal sm:tracking-normal [&_svg]:h-3 [&_svg]:w-3 sm:[&_svg]:h-3.5 sm:[&_svg]:w-3.5";

export default function EventRow({ event }: { event: EventRowEvent }) {
  const genres = displayGenres(event.subgenres);
  const links = getExternalLinks(event, 2);
  const isFree = showFreeCta(event);
  const statuses = getEventStatuses(event);
  const title = cleanEventTitle(event.title, event.venue.name);
  const subVenue = subVenueLabel(event.title, event.venue.name, event.subVenue);
  const showArtistPreview = shouldShowArtistPreview(title, event.artists);
  const lineup = showArtistPreview ? event.artists.map(formatArtistName).join(" / ") : "";
  // Single source of truth for this row's own event-detail URL (mobile/video
  // affordance polish, 2026-09-26) — reused by both the title link and the
  // VIDEO badge link below, so there is only ever one place that constructs
  // it.
  const eventHref = `/events/${event.slug}`;
  // External links + FREE as one ordered list, so the last one can share a
  // non-wrapping mobile unit with Calendar (see the actions column below).
  type LinkItem = { kind: "link"; label: string; href: string } | { kind: "free" };
  const linkItems: LinkItem[] = [
    ...links.map((l) => ({ kind: "link" as const, label: l.label, href: l.href })),
    ...(isFree ? [{ kind: "free" as const }] : []),
  ];
  const leadLinkItems = linkItems.slice(0, -1);
  const hasMedia = !!event.hasArtistPreview || !!event.hasAudioLinks;
  const bindCalendarToLastLink = !hasMedia;
  const lastLinkItem = linkItems.at(-1);
  // Typography the link group gives its children; the last item sits
  // outside the group (in the Calendar unit), so each item carries it itself.
  const LINK_GROUP_TEXT = "text-xs font-medium uppercase tracking-wide";
  const renderLinkItem = (item: LinkItem) =>
    item.kind === "link" ? (
      <a
        key={item.href}
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${LINK_GROUP_TEXT} -order-1 whitespace-nowrap text-text-secondary-strong transition-colors duration-150 hover:text-text-primary focus-visible:text-text-primary sm:order-none sm:whitespace-normal`}
      >
        {item.label} ↗<span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      // FREE is an admission/status badge, not a link — rendered after the
      // links so it always sits to the right of Official Event, in white to
      // carry comparable visual weight.
      <span key="free" className="-order-1 text-xs font-semibold uppercase tracking-wide text-text-primary sm:order-none">
        Free
      </span>
    );
  const calendarInput = {
    title,
    description: event.description,
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    venue: event.venue,
    eventUrl: `${SITE_URL}${eventHref}`,
  };
  const calendarButton = (
    <AddToCalendar
      event={calendarInput}
      icsHref={`/events/${event.slug}/calendar.ics`}
      mobileLabel="Calendar"
      buttonClassName={CALENDAR_BUTTON_CLASSES}
    />
  );
  // Mobile only (2026-11-13): when Video/Audio exist, a second Calendar
  // instance sits in the metadata row, bound with the first media badge in
  // one non-wrapping unit, so Calendar and that badge always wrap together
  // and no lone pill is left on a line. The actions-column Calendar is then
  // desktop-only (display:none below sm), so exactly one is ever rendered
  // visibly/accessibly per breakpoint. At sm the unit is display:contents
  // and this copy hidden, so desktop is unchanged.
  const withMobileCalendar = (badge: ReactNode) => (
    <span className="order-1 inline-flex items-center gap-x-4 sm:contents">
      <span className="flex sm:hidden">{calendarButton}</span>
      {badge}
    </span>
  );

  // Mobile vs desktop structure (2026-11-12). Desktop is the existing
  // three-column row (date | title/lineup/metadata | actions), unchanged
  // apart from the inline LINEUP: label and status badges (e.g. SOLD OUT)
  // below the time in the date column. Mobile reorders the same DOM — no
  // duplicated links — into: date + time + status badges on the top row →
  // title → genres (muted accent purple) → LINEUP: + artists → divider →
  // bottom section: one left-aligned wrapping flow of venue → Official
  // event → Tickets/Free → Calendar → Video → Audio (only those present),
  // so few elements share a line and more wrap as width requires.
  //
  // It does that by making the middle column, the metadata row, the action
  // column and the link group `display: contents` below `sm`, so their
  // children become items of the row's own wrapping flexbox, sequenced with
  // negative `order` (info lines are basis-full; actions keep their natural
  // width and wrap side by side with the row's 16px gap). At `sm` every
  // container is a real box again and every order/margin resets.
  return (
    <li className="border-b border-border-strong/80 last:border-b-0 sm:border-border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-4 sm:flex-nowrap sm:items-start sm:gap-5 sm:py-3.5">
        <div className="-order-6 flex shrink-0 items-baseline gap-2 sm:order-none sm:w-[7.5rem] sm:flex-col sm:items-start sm:gap-0.5">
          <span className="font-display text-sm font-bold uppercase tracking-wide text-text-primary">
            {formatRowDateRangeLabel(event)}
          </span>
          <span className="text-xs tabular-nums text-text-tertiary">
            {formatTimeRangeLabel(event)}
          </span>
          {/* Status badges (e.g. SOLD OUT) live in the date column: beside the
              time on mobile (the column is a row there), directly below it on
              desktop — the same place regardless of title length or actions.
              SOLD OUT uses the "strong" tone: text and border in the title's
              white. Status logic unchanged. */}
          {statuses.map((s) => (
            <span key={s.label} className="sm:mt-1">
              <StatusBadge label={s.label} tone={s.label === "Sold out" ? "strong" : s.tone} />
            </span>
          ))}
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
              Mobile: "LINEUP:" inline before the artists in exactly the
              lineup's own 12.5px/weight/grey — uppercase and the colon are
              the only distinction. Desktop: "LINEUP:" inline before the
              artists, same 14px, accent purple, semibold. No pill,
              background or border on either. Display only — event.artists
              itself is untouched. */}
          {lineup && (
            <p className="-order-3 min-w-0 basis-full break-words text-[12.5px] leading-snug text-text-secondary-strong sm:order-none sm:mt-0.5 sm:text-[14px]">
              <span className="uppercase sm:mr-1 sm:font-semibold sm:tracking-wide sm:text-accent">
                Lineup:
              </span>{" "}
              {lineup}
            </p>
          )}
          <div className="contents text-xs sm:mt-1 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
            {/* Venue (+ sub-venue): first item of the mobile bottom section
                under the divider — pin, name, sub-venue as one unit (min-w-0
                lets a very long name wrap inside it rather than overflow).
                At sm the wrapper is display:contents and the pin hidden, so
                desktop's metadata row is unchanged. */}
            <span
              className="-order-1 flex min-w-0 items-center gap-x-2 sm:contents sm:order-none"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="-mr-0.5 h-3 w-3 shrink-0 text-text-tertiary sm:hidden"
              >
                <path d="M10 17.5s-5.5-4.9-5.5-9.25a5.5 5.5 0 0 1 11 0c0 4.35-5.5 9.25-5.5 9.25Z" strokeLinejoin="round" />
                <circle cx="10" cy="8.25" r="2" />
              </svg>
              <Link
                href={`/venues/${event.venue.slug}`}
                className="min-w-0 text-text-secondary-strong underline decoration-1 decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
              >
                {event.venue.name}
              </Link>
              {subVenue && (
                <>
                  <span aria-hidden className="text-text-tertiary">·</span>
                  <span className="font-medium text-text-secondary-strong">{subVenue}</span>
                </>
              )}
            </span>
            {genres.length > 0 && (
              <>
                <span aria-hidden className="hidden text-text-tertiary sm:inline">·</span>
                <span className="-order-4 basis-full font-medium uppercase tracking-wide text-accent-dim sm:order-none sm:basis-auto sm:text-text-tertiary">
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
                {withMobileCalendar(
                  <Link
                    href={`${eventHref}#video`}
                    aria-label={`Go to artist preview video for ${title}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 sm:order-none"
                  >
                    <span aria-hidden="true" className="text-accent">▶</span>
                    Video
                  </Link>
                )}
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
                {/* Bound with the mobile Calendar only when there's no VIDEO
                    badge to carry it. */}
                {event.hasArtistPreview ? (
                  <Link
                    href={`${eventHref}#soundcloud`}
                    aria-label={`Go to audio links for ${title}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 sm:order-none"
                  >
                    <span aria-hidden="true" className="text-accent">♫</span>
                    Audio
                  </Link>
                ) : (
                  withMobileCalendar(
                    <Link
                      href={`${eventHref}#soundcloud`}
                      aria-label={`Go to audio links for ${title}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 sm:order-none"
                    >
                      <span aria-hidden="true" className="text-accent">♫</span>
                      Audio
                    </Link>
                  )
                )}
              </>
            )}
          </div>
          {/* Mobile-only internal divider between event info and the venue +
              actions section — subtler (border at 70%) than the between-event
              line, which is border-strong at 80% on mobile. */}
          <div aria-hidden className="-order-2 my-1 h-px basis-full bg-border/70 sm:hidden" />
        </div>

        <div className="contents sm:flex sm:shrink-0 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
          {/* Mobile: the link group is display:contents, so each link is its
              own unit in the bottom section's single wrapping flow (venue →
              Official event → Tickets/Free → Calendar → Video → Audio).
              Everything wraps purely by available width. One exception keeps
              Calendar from ever ending up alone on a line: when no Video/
              Audio follows it, the last of Official event/Tickets/Free and
              Calendar form one non-wrapping unit, so Calendar moves down
              with that link. With media present, the mobile Calendar is the
              copy bound to the first media badge in the metadata row (see
              withMobileCalendar) and this one is desktop-only. At sm
              both wrappers are display:contents / the original flex group,
              so desktop renders exactly as before. */}
          {leadLinkItems.length > 0 && (
            <div className="contents text-xs font-medium uppercase tracking-wide sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
              {leadLinkItems.map(renderLinkItem)}
            </div>
          )}
          <span className={`${bindCalendarToLastLink ? "inline-flex items-center gap-x-4" : "contents"} sm:contents`}>
            {lastLinkItem && renderLinkItem(lastLinkItem)}
            {hasMedia ? <span className="hidden sm:contents">{calendarButton}</span> : calendarButton}
          </span>
        </div>
      </div>
    </li>
  );
}
