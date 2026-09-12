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
    subVenue: null,
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
    adminUnpublishReason: null,
    adminUnpublishNote: null,
    adminUnpublishedAt: null,
    sourceCancelledAt: null,
    sourceCancelledBySourceId: null,
    sourceCancellationEvidence: null,
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
  // jsdom performs no real layout — every element's getBoundingClientRect()
  // is all zeros by default, which (with innerHeight stubbed to 800 above)
  // would make isSectionVisible's "rect.bottom > 0" check read every single
  // section as already scrolled out of view, for every test, regardless of
  // scenario. Default to an ordinary "visible, comfortably within the
  // viewport" rect instead — the realistic default — and let individual
  // tests override a specific section's rect (setSectionRect below) to
  // simulate the one real-browser case this matters for: a filter-driven
  // reflow clamping scroll position away from the still-active month.
  Element.prototype.getBoundingClientRect = () =>
    ({ top: 100, bottom: 300, left: 0, right: 800, width: 800, height: 200, x: 0, y: 100, toJSON: () => "" }) as DOMRect;
});

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { value, configurable: true });
}

/** Overrides one month section's own getBoundingClientRect, e.g. to simulate a real-browser reflow clamp having pushed it out of view. */
function setSectionRect(monthKey: string, rect: Partial<DOMRect>) {
  const el = document.getElementById(`month-${monthKey}`);
  if (!el) throw new Error(`no section rendered for month-${monthKey}`);
  el.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => "", ...rect }) as DOMRect;
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

  it("scrolls to the true top SMOOTHLY and clears a stale month hash when activated (2026-09-11: was an instant jump, now animated)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    // Simulate having navigated via month nav first (sets the hash).
    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    expect(window.location.hash).toBe("#month-2026-09");

    setScrollY(600);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
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

    // A native <button type="button"> activates on both click AND keyboard
    // Enter/Space per the HTML spec (the browser dispatches the same click
    // event either way) — this is what makes the element itself the
    // keyboard-accessibility guarantee, not any extra JS in this component.
    fireEvent.click(button);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("works independent of month count — appears on scroll even with a single month", () => {
    render(<EventExplorer events={[AUG_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(600);
    fireEvent.scroll(window);

    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });

  it("respects the mobile safe-area inset at the bottom edge (same env(safe-area-inset-bottom) pattern already used by the mobile filters sheet)", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(600);
    fireEvent.scroll(window);

    const button = screen.getByRole("button", { name: "Back to top" });
    expect(button.className).toContain("bottom-[max(1rem,env(safe-area-inset-bottom))]");
  });

  it("sits at a lower stacking layer (z-40) than the mobile filters sheet (z-50), so an open sheet always covers it rather than the reverse", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(600);
    fireEvent.scroll(window);

    const button = screen.getByRole("button", { name: "Back to top" });
    expect(button.className).toContain("z-40");
  });

  it("does not change Month nav's own click-to-scroll/highlight behavior — clicking a month still works normally after Back to top exists", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));

    expect(screen.getByRole("link", { name: "Sep" }).className).toContain("text-accent");
    expect(screen.getByRole("link", { name: "Aug" }).className).not.toContain("text-accent");
    expect(window.location.hash).toBe("#month-2026-09");
  });

  it("using Back to top after a month-nav jump leaves scroll-spy free to reflect the top of the page — no leftover pin from the month click", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    // Let the month click's own scroll-settle pin (isProgrammaticScrollRef)
    // expire naturally, exactly as it would well before a real user could
    // scroll back down and reach for Back to top.
    vi.advanceTimersByTime(200);

    setScrollY(600);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));

    // The IntersectionObserver mock reports Aug as the section back in view
    // once scrolled to the top — this must not be blocked by the month
    // click's own settle-timer pin, which only that click itself arms.
    latestObserver().trigger("2026-08");
    expect(screen.getByRole("link", { name: "Aug" }).className).toContain("text-accent");
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

