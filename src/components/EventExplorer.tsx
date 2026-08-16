"use client";

import { useEffect, useMemo, useState } from "react";
import type { EventWithVenue } from "@/lib/queries";
import {
  groupByMonth,
  isNextWeekend,
  isPastEvent,
  isThisWeekend,
  isTonight,
  sortByStart,
} from "@/lib/datetime";
import { formatMonthAbbr, formatMonthFull } from "@/lib/format";
import { eventMatchesQuery } from "@/lib/search";
import { GENRE_GROUPS, GENRES, type GenreSlug } from "@/lib/taxonomy";
import EventRow from "./EventRow";
import EmptyState from "./EmptyState";

type Mode = "all" | "tonight" | "weekend" | "next-weekend";

const MODE_LABEL: Record<Exclude<Mode, "all">, string> = {
  tonight: "Tonight",
  weekend: "This weekend",
  "next-weekend": "Next weekend",
};

const MODE_EMPTY_TITLE: Record<Exclude<Mode, "all">, string> = {
  tonight: "Nothing on tonight",
  weekend: "Nothing on this weekend",
  "next-weekend": "Nothing lined up next weekend yet",
};

export default function EventExplorer({ events }: { events: EventWithVenue[] }) {
  const [now, setNow] = useState<Date | null>(null);
  const [mode, setMode] = useState<Mode>("all");
  const [genre, setGenre] = useState<GenreSlug | "all">("all");
  const [venueId, setVenueId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");

  // "now" is deliberately read post-mount from the visitor's own clock rather
  // than at render time, so a statically prerendered page never bakes in a
  // stale build-time date for Tonight/Weekend filtering.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);

  const venueOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) map.set(e.venue.id, e.venue.name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const upcoming = useMemo(() => {
    if (!now) return [];
    return sortByStart(events.filter((e) => !isPastEvent(e, now)));
  }, [events, now]);

  const filtered = useMemo(() => {
    if (!now) return [];
    return upcoming.filter((e) => {
      if (mode === "tonight" && !isTonight(e, now)) return false;
      if (mode === "weekend" && !isThisWeekend(e, now)) return false;
      if (mode === "next-weekend" && !isNextWeekend(e, now)) return false;
      if (genre !== "all" && !e.subgenres.includes(genre)) return false;
      if (venueId !== "all" && e.venue.id !== venueId) return false;
      if (!eventMatchesQuery(e, e.venue, query)) return false;
      return true;
    });
  }, [upcoming, now, mode, genre, venueId, query]);

  const groups = useMemo(() => groupByMonth(filtered), [filtered]);
  const hasActiveFilters = mode !== "all" || genre !== "all" || venueId !== "all" || query.trim() !== "";

  function clearFilters() {
    setMode("all");
    setGenre("all");
    setVenueId("all");
    setQuery("");
  }

  return (
    <div>
      <div className="sticky top-0 z-30 border-b border-border bg-bg/92 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
              {(["tonight", "weekend", "next-weekend"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(mode === m ? "all" : m)}
                  className={
                    "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors " +
                    (mode === m
                      ? "border-accent bg-accent/15 text-accent-strong"
                      : "border-border-strong text-text-secondary hover:border-accent-dim hover:text-text-primary")
                  }
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="genre-filter">Subgenre</label>
            <select
              id="genre-filter"
              value={genre}
              onChange={(e) => setGenre(e.target.value as GenreSlug | "all")}
              className="rounded-full border border-border-strong bg-surface-1 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary transition-colors hover:text-text-primary"
            >
              <option value="all">All genres</option>
              {GENRE_GROUPS.map((group) => (
                <optgroup key={group.slug} label={group.label}>
                  {GENRES.filter((g) => g.group === group.slug).map((g) => (
                    <option key={g.slug} value={g.slug}>{g.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <div className="relative min-w-[12rem] flex-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events, artists or venues"
                aria-label="Search events, artists or venues"
                className="w-full rounded-full border border-border-strong bg-surface-1 px-3.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent"
              />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="sr-only" htmlFor="venue-filter">Venue</label>
            <select
              id="venue-filter"
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              className="rounded border border-transparent bg-transparent py-0.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary"
            >
              <option value="all">All venues</option>
              {venueOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] font-medium uppercase tracking-wide text-accent hover:text-accent-strong"
              >
                Clear filters
              </button>
            )}

            <span className="ml-auto text-[11px] text-text-tertiary">
              {now ? `${filtered.length} event${filtered.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>

          {groups.length > 1 && (
            <nav
              aria-label="Jump to month"
              className="mt-2 flex gap-3 overflow-x-auto whitespace-nowrap pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {groups.map((g) => (
                <a key={g.monthKey} href={`#month-${g.monthKey}`} className="shrink-0 hover:text-text-primary">
                  {formatMonthAbbr(g.month)}
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {!now ? null : groups.length === 0 ? (
          <EmptyState
            title={mode === "all" ? "No events match" : MODE_EMPTY_TITLE[mode as Exclude<Mode, "all">]}
            hint={hasActiveFilters ? "Try a different date range or clear your filters." : "Check back soon — new events are added every week."}
          />
        ) : (
          groups.map((group) => (
            <section key={group.monthKey} id={`month-${group.monthKey}`} className="scroll-mt-40 py-6 sm:py-8">
              <h2 className="font-display mb-3 flex items-baseline gap-2 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
                <span className="text-accent">{String(group.month).padStart(2, "0")} /</span>
                {formatMonthFull(group.month)}
                <span className="text-base font-semibold tracking-normal text-text-tertiary">{group.year}</span>
              </h2>
              <ul>
                {group.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
