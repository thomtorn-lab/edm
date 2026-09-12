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
  //
  // Threshold calibration (Production fix, 2026-09-12): the header+H1 block
  // measures ~160-190px tall against the real compiled site CSS across
  // mobile/desktop widths — the previous 480px threshold was ~2.5-3x that,
  // so the button stayed hidden through a long stretch of scrolling
  // (including after a single nearby month-nav click) during which the
  // header/H1 were already gone with no way back. 300px below is
  // comfortably past the new 240px threshold on any viewport actually seen.
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

  it("Production fix, 2026-09-12: appears at the new, lower calibrated threshold (240px) — the old 480px threshold stayed hidden through this exact range, well after the header/H1 had already scrolled out of view", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(200);
    fireEvent.scroll(window);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();

    setScrollY(260);
    fireEvent.scroll(window);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });

  it("appears after a month-navigation click alone, once the resulting scroll position is reported — a moderate jump (well below the old 480px threshold) is enough under the new calibration", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    fireEvent.click(screen.getByRole("link", { name: "Sep" }));
    // jsdom's scrollIntoView is a no-op, so the resulting real-browser
    // scroll position is simulated directly — 300px is a plausible jump to
    // a nearby month, comfortably below the old 480px threshold (which
    // would have kept the button hidden here) but above the new one.
    setScrollY(300);
    fireEvent.scroll(window);

    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });

  it("still appears and works correctly while a filter is active", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    fireEvent.change(genreSelect, { target: { value: "techno" } });

    setScrollY(300);
    fireEvent.scroll(window);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("scrolls to the true document top, not merely to the sticky filter/month-nav bar — window.scrollTo is called with top: 0, the same target regardless of scroll depth", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(5000); // deep in the list, far past any sticky element's own offset
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("carries distinct mobile vs desktop positioning classes, so it never collides with the mobile search/Filters row or the desktop control row", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(300);
    fireEvent.scroll(window);

    const button = screen.getByRole("button", { name: "Back to top" });
    // Mobile: closer to the edge (bottom-[...]/right-4); desktop (sm:):
    // slightly further in (sm:bottom-6/sm:right-6) — both fixed at the
    // bottom-right corner, well clear of the sticky top bar and the
    // bottom-anchored mobile filters sheet trigger.
    expect(button.className).toContain("right-4");
    expect(button.className).toContain("sm:bottom-6");
    expect(button.className).toContain("sm:right-6");
  });

  it("the mobile filters sheet, at a higher z-layer, still fully covers Back to top when both would otherwise be visible at once", () => {
    render(<EventExplorer events={[AUG_EVENT, SEP_EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    setScrollY(300);
    fireEvent.scroll(window);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

    const backToTop = screen.getByRole("button", { name: "Back to top" });
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(Number(sheet.parentElement?.className.match(/z-(\d+)/)?.[1])).toBeGreaterThan(
      Number(backToTop.className.match(/z-(\d+)/)?.[1])
    );
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

describe("EventExplorer — mobile iOS auto-zoom fix (2026-09-12): mobile text inputs/selects render at >= 16px so focusing them never triggers Safari's viewport zoom", () => {
  afterEach(cleanup);

  const EVENT = makeEvent("2026-08-10T20:00:00.000Z");

  function openMobileDrawer() {
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
  }

  it("the mobile search input renders at text-base (16px), not text-sm (14px)", () => {
    render(<EventExplorer events={[EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    const mobileSearch = screen.getByPlaceholderText("Search events") as HTMLInputElement;
    expect(mobileSearch.className).toContain("text-base");
    expect(mobileSearch.className).not.toMatch(/\btext-sm\b/);
  });

  it("the mobile filter drawer's Genre and Venue selects render at text-base (16px), not text-sm (14px)", () => {
    render(<EventExplorer events={[EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    openMobileDrawer();

    const genreSelect = document.getElementById("genre-filter-mobile") as HTMLSelectElement;
    const venueSelect = document.getElementById("venue-filter-mobile") as HTMLSelectElement;

    expect(genreSelect.className).toContain("text-base");
    expect(genreSelect.className).not.toMatch(/\btext-sm\b/);
    expect(venueSelect.className).toContain("text-base");
    expect(venueSelect.className).not.toMatch(/\btext-sm\b/);
  });

  it("the desktop search input and Genre/Venue selects are unaffected — still their original (smaller) desktop sizing", () => {
    render(<EventExplorer events={[EVENT]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();

    const desktopSearch = screen.getByPlaceholderText("Search events, artists, venues");
    const genreSelect = screen.getByLabelText("Genre") as HTMLSelectElement;
    const venueSelect = screen.getByLabelText("Venue") as HTMLSelectElement;

    expect(desktopSearch.className).toContain("text-xs");
    expect(genreSelect.className).toContain("text-xs");
    expect(venueSelect.className).toContain("text-xs");
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

  it("restores focus with preventScroll: true, so restoring focus never yanks the page's scroll position (mobile filter-drawer bug fix, 2026-09-12)", () => {
    openSheet();
    const trigger = screen.getByRole("button", { name: /^Filters/ });
    const focusSpy = vi.spyOn(trigger, "focus");

    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
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

  it("requirement 1: applying a filter that the current month still matches preserves the current month, explicitly scrolling it into view (simplified filter-apply model, 2026-09-12: always scroll, no visibility check)", () => {
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
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
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

  it("requirement 3: current month loses all matches, no LATER month matches -> falls back to the calendar-nearest EARLIER matching month (not simply the earliest one overall — product rule updated 2026-09-12)", () => {
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

    // Aug is 2 calendar months from Oct, Jul is 3 — Aug wins as the nearer
    // earlier match, not Jul merely because it's the earliest one overall.
    expect(activeMonthLabel()).toBe("Aug");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });

  it("requirement 4 (superseded by the filter-origin product rule, 2026-09-12): clearing every filter control back to default RESTORES the month the user started the filter session in, not wherever filtering had temporarily moved them", () => {
    // A second surviving month (Oct) keeps the nav bar visible post-filter.
    const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "trance");
    const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
    const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
    render(<EventExplorer events={[aug, sep, oct]} serverNow="2026-08-01T12:00:00.000Z" />);
    vi.runOnlyPendingTimers();
    expect(activeMonthLabel()).toBe("Aug"); // the origin the session must later return to

    selectGenre("techno"); // Aug drops out, auto-scrolls to Sep (nearest match)
    expect(activeMonthLabel()).toBe("Sep");

    selectGenre("all"); // clear the filter — Aug's event is back, and Aug (the origin) must become active again

    expect(activeMonthLabel()).toBe("Aug");
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: "start", behavior: "smooth" });
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
    it("locked-in scenario: August and November both have an electronic-other event, user is in November, selecting the electronic-other filter keeps November active and explicitly scrolls to it, never August", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[aug, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("electronic-other"); // the "Electronic / Other" bucket — November's own event matches it

      // November still matches -> stays active, and is explicitly scrolled
      // into view (simplified filter-apply model, 2026-09-12: always scroll
      // the computed target, no visibility check). Nothing here should ever
      // choose August: it's earlier, not later, than November, so it can
      // only ever be a fallback target when NO later month matches AND the
      // active month itself has lost its own match — neither is true here.
      expect(activeMonthLabel()).toBe("Nov");
      expect(activeMonthLabel()).not.toBe("Aug");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    });

    it("scrolls the active month's own section back into view when a filter-driven reflow has clamped scroll position away from it", () => {
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
      // month", only scrolls back to it.
      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("the filter-apply scroll reuses the programmatic-scroll pin, so scroll-spy cannot fight it mid-scroll, and scroll-spy resumes normally once it settles (no separate intent-released lock)", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[aug, nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");

      selectGenre("electronic-other");
      expect(activeMonthLabel()).toBe("Nov"); // filter-apply scroll fired, still the same month

      // Stale observer data arriving mid-scroll must not win — same pin
      // handleMonthNavClick's own scroll already relies on.
      latestObserver().trigger("2026-08");
      expect(activeMonthLabel()).toBe("Nov");

      // Once the settle window elapses, scroll-spy resumes normally with no
      // further action required — the simplified model (2026-09-12) has no
      // separate intent-released lock beyond this transient pin.
      vi.advanceTimersByTime(200);
      latestObserver().trigger("2026-12");
      expect(activeMonthLabel()).toBe("Dec");
    });
  });

  describe("product rule update, 2026-09-12 — zero-match reconciliation picks the calendar-CLOSEST matching month in either direction (replaces the earlier forward-only 'nearest later month' rule)", () => {
    it("1. a nearer EARLIER month beats a much-later month", () => {
      // Active: November. Matches: October (1 month away) and February (3
      // months away). October must win — this is the exact Production
      // scenario (filter + month-navigation follow-up investigation,
      // 2026-09-12) that motivated the rule change.
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance"); // will be filtered out
      const feb = makeGenreEvent("2027-02-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov, feb]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno");

      expect(activeMonthLabel()).toBe("Oct");
      expect(activeMonthLabel()).not.toBe("Feb");
    });

    it("2. a nearer LATER month beats a further-away earlier month", () => {
      // Active: November. Matches: September (2 months away) and December
      // (1 month away). December must win.
      const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance"); // will be filtered out
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[sep, nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno");

      expect(activeMonthLabel()).toBe("Dec");
      expect(activeMonthLabel()).not.toBe("Sep");
    });

    it("3. an exact tie between an earlier and a later month prefers the LATER month", () => {
      // Active: November. Matches: October and December, both exactly 1
      // month away. December (the later one) must win the tie-break.
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance"); // will be filtered out
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno");

      expect(activeMonthLabel()).toBe("Dec");
    });

    it("4. only EARLIER matches exist -> the nearest earlier month wins, not the earliest one overall", () => {
      // Active: October. Matches: July (3 months away) and August (2 months
      // away). August must win.
      vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
      const jul = makeGenreEvent("2026-07-10T20:00:00.000Z", "techno");
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
      const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "trance"); // will be filtered out
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "trance"); // will be filtered out
      render(<EventExplorer events={[jul, aug, sep, oct]} serverNow="2026-07-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-10");
      expect(activeMonthLabel()).toBe("Oct");

      selectGenre("techno");

      expect(activeMonthLabel()).toBe("Aug");
      expect(activeMonthLabel()).not.toBe("Jul");
    });

    it("5. only LATER matches exist -> the nearest later month wins", () => {
      // Active: August. Matches: September (1 month away) and December (4
      // months away). September must win.
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "trance"); // will be filtered out
      const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[aug, sep, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();
      expect(activeMonthLabel()).toBe("Aug");

      selectGenre("techno");

      expect(activeMonthLabel()).toBe("Sep");
      expect(activeMonthLabel()).not.toBe("Dec");
    });

    it("6. the active month still has matches -> no jump to a different month, but still explicitly scrolled to itself (unaffected by the distance rule)", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[aug, oct]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();
      expect(activeMonthLabel()).toBe("Aug");

      selectGenre("techno"); // both months still match

      expect(activeMonthLabel()).toBe("Aug");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    });

    it("7. zero matches anywhere -> no scroll, previous month context preserved (unaffected by the distance rule)", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
      const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[aug, sep]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-09");
      expect(activeMonthLabel()).toBe("Sep");

      selectGenre("trance"); // matches nothing at all

      expect(document.querySelector('nav[aria-label="Jump to month"]')).toBeNull();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

      selectGenre("all");

      expect(activeMonthLabel()).toBe("Sep");
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("mobile filter-drawer bug fix, 2026-09-12 — the bottom-of-page fallback must not overwrite an in-flight programmatic scroll target", () => {
    it("A. pinned-window protection: a bottom-of-page scroll arriving before the settle delay does not overwrite the reconciliation effect's chosen target with the last matching month", () => {
      // Aug is filtered out, Sep is 1 month from Aug (the nearest match),
      // Dec is the globally LAST matching month and 4 months from Aug — if
      // the atBottom branch ever wins this race it forces Dec, exactly the
      // Production symptom (a filter-driven reflow followed by a stray
      // bottom-of-page scroll event, e.g. from the mobile drawer closing).
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "trance"); // will be filtered out
      const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[aug, sep, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();
      expect(activeMonthLabel()).toBe("Aug");

      selectGenre("techno"); // pins to Sep (the calendar-nearest match) and starts settling
      expect(activeMonthLabel()).toBe("Sep");

      // Before the 150ms settle delay elapses, a scroll event reports the
      // page at its (now much shorter, post-filter) bottom.
      stubScrollGeometry({ atBottom: true });
      fireEvent.scroll(window);

      // Sep must still be active — Dec (the last month) must NOT have won.
      expect(activeMonthLabel()).toBe("Sep");
      expect(activeMonthLabel()).not.toBe("Dec");
    });

    it("B. legitimate at-bottom behavior survives once the settle window has elapsed: a genuine bottom-of-page scroll can still activate the last month", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "trance");
      const sep = makeGenreEvent("2026-09-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[aug, sep, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      selectGenre("techno"); // pins to Sep
      expect(activeMonthLabel()).toBe("Sep");

      vi.advanceTimersByTime(200); // past the settle delay — the pin is released

      // A genuine scroll to the bottom of the page now legitimately
      // activates the last month, exactly as before this fix.
      stubScrollGeometry({ atBottom: true });
      fireEvent.scroll(window);

      expect(activeMonthLabel()).toBe("Dec");
    });
  });

  describe("filter-state architecture rework, 2026-09-12 — filter-origin capture + mobile draft state", () => {
    function openMobileDrawer() {
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    }
    function mobileGenreSelect(): HTMLSelectElement {
      return document.getElementById("genre-filter-mobile") as HTMLSelectElement;
    }
    function selectMobileGenre(value: string) {
      fireEvent.change(mobileGenreSelect(), { target: { value } });
    }
    function tapShowEvents() {
      fireEvent.click(screen.getByRole("button", { name: /^Show/ }));
    }

    it("1. MOBILE: opening the drawer and changing the genre draft does not change the live event groups or active month before 'Show N events' is tapped", () => {
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "house");
      render(<EventExplorer events={[nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();
      expect(activeMonthLabel()).toBe("Nov");
      expect(screen.getAllByText("2 events").length).toBeGreaterThan(0);

      openMobileDrawer();
      selectMobileGenre("house"); // draft only — must not touch the live list behind the (open, covering) sheet

      expect(activeMonthLabel()).toBe("Nov");
      expect(screen.getAllByText("2 events").length).toBeGreaterThan(0);
      expect(screen.getByText(nov.title)).toBeTruthy();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it("2. MOBILE: November -> Electronic / Other draft -> 'Show N events' commits the filter and reconciles to the calendar-closest matching month, not the globally last one (the original Production bug scenario)", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance"); // will be filtered out
      const feb = makeGenreEvent("2027-02-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[oct, nov, feb]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      openMobileDrawer();
      selectMobileGenre("electronic-other");
      tapShowEvents();

      expect(activeMonthLabel()).toBe("Oct");
      expect(activeMonthLabel()).not.toBe("Feb");
    });

    it("3. MOBILE: closing/cancelling the drawer without tapping 'Show N events' discards the draft — filters and active month stay exactly as they were, and the next open re-seeds from the real (unchanged) values", () => {
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "house");
      render(<EventExplorer events={[nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      openMobileDrawer();
      selectMobileGenre("house");
      fireEvent.click(screen.getByRole("button", { name: "Close filters" })); // cancel, not apply

      expect(screen.getAllByText("2 events").length).toBeGreaterThan(0);
      expect(activeMonthLabel()).toBe("Nov");

      openMobileDrawer();
      expect(mobileGenreSelect().value).toBe("all");
    });

    it("4. FILTER ORIGIN: filtering from November to the calendar-closest match (October) leaves the origin captured as November, not overwritten by the temporary move", () => {
      // A second, much-farther techno match (Mar 2027) keeps the nav bar
      // itself visible once filtered (it hides once only one month remains)
      // without disturbing which month is actually closest to November.
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      render(<EventExplorer events={[oct, mar, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno");
      expect(activeMonthLabel()).toBe("Oct");

      // The origin is not directly observable except through what Clear
      // Filters returns to — assert that directly.
      selectGenre("all");
      expect(activeMonthLabel()).toBe("Nov");
    });

    it("5. CLEAR: tapping the actual 'Clear filters' control (not just resetting one select) returns to the filter-session origin month", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      render(<EventExplorer events={[oct, mar, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno");
      expect(activeMonthLabel()).toBe("Oct");

      fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);

      expect(activeMonthLabel()).toBe("Nov");
    });

    it("6. FILTER ORIGIN: multiple filter edits within the same session never overwrite the original origin month", () => {
      // A second, much-farther match for each genre (Mar/Apr 2027) keeps
      // the nav bar visible at every filtered step without changing which
      // month is actually closest.
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "house");
      const apr = makeGenreEvent("2027-04-10T20:00:00.000Z", "house");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      render(<EventExplorer events={[oct, mar, dec, apr, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno"); // -> Oct (closest to November)
      expect(activeMonthLabel()).toBe("Oct");

      selectGenre("house"); // a second edit within the same filtered session -> Dec (closest to October)
      expect(activeMonthLabel()).toBe("Dec");

      selectGenre("all"); // clear — must still return to the ORIGINAL origin, November
      expect(activeMonthLabel()).toBe("Nov");
    });

    it("7. FILTER ORIGIN: after Clear Filters, a brand-new filter session captures a fresh origin from wherever the user is now, not the old one", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "house");
      const apr = makeGenreEvent("2027-04-10T20:00:00.000Z", "house");
      render(<EventExplorer events={[oct, mar, nov, apr]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno"); // -> Oct, origin captured as November
      expect(activeMonthLabel()).toBe("Oct");

      selectGenre("all"); // clear -> back to November, origin cleared
      expect(activeMonthLabel()).toBe("Nov");
      vi.advanceTimersByTime(200); // past the restore's own settle delay, so scroll-spy is unpinned again

      // A genuine manual scroll (not a filter) to a different month, then a
      // brand-new filter session starting from THIS new position.
      latestObserver().trigger("2026-10");
      expect(activeMonthLabel()).toBe("Oct");

      selectGenre("house"); // October itself has no house match -> moves to November (closest)
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("all"); // clear -> must return to the NEW origin, October — not the stale November
      expect(activeMonthLabel()).toBe("Oct");
    });

    it("8. DESKTOP: the desktop genre select still filters immediately — no draft/commit step involved", () => {
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
      const sep = makeGenreEvent("2026-08-11T20:00:00.000Z", "house");
      render(<EventExplorer events={[aug, sep]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();
      expect(screen.getAllByText("2 events").length).toBeGreaterThan(0);

      selectGenre("techno"); // this describe's own selectGenre() drives the desktop control

      expect(screen.getAllByText("1 event").length).toBeGreaterThan(0);
      expect(screen.queryByText(sep.title)).toBeNull();
    });

    it("9. the closest-month tie-break still prefers the later month, unaffected by the filter-origin/draft rework", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno"); // Oct and Dec are both exactly 1 month away

      expect(activeMonthLabel()).toBe("Dec");
    });

    it("10. the origin restoration on Clear Filters is protected by the programmatic-scroll pin: stale scroll-spy data and an at-bottom scroll mid-settle cannot override it", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno"); // -> Dec (tie-break later); November captured as origin
      expect(activeMonthLabel()).toBe("Dec");

      selectGenre("all"); // clear -> restoring to November
      expect(activeMonthLabel()).toBe("Nov");

      // Before the settle window elapses, stale scroll-spy data and a
      // bottom-of-page scroll both arrive — neither may win the pin.
      latestObserver().trigger("2026-12");
      stubScrollGeometry({ atBottom: true });
      fireEvent.scroll(window);

      expect(activeMonthLabel()).toBe("Nov");
    });
  });

  describe("React-effect review, 2026-09-12 — filter-origin capture/restore folded into a single effect pass (ref-based), verified free of duplicate reconciliation", () => {
    it("A. DESKTOP: November -> immediate genre filter reconciles to the closest month in exactly one scroll — origin capture and reconciliation happen in the same pass, not two", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      render(<EventExplorer events={[oct, mar, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno");

      expect(activeMonthLabel()).toBe("Oct");
      // Exactly one scroll — if origin capture ever forced a second,
      // redundant run of the reconciliation logic, this would be 2.
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

      // The origin (November) is only observable through what Clear
      // Filters returns to.
      selectGenre("all");
      expect(activeMonthLabel()).toBe("Nov");
    });

    it("C. CLEAR: restoring the origin after Clear Filters performs exactly one scroll", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      render(<EventExplorer events={[oct, mar, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno");
      expect(activeMonthLabel()).toBe("Oct");
      const callsAfterFilter = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;

      selectGenre("all");

      expect(activeMonthLabel()).toBe("Nov");
      expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        callsAfterFilter + 1
      );
    });

    it("F. ZERO RESULTS: the origin survives a zero-result filtered state (captured, but nothing to reconcile) and restores correctly once filters are cleared", () => {
      // A second month (Dec) keeps the nav bar visible whenever unfiltered,
      // so the origin/restoration is directly checkable via activeMonthLabel().
      const aug = makeGenreEvent("2026-08-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[aug, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();
      expect(activeMonthLabel()).toBe("Aug");

      selectGenre("trance"); // matches nothing at all -> groups.length === 0

      expect(screen.getByText("No events match")).toBeTruthy();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

      selectGenre("all");

      // The origin (August, captured before the zero-result filter) is
      // restored — trivially true here since it never moved, but this
      // proves the ref survives an entire zero-result session rather than
      // being dropped the moment `groups.length === 0` short-circuits.
      expect(activeMonthLabel()).toBe("Aug");
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("highest-priority product rule, 2026-09-12 — the active month must never change after a filter if it still has at least one matching event", () => {
    it("November has a matching event, other months also match -> stays in November, explicitly scrolled to it, never a programmatic scroll to another month", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno"); // November still matches, and so does October

      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    });

    it("root-cause regression: a freshly re-created scroll-spy observer's own automatic initial report must not steal the active month away when it still matches (real-browser IntersectionObserver behavior — every newly observed section fires once with its current state; jsdom's mock does not do this automatically, so this test triggers it explicitly to stand in for it)", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");

      selectGenre("techno"); // November still matches -> the "stay" branch, explicitly scrolled
      expect(activeMonthLabel()).toBe("Nov");

      // The scroll-spy IntersectionObserver was torn down and recreated
      // because `groups` changed (the filter application itself) — a real
      // browser's freshly created observer always fires once, reporting
      // each newly observed section's CURRENT intersection state, even
      // though nothing actually scrolled. Simulate that automatic report
      // claiming October is topmost, during the same settle window — the
      // programmatic-scroll pin (armed by the filter-apply scroll itself)
      // ignores it.
      latestObserver().trigger("2026-10");

      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    });

    it("Clear Filters restoring the origin still behaves correctly afterward (unaffected by this fix)", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov, mar]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno"); // November drops out -> moves to October (closest)
      expect(activeMonthLabel()).toBe("Oct");

      selectGenre("all"); // Clear Filters -> restores the original origin, November
      expect(activeMonthLabel()).toBe("Nov");
    });
  });

  describe("INVESTIGATION, 2026-09-12 — mobile 'active month lost to February' Production report: state-level trace (diagnostic only, per explicit instruction not to add another timing fix yet)", () => {
    function openMobileDrawer() {
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    }
    function mobileGenreSelect(): HTMLSelectElement {
      return document.getElementById("genre-filter-mobile") as HTMLSelectElement;
    }
    function selectMobileGenre(value: string) {
      fireEvent.change(mobileGenreSelect(), { target: { value } });
    }
    function tapShowEvents() {
      fireEvent.click(screen.getByRole("button", { name: /^Show/ }));
    }
    function novemberSectionPresent(): boolean {
      return screen.queryByRole("link", { name: "Nov" }) !== null;
    }

    it("A. taxonomy proof: an event whose public badge reads 'Electronic' has 'electronic-other' in its subgenres, so it necessarily passes the electronic-other filter predicate (mainGenreOf is an identity mapping for this slug) — this is a static proof, not an assumption; see also src/lib/taxonomy.ts's GENRES table where 'electronic-other' is the ONLY slug with shortLabel 'Electronic'", () => {
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      // The public badge (EventRow -> displayGenres -> shortLabel) reads
      // "Electronic" for this exact event, proving subgenres contains
      // "electronic-other".
      expect(screen.getByText("Electronic")).toBeTruthy();

      // Applying the electronic-other filter must keep this exact event.
      selectGenre("electronic-other");
      expect(screen.getByText(nov.title)).toBeTruthy();
    });

    it("B/C (real mobile flow, real-scale distribution): November remains in filtered `groups` after the full mobile apply sequence — confirmed by the November nav pill and section still being present immediately after 'Show N events'", () => {
      // Mirrors the reported shape: November has a genuinely-electronic
      // event, a distant unrelated month exists so the nav bar itself
      // stays visible, and a Feb 2027 electronic-other event exists too
      // (the exact month Production reported landing on) so it's a
      // plausible closest-later match if November ever dropped out — which
      // this test proves it does NOT.
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      const feb = makeGenreEvent("2027-02-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[nov, feb]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      expect(activeMonthLabel()).toBe("Nov");
      expect(novemberSectionPresent()).toBe(true);

      openMobileDrawer();
      selectMobileGenre("electronic-other"); // draftGenre only — groups must not move yet
      expect(activeMonthLabel()).toBe("Nov");

      tapShowEvents(); // commits genre=electronic-other, closes drawer

      // groups after apply: November must still be present — this is the
      // direct answer to the "Key question": YES, November remains in the
      // filtered groups.
      expect(novemberSectionPresent()).toBe(true);
      expect(activeMonthLabel()).toBe("Nov");
      expect(activeMonthLabel()).not.toBe("Feb");
    });

    it("D/E (root cause, protected case): WITHIN the fixed 150ms window, a freshly re-created scroll-spy observer's own automatic initial report is correctly ignored, even in the exact mobile apply sequence", () => {
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      const feb = makeGenreEvent("2027-02-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[nov, feb]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      openMobileDrawer();
      selectMobileGenre("electronic-other");
      tapShowEvents();
      expect(activeMonthLabel()).toBe("Nov");

      // Simulate, with NO time elapsed (worst case for a fast device), the
      // freshly re-created observer's own automatic initial report
      // claiming February is topmost.
      latestObserver().trigger("2027-02");

      expect(activeMonthLabel()).toBe("Nov");
    });
  });

  describe("simplified filter-apply model, 2026-09-12 — filter-apply always explicitly scrolls to a deterministic target (current month if still matching, else calendar-closest); no separate intent-released lock", () => {
    function openMobileDrawer() {
      fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    }
    function mobileGenreSelect(): HTMLSelectElement {
      return document.getElementById("genre-filter-mobile") as HTMLSelectElement;
    }
    function selectMobileGenre(value: string) {
      fireEvent.change(mobileGenreSelect(), { target: { value } });
    }
    function tapShowEvents() {
      fireEvent.click(screen.getByRole("button", { name: /^Show/ }));
    }

    it("1. current month still matches -> explicit scroll to the same month, via the mobile draft -> Show N events commit flow", () => {
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      const feb = makeGenreEvent("2027-02-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[nov, feb]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      openMobileDrawer();
      selectMobileGenre("electronic-other");
      tapShowEvents();

      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    });

    it("2. current month has zero matches -> explicit scroll to the calendar-closest matching month", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov, mar]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno"); // November drops out -> closest match, October

      expect(activeMonthLabel()).toBe("Oct");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });

      // Scroll-spy is free to move again immediately after the settle
      // window — no separate lock outlives it.
      vi.advanceTimersByTime(200);
      latestObserver().trigger("2027-03");
      expect(activeMonthLabel()).toBe("Mar");
    });

    it("3. an equal-distance tie between an earlier and later matching month prefers the later one, and still explicitly scrolls", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "techno");
      render(<EventExplorer events={[oct, nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno");

      expect(activeMonthLabel()).toBe("Dec");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    });

    it("4. mobile draft filters do not affect the live list before 'Show N events' is tapped", () => {
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "techno");
      const dec = makeGenreEvent("2026-12-10T20:00:00.000Z", "house");
      render(<EventExplorer events={[nov, dec]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();
      expect(activeMonthLabel()).toBe("Nov");

      openMobileDrawer();
      selectMobileGenre("house"); // draft only

      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it("5. Show N events commits the draft exactly once and scrolls to the correct target, not the globally last month", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "electronic-other");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance"); // will be filtered out
      const feb = makeGenreEvent("2027-02-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[oct, nov, feb]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      openMobileDrawer();
      selectMobileGenre("electronic-other");
      tapShowEvents();

      expect(activeMonthLabel()).toBe("Oct"); // calendar-closest to November, not February
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("6. Clear Filters still returns to the filter-session origin month, unaffected by the simplified filter-apply model", () => {
      const oct = makeGenreEvent("2026-10-10T20:00:00.000Z", "techno");
      const mar = makeGenreEvent("2027-03-10T20:00:00.000Z", "techno");
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "trance");
      render(<EventExplorer events={[oct, mar, nov]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("techno"); // -> October
      expect(activeMonthLabel()).toBe("Oct");

      selectGenre("all"); // Clear -> back to November
      expect(activeMonthLabel()).toBe("Nov");
    });

    it("7. desktop behavior is identical to mobile: the immediate genre select explicitly scrolls to the current month when it still matches", () => {
      const nov = makeGenreEvent("2026-11-10T20:00:00.000Z", "electronic-other");
      const feb = makeGenreEvent("2027-02-10T20:00:00.000Z", "electronic-other");
      render(<EventExplorer events={[nov, feb]} serverNow="2026-08-01T12:00:00.000Z" />);
      vi.runOnlyPendingTimers();

      latestObserver().trigger("2026-11");
      selectGenre("electronic-other"); // desktop select, immediate — no drawer involved

      expect(activeMonthLabel()).toBe("Nov");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    });
  });
});
