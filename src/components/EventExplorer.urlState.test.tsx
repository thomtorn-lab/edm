// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import EventExplorer from "./EventExplorer";
import type { HomepageEvent } from "@/lib/homepageEvents";
import type { GenreSlug } from "@/lib/taxonomy";
import { LIST_RETURN_STORAGE_KEY } from "@/lib/explorerFilters";

/**
 * URL-backed homepage filters (homepage search/navigation work,
 * 2026-10-13): EventExplorer starts from the filters in the URL and mirrors
 * every committed change back into it with history.replaceState — see
 * src/lib/explorerFilters.ts. useSearchParams is mocked here; outside the
 * App Router it returns null (the other EventExplorer tests rely on that).
 */

let mockSearchParams: URLSearchParams | null = null;
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const CULTURE_BOX = { id: "v-culture-box", slug: "culture-box", name: "Culture Box", address: "Kronprinsessegade 54A", aliases: [] };
const KB18 = { id: "v-kb18", slug: "kb18", name: "KB18", address: "Kødboderne 18", aliases: [] };

let counter = 0;
function makeEvent(overrides: Partial<HomepageEvent> & Pick<HomepageEvent, "startDatetime">): HomepageEvent {
  counter += 1;
  return {
    id: `e-${counter}`,
    slug: `event-${counter}`,
    title: `Event ${counter}`,
    description: null,
    artists: [],
    endDatetime: null,
    subVenue: null,
    primaryGenre: "techno" as GenreSlug,
    subgenres: ["techno"] as GenreSlug[],
    officialEventUrl: null,
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    canonicalSourceId: null,
    overriddenFields: [],
    priceFrom: null,
    soldOut: false,
    postponed: false,
    dateChanged: false,
    venue: CULTURE_BOX,
    ...overrides,
  } as HomepageEvent;
}

// Fake "now": Saturday 1 Aug 2026, 14:00 Copenhagen.
const SERVER_NOW = "2026-08-01T12:00:00.000Z";
const TONIGHT_HOUSE_CB = makeEvent({
  title: "Tonight House Night",
  startDatetime: "2026-08-01T20:00:00.000Z",
  primaryGenre: "house" as GenreSlug,
  subgenres: ["house"] as GenreSlug[],
  artists: ["TIM ANDRESEN"],
});
const LATER_TECHNO_KB18 = makeEvent({ title: "Later Techno Night", startDatetime: "2026-09-12T20:00:00.000Z", venue: KB18 });
const LATER_HOUSE_CB = makeEvent({
  title: "Later House Night",
  startDatetime: "2026-10-10T20:00:00.000Z",
  primaryGenre: "house" as GenreSlug,
  subgenres: ["house"] as GenreSlug[],
});
const PAST_ONLY_VENUE_EVENT = makeEvent({
  title: "Past Night",
  startDatetime: "2026-07-01T20:00:00.000Z",
  venue: { id: "v-gone", slug: "gone-venue", name: "Gone Venue", address: "x", aliases: [] },
});
const EVENTS = [TONIGHT_HOUSE_CB, LATER_TECHNO_KB18, LATER_HOUSE_CB, PAST_ONLY_VENUE_EVENT];

function renderAt(url: string) {
  window.history.replaceState(null, "", url);
  mockSearchParams = new URLSearchParams(window.location.search);
  return render(<EventExplorer events={EVENTS} serverNow={SERVER_NOW} />);
}

const titles = () => screen.queryAllByRole("link", { name: /Night/ }).map((a) => a.textContent ?? "");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(SERVER_NOW));
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mockSearchParams = null;
  window.history.replaceState(null, "", "/");
});

