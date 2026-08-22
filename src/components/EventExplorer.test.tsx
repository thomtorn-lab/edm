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

describe("EventExplorer month heading — reference purple token (Round 11)", () => {
  it("the large month number (e.g. the purple '08' in '08 / AUGUST') uses exactly the text-accent token", () => {
    render(<EventExplorer events={[AUG_EVENT]} />);
    vi.runOnlyPendingTimers();
    const monthNumber = screen.getByText("08 /");
    const classes = monthNumber.className.split(/\s+/);
    // The purple accent token, reserved for brand/selected-state/active-nav
    // use (Round 13) — not for ordinary text-link hover states elsewhere.
    expect(classes).toContain("text-accent");
    expect(classes).not.toContain("text-accent-strong");
  });
});
