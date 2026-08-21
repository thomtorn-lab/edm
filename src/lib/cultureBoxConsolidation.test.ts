import { describe, expect, it } from "vitest";
import { buildConsolidationPatch, findCultureBoxRoomPairs, type CultureBoxEventSnapshot } from "./cultureBoxConsolidation";

function event(overrides: Partial<CultureBoxEventSnapshot> = {}): CultureBoxEventSnapshot {
  return {
    id: "e-test",
    title: "Black Box: Test",
    description: null,
    artists: [],
    venueId: "v-culture-box",
    startDatetime: "2026-08-28T20:00:00.000Z",
    officialEventUrl: "https://culture-box.com/event/fri-28-august/#black-box",
    ticketUrl: null,
    residentAdvisorUrl: null,
    facebookUrl: null,
    imageUrl: null,
    priceFrom: null,
    published: true,
    cancelled: false,
    manualOverride: false,
    overriddenFields: [],
    ...overrides,
  };
}

// Real Production data (fetched via inspect-source.yml snapshot mode,
// 2026-08-21) — the ONLY currently-published Black Box/Red Box pair found
// across all 14 published src-culture-box events at that time. Used here as
// a real regression fixture, not a fabricated example.
const REAL_SHARED_DESCRIPTION =
  "Taxman headlines Drum & Bass Klubben in Black Box, while Elevate takes over Red Box with Bass Rave.\n\nThe celebrated British drum & bass producer and DJ, Taxman, originally from Leicester, is coming to Culture Box!";

function realBlackBox(): CultureBoxEventSnapshot {
  return event({
    id: "e-cb859d30",
    title: "Black Box: TAXMAN, DWONJI, BOBBY 6 KILLA, HDN, DJ BREAKFAST, MAXI MO, L.A.D.J",
    description: REAL_SHARED_DESCRIPTION,
    artists: ["TAXMAN", "DWONJI", "BOBBY 6 KILLA", "HDN", "DJ BREAKFAST", "MAXI MO", "L.A.D.J"],
    officialEventUrl: "https://culture-box.com/event/fri-28-august/#black-box",
    residentAdvisorUrl: "https://ra.co/events/2445895",
    facebookUrl: "https://www.facebook.com/events/1006770321903371",
    imageUrl: "https://culture-box.com/wp-content/uploads/2026/05/img.jpg",
    priceFrom: 100,
  });
}

function realRedBox(): CultureBoxEventSnapshot {
  return event({
    id: "e-a6cc4454",
    title: "Red Box: FIA2THEFLOOR, AMITTET, TINKI, DELFF",
    description: REAL_SHARED_DESCRIPTION,
    artists: ["FIA2THEFLOOR", "AMITTET", "TINKI", "DELFF"],
    officialEventUrl: "https://culture-box.com/event/fri-28-august/#red-box",
    residentAdvisorUrl: "https://ra.co/events/2445895",
    facebookUrl: "https://www.facebook.com/events/1006770321903371",
    imageUrl: "https://culture-box.com/wp-content/uploads/2026/05/img.jpg",
    priceFrom: 100,
  });
}

describe("findCultureBoxRoomPairs", () => {
  it("real: finds the fri-28-august-2026 Black Box/Red Box pair", () => {
    const pairs = findCultureBoxRoomPairs([realBlackBox(), realRedBox()]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].survivor.id).toBe("e-cb859d30");
    expect(pairs[0].obsolete.id).toBe("e-a6cc4454");
  });

  it("real: a solo published Black Box event with no published Red Box sibling is never paired with an unrelated night", () => {
    const soloBlackBox = event({
      id: "e-cf9da26a",
      title: "Black Box: SPECIFIC OBJECTS, ELLIOTT TAGUCHI, VANPANA",
      officialEventUrl: "https://culture-box.com/event/sat-29-august-2026/#black-box",
      startDatetime: "2026-08-29T20:00:00.000Z",
    });
    const pairs = findCultureBoxRoomPairs([realBlackBox(), realRedBox(), soloBlackBox]);
    expect(pairs).toHaveLength(1); // only the genuine pair, solo event untouched
    expect(pairs.some((p) => p.survivor.id === soloBlackBox.id || p.obsolete.id === soloBlackBox.id)).toBe(false);
  });

  it("requires the SAME base URL (different room fragment) — same night/venue alone is not enough", () => {
    const a = event({ id: "e-a", title: "Black Box: X", officialEventUrl: "https://culture-box.com/event/night-a/#black-box" });
    const b = event({ id: "e-b", title: "Red Box: Y", officialEventUrl: "https://culture-box.com/event/night-b/#red-box" });
    expect(findCultureBoxRoomPairs([a, b])).toHaveLength(0);
  });

  it("requires an explicit room name in both titles", () => {
    const a = event({ id: "e-a", title: "Some Showcase" });
    const b = event({ id: "e-b", title: "Red Box: Y", officialEventUrl: "https://culture-box.com/event/fri-28-august/#red-box" });
    expect(findCultureBoxRoomPairs([a, b])).toHaveLength(0);
  });

  it("never pairs two events naming the SAME room", () => {
    const a = event({ id: "e-a", officialEventUrl: "https://culture-box.com/event/fri-28-august/#black-box" });
    const b = event({ id: "e-b", title: "Black Box: Other", officialEventUrl: "https://culture-box.com/event/fri-28-august/#black-box-2" });
    expect(findCultureBoxRoomPairs([a, b])).toHaveLength(0);
  });

  it("skips a pair where either side has been manually overridden by an admin", () => {
    const pairs = findCultureBoxRoomPairs([realBlackBox(), event({ ...realRedBox(), manualOverride: true, overriddenFields: ["title"] })]);
    expect(pairs).toHaveLength(0);
  });

  it("skips a pair where either side is cancelled", () => {
    const pairs = findCultureBoxRoomPairs([realBlackBox(), { ...realRedBox(), cancelled: true }]);
    expect(pairs).toHaveLength(0);
  });

  it("skips a pair where either side is already unpublished", () => {
    const pairs = findCultureBoxRoomPairs([realBlackBox(), { ...realRedBox(), published: false }]);
    expect(pairs).toHaveLength(0);
  });

  it("never double-counts an event across multiple pairs", () => {
    const bb = realBlackBox();
    const rb = realRedBox();
    const pairs = findCultureBoxRoomPairs([bb, rb, { ...rb, id: "e-decoy" }]);
    expect(pairs).toHaveLength(1);
  });
});