describe("EventExplorer — initial filters from the URL", () => {
  it("restores search, genre, venue and date range from the query string", () => {
    renderAt("/?when=tonight&genre=house&venue=culture-box&q=tim");
    const [mobileSearch, desktopSearch] = screen.getAllByRole("searchbox") as HTMLInputElement[];
    expect(mobileSearch.value).toBe("tim");
    expect(desktopSearch.value).toBe("tim");
    expect((document.getElementById("genre-filter") as HTMLSelectElement).value).toBe("house");
    expect((document.getElementById("venue-filter") as HTMLSelectElement).value).toBe("v-culture-box");
    for (const button of screen.getAllByRole("button", { name: "Tonight" })) {
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }
    expect(titles()).toEqual([expect.stringContaining("Tonight House Night")]);
  });

  it("shows the full list for a plain homepage URL", () => {
    renderAt("/");
    expect(titles()).toHaveLength(3);
  });

  it("ignores a venue slug that has no upcoming event in the list, keeping the other filters", () => {
    renderAt("/?venue=gone-venue&genre=house");
    expect((document.getElementById("venue-filter") as HTMLSelectElement).value).toBe("all");
    expect((document.getElementById("genre-filter") as HTMLSelectElement).value).toBe("house");
    expect(titles()).toHaveLength(2);
  });

  it("does not scroll on a mount that already starts filtered — the browser's own scroll restoration must win (back from an event page)", () => {
    renderAt("/?genre=house");
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("does not rewrite a URL that already matches the restored filters", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderAt("/?genre=house&q=tim");
    replaceState.mockClear();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("EventExplorer — mirroring filters into the URL", () => {
  it("writes a changed filter with replaceState, never pushState, keeping unrelated params and the month hash", () => {
    renderAt("/?utm_source=newsletter#month-2026-09");
    const pushState = vi.spyOn(window.history, "pushState");
    fireEvent.change(document.getElementById("genre-filter")!, { target: { value: "house" } });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/?utm_source=newsletter&genre=house#month-2026-09",
    );
    fireEvent.change(document.getElementById("venue-filter")!, { target: { value: "v-kb18" } });
    expect(window.location.search).toBe("?utm_source=newsletter&genre=house&venue=kb18");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("updates the URL while typing a search, without adding history entries", () => {
    renderAt("/");
    const lengthBefore = window.history.length;
    const desktopSearch = screen.getAllByRole("searchbox")[1];
    fireEvent.change(desktopSearch, { target: { value: "t" } });
    fireEvent.change(desktopSearch, { target: { value: "tim a" } });
    expect(window.location.search).toBe("?q=tim+a");
    expect(window.history.length).toBe(lengthBefore);
  });

  it("toggles the date range in and out of the URL", () => {
    renderAt("/");
    const [tonight] = screen.getAllByRole("button", { name: "Tonight" });
    fireEvent.click(tonight);
    expect(window.location.search).toBe("?when=tonight");
    fireEvent.click(tonight);
    expect(window.location.search).toBe("");
  });

  it("Clear filters returns to the plain homepage URL", () => {
    renderAt("/?when=tonight&genre=house&q=tim&utm_medium=email");
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(window.location.pathname + window.location.search).toBe("/?utm_medium=email");
    expect(titles()).toHaveLength(3);
  });

  it("does not write the mobile drawer's uncommitted draft into the URL — only once applied", () => {
    renderAt("/");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(document.getElementById("genre-filter-mobile")!, { target: { value: "house" } });
    expect(window.location.search).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /^Show \d+ events?$/ }));
    expect(window.location.search).toBe("?genre=house");
  });
});

describe("EventExplorer — remembering the list for '← All events'", () => {
  it("records the opened event and the current filtered list URL", () => {
    renderAt("/?genre=house&q=tim");
    fireEvent.click(screen.getByRole("link", { name: /Tonight House Night/ }));
    expect(JSON.parse(window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)!)).toEqual({
      eventPath: `/events/${TONIGHT_HOUSE_CB.slug}`,
      listUrl: "/?genre=house&q=tim",
    });
  });

  it("records the plain homepage for an unfiltered list, and leaves out unrelated params", () => {
    renderAt("/?utm_source=newsletter");
    fireEvent.click(screen.getByRole("link", { name: /Later Techno Night/ }));
    expect(JSON.parse(window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)!).listUrl).toBe("/");
  });

  it("ignores clicks on links that don't open an event page", () => {
    renderAt("/");
    fireEvent.click(screen.getAllByRole("link", { name: "KB18" })[0]);
    expect(window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)).toBeNull();
  });
});
