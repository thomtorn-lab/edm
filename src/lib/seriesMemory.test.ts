import { describe, expect, it } from "vitest";
import { buildReviewPriorityList, scoreReviewPriority, type ReviewPriorityInput } from "./reviewPriority";
import { buildSeriesIndex, findSeriesMatch, placeNames, seriesKeys, seriesStrength, type SeriesHistoryEvent } from "./seriesMemory";
import type { Source, Venue } from "./types";

/**
 * Series memory (coverage work, phase 2, 2026-10-18). Titles, venues and
 * decisions come from the 2026-10-17 Production history: Final Descent is
 * the case it exists for; Black Box (a Culture Box room), MODULE (a venue
 * used as "X MODULE"), Byhaven (Pumpehuset's pop-up area) and generic titles
 * are where a naive "same words, published before" rule goes wrong.
 */

const NOW = new Date("2026-10-18T12:00:00+02:00");

function venue(id: string, name: string, aliases: string[] = []): Venue {
  return {
    id,
    slug: id.replace(/^v-/, ""),
    name,
    aliases,
    address: "",
    city: "Copenhagen",
    postalCode: "",
    websiteUrl: null,
    description: "",
    shortDescription: null,
    venueProfile: null,
  };
}

const VENUES: Venue[] = [
  venue("v-basement", "Basement", ["Basement CPH", "Basement Bar"]),
  venue("v-alice", "ALICE"),
  venue("v-culture-box", "Culture Box"),
  venue("v-module", "MODULE", ["Module Copenhagen"]),
  venue("v-pumpehuset", "Pumpehuset"),
  venue("v-loevstraede", "Løvstræde"),
];

const TRUST = new Map<string, Source["trustLevel"]>([
  ["src-kultunaut", "medium"],
  ["src-billetto", "medium"],
  ["src-pumpehuset", "high"],
]);

let n = 0;
function ev(title: string, venueId: string, start: string, overrides: Partial<SeriesHistoryEvent> = {}): SeriesHistoryEvent {
  return { id: `e-${++n}`, title, venueId, artists: [], startDatetime: start, published: true, adminUnpublishReason: null, ...overrides };
}

function dq(overrides: Partial<ReviewPriorityInput> = {}): ReviewPriorityInput {
  return {
    id: "dq-test",
    probableTitle: "An Event",
    probableStart: "2026-11-06T19:00:00+01:00",
    probableEnd: null,
    probableVenueName: null,
    sourceId: "src-kultunaut",
    detectedLineup: [],
    predictedGenre: null,
    description: null,
    ...overrides,
  };
}

const FINAL_DESCENT_HISTORY = [
  ev("69/96: The Final Descent", "v-basement", "2026-10-24T23:00:00+02:00", { artists: ["Nyx"] }),
  ev("Final Descent: Nyx (UK)", "v-alice", "2026-09-26T23:00:00+02:00", { artists: ["Nyx"] }),
];

const FINAL_DESCENT = dq({
  id: "dq-final-descent",
  probableTitle: "Final Descent: Amina Hocine (SE) + Barbara Skovmand (DK)",
  probableVenueName: "Basement Bar",
});

function ctx(history: SeriesHistoryEvent[]) {
  return { venues: VENUES, sourceTrust: TRUST, now: NOW, seriesIndex: buildSeriesIndex(history, VENUES) };
}

const series = (p: ReturnType<typeof scoreReviewPriority>) => p.signals.filter((s) => s.key.startsWith("series_"));

describe("seriesKeys — only names that can identify a series", () => {
  const places = placeNames(VENUES);

  it("finds the series name in both Final Descent title shapes, and drops the artists marked with a country code", () => {
    expect([...seriesKeys("Final Descent: Amina Hocine (SE) + Barbara Skovmand (DK)", [], places)]).toEqual(["final descent"]);
    expect([...seriesKeys("69/96: The Final Descent", [], places)]).toEqual(["final descent"]);
  });

  it("never uses a room, an area or a venue name: Black Box, Byhaven, X MODULE", () => {
    expect([...seriesKeys("Black Box", [], places)]).toEqual([]);
    expect([...seriesKeys("Black Box: Techno Night", [], places)]).toEqual([]);
    expect([...seriesKeys("Byhaven: Standart + Green Tea Bitches", ["Standart", "Green Tea Bitches"], places)]).toEqual([]);
    expect([...seriesKeys("Dirty Trancing X MODULE", [], places)]).toEqual(["dirty trancing"]);
    expect([...seriesKeys("Rave x MODULE", [], places)]).toEqual([]);
  });

  it("never uses generic titles: occasions, formats, genres, weekdays", () => {
    for (const title of ["Halloween Party", "Friday Night", "Techno Night", "Fredag i Løvstræde", "Saturday", "Closing Party 2026", "DJ Night vol. 3"]) {
      expect([...seriesKeys(title, [], places)], title).toEqual([]);
    }
  });

  it("never uses an artist on the lineup as a series name", () => {
    expect([...seriesKeys("Horst Haller", ["Horst Haller"], places)]).toEqual([]);
  });
});

