"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Whether any part of `el` currently falls within the viewport's vertical
 * span — used by the Clear Filters origin-restore branch (see the
 * reconciliation effect below) to skip its own scroll when the restored
 * origin month is already the active, visible month. Deliberately the
 * loosest possible "is it there at all" check, not the IntersectionObserver's
 * own narrow near-top band.
 */
function isSectionVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * Shared filter predicate (filter-state architecture rework, 2026-09-12):
 * pulled out of the `filtered` memo so the mobile drawer's draft preview
 * count (see `draftFiltered` below) can compute the same result against
 * draft genre/venue values without duplicating — and risking drifting from
 * — the actual filter logic.
 */
function applyFilters(
  upcoming: EventWithVenue[],
  now: Date,
  mode: Mode,
  genre: MainGenreSlug | "all",
  venueId: string | "all",
  query: string
): EventWithVenue[] {
  return upcoming.filter((e) => {
    if (mode === "tonight" && !isTonight(e, now)) return false;
    if (mode === "weekend" && !isThisWeekend(e, now)) return false;
    if (mode === "next-weekend" && !isNextWeekend(e, now)) return false;
    if (genre !== "all" && !e.subgenres.some((s) => mainGenreOf(s) === genre)) return false;
    if (venueId !== "all" && e.venue.id !== venueId) return false;
    if (!eventMatchesQuery(e, e.venue, query)) return false;
    return true;
  });
}

const pillClasses = (active: boolean) =>
  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
  (active
    ? "border-accent bg-accent/15 text-accent-strong"
    : "border-border-strong text-text-secondary hover:border-accent-dim hover:text-text-primary");

// "accent-select" and "search-field" are hooks for the scoped :focus-visible
// overrides in globals.css — the active-state purple here already lives on
// the control's own border/text (matching pillClasses), so the sitewide
// focus-visible ring must not ALSO render purple on top of it (that reads as
// a separate outer ring rather than one accent treatment). See globals.css.
const selectClasses = (active: boolean) =>
  "accent-select rounded-full border bg-surface-1 px-3 py-1.5 text-xs font-semibold transition-colors " +
  (active
    ? "border-accent text-accent-strong"
    : "border-border-strong text-text-secondary hover:text-text-primary");

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
    >
      <path d="M2 4h12M4.5 8h7M7 12h2" />
    </svg>
  );
}

