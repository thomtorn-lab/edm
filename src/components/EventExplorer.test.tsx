// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import EventExplorer from "./EventExplorer";
import type { EventWithVenue } from "@/lib/queries";
import type { GenreSlug } from "@/lib/taxonomy";

/**
 * Regression coverage for the mobile month-nav active-highlight bug: tapping
 * a month must win immediately and stay pinned until the resulting scroll
 * settles, after which normal scroll-spy (IntersectionObserver) resumes —
 * see EventExplorer.tsx's isProgrammaticScrollRef/handleMonthNavClick and
 * the bottom-of-page fallback effect for the fix itself. jsdom does no real
 * layout, so IntersectionObserver is mocked here to let tests drive it
 * directly, and window/documentElement scroll geometry is stubbed per test.
 */

class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Test helper: simulate the browser reporting these sections as intersecting. */
  trigger(topId: string) {
    const entries = this.observed.map(
      (el) =>
        ({
          target: el,
          isIntersecting: el.id === `month-${topId}`,
          boundingClientRect: { top: el.id === `month-${topId}` ? 0 : 500 } as DOMRectReadOnly,
        }) as IntersectionObserverEntry,
    );
    // The real browser invokes this callback outside any React event
    // handler too, so React needs an explicit act() to flush the resulting
    // state update before a test can observe it.
    act(() => {
      this.callback(entries, this);
    });
  }
}

function latestObserver(): MockIntersectionObserver {
  const instance = MockIntersectionObserver.instances.at(-1);
  if (!instance) throw new Error("no IntersectionObserver instance was created");
  return instance;
}

function stubScrollGeometry({ atBottom }: { atBottom: boolean }) {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(window, "scrollY", { value: atBottom ? 2000 : 0, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: atBottom ? 2800 : 5000,
    configurable: true,
  });
}

const VENUE = {
  id: "v-test",
  slug: "test-venue",
  name: "Test Venue",
  aliases: [],
  address: "Test St 1",
  city: "Copenhagen" as const,
  postalCode: "1000",
  websiteUrl: null,
  description: "",
  shortDescription: null,
  venueProfile: null,
};

let eventCounter = 0;
function makeEvent(startIso: string): EventWithVenue {
  eventCounter += 1;
  return {
    id: `e-${eventCounter}`,
    title: `Test Event ${eventCounter}`,
    slug: `test-event-${eventCounter}`,
    description: null,
    artists: [],
    startDatetime: startIso,
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    primaryGenre: "techno" as GenreSlug,
    subgenres: ["techno"] as GenreSlug[],
    genreConfidence: "high",
    officialEventUrl: null,
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    imageUrl: null,
    priceFrom: null,
    currency: null,
    soldOut: false,
    cancelled: false,
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: null,
    createdAt: startIso,
    updatedAt: startIso,
    lastSourceCheck: null,
    lastChanged: null,
    venue: VENUE,
  };
}

