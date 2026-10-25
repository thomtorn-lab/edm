// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
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

describe("EventExplorer — genre links (main genres include subgenres, legacy sets, aliases, unknown values)", () => {
  const genreEvent = (title: string, subgenres: GenreSlug[], day: number) =>
    makeEvent({ title, startDatetime: `2026-09-${String(day).padStart(2, "0")}T20:00:00.000Z`, primaryGenre: subgenres[0], subgenres });
  const GENRE_EVENTS = [
    genreEvent("Techno Night", ["techno"], 1),
    genreEvent("Melodic Night", ["melodic-techno"], 2),
    genreEvent("Industrial Night", ["industrial"], 3),
    genreEvent("Techno Industrial Night", ["techno", "industrial"], 4),
    genreEvent("Dubstep Night", ["dubstep"], 5),
    genreEvent("Garage Night", ["garage"], 6),
    genreEvent("Hardstyle Night", ["hardstyle"], 7),
    genreEvent("Rawstyle Night", ["rawstyle"], 8),
    genreEvent("Hardcore Night", ["hardcore"], 9),
    genreEvent("Hypnotic Night", ["hypnotic-techno"], 10),
    genreEvent("Ambient Night", ["ambient"], 11),
    genreEvent("Experimental Night", ["experimental"], 12),
    genreEvent("Legacy Ambient Night", ["ambient-experimental"], 13),
    genreEvent("Jungle Night", ["jungle"], 14),
  ];
  function renderGenresAt(url: string) {
    window.history.replaceState(null, "", url);
    mockSearchParams = new URLSearchParams(window.location.search);
    return render(<EventExplorer events={GENRE_EVENTS} serverNow={SERVER_NOW} />);
  }
  // Longest matching title wins: "Techno Industrial Night" also contains "Industrial Night".
  const byLength = [...GENRE_EVENTS].sort((a, b) => b.title.length - a.title.length);
  const listed = () => titles().map((t) => byLength.find((e) => t.includes(e.title))?.title).filter(Boolean).sort();
  const notice = () => screen.queryByRole("status");

  // Genre system revision (2026-10-24 — intended change from #161): Techno
  // is a main genre and includes its subgenres again, via the explicit
  // hierarchy; Industrial is standalone and stays out.
  it("?genre=techno lists Techno and techno-subgenre events, each once — not Industrial-only events", () => {
    renderGenresAt("/?genre=techno");
    expect(listed()).toEqual(["Hypnotic Night", "Melodic Night", "Techno Industrial Night", "Techno Night"]);
  });

  it("?genre=melodic-techno (a subgenre) stays exact", () => {
    renderGenresAt("/?genre=melodic-techno");
    expect(listed()).toEqual(["Melodic Night"]);
  });

  it("?genre=garage and ?genre=uk-garage both select UK Garage, and the URL is written back as uk-garage", () => {
    renderGenresAt("/?genre=garage");
    expect(listed()).toEqual(["Garage Night"]);
    expect((document.getElementById("genre-filter") as HTMLSelectElement).value).toBe("garage");
    expect(window.location.search).toBe("?genre=uk-garage");
    cleanup();
    renderGenresAt("/?genre=uk-garage");
    expect(listed()).toEqual(["Garage Night"]);
    expect(notice()).toBeNull();
  });

  it("the legacy ?genre=ambient-experimental link covers Ambient, Experimental and the legacy stored value", () => {
    renderGenresAt("/?genre=ambient-experimental");
    expect(listed()).toEqual(["Ambient Night", "Experimental Night", "Legacy Ambient Night"]);
    const select = document.getElementById("genre-filter") as HTMLSelectElement;
    expect(Array.from(select.options).find((o) => o.value === "ambient-experimental")!.hidden).toBe(true);
    expect(notice()).toBeNull();
  });

  it("?genre=drum-and-bass includes Jungle; ?genre=jungle is exact", () => {
    renderGenresAt("/?genre=drum-and-bass");
    expect(listed()).toEqual(["Jungle Night"]);
    cleanup();
    renderGenresAt("/?genre=jungle");
    expect(listed()).toEqual(["Jungle Night"]);
  });

  it("?genre=industrial lists every event tagged Industrial, including the two-genre one", () => {
    renderGenresAt("/?genre=industrial");
    expect(listed()).toEqual(["Industrial Night", "Techno Industrial Night"]);
  });

  it("the legacy ?genre=garage-bass link keeps its group meaning (Dubstep + Garage) without offering the group as a choice", () => {
    renderGenresAt("/?genre=garage-bass");
    expect(listed()).toEqual(["Dubstep Night", "Garage Night"]);
    const select = document.getElementById("genre-filter") as HTMLSelectElement;
    expect(select.value).toBe("garage-bass");
    const legacyOption = Array.from(select.options).find((o) => o.value === "garage-bass")!;
    expect(legacyOption.hidden).toBe(true);
    expect(legacyOption.textContent).toBe("UK Garage & Dubstep");
    expect(select.parentElement!.querySelector("[data-select-value]")!.textContent).toBe("UK Garage & Dubstep");
    expect(window.location.search).toBe("?genre=garage-bass");
    expect(notice()).toBeNull();
  });

  it("the legacy ?genre=hardstyle-hardcore link keeps its group meaning (Hardstyle + Rawstyle + Hardcore)", () => {
    renderGenresAt("/?genre=hardstyle-hardcore");
    expect(listed()).toEqual(["Hardcore Night", "Hardstyle Night", "Rawstyle Night"]);
  });

  it("picking a real genre after a legacy link drops the legacy group from the options", () => {
    renderGenresAt("/?genre=hardstyle-hardcore");
    const select = document.getElementById("genre-filter") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "hardcore" } });
    expect(listed()).toEqual(["Hardcore Night"]);
    expect(Array.from(select.options).some((o) => o.value === "hardstyle-hardcore")).toBe(false);
    expect(window.location.search).toBe("?genre=hardcore");
  });

  it("without a legacy link, no legacy set is an option — only All genres plus the admin's 27 genres", () => {
    renderGenresAt("/");
    const values = Array.from((document.getElementById("genre-filter") as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toHaveLength(28);
    expect(values).not.toContain("garage-bass");
    expect(values).not.toContain("hardstyle-hardcore");
    expect(values).not.toContain("ambient-experimental");
  });

  it("an unknown ?genre= value is reported on screen, not silently turned into the full list", () => {
    renderGenresAt("/?genre=polka&when=weekend");
    expect(notice()?.textContent).toContain("“polka”");
    expect(notice()?.textContent).toContain("isn’t recognised");
    expect((document.getElementById("genre-filter") as HTMLSelectElement).value).toBe("all");
    // the other filters from the link still apply
    for (const button of screen.getAllByRole("button", { name: "This weekend" })) {
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("the unknown-genre notice goes away when the visitor dismisses it or picks a genre", () => {
    renderGenresAt("/?genre=polka");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(notice()).toBeNull();
    cleanup();
    renderGenresAt("/?genre=polka");
    fireEvent.change(document.getElementById("genre-filter")!, { target: { value: "industrial" } });
    expect(notice()).toBeNull();
    expect(listed()).toEqual(["Industrial Night", "Techno Industrial Night"]);
  });

  it("mobile: the filters sheet uses the same exact match", () => {
    renderGenresAt("/");
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.change(document.getElementById("genre-filter-mobile")!, { target: { value: "melodic-techno" } });
    fireEvent.click(screen.getByRole("button", { name: /^Show \d+ events?$/ }));
    expect(listed()).toEqual(["Melodic Night"]);
    expect(window.location.search).toBe("?genre=melodic-techno");
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
      savedAt: Date.now(),
    });
  });

  it("records the plain homepage for an unfiltered list, and leaves out unrelated params", () => {
    renderAt("/?utm_source=newsletter");
    fireEvent.click(screen.getByRole("link", { name: /Later Techno Night/ }));
    expect(JSON.parse(window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)!).listUrl).toBe("/");
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("records nothing for a %s-click (opens the event elsewhere, not in this tab)", (_label, init) => {
    renderAt("/?genre=house");
    fireEvent.click(screen.getByRole("link", { name: /Tonight House Night/ }), init);
    expect(window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)).toBeNull();
  });

  it("keeps an existing record pointing at the list's current view after a filter change (what browser back would show)", () => {
    renderAt("/?genre=house");
    fireEvent.click(screen.getByRole("link", { name: /Tonight House Night/ }));
    fireEvent.change(document.getElementById("genre-filter")!, { target: { value: "techno" } });
    const record = JSON.parse(window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)!);
    expect(record.listUrl).toBe("/?genre=techno");
    expect(record.eventPath).toBe(`/events/${TONIGHT_HOUSE_CB.slug}`);
  });

  it("ignores clicks on links that don't open an event page", () => {
    renderAt("/");
    fireEvent.click(screen.getAllByRole("link", { name: "KB18" })[0]);
    expect(window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)).toBeNull();
  });
});

