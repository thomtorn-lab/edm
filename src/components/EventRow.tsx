import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import type { EventRowEvent } from "@/lib/homepageEvents";
import { formatRowDateRangeLabel, formatTimeRangeLabel } from "@/lib/format";
import { isMultiDayEvent } from "@/lib/datetime";
import { displayGenres, genreLabelPagePath } from "@/lib/taxonomy";
import { getExternalLinks, showFreeCta } from "@/lib/links";
import { cleanEventTitle, formatArtistName, lineupDuplicatesTitle, subVenueLabel } from "@/lib/eventPresentation";
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
/**
 * Mobile-only invisible hit-area extension (2026-11-21): the compact action
 * links/pills keep their small visual size, while a transparent pseudo-element
 * grows the tappable box by 6px on every side (up to the 6px row gap, so it
 * never covers the venue line) without affecting layout. Off at sm (static, so desktop is untouched).
 */
const TAP_AREA =
  "relative before:absolute before:-inset-x-1.5 before:-inset-y-1.5 before:content-[''] sm:static sm:before:hidden";

const CALENDAR_BUTTON_CLASSES =
  `${TAP_AREA} inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-[1.3333] tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary sm:min-h-[2.25rem] sm:gap-1.5 sm:rounded sm:px-2.5 sm:py-1 sm:text-[11px] sm:font-medium sm:normal-case sm:leading-normal sm:tracking-normal [&_svg]:h-3 [&_svg]:w-3 sm:[&_svg]:h-3.5 sm:[&_svg]:w-3.5`;

/**
 * Mobile action buttons (2026-11-24 mobile redesign). Every action keeps a
 * 44×44px (or taller) touch target while the visible button is 36px tall:
 * the anchor/button is the 44px box, the inner span draws the button.
 */
const MOBILE_ACTION_BOX = "flex h-11 items-center";
const MOBILE_PILL_BASE =
  "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 text-[15px] font-semibold transition-colors";
/** Primary: Tickets — the filled accent button. */
const MOBILE_PRIMARY_PILL = `${MOBILE_PILL_BASE} bg-accent-strong text-accent-on group-hover:bg-accent`;
/** Secondary: Official Event (and the rare Source fallback) — one outlined style, identical on every row. */
const MOBILE_SECONDARY_PILL = `${MOBILE_PILL_BASE} border border-accent-dim text-accent-strong group-hover:border-accent group-hover:text-text-primary`;
/** Tertiary: Calendar / Video / Audio — 44×44 targets around a 36×36 outlined icon box. */
const MOBILE_ICON_TARGET = "group flex h-11 w-11 items-center justify-center text-text-secondary-strong";
const MOBILE_ICON_BOX =
  "flex h-9 w-9 items-center justify-center rounded-[10px] border border-border-strong transition-colors group-hover:border-accent-dim group-hover:text-text-primary";
/** AddToCalendar's own button, styled as the same icon target (its svg is the icon). */
const MOBILE_CALENDAR_BUTTON = `${MOBILE_ICON_TARGET} cursor-pointer [&>svg]:box-content [&>svg]:h-4 [&>svg]:w-4 [&>svg]:rounded-[10px] [&>svg]:border [&>svg]:border-border-strong [&>svg]:p-[9px] [&>svg]:transition-colors hover:[&>svg]:border-accent-dim hover:text-text-primary`;

function ExternalArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3 w-3 shrink-0">
      <path d="M3 9l6-6M4 3h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function EventRow({
  event,
  dateInHeading = false,
}: {
  event: EventRowEvent;
  /**
   * The homepage list groups rows under sticky mobile day headings, so on
   * mobile the row then omits its own single-day date (a multi-day range is
   * still shown, since the heading only names the start day). Venue and genre
   * pages have no day headings and keep the date in the row. Desktop is
   * unaffected either way.
   */
  dateInHeading?: boolean;
}) {
  const genres = displayGenres(event.subgenres);
  const links = getExternalLinks(event, 2);
  const isFree = showFreeCta(event);
  const statuses = getEventStatuses(event);
  const title = cleanEventTitle(event.title, event.venue.name);
  const subVenue = subVenueLabel(event.title, event.venue.name, event.subVenue);
  // The lineup is hidden only when every artist (b2b/vs/x entries split) is
  // already named in the title (2026-11-22) — the event page uses the same
  // rule, so a lineup is shown or hidden identically in both places.
  const lineup =
    event.artists.length > 0 && !lineupDuplicatesTitle(title, event.artists)
      ? event.artists.map(formatArtistName).join(" / ")
      : "";
  // Single source of truth for this row's own event-detail URL (mobile/video
  // affordance polish, 2026-09-26) — reused by both the title link and the
  // VIDEO badge link below, so there is only ever one place that constructs
  // it.
  const eventHref = `/events/${event.slug}`;
  // Mobile lineup: every artist name is kept whole (non-breaking spaces) and
  // each "·" separator stays at the end of a line, never the start of the next.
  const mobileLineup = lineup
    ? event.artists.map((a) => formatArtistName(a).replace(/ /g, "\u00a0")).join("\u00a0· ")
    : "";
  // Mobile actions: Tickets (primary) first, then Official Event / Source
  // (secondary) — same links, same rules as desktop, only the order differs.
  const mobileLinks = [...links].sort((a, b) => Number(b.label === "Tickets") - Number(a.label === "Tickets"));
  const showMobileDate = !dateInHeading || isMultiDayEvent(event);
  // A genre that has its own landing page (only Techno so far) is a plain
  // crawlable link to it, a sibling of the title link rather than nested in
  // it; every other genre stays plain text. Shared by both layouts.
  const genreNodes = genres.map((g, i) => {
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
  });
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
  const LINK_GROUP_TEXT = "text-[11px] font-medium uppercase tracking-wide sm:text-xs";
  const renderLinkItem = (item: LinkItem) =>
    item.kind === "link" ? (
      <a
        key={item.href}
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${LINK_GROUP_TEXT} ${TAP_AREA} -order-1 whitespace-nowrap text-text-secondary sm:text-text-secondary-strong transition-colors duration-150 hover:text-text-primary focus-visible:text-text-primary sm:order-none sm:whitespace-normal`}
      >
        {item.label} ↗<span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      // FREE is an admission/status badge, not a link — rendered after the
      // links so it always sits to the right of Official Event, in white to
      // carry comparable visual weight.
      <span key="free" className="-order-1 text-[11px] font-semibold sm:text-xs uppercase tracking-wide text-text-primary sm:order-none">
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

  // Mobile vs desktop structure (2026-11-12; compacted 2026-11-21). Desktop
  // is the existing three-column row (date | title/lineup/metadata |
  // actions), unchanged. Mobile reorders the same DOM — no duplicated links —
  // into one continuous unit: date + time + status badges → title → genres
  // (muted accent purple) → LINEUP: + artists → venue (own line) → one
  // compact wrapping action line: Official event → Tickets/Free → Calendar →
  // Video → Audio (only those present). No internal divider: the only line
  // is the between-event border, with equal 10px padding above and below.
  //
  // It does that by making the middle column, the metadata row, the action
  // column and the link group `display: contents` below `sm`, so their
  // children become items of the row's own wrapping flexbox, sequenced with
  // negative `order` (info lines are basis-full; actions keep their natural
  // width and wrap side by side with the row's 16px column gap). Vertical
  // rhythm: a 6px row gap, with genres and the lineup pulled to 4px under
  // the title. At `sm` every container is a real box again and every
  // order/margin resets.
  return (
    <li className="border-b border-border last:border-b-0">
      {/* Desktop row (sm and up) — unchanged; display:none below sm, where the
          mobile layout further down renders instead. */}
      <div className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5 sm:flex sm:flex-nowrap sm:items-start sm:gap-5 sm:py-3.5">
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
            className="-order-5 block basis-full cursor-pointer text-[15px] font-semibold leading-snug text-text-primary underline decoration-1 decoration-transparent underline-offset-4 transition-[filter,text-decoration-color] duration-150 hover:brightness-110 hover:decoration-current focus-visible:brightness-110 focus-visible:decoration-current active:decoration-current sm:order-none sm:mt-0 sm:line-clamp-2"
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
            <p className="-order-3 -mt-0.5 min-w-0 basis-full break-words text-[12.5px] leading-snug text-text-secondary-strong sm:order-none sm:mt-0.5 sm:text-[14px]">
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
              className="-order-1 flex min-w-0 basis-full items-center gap-x-2 sm:contents sm:order-none"
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
                <span className="-order-4 -mt-0.5 basis-full font-medium uppercase tracking-wide text-accent-dim sm:order-none sm:mt-0 sm:basis-auto sm:text-text-tertiary">
                  {/* A genre that has its own landing page (only Techno so
                      far) is a plain crawlable link to it, a sibling of the
                      title link rather than nested in it; every other genre
                      stays plain text. The homepage genre filter is separate
                      UI and unaffected. */}
                  {genreNodes}
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
                    className={`${TAP_AREA} inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 sm:order-none`}
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
                    className={`${TAP_AREA} inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 sm:order-none`}
                  >
                    <span aria-hidden="true" className="text-accent">♫</span>
                    Audio
                  </Link>
                ) : (
                  withMobileCalendar(
                    <Link
                      href={`${eventHref}#soundcloud`}
                      aria-label={`Go to audio links for ${title}`}
                      className={`${TAP_AREA} inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary order-1 sm:order-none`}
                    >
                      <span aria-hidden="true" className="text-accent">♫</span>
                      Audio
                    </Link>
                  )
                )}
              </>
            )}
          </div>
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
            <div className="contents text-[11px] font-medium uppercase tracking-wide sm:flex sm:text-xs sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
              {leadLinkItems.map(renderLinkItem)}
            </div>
          )}
          <span className={`${bindCalendarToLastLink ? "inline-flex items-center gap-x-4" : "contents"} sm:contents`}>
            {lastLinkItem && renderLinkItem(lastLinkItem)}
            {hasMedia ? <span className="hidden sm:contents">{calendarButton}</span> : calendarButton}
          </span>
        </div>
      </div>
      {/* Mobile row (below sm; 2026-11-24 redesign). Time + venue → title →
          genres → full lineup → actions. Actions: Tickets / Official Event as
          a left group, Calendar / Video / Audio as a right group; when the two
          don't fit on one line the whole icon group wraps to the next line,
          left-aligned (justify-between with a single item per line). */}
      <div data-mobile-only className="pb-1.5 pt-3 sm:hidden">
        <div className="flex min-h-[18px] items-center gap-1.5 font-mono text-[13px] leading-[18px] tracking-[0.02em] text-text-secondary">
          {showMobileDate && (
            <>
              <span className="uppercase">{formatRowDateRangeLabel(event)}</span>
              <span aria-hidden="true" className="text-text-tertiary">•</span>
            </>
          )}
          <span className="tabular-nums">{formatTimeRangeLabel(event)}</span>
          <span aria-hidden="true" className="text-text-tertiary">•</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-3 w-3 shrink-0">
              <path d="M10 17.5s-5.5-4.9-5.5-9.25a5.5 5.5 0 0 1 11 0c0 4.35-5.5 9.25-5.5 9.25Z" strokeLinejoin="round" />
              <circle cx="10" cy="8.25" r="2" />
            </svg>
            <Link
              href={`/venues/${event.venue.slug}`}
              className="min-w-0 break-words uppercase underline decoration-1 decoration-transparent underline-offset-4 transition-colors hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
            >
              {event.venue.name}
              {subVenue && <span className="text-text-secondary-strong"> · {subVenue}</span>}
            </Link>
          </span>
          {(statuses.length > 0 || isFree) && (
            <span className="ml-auto flex shrink-0 items-center gap-1 pl-1 leading-3">
              {statuses.map((s) => (
                <StatusBadge key={s.label} label={s.label} tone={s.label === "Sold out" ? "strong" : s.tone} />
              ))}
              {isFree && (
                <span className="inline-flex items-center rounded-[3px] border border-accent-dim px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
                  Free
                </span>
              )}
            </span>
          )}
        </div>
        <Link href={eventHref} className="group mt-0.5 flex items-start gap-3">
          <span className="min-w-0 flex-1 break-words text-[26px] font-bold leading-[1.18] tracking-[-0.01em] text-text-primary underline decoration-1 decoration-transparent underline-offset-4 group-hover:decoration-current">
            {title}
          </span>
          <svg aria-hidden="true" viewBox="0 0 18 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="mt-px h-[30px] w-5 shrink-0 text-text-tertiary transition-colors group-hover:text-text-primary">
            <path d="M3 12h12M10 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        {genres.length > 0 && (
          <p className="mt-1 text-xs font-semibold uppercase leading-4 tracking-[0.08em] text-accent">{genreNodes}</p>
        )}
        {mobileLineup && (
          <p className="mt-[3px] break-words text-[17px] leading-[1.4] text-text-secondary-strong">{mobileLineup}</p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-1">
          {mobileLinks.length > 0 && (
            <div className="flex items-center gap-2">
              {mobileLinks.map((l) => (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={`group ${MOBILE_ACTION_BOX}`}>
                  <span className={l.label === "Tickets" ? MOBILE_PRIMARY_PILL : MOBILE_SECONDARY_PILL}>
                    {l.label === "Official event" ? "Official Event" : l.label}
                    <ExternalArrow />
                  </span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-none items-center">
            <AddToCalendar
              event={calendarInput}
              icsHref={`/events/${event.slug}/calendar.ics`}
              compact
              buttonClassName={MOBILE_CALENDAR_BUTTON}
            />
            {event.hasArtistPreview && (
              <Link href={`${eventHref}#video`} aria-label={`Go to artist preview video for ${title}`} className={MOBILE_ICON_TARGET}>
                <span className={MOBILE_ICON_BOX}>
                  <svg aria-hidden="true" viewBox="0 0 14 14" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5Z" />
                  </svg>
                </span>
              </Link>
            )}
            {event.hasAudioLinks && (
              <Link href={`${eventHref}#soundcloud`} aria-label={`Go to audio links for ${title}`} className={MOBILE_ICON_TARGET}>
                <span className={MOBILE_ICON_BOX}>
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4">
                    <path d="M7.5 15V4.5l9-2V13" strokeLinejoin="round" />
                    <circle cx="5.25" cy="15" r="2.25" />
                    <circle cx="14.25" cy="13" r="2.25" />
                  </svg>
                </span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