const AUG_EVENT = makeEvent("2026-08-10T20:00:00.000Z");
const SEP_EVENT = makeEvent("2026-09-10T20:00:00.000Z");
const OCT_EVENT = makeEvent("2026-10-10T20:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  stubScrollGeometry({ atBottom: false });
});

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { value, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("EventExplorer month nav — active highlight", () => {
  it("tapping a month immediately highlights it, before any scroll/observer event resolves", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers(); // flush the post-mount setNow(new Date()) effect

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));

    expect(screen.getByRole("link", { name: "Sep" }).className).toContain("text-accent");
    expect(screen.getByRole("link", { name: "Aug" }).className).not.toContain("text-accent");
  });

  it("stays pinned on the tapped month while stale observer data arrives mid-scroll (requirement 2)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    // Simulate the observer firing mid-scroll with August still reported as
    // the topmost intersecting section — this is exactly the stale signal
    // that used to win the race and leave Aug highlighted.
    latestObserver().trigger("2026-08");

    expect(screen.getByRole("link", { name: "Sep" }).className).toContain("text-accent");
  });

  it("resumes scroll-spy once the scroll has settled (requirement 3)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    vi.advanceTimersByTime(200); // past the settle delay

    latestObserver().trigger("2026-08"); // a genuine manual scroll back to August
    expect(screen.getByRole("link", { name: "Aug" }).className).toContain("text-accent");
  });

  it("normal manual scrolling updates the active month with no nav tap involved (requirement 4)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT, OCT_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    latestObserver().trigger("2026-09");
    expect(screen.getByRole("link", { name: "Sep" }).className).toContain("text-accent");

    latestObserver().trigger("2026-10");
    expect(screen.getByRole("link", { name: "Oct" }).className).toContain("text-accent");
  });

  it("activates the LAST month once the page is scrolled to the bottom, independent of the observer band (root-cause fix, requirement 5)", () => {
    // Three months so the fix is provably not keyed to any specific name —
    // whichever group is last (October here, not September) must win.
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT, OCT_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    // No observer entry ever claims October is intersecting — this is
    // exactly the scenario where a short/near-page-end last section can
    // never satisfy the band, and only the bottom-of-page signal saves it.
    stubScrollGeometry({ atBottom: true });
    fireEvent.scroll(window);

    expect(screen.getByRole("link", { name: "Oct" }).className).toContain("text-accent");
  });

  it("does not special-case September: the same bottom-of-page fix applies when September is a middle month, not the last one", () => {
    render(<EventExplorer events={[SEP_EVENT, OCT_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    stubScrollGeometry({ atBottom: true });
    fireEvent.scroll(window);

    // October (the actual last month here) must win, not September.
    expect(screen.getByRole("link", { name: "Oct" }).className).toContain("text-accent");
    expect(screen.getByRole("link", { name: "Sep" }).className).not.toContain("text-accent");
  });

  it("applies the accent/underline active-month treatment on desktop too, not just mobile", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));

    // The active month must be clearly distinguishable from inactive months
    // at every breakpoint — desktop must not neutralize the accent/underline
    // treatment the way it used to.
    const sepLink = screen.getByRole("link", { name: "Sep" });
    expect(sepLink.className).toContain("text-accent");
    expect(sepLink.className).toContain("underline");
    expect(sepLink.className).not.toContain("sm:text-text-tertiary");
    expect(sepLink.className).not.toContain("sm:no-underline");
  });
});

