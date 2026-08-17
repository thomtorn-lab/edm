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
import { formatMonthAbbrTitleCase, formatMonthFull } from "@/lib/format";
import { eventMatchesQuery } from "@/lib/search";
import { MAIN_GENRES, mainGenreOf, type MainGenreSlug } from "@/lib/taxonomy";
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

const DATE_MODES = ["tonight", "weekend", "next-weekend"] as const;

const pillClasses = (active: boolean) =>
  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
  (active
    ? "border-accent bg-accent/15 text-accent-strong"
    : "border-border-strong text-text-secondary hover:border-accent-dim hover:text-text-primary");

const selectClasses =
  "rounded-full border border-border-strong bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary";

export default function EventExplorer({ events }: { events: EventWithVenue[] }) {
  const [now, setNow] = useState<Date | null>(null);
  const [mode, setMode] = useState<Mode>("all");
  const [genre, setGenre] = useState<MainGenreSlug | "all">("all");
  const [venueId, setVenueId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // "now" is deliberately read post-mount from the visitor's own clock rather
  // than at render time, so a statically prerendered page never bakes in a
  // stale build-time date for Tonight/Weekend filtering.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);

  // Lock background scroll while the mobile filters sheet is open.
  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileFiltersOpen]);

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
      if (genre !== "all" && !e.subgenres.some((s) => mainGenreOf(s) === genre)) return false;
      if (venueId !== "all" && e.venue.id !== venueId) return false;
      if (!eventMatchesQuery(e, e.venue, query)) return false;
      return true;
    });
  }, [upcoming, now, mode, genre, venueId, query]);

  const groups = useMemo(() => groupByMonth(filtered), [filtered]);
  const hasActiveFilters = mode !== "all" || genre !== "all" || venueId !== "all" || query.trim() !== "";
  const activeDrawerFilterCount = (genre !== "all" ? 1 : 0) + (venueId !== "all" ? 1 : 0);

  function clearFilters() {
    setMode("all");
    setGenre("all");
    setVenueId("all");
    setQuery("");
  }

  const countLabel = now ? `${filtered.length} event${filtered.length === 1 ? "" : "s"}` : "";

  const genreSelect = (id: string) => (
    <select
      id={id}
      value={genre}
      onChange={(e) => setGenre(e.target.value as MainGenreSlug | "all")}
      className={selectClasses}
    >
      <option value="all">All genres</option>
      {MAIN_GENRES.map((g) => (
        <option key={g.slug} value={g.slug}>{g.label}</option>
      ))}
    </select>
  );

  const venueSelect = (id: string) => (
    <select
      id={id}
      value={venueId}
      onChange={(e) => setVenueId(e.target.value)}
      className={selectClasses}
    >
      <option value="all">All venues</option>
      {venueOptions.map(([optionId, name]) => (
        <option key={optionId} value={optionId}>{name}</option>
      ))}
    </select>
  );

  return (
    <div>
      <div className="sticky top-0 z-30 border-b border-border bg-bg/92 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          {/* ---- Mobile (< sm): full-width search, scrollable quick filters, one Filters button ---- */}
          <div className="flex flex-col gap-2.5 sm:hidden">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events, artists or venues"
              aria-label="Search events, artists or venues"
              className="w-full rounded-full border border-border-strong bg-surface-1 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent"
            />

            <div
              className="flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="group"
              aria-label="Date range"
            >
              {DATE_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(mode === m ? "all" : m)}
                  className={"min-h-[2.25rem] " + pillClasses(mode === m)}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary"
              >
                Filters
                {activeDrawerFilterCount > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-on">
                    {activeDrawerFilterCount}
                  </span>
                )}
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium text-accent hover:text-accent-strong"
                >
                  Clear filters
                </button>
              )}

              <span className="ml-auto text-[11px] text-text-tertiary">{countLabel}</span>
            </div>
          </div>

          {/* ---- Desktop (>= sm): one coherent tool row ---- */}
          <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
              {DATE_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(mode === m ? "all" : m)}
                  className={pillClasses(mode === m)}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="genre-filter">Genre</label>
            {genreSelect("genre-filter")}

            <label className="sr-only" htmlFor="venue-filter">Venue</label>
            {venueSelect("venue-filter")}

            <div className="relative w-48 lg:w-64">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events, artists, venues"
                aria-label="Search events, artists or venues"
                className="w-full rounded-full border border-border-strong bg-surface-1 px-3.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent"
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] font-medium text-accent hover:text-accent-strong"
              >
                Clear filters
              </button>
            )}

            <span className="ml-auto text-[11px] text-text-tertiary">{countLabel}</span>
          </div>
        </div>

        {groups.length > 1 && (
          <nav
            aria-label="Jump to month"
            className="border-t border-border/60"
          >
            <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1.5 whitespace-nowrap sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {groups.map((g) => (
                <a
                  key={g.monthKey}
                  href={`#month-${g.monthKey}`}
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-text-tertiary hover:text-text-primary"
                >
                  {formatMonthAbbrTitleCase(g.month)}
                </a>
              ))}
            </div>
          </nav>
        )}
      </div>

      {/* ---- Mobile filters sheet: Genre + Venue ---- */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-bg/70"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Filters</h2>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className="flex h-8 w-8 items-center justify-center rounded text-text-tertiary hover:text-text-primary"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="genre-filter-mobile" className="mb-1.5 block text-xs font-semibold text-text-secondary">
                  Genre
                </label>
                <select
                  id="genre-filter-mobile"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value as MainGenreSlug | "all")}
                  className="w-full rounded border border-border-strong bg-surface-2 px-3.5 py-3 text-sm text-text-primary"
                >
                  <option value="all">All genres</option>
                  {MAIN_GENRES.map((g) => (
                    <option key={g.slug} value={g.slug}>{g.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="venue-filter-mobile" className="mb-1.5 block text-xs font-semibold text-text-secondary">
                  Venue
                </label>
                <select
                  id="venue-filter-mobile"
                  value={venueId}
                  onChange={(e) => setVenueId(e.target.value)}
                  className="w-full rounded border border-border-strong bg-surface-2 px-3.5 py-3 text-sm text-text-primary"
                >
                  <option value="all">All venues</option>
                  {venueOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              {activeDrawerFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setGenre("all");
                    setVenueId("all");
                  }}
                  className="min-h-[2.75rem] flex-1 rounded border border-border-strong text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="min-h-[2.75rem] flex-[2] rounded bg-accent text-xs font-semibold uppercase tracking-wide text-accent-on"
              >
                Show {countLabel}
              </button>
            </div>
          </div>
        </div>
      )}

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