describe("series memory in the review priority — Final Descent (positive)", () => {
  it("counts the earlier Final Descent nights: same venue plus KultuNaut's own category, and it says which events", () => {
    const p = scoreReviewPriority(FINAL_DESCENT, ctx(FINAL_DESCENT_HISTORY));
    const [signal] = series(p);
    expect(signal.key).toBe("series_same_venue");
    expect(signal.points).toBe(2);
    expect(signal.label).toContain("“69/96: The Final Descent” (2026-10-24, Basement)");
    expect(signal.label).toContain("same venue");
    expect(p.seriesMatch?.key).toBe("final descent");
    // From "possible" (category only) to "likely": ranked above category-only rows.
    expect(p.tier).toBe("likely");
    expect(scoreReviewPriority(FINAL_DESCENT, { venues: VENUES, sourceTrust: TRUST, now: NOW }).tier).toBe("possible");
  });

  it("changes ranking only: the row's genre, fields and status are untouched", () => {
    const row = { ...FINAL_DESCENT };
    const before = JSON.stringify(row);
    const list = buildReviewPriorityList([row], ctx(FINAL_DESCENT_HISTORY));
    expect(JSON.stringify(row)).toBe(before);
    expect(list.likely[0].item.predictedGenre).toBeNull();
  });
});

describe("series memory — what must not count (negative)", () => {
  it("Black Box: Culture Box's room name links nothing", () => {
    const history = [ev("Black Box", "v-culture-box", "2026-10-10T23:00:00+02:00"), ev("Black Box", "v-culture-box", "2026-10-03T23:00:00+02:00")];
    const p = scoreReviewPriority(dq({ probableTitle: "Black Box", probableVenueName: "Culture Box" }), ctx(history));
    expect(series(p)).toEqual([]);
    expect(p.seriesMatch).toBeNull();
  });

  it("X MODULE: two different nights at MODULE are not one series because both titles name the venue", () => {
    const history = [ev("TANZEN x MODULE", "v-module", "2026-10-03T23:59:00+02:00")];
    const p = scoreReviewPriority(dq({ probableTitle: "Dirty Trancing X MODULE", probableVenueName: "MODULE" }), ctx(history));
    expect(series(p)).toEqual([]);
  });

  it("Byhaven: a published pop-up there says nothing about the next one", () => {
    const history = [ev("Byhaven: Standart + Green Tea Bitches", "v-pumpehuset", "2026-08-15T16:00:00+02:00", { artists: ["Standart", "Green Tea Bitches"] })];
    const p = scoreReviewPriority(dq({ probableTitle: "Byhaven: Quiz", probableVenueName: "Pumpehuset", sourceId: "src-pumpehuset" }), ctx(history));
    expect(series(p)).toEqual([]);
  });

  it("generic titles: an earlier 'Halloween Party' at the same venue is not a series", () => {
    const history = [ev("Halloween Party", "v-pumpehuset", "2025-10-31T22:00:00+01:00")];
    const p = scoreReviewPriority(dq({ probableTitle: "Halloween Party", probableVenueName: "Pumpehuset" }), ctx(history));
    expect(series(p)).toEqual([]);
  });

  it("one earlier published night at another venue is not enough on its own", () => {
    const history = [ev("Final Descent: Nyx (UK)", "v-alice", "2026-09-26T23:00:00+02:00")];
    const p = scoreReviewPriority(FINAL_DESCENT, ctx(history));
    expect(series(p).map((s) => [s.key, s.points])).toEqual([["series_not_counted", 0]]);
    expect(series(p)[0].label).toMatch(/not counted without more evidence/);
    expect(p.tier).toBe("possible");
  });

  it("the same night at the same venue is a duplicate for dedup, never series evidence", () => {
    const history = [ev("Final Descent: Amina Hocine", "v-basement", "2026-11-06T20:00:00+01:00")];
    expect(findSeriesMatch({ title: FINAL_DESCENT.probableTitle, lineup: [], venueName: "Basement Bar", start: FINAL_DESCENT.probableStart, ownElectronicSignal: true }, buildSeriesIndex(history, VENUES))).toBeNull();
  });
});