describe("EventExplorer month heading — reference purple token (Round 14: no numeric prefix)", () => {
  it("the month name itself (e.g. 'AUGUST') uses exactly the text-accent token, with no numeric prefix", () => {
    render(<EventExplorer events={[AUG_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(screen.queryByText(/^08 \/?$/)).toBeNull();
    expect(screen.queryByText(/08 \/ AUGUST/)).toBeNull();
    const monthName = screen.getByText("AUGUST");
    const classes = monthName.className.split(/\s+/);
    // The purple accent token, reserved for brand/selected-state/active-nav
    // use (Round 13) — not for ordinary text-link hover states elsewhere.
    expect(classes).toContain("text-accent");
    expect(classes).not.toContain("text-accent-strong");
  });
});

describe("EventExplorer — Back to top", () => {
  // The site header/H1 live above this component (see app/page.tsx) and are
  // ordinary in-flow content, not sticky — only this component's own
  // search/filter/month-nav bar is sticky. Clicking a later month (or any
  // long scroll) can push the header/H1 fully out of view with no way back
  // except a manual drag-scroll. This button is the fix; jsdom has no real
  // layout so it can't assert pixel visibility of the header/H1 itself
  // (verified separately in a real browser), but it can assert the button's
  // own presence/absence and behavior precisely.
  it("is not rendered at the initial, unscrolled top of the page", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });

  it("appears once the page is scrolled down past the threshold", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(600);
    fireEvent.scroll(window);

    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });

  it("disappears again once scrolled back near the top", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(600);
    fireEvent.scroll(window);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();

    setScrollY(0);
    fireEvent.scroll(window);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });

  it("scrolls to the true top and clears a stale month hash when activated", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    // Simulate having navigated via month nav first (sets the hash).
    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    expect(window.location.hash).toBe("#month-2026-09");

    setScrollY(600);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(window.location.hash).toBe("");
  });

  it("is a real, keyboard-activatable button (not a div) with an accessible name", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(600);
    fireEvent.scroll(window);

    const button = screen.getByRole("button", { name: "Back to top" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");

    fireEvent.click(button);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it("works independent of month count — appears on scroll even with a single month", () => {
    render(<EventExplorer events={[AUG_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(600);
    fireEvent.scroll(window);

    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });
});

describe("EventExplorer — Filters button active state (Round 15)", () => {
  afterEach(cleanup);

  const OTHER_VENUE = { ...VENUE, id: "v-other", slug: "other-venue", name: "Other Venue" };
  const EVENT_A = makeEvent("2026-08-10T20:00:00.000Z");
  const EVENT_B = { ...makeEvent("2026-08-12T20:00:00.000Z"), venueId: OTHER_VENUE.id, venue: OTHER_VENUE };

  function selectSecondOption(select: HTMLSelectElement) {
    const value = (select.querySelectorAll("option")[1] as HTMLOptionElement).value;
    fireEvent.change(select, { target: { value } });
  }

  function filtersButton() {
    return screen.getByRole("button", { name: /^Filters/ });
  }

  it("stays neutral (not purple) with no active Genre/Venue filter", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const btn = filtersButton();
    expect(btn.textContent).toBe("Filters");
    expect(btn.className).toContain("border-border-strong");
    expect(btn.className).not.toContain("border-accent");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("turns purple (reusing the existing accent token) with only Genre active, and the Genre select itself picks up the same accent", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    selectSecondOption(genreSelect);
    const btn = filtersButton();
    expect(btn.textContent).toBe("Filters · 1");
    expect(btn.className).toContain("border-accent");
    expect(btn.className).toContain("bg-accent/15");
    expect(btn.className).toContain("text-accent-strong");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    // Desktop has no single wrapping "Filters" control — the Genre/Venue
    // selects themselves are the desktop equivalent, so each carries the
    // same active-state accent individually when it has a real selection.
    expect(genreSelect.className).toContain("border-accent");
    expect(genreSelect.className).toContain("text-accent-strong");
    const venueSelect = screen.getByLabelText("Venue") as HTMLSelectElement;
    expect(venueSelect.className).not.toContain("border-accent");
  });

  it("turns purple with only Venue active, and the Venue select itself picks up the same accent", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const venueSelect = screen.getByLabelText("Venue") as HTMLSelectElement;
    selectSecondOption(venueSelect);
    const btn = filtersButton();
    expect(btn.textContent).toBe("Filters · 1");
    expect(btn.className).toContain("border-accent");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(venueSelect.className).toContain("border-accent");
    expect(venueSelect.className).toContain("text-accent-strong");
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    expect(genreSelect.className).not.toContain("border-accent");
  });

  it("stays purple with both Genre and Venue active, reflecting the count, and both selects carry the accent", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    const venueSelect = screen.getByLabelText("Venue") as HTMLSelectElement;
    selectSecondOption(genreSelect);
    selectSecondOption(venueSelect);
    const btn = filtersButton();
    expect(btn.textContent).toBe("Filters · 2");
    expect(btn.className).toContain("border-accent");
    expect(genreSelect.className).toContain("border-accent");
    expect(venueSelect.className).toContain("border-accent");
  });

  it("returns to neutral once Genre and Venue are cleared back to 'all', including the selects themselves", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    const venueSelect = screen.getByLabelText("Venue") as HTMLSelectElement;
    selectSecondOption(genreSelect);
    selectSecondOption(venueSelect);
    fireEvent.change(genreSelect, { target: { value: "all" } });
    fireEvent.change(venueSelect, { target: { value: "all" } });
    const btn = filtersButton();
    expect(btn.textContent).toBe("Filters");
    expect(btn.className).not.toContain("border-accent");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(genreSelect.className).not.toContain("border-accent");
    expect(venueSelect.className).not.toContain("border-accent");
  });
});

describe("EventExplorer — Genre/Venue and Search focus treatment (Round 16)", () => {
  afterEach(cleanup);

  const OTHER_VENUE = { ...VENUE, id: "v-other", slug: "other-venue", name: "Other Venue" };
  const EVENT_A = makeEvent("2026-08-10T20:00:00.000Z");
  const EVENT_B = { ...makeEvent("2026-08-12T20:00:00.000Z"), venueId: OTHER_VENUE.id, venue: OTHER_VENUE };

  // Chromium marks <select> and <input type="search"> as :focus-visible even
  // on a plain mouse click (unlike <button>), so the sitewide purple
  // `:focus-visible` outline in globals.css needs a scoped, higher-specificity
  // override for these controls — see the .accent-select/.search-field hooks
  // asserted below, and globalsCssCascade.test.ts for the CSS-side guard.

  it("Genre and Venue selects carry the accent-select hook that neutralizes the sitewide purple focus-visible ring", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    const venueSelect = screen.getByLabelText("Venue") as HTMLSelectElement;
    expect(genreSelect.className).toContain("accent-select");
    expect(venueSelect.className).toContain("accent-select");
  });

  it("both desktop and mobile search inputs carry the search-field hook and no longer turn purple on focus", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const searchInputs = screen.getAllByLabelText("Search events, artists or venues") as HTMLInputElement[];
    expect(searchInputs.length).toBeGreaterThanOrEqual(2);
    for (const input of searchInputs) {
      expect(input.className).toContain("search-field");
      expect(input.className).not.toContain("focus:border-accent");
    }
  });

  it("the desktop search input uses a neutral focus border instead of the purple accent", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const desktopSearch = screen.getByPlaceholderText("Search events, artists, venues");
    expect(desktopSearch.className).toContain("focus:border-text-secondary");
  });
});