export default function EventExplorer({
  events,
  serverNow,
}: {
  events: EventWithVenue[];
  /**
   * ISO timestamp for "now" at the moment the server rendered this page
   * (see app/page.tsx). Used as the initial value so the very first render
   * — server-side, and the client's first paint before hydration's own
   * effect below runs — already has a real, current clock to filter
   * past/upcoming events by, rather than treating "now" as unknown.
   *
   * Bug fix (venue-dropdown/"All venues" follow-up): before this prop
   * existed, `now` started as `null`, and every `now`-dependent value
   * (`upcoming`, `venueOptions`, `filtered`) had its own "not yet known"
   * fallback — for `venueOptions` specifically, that fallback was the full
   * unfiltered `events` list, so a past-only venue (e.g. Nemoland, whose
   * only event was months in the past) still appeared in "All venues" in
   * every server-rendered response and every client's first paint, only
   * disappearing once the mount effect below replaced `null` with a real
   * Date. That's a genuine bug, not just a flash: it's what a search-engine
   * crawler, a no-JS visitor, or anyone whose JS hasn't finished loading
   * yet actually sees — this page is already fully dynamic (`revalidate =
   * 0`), so there's no reason "now" can't be correct from the very first
   * render, exactly like /venues/[slug]/page.tsx already does.
   */
  serverNow: string;
}) {
  const [now, setNow] = useState<Date>(() => new Date(serverNow));
  const [mode, setMode] = useState<Mode>("all");
  const [genre, setGenre] = useState<MainGenreSlug | "all">("all");
  const [venueId, setVenueId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Draft copies of genre/venue, edited only while the mobile filters sheet
  // is open (filter-state architecture rework, 2026-09-12): the sheet used
  // to write straight into `genre`/`venueId`, so the live event list behind
  // it re-filtered, reflowed and reconciled its active month while still
  // covered and scroll-locked — the root cause of the mobile-only "lands on
  // the wrong month" Production reports. These are seeded from the real
  // values when the sheet opens and only ever committed back to them when
  // "Show N events" is tapped; closing/cancelling any other way just
  // discards them, since the next open re-seeds from the (untouched) real
  // values anyway.
  const [draftGenre, setDraftGenre] = useState<MainGenreSlug | "all">("all");
  const [draftVenueId, setDraftVenueId] = useState<string | "all">("all");
  const mobileFiltersDialogRef = useRef<HTMLDivElement>(null);
  const mobileFiltersTriggerRef = useRef<HTMLButtonElement>(null);
  const [activeMonthKey, setActiveMonthKey] = useState<string | null>(null);
  // Filter-session origin tracking (filter-state architecture rework,
  // 2026-09-12; React-effect review, same day): the month the user was
  // viewing the instant a filter session started, so Clear Filters can
  // return there instead of leaving activeMonthKey wherever filtering had
  // moved it. Both are plain refs, not React state — capturing/restoring
  // this never needs to trigger a render on its own, only ever piggybacks
  // on a render the reconciliation effect below is already handling for
  // some OTHER reason (`hasActiveFilters`/`groups`/`activeMonthKey`
  // changing). An earlier version of this used `useState` for the origin,
  // which meant setting it was itself a dependency change that forced a
  // second, redundant run of that effect right after the first — a real
  // duplicate-scroll bug caught in testing. Folding origin capture/restore
  // into the START of that same effect (see below), driven by refs the
  // effect reads but never depends on, removes the second effect
  // invocation entirely rather than papering over it with an incomplete
  // dependency array.
  const filterOriginMonthKeyRef = useRef<string | null>(null);
  // Mirrors `hasActiveFilters` as of the last time the reconciliation
  // effect actually ran — the only way to detect an edge ("a session just
  // STARTED" / "a session just ENDED") from inside a single effect without
  // a second effect or extra state to hold the previous value.
  const wasFilteredRef = useRef(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // `now` starts from serverNow (always correct — see its doc comment
  // above), then gets replaced with the visitor's own browser clock once
  // mounted, so Tonight/Weekend filtering matches the visitor's actual
  // clock rather than the server's, without ever passing through an
  // "unknown" state in between.
  //
  // It's then kept fresh for the lifetime of the tab: a page opened before
  // an event's end (or its no-end-time fallback cutoff) and left open past
  // it must still remove that event without a reload. A 1-minute interval
  // covers the common case; the visibilitychange listener catches the
  // common case of a tab backgrounded overnight and revisited — it fires
  // immediately on refocus rather than waiting up to a minute.
  //
  // The refresh only actually calls setNow (triggering a re-render) when it
  // would change at least one event's past/upcoming status — returning the
  // SAME `now` reference otherwise, which React treats as a no-op update
  // (bails out without re-rendering). This isn't just an optimization: a
  // `now` tick that changes nothing observable still produces new
  // `upcoming`/`filtered`/`groups` array references on every render (they're
  // freshly filtered/sorted), which tears down and recreates the month-nav
  // IntersectionObserver below — and that teardown's own safety-net cleanup
  // unconditionally releases the tap-to-scroll pin (isProgrammaticScrollRef),
  // so an unconditional tick could cancel an in-progress tap-scroll for no
  // reason. Skipping genuinely no-op ticks avoids that entirely.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());

    function refreshIfChanged() {
      setNow((current) => {
        const next = new Date();
        const changed = events.some((e) => isPastEvent(e, current) !== isPastEvent(e, next));
        return changed ? next : current;
      });
    }
    const interval = window.setInterval(refreshIfChanged, 60_000);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") refreshIfChanged();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [events]);

  // Lock background scroll while the mobile filters sheet is open.
  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileFiltersOpen]);

  // Escape closes the mobile filters sheet, matching the standard modal
  // convention (and AddToCalendar's own dropdown, which already did this) —
  // previously the only way to dismiss it was tapping the close button or
  // the overlay (QA audit, 2026-08-29).
  //
  // QA follow-up (2026-08-29): the sheet is visually opaque (a full-viewport
  // fixed overlay) but nothing behind it was ever made inert, so Tab could
  // walk keyboard/screen-reader focus straight through it into the page
  // underneath — reachable and activatable while completely invisible. This
  // adds the minimal containment the WAI-ARIA APG dialog pattern calls for:
  // focus moves into the sheet on open, Tab/Shift+Tab wrap between its own
  // first and last focusable elements while it's open, and focus returns to
  // the "Filters" trigger button on close — no external dependency, no
  // general-purpose focus-trap system, just the few lines this one sheet
  // needs.
  //
  // The trigger's own focus restoration passes `preventScroll: true` (mobile
  // filter-drawer bug fix, 2026-09-12): a plain `.focus()` call scrolls its
  // target into view by default if it isn't already visible, which — right
  // after a filter selected inside this drawer has already reconciled the
  // page to a different, deliberately-chosen month — could yank the page
  // back toward wherever the "Filters" button itself sits. Restoring
  // keyboard/screen-reader focus here is still required; only the
  // side-effect scroll that accompanies it by default is suppressed.
  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const dialog = mobileFiltersDialogRef.current;
    if (!dialog) return;

    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );

    (getFocusable()[0] ?? dialog).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileFiltersOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const trigger = mobileFiltersTriggerRef.current;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus({ preventScroll: true });
    };
  }, [mobileFiltersOpen]);

  const upcoming = useMemo(() => {
    return sortByStart(events.filter((e) => !isPastEvent(e, now)));
  }, [events, now]);

  // Sourced from `upcoming`, never the raw `events` prop — a venue with no
  // upcoming event would otherwise appear as a selectable option that
  // always yields a zero-result state (QA audit, 2026-08-29). `now` is
  // always a real Date (see the serverNow prop doc comment above), so this
  // is correct from the very first render — no "not yet known" fallback
  // that could leak a past-only venue into the dropdown.
  const venueOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of upcoming) map.set(e.venue.id, e.venue.name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [upcoming]);

  const filtered = useMemo(
    () => applyFilters(upcoming, now, mode, genre, venueId, query),
    [upcoming, now, mode, genre, venueId, query]
  );

  const groups = useMemo(() => groupByMonth(filtered), [filtered]);

  // Remembers the `groups` reference as of the last reconciliation effect
  // run (product rule, 2026-09-12 — see its use in that effect's "stay"
  // branch below): `groups` only ever gets a new array identity when
  // `filtered` actually changes (mode/genre/venueId/query/now/events), NOT
  // merely because `activeMonthKey` changed on its own (a manual scroll or
  // nav tap) — so comparing against this ref is how that effect tells "a
  // filter/search change just happened" apart from "the user just scrolled
  // or tapped a month," from inside a single effect with no extra state.
  const lastGroupsRef = useRef(groups);

  // Preview count for the mobile drawer's "Show N events" button, computed
  // from the DRAFT genre/venue values (filter-state architecture rework,
  // 2026-09-12) — deliberately a separate memo from `filtered`/`groups`
  // above, not a mutation of them: the live event list and month
  // reconciliation must stay completely untouched while the sheet is open,
  // reacting only once the draft is actually committed on tap.
  const draftFiltered = useMemo(
    () => applyFilters(upcoming, now, mode, draftGenre, draftVenueId, query),
    [upcoming, now, mode, draftGenre, draftVenueId, query]
  );

  const hasActiveFilters = mode !== "all" || genre !== "all" || venueId !== "all" || query.trim() !== "";

  // Tapping a month nav item must win immediately (see handleMonthNavClick)
  // and stay pinned while the resulting scroll settles — otherwise the
  // IntersectionObserver below, reacting to whatever happens to be in the
  // narrow post-header band mid-scroll, can re-assert the PREVIOUS month for
  // a frame or two. isProgrammaticScrollRef is that pin; scheduleScrollSettle
  // releases it once scroll position has stopped moving (or, if the target
  // was already fully in view and no scroll event ever fires, after a fixed
  // fallback delay armed directly in the click handler).
  const isProgrammaticScrollRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);

  function scheduleScrollSettle() {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      settleTimerRef.current = null;
    }, 150);
  }

  function handleMonthNavClick(monthKey: string) {
    const el = document.getElementById(`month-${monthKey}`);
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    setActiveMonthKey(monthKey);
    el.scrollIntoView({ block: "start" }); // no `behavior` -> instant, matching the native anchor jump this replaces
    if (window.location.hash !== `#month-${monthKey}`) {
      history.replaceState(null, "", `#month-${monthKey}`);
    }
    scheduleScrollSettle();
  }

  // Reconciles the active month against `groups` whenever filtering changes
  // which months have any matching event — month navigation itself stays
  // pure navigation (handleMonthNavClick above is the only thing a user
  // action ever drives), this effect only *reacts* to a filter/search
  // change altering which months have a match (product rule, 2026-09-12 —
  // simplified filter-apply model superseding the earlier context-lock
  // approach to this same case):
  //   - a filter/search change just happened (groupsChangedSinceLastRun)
  //     and the active month still has a match -> target = the active
  //     month itself
  //   - otherwise -> target = whichever matching month is calendar-closest
  //     to the previous active month, in EITHER direction, ties broken
  //     toward the later month (product rule, 2026-09-12 — a forward-only
  //     "nearest later month" rule shipped earlier the same day looked
  //     correct in isolation but produced a jarring far-forward jump in
  //     Production whenever the nearest actual match happened to fall
  //     before the active month, e.g. November -> February when October
  //     also matched and was much closer)
  //   Either way, once a target is computed for a filter-driven pass, it is
  //   ALWAYS explicitly scrolled into view and made active — no visibility
  //   check, no "already there so skip the scroll" branch. The product
  //   requirement (land on the right month) outranks preserving the exact
  //   previous pixel position, and passive scroll-spy is deliberately not
  //   relied on to get this right on its own.
  //   - no months at all -> leave activeMonthKey exactly as it is (don't
  //     clear it to null) and don't scroll. The nav bar has nothing to show
  //     either way (it's gated on groups.length > 1), but the PREVIOUS month
  //     context must survive a filter that transiently matches nothing, so
  //     it's simply restored once the filter is relaxed/cleared again —
  //     clearing to null would instead make that restoration look
  //     indistinguishable from a fresh initial mount and fall into the next
  //     bullet's first-month default, discarding context the user never
  //     asked to lose
  //   - initial mount (activeMonthKey still null) -> establish the first
  //     month as active with NO scroll: there is nothing to jump away from,
  //     the page is already sitting at its natural starting position
  //   - a filter session just ENDED (every filter/search control back to
  //     its default) -> restore activeMonthKey to the filter-session origin
  //     captured below, instead of falling under the first bullet above:
  //     every month that was visible while filtered remains visible once
  //     filters are cleared (clearing only adds events back, never removes
  //     any), so "current month still has matches -> stay" would otherwise
  //     just leave the user wherever filtering had moved them (e.g.
  //     October) instead of returning to where they started (November) —
  //     exactly the reported Clear Filters bug. Skips the scroll (but still
  //     restores state) if the origin is already the active, visible month
  //     — e.g. a filter session where every filter tried matched nothing,
  //     so activeMonthKey never actually moved.
  // Filter-session origin capture (the mirror image of the bullet above)
  // happens first, at the very top of this same effect, the instant a
  // session STARTS: see the two ref reads/writes immediately below. Folding
  // capture and reconciliation into one effect — rather than two separate
  // effects that would each react to the same render — is deliberate: it
  // guarantees capture-then-reconcile happens as a single atomic pass with
  // exactly one resulting scroll, with no second effect invocation to
  // suppress via an incomplete dependency array. See the refs' own doc
  // comment (near their declarations) for why they're refs, not state.
  useEffect(() => {
    // Did `groups` itself get a new array identity since the last time
    // this effect ran? True only for a filter/search/now/events-driven
    // pass, never for a pass triggered solely by `activeMonthKey` changing
    // on its own (a manual scroll or a month-nav tap) — see the "stay"
    // branch below for why this distinction matters.
    const groupsChangedSinceLastRun = groups !== lastGroupsRef.current;
    lastGroupsRef.current = groups;

    const previouslyFiltered = wasFilteredRef.current;
    wasFilteredRef.current = hasActiveFilters;

    if (hasActiveFilters && !previouslyFiltered) {
      // Session starting — capture whatever was active *before* anything
      // below gets a chance to move it.
      filterOriginMonthKeyRef.current = activeMonthKey;
    }

    if (!hasActiveFilters && previouslyFiltered && filterOriginMonthKeyRef.current !== null) {
      const origin = filterOriginMonthKeyRef.current;
      filterOriginMonthKeyRef.current = null;
      if (groups.some((g) => g.monthKey === origin)) {
        const el = document.getElementById(`month-${origin}`);
        const alreadyThere = activeMonthKey === origin && el !== null && isSectionVisible(el);
        if (!alreadyThere) {
          isProgrammaticScrollRef.current = true;
          setActiveMonthKey(origin);
          el?.scrollIntoView({ block: "start", behavior: "smooth" });
          if (window.location.hash !== `#month-${origin}`) {
            history.replaceState(null, "", `#month-${origin}`);
          }
          scheduleScrollSettle();
        }
        return;
      }
      // The origin month has no event left at all (e.g. its only event
      // lapsed into the past while filtered) — nothing sensible to restore
      // to; fall through to the normal reconciliation below instead, using
      // `groups`/`activeMonthKey` exactly as they are now.
    }

    if (groups.length === 0) return;
    if (activeMonthKey === null) {
      setActiveMonthKey(groups[0].monthKey);
      return;
    }
    if (groups.some((g) => g.monthKey === activeMonthKey)) {
      // The active month still has a match — target stays the active
      // month itself (product rule, 2026-09-12: this is the highest-
      // priority rule, it must never move to a DIFFERENT month merely
      // because a filter was applied). Only a genuine filter/search-driven
      // pass (hasActiveFilters && groupsChangedSinceLastRun) explicitly
      // scrolls it into view — gating on that is still required even
      // though the scroll itself is now unconditional within that gate:
      // without it, this branch reruns on every ORDINARY manual scroll-spy
      // update too (any time the IntersectionObserver moves activeMonthKey
      // to a different, still-matching month re-triggers this effect), and
      // an unconditional scroll there would fight the user's own scrolling
      // in a feedback loop. Once gated to an actual filter-apply pass, the
      // scroll itself has no visibility check — no "already there so skip
      // it" branch — since the product requirement (land on the right
      // month) outranks preserving the exact previous pixel position, and
      // passive scroll-spy is deliberately not relied on to get this right
      // on its own.
      if (hasActiveFilters && groupsChangedSinceLastRun) {
        const el = document.getElementById(`month-${activeMonthKey}`);
        isProgrammaticScrollRef.current = true;
        el?.scrollIntoView({ block: "start", behavior: "smooth" });
        scheduleScrollSettle();
      }
      return;
    }

    // Calendar-month distance, not string/lexicographic distance and not
    // event counts — `year * 12 + month` turns "how many months apart" into
    // plain integer subtraction across year boundaries. `groups` carries
    // `year`/`month` directly (see groupByMonth in datetime.ts); the
    // previous activeMonthKey is a "YYYY-MM" string, parsed the same way.
    const activeYear = Number(activeMonthKey.slice(0, 4));
    const activeMonth = Number(activeMonthKey.slice(5, 7));
    const activeIndex = activeYear * 12 + activeMonth;

    // Closest match wins regardless of direction; on an exact tie the LATER
    // month wins (product rule, 2026-09-12). `groups` is already
    // chronologically ascending, so scanning forward and using `<=` (rather
    // than strict `<`) naturally lets a later, equally-close candidate
    // overwrite an earlier one.
    let target = groups[0].monthKey;
    let bestDistance = Infinity;
    for (const g of groups) {
      const distance = Math.abs(g.year * 12 + g.month - activeIndex);
      if (distance <= bestDistance) {
        bestDistance = distance;
        target = g.monthKey;
      }
    }

    isProgrammaticScrollRef.current = true;
    setActiveMonthKey(target);
    const el = document.getElementById(`month-${target}`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (window.location.hash !== `#month-${target}`) {
      history.replaceState(null, "", `#month-${target}`);
    }
    scheduleScrollSettle();
    // Complete, correct dependency array — every reactive value the effect
    // reads (`groups`, `activeMonthKey`, `hasActiveFilters`) is listed; no
    // suppression needed. `filterOriginMonthKeyRef`/`wasFilteredRef`/
    // `lastGroupsRef` are refs, not state — React's own rule is that a
    // ref's `.current` is read fresh on every invocation regardless of the
    // dependency array
    // (mutating one doesn't trigger a re-render, so it can't be "missing"
    // from a list of things that do), which is exactly why folding origin
    // capture/restore into this effect via refs — rather than tracking the
    // origin as its own piece of React state read by a second effect —
    // removes the double-invocation problem structurally instead of
    // instructing the linter to ignore it.
  }, [groups, activeMonthKey, hasActiveFilters]);

  useEffect(() => {
    if (groups.length < 2) return;
    const sections = groups
      .map((g) => document.getElementById(`month-${g.monthKey}`))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // A tap-driven or filter-apply-driven scroll is still settling —
        // its own handler already set the active month and owns it until
        // scroll position stops moving.
        if (isProgrammaticScrollRef.current) return;
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        );
        setActiveMonthKey(topMost.target.id.replace("month-", ""));
      },
      { rootMargin: "-160px 0px -70% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [groups]);

  // The intersection band above only covers a strip near the top of the
  // viewport. When the LAST month's section is short enough (or close enough
  // to the end of the page) that the page can't scroll any further once that
  // section reaches the top of the band, the section can end up sitting
  // lower in the viewport than the band ever reaches — so it never registers
  // as "intersecting" and the previous month is left active indefinitely.
  // This isn't month-specific: it happens for whichever month is currently
  // last AND short/near the page end (right now that's frequently September,
  // but the fix must not assume that). The generic, robust signal is scroll
  // position itself: once the viewport has reached the bottom of the page,
  // the last group is unambiguously the one in view, independent of the
  // observer's band geometry — this also doubles as this effect's scroll-end
  // detector for releasing the programmatic-scroll pin above.
  //
  // The atBottom branch itself must respect the programmatic-scroll pin
  // (mobile filter-drawer bug fix, 2026-09-12): closing the mobile filters
  // sheet right after a filter shrinks the page can produce a stray scroll
  // event that transiently reads as "at the bottom" while a reconciliation-
  // or nav-driven scroll is still settling on its own, deliberately chosen
  // target month. Unlike the IntersectionObserver callback above (which
  // already ignores stale data while pinned), this branch had no such guard
  // and would clobber that target with the last matching month. The settle
  // scheduling just below stays unconditional either way — a genuine
  // scroll-to-bottom still needs to release the pin once it's the pin's own
  // scroll that reached the bottom.
  useEffect(() => {
    if (groups.length < 2) return;
    function handleScroll() {
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 4;
      if (atBottom && !isProgrammaticScrollRef.current) {
        const lastKey = groups[groups.length - 1].monthKey;
        setActiveMonthKey((current) => (current === lastKey ? current : lastKey));
      }
      if (isProgrammaticScrollRef.current) scheduleScrollSettle();
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
      // Safety net: if `groups` changes mid-scroll (e.g. a filter edit) this
      // effect tears down and its settle timer is cleared without ever
      // firing — never leave the pin stuck on, or manual scrolling would
      // stop updating the active month (requirement 4).
      isProgrammaticScrollRef.current = false;
    };
  }, [groups]);

  // Both the month nav and long single-month listings can scroll the page
  // far enough that the site header/H1 (ordinary in-flow content above this
  // component — only the search/filter/month-nav bar here is sticky) is no
  // longer visible, with no way back except dragging the scrollbar. Surfaced
  // as its own small, independent scroll listener — deliberately not reusing
  // the month-tracking effect above, which only runs once there are 2+
  // months — so this works regardless of month count.
  const BACK_TO_TOP_THRESHOLD = 480;
  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > BACK_TO_TOP_THRESHOLD);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function handleBackToTop() {
    // Smooth (unlike handleMonthNavClick's own instant jump, which replaces
    // a native #hash anchor jump and matches that browser default) — this
    // button is a deliberate, visible "return to the top" action, so an
    // animated scroll is the more legible affordance for it (Back-to-top
    // control, 2026-09-11). Doesn't touch isProgrammaticScrollRef/the
    // month-nav pin: scroll-spy keeps updating activeMonthKey normally
    // throughout, correctly landing on the first month once the scroll
    // reaches the top, exactly as an ordinary manual scroll-up would.
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  const activeDrawerFilterCount = (genre !== "all" ? 1 : 0) + (venueId !== "all" ? 1 : 0);
  const draftDrawerFilterCount = (draftGenre !== "all" ? 1 : 0) + (draftVenueId !== "all" ? 1 : 0);

  function clearFilters() {
    setMode("all");
    setGenre("all");
    setVenueId("all");
    setQuery("");
  }

  const countLabel = `${filtered.length} event${filtered.length === 1 ? "" : "s"}`;
  const draftCountLabel = `${draftFiltered.length} event${draftFiltered.length === 1 ? "" : "s"}`;

  // Seeds the draft genre/venue from the currently applied values right as
  // the mobile sheet opens (filter-state architecture rework, 2026-09-12),
  // so editing the draft always starts from what's actually applied, and a
  // stale draft from a previous open-without-applying session never leaks
  // into a new one.
  function openMobileFilters() {
    setDraftGenre(genre);
    setDraftVenueId(venueId);
    setMobileFiltersOpen(true);
  }

  // Commits the draft genre/venue to the real, applied filter state and
  // closes the sheet — the ONE point where the mobile drawer's edits ever
  // reach the live event list/month reconciliation, so that reflow only
  // ever happens once the sheet is already closing, never while it's still
  // open and covering/scroll-locking the page underneath.
  function applyMobileFilters() {
    setGenre(draftGenre);
    setVenueId(draftVenueId);
    setMobileFiltersOpen(false);
  }

  const genreSelect = (id: string) => (
    <select
      id={id}
      value={genre}
      onChange={(e) => setGenre(e.target.value as MainGenreSlug | "all")}
      className={selectClasses(genre !== "all")}
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
      className={selectClasses(venueId !== "all")}
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
        <div className="mx-auto max-w-6xl px-4 py-2.5 sm:px-6 sm:py-3">
          {/* ---- Mobile (< sm): search + Filters on one row, scrollable quick filters below ---- */}
          <div className="flex flex-col gap-2 sm:hidden">
            <div className="flex items-center gap-2">
              {/* text-base (16px), not text-sm: iOS Safari auto-zooms the
                  viewport on focus for any text input/select below 16px.
                  leading-5 keeps the line-height (and so the control's
                  height) identical to the old text-sm — only the font-size
                  itself crosses the 16px threshold. */}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events"
                aria-label="Search events, artists or venues"
                className="search-field min-w-0 flex-1 rounded-full border border-border-strong bg-surface-1 px-4 py-2 text-base leading-5 text-text-primary placeholder:text-text-tertiary focus:border-text-secondary"
              />
              <button
                ref={mobileFiltersTriggerRef}
                type="button"
                onClick={openMobileFilters}
                aria-haspopup="dialog"
                aria-pressed={activeDrawerFilterCount > 0}
                className={
                  "inline-flex min-h-[2.25rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors " +
                  (activeDrawerFilterCount > 0
                    ? "border-accent bg-accent/15 text-accent-strong"
                    : "border-border-strong text-text-secondary hover:text-text-primary")
                }
              >
                <FilterIcon />
                {activeDrawerFilterCount > 0 ? `Filters · ${activeDrawerFilterCount}` : "Filters"}
              </button>
            </div>

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

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="self-start text-xs font-medium text-accent hover:text-accent-strong"
              >
                Clear filters
              </button>
            )}
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
                className="search-field w-full rounded-full border border-border-strong bg-surface-1 px-3.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-text-secondary"
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
              {groups.map((g) => {
                const isActive = g.monthKey === activeMonthKey;
                return (
                  <a
                    key={g.monthKey}
                    href={`#month-${g.monthKey}`}
                    onClick={(e) => {
                      e.preventDefault();
                      handleMonthNavClick(g.monthKey);
                    }}
                    className={
                      "shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors " +
                      (isActive
                        ? "text-accent underline decoration-accent underline-offset-4"
                        : "text-text-tertiary hover:text-text-primary")
                    }
                  >
                    {formatMonthAbbrTitleCase(g.month)}
                  </a>
                );
              })}
            </div>
          </nav>
        )}
      </div>

      {/* Mobile-only result count, moved out of the top control row. */}
      <p className="px-4 pt-2 text-[11px] text-text-tertiary sm:hidden">{countLabel}</p>

      {/* ---- Mobile filters sheet: Genre + Venue ---- */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-bg/70"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={mobileFiltersDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-surface-1 shadow-2xl"
          >
            <div className="flex items-center justify-between p-4 pb-3">
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

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="genre-filter-mobile" className="mb-1.5 block text-xs font-semibold text-text-secondary">
                    Genre
                  </label>
                  {/* text-base, not text-sm — same iOS auto-zoom fix as the
                      mobile search input above. */}
                  <select
                    id="genre-filter-mobile"
                    value={draftGenre}
                    onChange={(e) => setDraftGenre(e.target.value as MainGenreSlug | "all")}
                    className="w-full rounded border border-border-strong bg-surface-2 px-3.5 py-3 text-base leading-5 text-text-primary"
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
                    value={draftVenueId}
                    onChange={(e) => setDraftVenueId(e.target.value)}
                    className="w-full rounded border border-border-strong bg-surface-2 px-3.5 py-3 text-base leading-5 text-text-primary"
                  >
                    <option value="all">All venues</option>
                    {venueOptions.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-border bg-surface-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {draftDrawerFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftGenre("all");
                    setDraftVenueId("all");
                  }}
                  className="min-h-[2.75rem] flex-1 rounded border border-border-strong text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={applyMobileFilters}
                className="min-h-[2.75rem] flex-[2] rounded bg-accent text-xs font-semibold uppercase tracking-wide text-accent-on"
              >
                Show {draftCountLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {groups.length === 0 ? (
          <EmptyState
            title={mode === "all" ? "No events match" : MODE_EMPTY_TITLE[mode as Exclude<Mode, "all">]}
            hint={hasActiveFilters ? "Try a different date range or clear your filters." : "Check back soon — new events are added every week."}
          />
        ) : (
          groups.map((group) => (
            <section key={group.monthKey} id={`month-${group.monthKey}`} className="scroll-mt-40 py-6 sm:py-8">
              <h2 className="font-display mb-3 flex items-baseline gap-2 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
                <span className="text-accent">{formatMonthFull(group.month)}</span>
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

      {showBackToTop && (
        <button
          type="button"
          onClick={handleBackToTop}
          aria-label="Back to top"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface-1/95 text-text-secondary shadow-lg backdrop-blur transition-colors hover:text-text-primary sm:bottom-6 sm:right-6"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M8 12.5V3.5M4 7.5 8 3.5l4 4" />
          </svg>
        </button>
      )}
    </div>
  );
}