describe("EventExplorer — URL changes that don't remount the list", () => {
  /** Simulates a client navigation that changes the URL while the list stays mounted (header "Events" link, back/forward between homepage entries). */
  function navigateWithoutRemount(rerender: (ui: ReactElement) => void, url: string) {
    window.history.replaceState(null, "", url);
    mockSearchParams = new URLSearchParams(window.location.search);
    act(() => {
      rerender(<EventExplorer events={EVENTS} serverNow={SERVER_NOW} />);
    });
  }

  it("follows a navigation to the plain homepage (header 'Events' link while filtered)", () => {
    const { rerender } = renderAt("/?genre=house&q=night");
    expect(titles()).toHaveLength(2);
    navigateWithoutRemount(rerender, "/");
    expect((document.getElementById("genre-filter") as HTMLSelectElement).value).toBe("all");
    expect((screen.getAllByRole("searchbox")[1] as HTMLInputElement).value).toBe("");
    expect(titles()).toHaveLength(3);
    expect(window.location.search).toBe("");
  });

  it("follows back/forward to a different filtered homepage entry", () => {
    const { rerender } = renderAt("/");
    navigateWithoutRemount(rerender, "/?when=tonight&venue=culture-box");
    for (const button of screen.getAllByRole("button", { name: "Tonight" })) {
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }
    expect((document.getElementById("venue-filter") as HTMLSelectElement).value).toBe("v-culture-box");
    expect(titles()).toEqual([expect.stringContaining("Tonight House Night")]);
  });

  it("does not reset the list for a lagging echo of its own write (fast typing)", () => {
    const { rerender } = renderAt("/");
    const search = screen.getAllByRole("searchbox")[1] as HTMLInputElement;
    fireEvent.change(search, { target: { value: "ti" } });
    fireEvent.change(search, { target: { value: "tim" } });
    expect(window.location.search).toBe("?q=tim");
    // The router catches up one write late: useSearchParams still says "ti"
    // while the address bar already says "tim".
    mockSearchParams = new URLSearchParams("q=ti");
    act(() => {
      rerender(<EventExplorer events={EVENTS} serverNow={SERVER_NOW} />);
    });
    expect(search.isConnected).toBe(true);
    expect(search.value).toBe("tim");
    mockSearchParams = new URLSearchParams("q=tim");
    act(() => {
      rerender(<EventExplorer events={EVENTS} serverNow={SERVER_NOW} />);
    });
    expect(search.isConnected).toBe(true);
    expect(search.value).toBe("tim");
  });

  it("does not remount when the router reports the list's own write", () => {
    const { rerender } = renderAt("/");
    const genreSelect = document.getElementById("genre-filter") as HTMLSelectElement;
    fireEvent.change(genreSelect, { target: { value: "house" } });
    mockSearchParams = new URLSearchParams(window.location.search);
    act(() => {
      rerender(<EventExplorer events={EVENTS} serverNow={SERVER_NOW} />);
    });
    expect(genreSelect.isConnected).toBe(true);
    expect(genreSelect.value).toBe("house");
  });
});

