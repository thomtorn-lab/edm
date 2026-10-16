import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPLORER_URL_FILTERS,
  LIST_RETURN_MAX_AGE_MS,
  isSafeListUrl,
  parseExplorerFilters,
  readListReturn,
  serializeExplorerFilters,
} from "./explorerFilters";

const parse = (search: string) => parseExplorerFilters(new URLSearchParams(search));

describe("parseExplorerFilters", () => {
  it("returns the defaults for no params, an empty query string, or null (outside the App Router)", () => {
    expect(parseExplorerFilters(null)).toEqual(DEFAULT_EXPLORER_URL_FILTERS);
    expect(parse("")).toEqual(DEFAULT_EXPLORER_URL_FILTERS);
  });

  it("reads every supported filter", () => {
    expect(parse("when=weekend&genre=house&venue=culture-box&q=tim%20andresen")).toEqual({
      mode: "weekend",
      genre: "house",
      venueSlug: "culture-box",
      query: "tim andresen",
    });
  });

  it("accepts each date mode", () => {
    expect(parse("when=tonight").mode).toBe("tonight");
    expect(parse("when=weekend").mode).toBe("weekend");
    expect(parse("when=next-weekend").mode).toBe("next-weekend");
  });

  it("ignores invalid values instead of failing — the rest of the view still applies", () => {
    expect(parse("when=yesterday&genre=polka&venue=Not%20A%20Slug&q=x")).toEqual({
      mode: "all",
      genre: "all",
      venueSlug: null,
      query: "x",
    });
  });

  it("caps an absurdly long search query", () => {
    expect(parse(`q=${"a".repeat(5000)}`).query).toHaveLength(200);
  });
});

describe("serializeExplorerFilters", () => {
  it("omits every default, giving an empty string for the plain homepage", () => {
    expect(serializeExplorerFilters(DEFAULT_EXPLORER_URL_FILTERS)).toBe("");
  });

  it("writes the filters in a fixed order", () => {
    expect(
      serializeExplorerFilters({ mode: "weekend", genre: "house", venueSlug: "culture-box", query: "tim andresen" }),
    ).toBe("when=weekend&genre=house&venue=culture-box&q=tim+andresen");
  });

  it("omits a whitespace-only search but keeps a real one exactly as typed", () => {
    expect(serializeExplorerFilters({ ...DEFAULT_EXPLORER_URL_FILTERS, query: "   " })).toBe("");
    expect(serializeExplorerFilters({ ...DEFAULT_EXPLORER_URL_FILTERS, query: "Kevin Di " })).toBe("q=Kevin+Di+");
  });

  it("keeps query keys it doesn't own (e.g. campaign tracking) and replaces the ones it does", () => {
    expect(
      serializeExplorerFilters(
        { ...DEFAULT_EXPLORER_URL_FILTERS, genre: "techno" },
        "?utm_source=newsletter&genre=house&q=old",
      ),
    ).toBe("utm_source=newsletter&genre=techno");
  });

  it("round-trips through parse", () => {
    const filters = { mode: "next-weekend" as const, genre: "drum-and-bass" as const, venueSlug: "kb18", query: "æøå & co" };
    expect(parseExplorerFilters(new URLSearchParams(serializeExplorerFilters(filters)))).toEqual(filters);
  });
});

describe("list return target ('← All events')", () => {
  const NOW = 1_800_000_000_000;
  const record = (eventPath: string, listUrl: string, savedAt: number = NOW) => JSON.stringify({ eventPath, listUrl, savedAt });

  it("returns the recorded list URL only for the same event", () => {
    expect(readListReturn(record("/events/a", "/?q=tim"), "/events/a", NOW)).toBe("/?q=tim");
    expect(readListReturn(record("/events/a", "/?q=tim"), "/events/b", NOW)).toBeNull();
  });

  it("returns null when nothing (or garbage) is stored", () => {
    expect(readListReturn(null, "/events/a", NOW)).toBeNull();
    expect(readListReturn("not json", "/events/a", NOW)).toBeNull();
    expect(readListReturn(JSON.stringify({ eventPath: "/events/a" }), "/events/a", NOW)).toBeNull();
  });

  it("ignores an old-format record without a timestamp", () => {
    expect(readListReturn(JSON.stringify({ eventPath: "/events/a", listUrl: "/?q=tim" }), "/events/a", NOW)).toBeNull();
  });

  it("expires a record after LIST_RETURN_MAX_AGE_MS (and rejects one from the future)", () => {
    expect(readListReturn(record("/events/a", "/?q=tim", NOW - LIST_RETURN_MAX_AGE_MS), "/events/a", NOW)).toBe("/?q=tim");
    expect(readListReturn(record("/events/a", "/?q=tim", NOW - LIST_RETURN_MAX_AGE_MS - 1), "/events/a", NOW)).toBeNull();
    expect(readListReturn(record("/events/a", "/?q=tim", NOW + 60_000), "/events/a", NOW)).toBeNull();
  });

  it("never returns anything but a same-site homepage URL", () => {
    for (const bad of ["https://evil.example/", "//evil.example/", "/venues/x", "javascript:alert(1)", ""]) {
      expect(isSafeListUrl(bad)).toBe(false);
      expect(readListReturn(record("/events/a", bad), "/events/a", NOW)).toBeNull();
    }
    expect(isSafeListUrl("/")).toBe(true);
    expect(isSafeListUrl("/?when=weekend")).toBe(true);
  });
});