describe("EventExplorer — mobile Filters sheet focus containment (QA follow-up, 2026-08-29)", () => {
  afterEach(cleanup);

  const EVENT = makeEvent("2026-08-10T20:00:00.000Z");

  function openSheet() {
    render(<EventExplorer events={[EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    return screen.getByRole("dialog", { name: "Filters" });
  }

  it("moves focus into the sheet on open, to its first focusable control", () => {
    openSheet();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close filters");
  });

  it("Tab from the last focusable control wraps back to the first, never escaping into the page behind the sheet", () => {
    const dialog = openSheet();
    const showButton = screen.getByRole("button", { name: /^Show/ });
    showButton.focus();
    expect(document.activeElement).toBe(showButton);

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close filters");
  });

  it("Shift+Tab from the first focusable control wraps to the last, never escaping into the page behind the sheet", () => {
    const dialog = openSheet();
    const closeButton = screen.getByRole("button", { name: "Close filters" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Show/ }));
  });

  it("restores focus to the Filters trigger button after Escape closes the sheet", () => {
    const dialog = openSheet();
    const trigger = screen.getByRole("button", { name: /^Filters/ });
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("restores focus to the Filters trigger button after the close button dismisses the sheet", () => {
    openSheet();
    const trigger = screen.getByRole("button", { name: /^Filters/ });
    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("EventExplorer — 'All venues' excludes a venue with only past events (Production bug, 2026-08-29)", () => {
  afterEach(cleanup);

  // Real-world shape of the bug: Nemoland's only event was months in the
  // past by the time this was reported, but it kept appearing in "All
  // venues". PAST_VENUE here plays that role; UPCOMING_VENUE is a normal
  // venue that must keep appearing, proving this isn't just "the dropdown
  // is empty" but a real exclude-only-this-one behavior.
  const PAST_VENUE = { ...VENUE, id: "v-past-only", slug: "past-only-venue", name: "Past Only Venue" };
  const UPCOMING_VENUE = { ...VENUE, id: "v-upcoming", slug: "upcoming-venue", name: "Upcoming Venue" };
  const PAST_EVENT = { ...makeEvent("2026-01-10T20:00:00.000Z"), venueId: PAST_VENUE.id, venue: PAST_VENUE };
  const UPCOMING_EVENT = { ...makeEvent("2026-08-10T20:00:00.000Z"), venueId: UPCOMING_VENUE.id, venue: UPCOMING_VENUE };

  function venueDropdownOptions(): string[] {
    const select = screen.getByLabelText("Venue", { exact: true }) as HTMLSelectElement;
    return Array.from(select.querySelectorAll("option")).map((o) => o.textContent ?? "");
  }

  it("excludes the past-only venue from the actual server-rendered HTML — before any effect has ever run (the real SSR/first-paint bug)", () => {
    // react-dom/server's renderToStaticMarkup never runs effects — this is
    // the one way to genuinely observe what a real Next.js server render
    // (and a client's first paint before hydration) produces, which
    // React Testing Library's render() cannot: RTL wraps every render in
    // act(), and act() flushes useEffect synchronously regardless of fake
    // timers, so it can never observe the pre-effect state on its own.
    // Before this fix, `now` started at `null` there and venueOptions fell
    // back to the full unfiltered `events` list, so this exact assertion
    // would have failed — Nemoland-like past-only venues were genuinely
    // present in real Production HTML, not just a passing visual flash.
    const html = renderToStaticMarkup(<EventExplorer events={[PAST_EVENT, UPCOMING_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    expect(html).toContain("Upcoming Venue");
    expect(html).not.toContain("Past Only Venue");
  });

  it("still excludes the past-only venue after hydration settles (steady-state, unchanged from before)", () => {
    render(<EventExplorer events={[PAST_EVENT, UPCOMING_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const options = venueDropdownOptions();
    expect(options).toContain("Upcoming Venue");
    expect(options).not.toContain("Past Only Venue");
  });

  it("a venue with zero events at all is also absent from 'All venues'", () => {
    render(<EventExplorer events={[UPCOMING_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const options = venueDropdownOptions();
    expect(options).toContain("Upcoming Venue");
    expect(options).not.toContain("Past Only Venue");
  });
});

describe("EventExplorer — 'now' stays fresh without a reload (public event integrity work package, 2026-09-04)", () => {
  afterEach(cleanup);

  // Root cause of 5 real reference cases (KARRUSEL AFTERPARTY, 240 Months
  // of Riotvan, Sonicfest, Cinna Peyghamy, ALICE TUNES IN) staying visible
  // past their end: `now` was set exactly once on mount and never again, so
  // a tab left open past an event's end kept rendering it as upcoming
  // forever. These tests prove `now` is now kept fresh by both the 1-minute
  // interval and the visibilitychange listener — see EventExplorer.tsx.
  it("an event disappears once its end passes, on its own, via the periodic interval refresh — no reload, no prop change", () => {
    const event = { ...makeEvent("2026-08-01T20:00:00.000Z"), endDatetime: "2026-08-01T22:00:00.000Z" };
    vi.setSystemTime(new Date("2026-08-01T21:00:00.000Z"));
    render(<EventExplorer events={[event]} serverNow="2026-08-01T21:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(screen.queryByText(event.title)).not.toBeNull();

    act(() => {
      vi.setSystemTime(new Date("2026-08-01T22:01:00.000Z")); // past the stored end
      vi.advanceTimersByTime(60_000); // one interval tick
    });

    expect(screen.queryByText(event.title)).toBeNull();
  });

  it("an event disappears immediately on tab refocus (visibilitychange), even before the next interval tick", () => {
    const event = { ...makeEvent("2026-08-01T20:00:00.000Z"), endDatetime: "2026-08-01T22:00:00.000Z" };
    vi.setSystemTime(new Date("2026-08-01T21:00:00.000Z"));
    render(<EventExplorer events={[event]} serverNow="2026-08-01T21:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(screen.queryByText(event.title)).not.toBeNull();

    act(() => {
      vi.setSystemTime(new Date("2026-08-01T22:01:00.000Z"));
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.queryByText(event.title)).toBeNull();
  });

  it("an event that has NOT yet ended survives an interval tick (no false-positive removal)", () => {
    const event = { ...makeEvent("2026-08-01T20:00:00.000Z"), endDatetime: "2026-08-01T22:00:00.000Z" };
    vi.setSystemTime(new Date("2026-08-01T21:00:00.000Z"));
    render(<EventExplorer events={[event]} serverNow="2026-08-01T21:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    act(() => {
      vi.setSystemTime(new Date("2026-08-01T21:30:00.000Z")); // still before end
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.queryByText(event.title)).not.toBeNull();
  });
});