describe("EventExplorer — genre display integrity + filter inheritance (2026-09-11 audit)", () => {
  afterEach(cleanup);

  const DEEP_HOUSE_EVENT = {
    ...makeEvent("2026-08-10T20:00:00.000Z"),
    primaryGenre: "deep-house" as GenreSlug,
    subgenres: ["deep-house"] as GenreSlug[],
  };
  const MELODIC_TECHNO_EVENT = {
    ...makeEvent("2026-08-11T20:00:00.000Z"),
    primaryGenre: "melodic-techno" as GenreSlug,
    subgenres: ["melodic-techno"] as GenreSlug[],
  };
  const INDUSTRIAL_EVENT = {
    ...makeEvent("2026-08-12T20:00:00.000Z"),
    primaryGenre: "industrial" as GenreSlug,
    subgenres: ["industrial"] as GenreSlug[],
  };
  const TRANCE_EVENT = {
    ...makeEvent("2026-08-13T20:00:00.000Z"),
    primaryGenre: "trance" as GenreSlug,
    subgenres: ["trance"] as GenreSlug[],
  };
  const ALL_EVENTS = [DEEP_HOUSE_EVENT, MELODIC_TECHNO_EVENT, INDUSTRIAL_EVENT, TRANCE_EVENT];

  function selectGenre(value: string) {
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    fireEvent.change(genreSelect, { target: { value } });
  }

  // Several genre labels used below ("House", "Techno", "Hard Techno",
  // "Trance") are ALSO literal option text in the always-present Genre
  // filter <select> (desktop + mobile), so a plain screen.getByText would
  // match the dropdown option itself regardless of what's in the event
  // list — these helpers exclude <option> elements so assertions only see
  // real event-card content.
  const ignoreOptions = { ignore: "option, script, style" };
  const cardText = (text: string) => screen.getByText(text, ignoreOptions);
  const queryCardText = (text: string) => screen.queryByText(text, ignoreOptions);
  const allCardText = (text: string) => screen.getAllByText(text, ignoreOptions);

  it("shows Deep House's own event row tagged 'Deep House', not the broader 'House'", () => {
    render(<EventExplorer events={[DEEP_HOUSE_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(cardText("Deep House")).toBeTruthy();
    expect(queryCardText("House")).toBeNull();
  });

  it("shows Melodic Techno's own event row tagged 'Melodic Techno', not the broader 'Techno'", () => {
    render(<EventExplorer events={[MELODIC_TECHNO_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(cardText("Melodic Techno")).toBeTruthy();
    expect(queryCardText("Techno")).toBeNull();
  });

  it("shows Industrial's own event row tagged 'Industrial', not 'Techno' or 'Hard Techno'", () => {
    render(<EventExplorer events={[INDUSTRIAL_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(cardText("Industrial")).toBeTruthy();
    expect(queryCardText("Techno")).toBeNull();
    expect(queryCardText("Hard Techno")).toBeNull();
  });

  it("Deep House is discoverable under the broader 'House' filter (parent-group inheritance)", () => {
    render(<EventExplorer events={ALL_EVENTS} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    selectGenre("house");
    expect(cardText("Deep House")).toBeTruthy();
    expect(queryCardText("Melodic Techno")).toBeNull();
    expect(queryCardText("Industrial")).toBeNull();
    expect(queryCardText("Trance")).toBeNull();
  });

  it("Melodic Techno and Industrial are both discoverable under the broader 'Techno' filter, with no duplicate rows", () => {
    render(<EventExplorer events={ALL_EVENTS} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    selectGenre("techno");
    expect(allCardText("Melodic Techno")).toHaveLength(1);
    expect(allCardText("Industrial")).toHaveLength(1);
    expect(queryCardText("Deep House")).toBeNull();
    expect(queryCardText("Trance")).toBeNull();
  });

  it("an event tagged with an unrelated genre (Trance) is unaffected by the Techno/House filter change", () => {
    render(<EventExplorer events={ALL_EVENTS} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    selectGenre("trance");
    expect(cardText("Trance")).toBeTruthy();
    expect(queryCardText("Deep House")).toBeNull();
    expect(queryCardText("Melodic Techno")).toBeNull();
    expect(queryCardText("Industrial")).toBeNull();
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

describe("EventExplorer — filter + month-navigation context behavior (2026-09-12)", () => {
  afterEach(cleanup);

  function selectGenre(value: string) {
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    fireEvent.change(genreSelect, { target: { value } });
  }

  function activeMonthLabel(): string {
    const link = document.querySelector('nav[aria-label="Jump to month"] a.text-accent');
    if (!link) throw new Error("no month is currently marked active");
    return link.textContent ?? "";
  }

  function makeGenreEvent(startIso: string, genreSlug: GenreSlug): EventWithVenue {
    return { ...makeEvent(startIso), primaryGenre: genreSlug, subgenres: [genreSlug] };
  }

  it("requirement 1: applying a filter that the current month still matches preserves the current month — no scroll", () => {
    // A second surviving month (Oct) keeps the month-nav bar itself visible
    // after filtering (it hides once only one month remains) so the active
    // highlight stays checkable.
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "trance"); // will be filtered out
    const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
    render(<EventExplorer events={[aug, sep, oct]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(activeMonthLabel()).toBe("Aug");

    selectGenre("techno"); // keeps Aug's and Oct's events, drops Sep's

    expect(activeMonthLabel()).toBe("Aug");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("requirement 2: current month loses all matches, a LATER month still matches -> auto-scrolls to the nearest later month", () => {
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "trance"); // will be filtered out
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
    const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
    render(<EventExplorer events={[aug, sep, oct]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(activeMonthLabel()).toBe("Aug");

    selectGenre("techno");

    expect(activeMonthLabel()).toBe("Sep"); // nearest later month with matches, not Oct
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });

  it("requirement 3: current month loses all matches, no LATER month matches -> falls back to the first month with matches", () => {
    // Two surviving months (Jul, Aug) keep the nav bar visible after
    // filtering, so the active highlight stays checkable.
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z")); // so July itself still counts as upcoming
    const jul = makeGenreEvent("2026-07-10T20:00:00.000Z", "techno");
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "trance"); // will be filtered out
    const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "trance"); // will be filtered out
    render(<EventExplorer events={[jul, aug, sep, oct]} serverNow="2026-07-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    // Move to October first (a genuine prior scroll position), then filter it away along with September.
    latestObserver().trigger("2026-10");
    expect(activeMonthLabel()).toBe("Oct");

    selectGenre("techno");

    expect(activeMonthLabel()).toBe("Jul"); // no later match exists -> first matching month
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });

  it("requirement 4: clearing the filter preserves whatever month is currently active — no jump to top, no reset", () => {
    // A second surviving month (Oct) keeps the nav bar visible post-filter.
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "trance");
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
    const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
    render(<EventExplorer events={[aug, sep, oct]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    selectGenre("techno"); // Aug drops out, auto-scrolls to Sep (nearest later match)
    expect(activeMonthLabel()).toBe("Sep");
    const callsAfterFilter = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;

    selectGenre("all"); // clear the filter — Aug's event is back, but Sep must remain active

    expect(activeMonthLabel()).toBe("Sep");
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFilter);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("regression: a zero-match filter never discards the previous month context, so clearing it restores that same month with no scroll", () => {
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
    const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
    render(<EventExplorer events={[aug, sep, oct]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    // 1. Establish an active month that is NOT the first month.
    latestObserver().trigger("2026-09");
    expect(activeMonthLabel()).toBe("Sep");

    // 2. Apply a filter that matches nothing anywhere.
    selectGenre("trance");
    expect(screen.getByText("No events match")).toBeTruthy();
    expect(document.querySelector('nav[aria-label="Jump to month"]')).toBeNull();

    // 3. No scroll occurred.
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    // 4. Clear the filter.
    selectGenre("all");

    // 5. September's context is preserved (not reset to August, the first month).
    expect(activeMonthLabel()).toBe("Sep");

    // 6. Clearing never triggers a scroll either.
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("requirement: no matches anywhere never attempts a scroll", () => {
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
    render(<EventExplorer events={[aug]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    selectGenre("trance"); // matches nothing at all

    expect(screen.getByText("No events match")).toBeTruthy();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector('nav[aria-label="Jump to month"]')).toBeNull();
  });

  it("month navigation stays navigation only — clicking a month never changes which events are shown", () => {
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "trance");
    render(<EventExplorer events={[aug, sep]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(screen.getAllByText("2 events").length).toBeGreaterThan(0); // mobile + desktop count labels

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));

    // Still both events, both still rendered — a month-nav tap only scrolls/highlights.
    expect(screen.getAllByText("2 events").length).toBeGreaterThan(0);
    expect(screen.getByText(aug.title)).toBeTruthy();
    expect(screen.getByText(sep.title)).toBeTruthy();
  });

  it("scroll-spy resumes normally after a filter-triggered auto-scroll settles", () => {
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "trance");
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
    const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
    render(<EventExplorer events={[aug, sep, oct]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    selectGenre("techno"); // auto-scrolls to Sep, pinning scroll-spy
    expect(activeMonthLabel()).toBe("Sep");

    vi.advanceTimersByTime(200); // past the settle delay — the pin should now be released

    latestObserver().trigger("2026-10"); // a genuine manual scroll to October
    expect(activeMonthLabel()).toBe("Oct");
  });

  describe("Production bug fix, 2026-09-12 — Electronic/Other genre filter + month-navigation viewport", () => {
    it("locked-in scenario: August and November both have an electronic-other event, user is in November, selecting the electronic-other filter keeps November active and never intentionally selects or scrolls to August", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[aug, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("electronic-other"); // the "Electronic / Other" bucket — November's own event matches it

      // November still matches -> stays active. Nothing here should ever
      // choose August: it's earlier, not later, than November, so it can
      // only ever be a fallback target when NO later month matches AND the
      // active month itself has lost its own match — neither is true here.
      expect(activeMonthLabel()).toBe("Nov");
      expect(activeMonthLabel()).not.toBe("Aug");
      // Both months' rects are the default "comfortably visible" stub, so
      // no corrective scroll should fire either.
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it("real-browser reflow limitation: jsdom cannot model layout, so this simulates a post-filter reflow clamp by directly overriding the active month's bounding rect, and confirms the SAME month is scrolled back into view (never a different one)", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[aug, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      // Simulate a real browser having clamped scroll position away from
      // November's section once the filtered page reflows shorter — jsdom
      // does no real layout, so this is done by directly overriding the
      // section's own getBoundingClientRect to report itself well below the
      // viewport, standing in for what a genuine drastic reflow would do.
      setSectionRect("2026-11", { top: 2000, bottom: 2300 });

      selectGenre("electronic-other");

      // Still the SAME month — the fix never treats this as "pick another
      // month", only "make sure this one is actually visible".
      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("does not scroll at all when the active month's section is already visible after filtering — only a genuine displacement triggers the corrective scroll", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[aug, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      // November's rect stays at the default "comfortably visible" stub — no override.

      selectGenre("electronic-other");

      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it("the corrective scroll reuses the programmatic-scroll pin, so scroll-spy cannot fight it mid-scroll and resumes normally once it settles", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[aug, nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      setSectionRect("2026-11", { top: 2000, bottom: 2300 }); // simulate reflow displacement

      selectGenre("electronic-other");
      expect(activeMonthLabel()).toBe("Nov"); // corrective scroll fired, still the same month

      // Stale observer data arriving mid-scroll must not win — same pin
      // handleMonthNavClick's own scroll already relies on.
      latestObserver().trigger("2026-08");
      expect(activeMonthLabel()).toBe("Nov");

      // Once settled, scroll-spy resumes normally.
      vi.advanceTimersByTime(200);
      latestObserver().trigger("2026-12");
      expect(activeMonthLabel()).toBe("Dec");
    });
  });
});