describe("buildConsolidationPatch", () => {
  it("real: matches exactly what a fresh sync under the new consolidated adapter would produce", () => {
    const pairs = findCultureBoxRoomPairs([realBlackBox(), realRedBox()]);
    const patch = buildConsolidationPatch(pairs[0]);

    expect(patch.title).toBe(
      "Black Box: TAXMAN, DWONJI, BOBBY 6 KILLA, HDN, DJ BREAKFAST, MAXI MO, L.A.D.J · Red Box: FIA2THEFLOOR, AMITTET, TINKI, DELFF",
    );
    expect(patch.artists).toEqual(["TAXMAN", "DWONJI", "BOBBY 6 KILLA", "HDN", "DJ BREAKFAST", "MAXI MO", "L.A.D.J", "FIA2THEFLOOR", "AMITTET", "TINKI", "DELFF"]);
    expect(patch.officialEventUrl).toBe("https://culture-box.com/event/fri-28-august/");
    expect(patch.ticketUrl).toBeNull();
    expect(patch.residentAdvisorUrl).toBe("https://ra.co/events/2445895");
    expect(patch.facebookUrl).toBe("https://www.facebook.com/events/1006770321903371");
    expect(patch.priceFrom).toBe(100);
    // Shared prose appears exactly once (not duplicated across both sides), followed by the room breakdown.
    expect(patch.description).toBe(
      `${REAL_SHARED_DESCRIPTION}\n\nBlack Box\nTAXMAN, DWONJI, BOBBY 6 KILLA, HDN, DJ BREAKFAST, MAXI MO, L.A.D.J\n\nRed Box\nFIA2THEFLOOR, AMITTET, TINKI, DELFF`,
    );
  });

  it("falls back to a room-only description when neither side has real prose", () => {
    const bb = event({ id: "e-bb", title: "Black Box: A", artists: ["Artist A"], description: null });
    const rb = event({ id: "e-rb", title: "Red Box: B", artists: ["Artist B"], description: null, officialEventUrl: "https://culture-box.com/event/fri-28-august/#red-box" });
    const patch = buildConsolidationPatch({ survivor: bb, obsolete: rb, reason: "test" });
    expect(patch.description).toBe("Black Box\nArtist A\n\nRed Box\nArtist B");
  });

  it("uses 'Lineup TBA' for a room with no artists", () => {
    const bb = event({ id: "e-bb", title: "Black Box: A", artists: [] });
    const rb = event({ id: "e-rb", title: "Red Box: B", artists: ["Artist B"], officialEventUrl: "https://culture-box.com/event/fri-28-august/#red-box" });
    const patch = buildConsolidationPatch({ survivor: bb, obsolete: rb, reason: "test" });
    expect(patch.description).toContain("Black Box\nLineup TBA");
  });

  it("prefers the survivor's own ticket/RA/facebook/image/price value, falling back to the obsolete side's only when the survivor's is null", () => {
    const bb = event({ id: "e-bb", title: "Black Box: A", residentAdvisorUrl: null, priceFrom: null });
    const rb = event({
      id: "e-rb",
      title: "Red Box: B",
      officialEventUrl: "https://culture-box.com/event/fri-28-august/#red-box",
      residentAdvisorUrl: "https://ra.co/events/999",
      priceFrom: 150,
    });
    const patch = buildConsolidationPatch({ survivor: bb, obsolete: rb, reason: "test" });
    expect(patch.residentAdvisorUrl).toBe("https://ra.co/events/999");
    expect(patch.priceFrom).toBe(150);
  });
});
