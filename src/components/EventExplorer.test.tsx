// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  stubScrollGeometry({ atBottom: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("EventExplorer month nav — active highlight", () => {
  it("tapping a month immediately highlights it, before any scroll/observer event resolves", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} />);
    vi.runOnlyPendingTimers(); // flush the post-mount setNow(new Date()) effect

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));

    expect(screen.getByRole("link", { name: "Sep" }).className).toContain("text-accent");
    expect(screen.getByRole("link", { name: "Aug" }).className).not.toContain("text-accent");
  });

  it("stays pinned on the tapped month while stale observer data arrives mid-scroll (requirement 2)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    // Simulate the observer firing mid-scroll with August still reported as
    // the topmost intersecting section — this is exactly the stale signal
    // that used to win the race and leave Aug highlighted.
    latestObserver().trigger("2026-08");

    expect(screen.getByRole("link", { name: "Sep" }).className).toContain("text-accent");
  });

  it("resumes scroll-spy once the scroll has settled (requirement 3)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    vi.advanceTimersByTime(200); // past the settle delay

    latestObserver().trigger("2026-08"); // a genuine manual scroll back to August
    expect(screen.getByRole("link", { name: "Aug" }).className).toContain("text-accent");
  });

  it("normal manual scrolling updates the active month with no nav tap involved (requirement 4)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT, OCT_EVENT]} />);
    vi.runOnlyPendingTimers();

    latestObserver().trigger("2026-09");
    expect(screen.getByRole("link", { name: "Sep" }).className).toContain("text-accent");

    latestObserver().trigger("2026-10");
    expect(screen.getByRole("link", { name: "Oct" }).className).toContain("text-accent");
  });

  it("activates the LAST month once the page is scrolled to the bottom, independent of the observer band (root-cause fix, requirement 5)", () => {
    // Three months so the fix is provably not keyed to any specific name —
    // whichever group is last (October here, not September) must win.
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT, OCT_EVENT]} />);
    vi.runOnlyPendingTimers();

    // No observer entry ever claims October is intersecting — this is
    // exactly the scenario where a short/near-page-end last section can
    // never satisfy the band, and only the bottom-of-page signal saves it.
    stubScrollGeometry({ atBottom: true });
    fireEvent.scroll(window);

    expect(screen.getByRole("link", { name: "Oct" }).className).toContain("text-accent");
  });

  it("does not special-case September: the same bottom-of-page fix applies when September is a middle month, not the last one", () => {
    render(<EventExplorer events={[SEP_EVENT, OCT_EVENT]} />);
    vi.runOnlyPendingTimers();

    stubScrollGeometry({ atBottom: true });
    fireEvent.scroll(window);

    // October (the actual last month here) must win, not September.
    expect(screen.getByRole("link", { name: "Oct" }).className).toContain("text-accent");
    expect(screen.getByRole("link", { name: "Sep" }).className).not.toContain("text-accent");
  });

  it("applies the accent/underline active-month treatment on desktop too, not just mobile", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} />);
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
    render(<EventExplorer events={[AUG_EVENT]} />);
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
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
    vi.runOnlyPendingTimers();
    const btn = filtersButton();
    expect(btn.textContent).toBe("Filters");
    expect(btn.className).toContain("border-border-strong");
    expect(btn.className).not.toContain("border-accent");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("turns purple (reusing the existing accent token) with only Genre active, and the Genre select itself picks up the same accent", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
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
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
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
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
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
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
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
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
    vi.runOnlyPendingTimers();
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    const venueSelect = screen.getByLabelText("Venue") as HTMLSelectElement;
    expect(genreSelect.className).toContain("accent-select");
    expect(venueSelect.className).toContain("accent-select");
  });

  it("both desktop and mobile search inputs carry the search-field hook and no longer turn purple on focus", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
    vi.runOnlyPendingTimers();
    const searchInputs = screen.getAllByLabelText("Search events, artists or venues") as HTMLInputElement[];
    expect(searchInputs.length).toBeGreaterThanOrEqual(2);
    for (const input of searchInputs) {
      expect(input.className).toContain("search-field");
      expect(input.className).not.toContain("focus:border-accent");
    }
  });

  it("the desktop search input uses a neutral focus border instead of the purple accent", () => {
    render(<EventExplorer events={[EVENT_A, EVENT_B]} />);
    vi.runOnlyPendingTimers();
    const desktopSearch = screen.getByPlaceholderText("Search events, artists, venues");
    expect(desktopSearch.className).toContain("focus:border-text-secondary");
  });
});
