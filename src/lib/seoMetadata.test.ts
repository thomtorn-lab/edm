import { describe, expect, it } from "vitest";
import { getVenueBySlug, publicVenueLabel } from "./data/venues";
import {
  buildEventSeoDescription,
  buildEventSeoTitle,
  buildVenueSeoDescription,
  buildVenueSeoTitle,
  formatSeoDate,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  shortenNaturally,
} from "./seoMetadata";

const NO_UNDEFINED = /undefined|null|NaN|\s,|,,|\s\.|- -|\|\s*$/;

function venueInput(slug: string) {
  const venue = getVenueBySlug(slug)!;
  return { label: publicVenueLabel(venue), address: venue.address, description: venue.description, shortDescription: venue.shortDescription };
}

describe("formatSeoDate", () => {
  it("uses the Europe/Copenhagen calendar date, not UTC", () => {
    // 22:30 UTC on 23 Oct = 00:30 on 24 Oct in Copenhagen (CEST).
    expect(formatSeoDate("2026-10-23T22:30:00.000Z")).toBe("24 Oct 2026");
    // 23:30 UTC on 31 Dec = 00:30 on 1 Jan in Copenhagen (CET).
    expect(formatSeoDate("2026-12-31T23:30:00.000Z")).toBe("1 Jan 2027");
    expect(formatSeoDate("2026-10-23T18:00:00.000Z")).toBe("23 Oct 2026");
  });

  it("returns an empty string for a missing or invalid datetime", () => {
    expect(formatSeoDate("")).toBe("");
    expect(formatSeoDate(null)).toBe("");
    expect(formatSeoDate("not a date")).toBe("");
  });
});

