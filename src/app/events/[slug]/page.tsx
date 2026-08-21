import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventBySlugWithVenue } from "@/lib/queries";
import { formatFullDateLabel, formatTimeLabel } from "@/lib/format";
import { crossesMidnight } from "@/lib/datetime";
import { displayGenres, getGenre } from "@/lib/taxonomy";
import { getExternalLinks, showFreeCta } from "@/lib/links";
import { googleCalendarUrl, icsDataUrl, outlookCalendarUrl } from "@/lib/ics";
import { buildEventJsonLd } from "@/lib/jsonld";
import StatusBadge, { getEventStatuses } from "@/components/StatusBadge";

// Events are admin-editable now (publish/hide/correct/cancel); render fresh
// on every request rather than risk serving a stale prebuilt page.
export const revalidate = 0;

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlugWithVenue(slug);
  if (!event) return {};

  const genres = displayGenres(event.subgenres).map((g) => g.label).join(" · ");
  const description = `${event.title}${event.artists.length ? `: ${event.artists.join(", ")}` : ""} — ${genres} at ${event.venue.name}, ${event.venue.city}, on ${formatFullDateLabel(event.startDatetime)}.`;

  return {
    title: event.title,
    description,
    alternates: { canonical: `/events/${event.slug}` },
    openGraph: {
      title: event.title,
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

  const genres = event.subgenres.map(getGenre);
  const links = getExternalLinks(event);
  const isFree = showFreeCta(event);
  const statuses = getEventStatuses(event);
  const canonicalUrl = `https://electroniccph.com/events/${event.slug}`;
  const jsonLd = buildEventJsonLd(event, canonicalUrl);

  const calendarInput = {
    title: event.title,
    description: event.description,
    startDatetime: event.startDatetime,
    endDatetime: event.endDatetime,
    venue: event.venue,
    eventUrl: canonicalUrl,
  };
  const icsFilename = `${event.slug}.ics`;

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

      <h1 className="font-display mt-3 text-3xl font-extrabold uppercase leading-[1.05] tracking-tight text-text-primary sm:text-5xl">
        {event.title}
      </h1>

      {event.artists.length > 0 && (
        <p className="mt-3 text-lg text-text-secondary">{event.artists.join(" / ")}</p>
      )}

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-y border-border py-6 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Date &amp; time</dt>
          <dd className="mt-1 text-sm text-text-primary">
            {formatFullDateLabel(event.startDatetime)}
            <br />
            {formatTimeLabel(event.startDatetime)}
            {event.endDatetime && (
              <>
                {" – "}
                {formatTimeLabel(event.endDatetime)}
                {crossesMidnight(event) && <span className="text-text-tertiary"> (+1)</span>}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Venue</dt>
          <dd className="mt-1 text-sm text-text-primary">
            <Link href={`/venues/${event.venue.slug}`} className="hover:text-accent-strong">{event.venue.name}</Link>
            <br />
            <span className="text-text-secondary">{event.venue.address}</span>
          </dd>
        </div>
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
      </dl>

      {event.description && (
        <div className="mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">About</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-secondary">{event.description}</p>
        </div>
      )}

      {(links.length > 0 || isFree) && (
        <div className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Links</h2>
          <div className="mt-2 flex flex-wrap gap-3">
            {isFree && (
              <span className="rounded border border-accent bg-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-strong">
                Free
              </span>
            )}
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  "rounded border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors " +
                  (link.primary
                    ? "border-accent bg-accent/10 text-accent-strong hover:bg-accent/20"
                    : "border-border-strong text-text-secondary hover:border-accent-dim hover:text-text-primary")
                }
              >
                {link.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Add to calendar</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          <a href={googleCalendarUrl(calendarInput)} target="_blank" rel="noopener noreferrer" className="rounded border border-border-strong px-4 py-2 hover:border-accent-dim hover:text-text-primary">
            Google Calendar
          </a>
          <a href={outlookCalendarUrl(calendarInput)} target="_blank" rel="noopener noreferrer" className="rounded border border-border-strong px-4 py-2 hover:border-accent-dim hover:text-text-primary">
            Outlook
          </a>
          <a href={icsDataUrl(calendarInput)} download={icsFilename} className="rounded border border-border-strong px-4 py-2 hover:border-accent-dim hover:text-text-primary">
            Apple Calendar / ICS
          </a>
        </div>
      </div>

      <p className="mt-10 text-xs text-text-tertiary">
        Times shown in Europe/Copenhagen. Details are drawn from official and verified sources — if something here looks
        wrong, <Link href="/contact" className="underline hover:text-text-secondary">let us know</Link>.
      </p>
    </div>
  );
}
