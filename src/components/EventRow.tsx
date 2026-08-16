import Link from "next/link";
import type { EventWithVenue } from "@/lib/queries";
import { formatRowDateLabel, formatTimeRangeLabel } from "@/lib/format";
import { displayGenres } from "@/lib/taxonomy";
import { getExternalLinks } from "@/lib/links";
import AddToCalendar from "./AddToCalendar";
import StatusBadge, { getEventStatuses } from "./StatusBadge";

const SITE_URL = "https://electroniccph.com";

export default function EventRow({ event }: { event: EventWithVenue }) {
  const genres = displayGenres(event.subgenres);
  const links = getExternalLinks(event, 2);
  const statuses = getEventStatuses(event);
  const lineup = event.artists.length > 0 ? `: ${event.artists.join(" / ")}` : "";
  const calendarInput = {
    title: event.title,
    description: event.description,
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    venue: event.venue,
    eventUrl: `${SITE_URL}/events/${event.slug}`,
  };

  return (
    <li className="group border-b border-border last:border-b-0">
      <div className="flex flex-col gap-2.5 py-4 transition-colors sm:flex-row sm:items-center sm:gap-5 sm:py-3.5 sm:group-hover:bg-surface-1/60">
        <div className="flex shrink-0 items-baseline gap-2 sm:w-[7.5rem] sm:flex-col sm:items-start sm:gap-0.5">
          <span className="font-display text-sm font-bold uppercase tracking-wide text-text-primary">
            {formatRowDateLabel(event.startDatetime)}
          </span>
          <span className="text-xs tabular-nums text-text-tertiary">
            {formatTimeRangeLabel(event)}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <Link
            href={`/events/${event.slug}`}
            className="block text-[15px] font-semibold leading-snug text-text-primary hover:text-accent-strong sm:truncate"
          >
            {event.title}
            <span className="font-normal text-text-secondary">{lineup}</span>
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Link href={`/venues/${event.venue.slug}`} className="text-text-secondary hover:text-text-primary">
              {event.venue.name}
            </Link>
            {genres.length > 0 && (
              <>
                <span aria-hidden className="text-text-tertiary">·</span>
                <span className="font-medium uppercase tracking-wide text-text-tertiary">
                  {genres.map((g) => g.shortLabel).join(" · ")}
                </span>
              </>
            )}
            {statuses.map((s) => (
              <StatusBadge key={s.label} {...s} />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 sm:gap-y-1">
          {links.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium uppercase tracking-wide">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    link.primary
                      ? "text-accent-strong hover:text-accent"
                      : "text-text-secondary hover:text-text-primary"
                  }
                >
                  {link.label} ↗
                </a>
              ))}
            </div>
          )}
          <AddToCalendar event={calendarInput} filename={`${event.slug}.ics`} />
        </div>
      </div>
    </li>
  );
}