describe("buildEventSeoTitle", () => {
  it("matches the agreed pattern for Eric Prydz at TAP1", () => {
    expect(
      buildEventSeoTitle({ title: "Eric Prydz", venueName: "TAP1", startDatetime: "2026-10-23T18:00:00.000Z", artists: ["Eric Prydz"] }),
    ).toBe("Eric Prydz - TAP1, Copenhagen - 23 Oct 2026 | Electronic CPH");
  });

  it("carries the brand exactly once", () => {
    const title = buildEventSeoTitle({ title: "Eric Prydz", venueName: "TAP1", startDatetime: "2026-10-23T18:00:00.000Z", artists: [] });
    expect(title.match(/Electronic CPH/g)).toHaveLength(1);
  });

  it("drops the date first, then the brand, before touching the event name", () => {
    const base = { venueName: "Den Anden Side", startDatetime: "2026-11-14T22:00:00.000Z", artists: [] };
    expect(buildEventSeoTitle({ ...base, title: "Hyggelit Showcase Vol. 3" })).toBe(
      "Hyggelit Showcase Vol. 3 - Den Anden Side, Copenhagen | Electronic CPH",
    );
    expect(buildEventSeoTitle({ ...base, title: "Fabric Presents: Midnight Odyssey" })).toBe(
      "Fabric Presents: Midnight Odyssey - Den Anden Side, Copenhagen",
    );
  });

  it("shortens a long name at a natural break, keeping venue and Copenhagen, never cutting a word", () => {
    const title = buildEventSeoTitle({
      title: "Fast Forward Records Label Night presents Solomun, Âme, Dixon, Adriatique & Friends",
      venueName: "Den Anden Side",
      startDatetime: "2026-11-14T22:00:00.000Z",
      artists: ["Solomun", "Âme", "Dixon", "Adriatique"],
    });
    expect(title).toBe("Fast Forward Records Label Night - Den Anden Side, Copenhagen");
    expect(title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
  });

  it("never splits an act name joined with '&'", () => {
    const title = buildEventSeoTitle({
      title: "Oliver Huntemann b2b Dense & Pika All Night Long Extended Marathon Session",
      venueName: "Gravity Copenhagen",
      startDatetime: "2026-12-31T23:00:00.000Z",
      artists: [],
    });
    expect(title).toContain("Dense & Pika");
    expect(title).toMatch(/… - Gravity Copenhagen$/);
    expect(title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
  });

  it("doesn't double 'Copenhagen' when the venue name already has it", () => {
    const title = buildEventSeoTitle({ title: "X", venueName: "Gravity Copenhagen", startDatetime: "2026-10-23T18:00:00.000Z", artists: [] });
    expect(title).toBe("X - Gravity Copenhagen - 23 Oct 2026 | Electronic CPH");
  });

  it("handles missing title, venue and date without empty fields", () => {
    expect(buildEventSeoTitle({ title: "", venueName: "", startDatetime: "", artists: ["DJ A", "DJ B"] })).toBe(
      "DJ A, DJ B - Copenhagen | Electronic CPH",
    );
    const bare = buildEventSeoTitle({ title: "  ", venueName: "", startDatetime: "", artists: [] });
    expect(bare).toBe("Electronic music event - Copenhagen | Electronic CPH");
    expect(bare).not.toMatch(NO_UNDEFINED);
  });
});

describe("buildEventSeoDescription", () => {
  it("names event, venue and full local date", () => {
    expect(
      buildEventSeoDescription({ title: "Eric Prydz", venueName: "TAP1", startDatetime: "2026-10-23T18:00:00.000Z", artists: ["Eric Prydz"], showArtists: false }),
    ).toBe("Eric Prydz at TAP1, Copenhagen on Friday 23 October 2026.");
  });

  it("adds the lineup only when the page shows it, as whole names with 'and more' when cut", () => {
    const description = buildEventSeoDescription({
      title: "Hyggelit Showcase",
      venueName: "MODULE",
      startDatetime: "2026-10-23T22:30:00.000Z",
      artists: ["Artist One", "Artist Two", "Artist Three", "Artist Four", "Artist Five", "Artist Six", "Artist Seven", "Artist Eight", "Artist Nine"],
      genres: ["Techno"],
      showArtists: true,
    });
    expect(description.startsWith("Hyggelit Showcase at MODULE, Copenhagen on Saturday 24 October 2026. Lineup: Artist One, Artist Two")).toBe(true);
    expect(description).toMatch(/ and more\./);
    expect(description.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX);
  });

  it("adds genres only as far as they fit", () => {
    expect(
      buildEventSeoDescription({ title: "X", venueName: "TAP1", startDatetime: "2026-10-23T18:00:00.000Z", artists: [], genres: ["Techno", "House"] }),
    ).toBe("X at TAP1, Copenhagen on Friday 23 October 2026. Techno · House.");
  });

  it("handles missing venue and date", () => {
    expect(buildEventSeoDescription({ title: "X", venueName: "", startDatetime: "", artists: [] })).toBe("X in Copenhagen.");
  });
});

describe("buildVenueSeoTitle", () => {
  it("matches the agreed pattern", () => {
    expect(buildVenueSeoTitle(venueInput("module"))).toBe("MODULE Copenhagen - Upcoming Events | Electronic CPH");
    expect(buildVenueSeoTitle(venueInput("tap1"))).toBe("TAP1 Copenhagen - Upcoming Events | Electronic CPH");
  });

  it("drops a directory-only parenthetical and never doubles Copenhagen", () => {
    expect(buildVenueSeoTitle({ label: "Jolene (Club)" })).toBe("Jolene Copenhagen - Upcoming Events | Electronic CPH");
    expect(buildVenueSeoTitle({ label: "Gravity Copenhagen" })).toBe("Gravity Copenhagen - Upcoming Events | Electronic CPH");
  });
});

describe("buildVenueSeoDescription", () => {
  it("describes the place and the event overview, within the length budget, for every registered venue", async () => {
    const { VENUES } = await import("./data/venues");
    for (const venue of VENUES) {
      const input = { label: publicVenueLabel(venue), address: venue.address, description: venue.description, shortDescription: venue.shortDescription };
      const description = buildVenueSeoDescription(input);
      expect(description.length, venue.id).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX);
      expect(description, venue.id).toMatch(/^Upcoming (electronic music )?events (at|in) /);
      expect(description, venue.id).not.toMatch(NO_UNDEFINED);
      expect(buildVenueSeoTitle(input).length, venue.id).toBeLessThanOrEqual(SEO_TITLE_MAX);
    }
  });

  it("MODULE: overview plus its own description", () => {
    expect(buildVenueSeoDescription(venueInput("module"))).toBe(
      "Upcoming electronic music events at MODULE, Copenhagen. Basement nightclub near Copenhagen City Hall built specifically for house, techno and industrial sound…",
    );
  });

  it("falls back to the address, then the overview alone, when no description exists", () => {
    expect(buildVenueSeoDescription({ label: "X", address: "Street 1, 1000 København K", description: "", shortDescription: null })).toBe(
      "Upcoming electronic music events at X, Copenhagen — Street 1, 1000 København K.",
    );
    expect(buildVenueSeoDescription({ label: "X" })).toBe("Upcoming electronic music events at X, Copenhagen.");
  });
});

describe("shortenNaturally", () => {
  it("returns text unchanged when it fits", () => {
    expect(shortenNaturally("Short", 10)).toBe("Short");
  });

  it("falls back to a whole-word cut with an ellipsis", () => {
    const out = shortenNaturally("Supercalifragilistic Extraordinary Nightlong Celebration", 30);
    expect(out).toBe("Supercalifragilistic…");
  });
});