describe("series memory — unpublish reasons", () => {
  const SERIES = "Night Shift Collective: Vol. 4";

  it("an earlier event unpublished as irrelevant counts against the series, even next to a published one", () => {
    const history = [
      ev("Night Shift Collective: Vol. 2", "v-pumpehuset", "2026-06-01T22:00:00+02:00"),
      ev("Night Shift Collective: Vol. 3", "v-pumpehuset", "2026-08-01T22:00:00+02:00", { published: false, adminUnpublishReason: "irrelevant" }),
    ];
    const p = scoreReviewPriority(dq({ probableTitle: SERIES, probableVenueName: "Pumpehuset" }), ctx(history));
    expect(series(p).map((s) => [s.key, s.points])).toEqual([["series_irrelevant", -1]]);
    expect(series(p)[0].label).toMatch(/unpublished as irrelevant/);
  });

  it.each(["duplicate", "cancelled", "incorrect_data", "other"] as const)("an event unpublished as %s is neither for nor against", (reason) => {
    const history = [ev("Night Shift Collective: Vol. 3", "v-pumpehuset", "2026-08-01T22:00:00+02:00", { published: false, adminUnpublishReason: reason })];
    const match = findSeriesMatch(
      { title: SERIES, lineup: [], venueName: "Pumpehuset", start: "2026-11-06T22:00:00+01:00", ownElectronicSignal: true },
      buildSeriesIndex(history, VENUES),
    );
    expect(match?.neutral).toHaveLength(1);
    expect(match && seriesStrength(match)).toBe("unsupported");
    const p = scoreReviewPriority(dq({ probableTitle: SERIES, probableVenueName: "Pumpehuset" }), ctx(history));
    expect(p.signals.filter((s) => s.key.startsWith("series_") && s.points !== 0)).toEqual([]);
  });

  it("a published and a duplicate-unpublished night together still count as one published night", () => {
    const history = [
      ev("Night Shift Collective: Vol. 2", "v-pumpehuset", "2026-06-01T22:00:00+02:00"),
      ev("Night Shift Collective: Vol. 2", "v-pumpehuset", "2026-06-01T22:00:00+02:00", { published: false, adminUnpublishReason: "duplicate" }),
    ];
    const p = scoreReviewPriority(dq({ probableTitle: SERIES, probableVenueName: "Pumpehuset" }), ctx(history));
    expect(p.seriesMatch?.published).toHaveLength(1);
    expect(series(p).map((s) => s.key)).toEqual(["series_same_venue"]);
  });
});

describe("series memory — earlier editorial mistakes are not copied forward", () => {
  // Suppose a metal band's night was once published by mistake.
  const MISTAKE = [ev("Gloryhammer: Return to the Kingdom", "v-pumpehuset", "2025-11-20T20:00:00+01:00")];

  it("the row's own non-electronic wording beats an earlier publish of the same name", () => {
    const row = dq({ probableTitle: "Gloryhammer: Winter Tour", probableVenueName: "Pumpehuset", description: "Skotsk heavy metal med fuld scenografi." });
    const p = scoreReviewPriority(row, ctx(MISTAKE));
    expect(series(p).map((s) => [s.key, s.points])).toEqual([["series_not_counted", 0]]);
    expect(series(p)[0].label).toMatch(/names a non-electronic genre/);
    expect(p.tier).toBe("none");
  });

  it("an earlier publish never brings in a row with no electronic signal of its own", () => {
    const row = dq({ probableTitle: "Gloryhammer: Winter Tour", probableVenueName: "Pumpehuset", sourceId: "src-billetto", detectedLineup: ["Gloryhammer"] });
    const p = scoreReviewPriority(row, ctx(MISTAKE));
    expect(p.signals.filter((s) => s.key.startsWith("series_") && s.points > 0)).toEqual([]);
    expect(p.tier).toBe("none");
    expect(buildReviewPriorityList([row], ctx(MISTAKE)).likely).toEqual([]);
  });

  it("a later 'irrelevant' unpublish overrides the earlier mistaken publish", () => {
    const corrected = [...MISTAKE, ev("Gloryhammer: Legends", "v-pumpehuset", "2026-03-20T20:00:00+01:00", { published: false, adminUnpublishReason: "irrelevant" })];
    const p = scoreReviewPriority(dq({ probableTitle: "Gloryhammer: Winter Tour", probableVenueName: "Pumpehuset" }), ctx(corrected));
    expect(series(p).map((s) => s.key)).toEqual(["series_irrelevant"]);
  });
});
