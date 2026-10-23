import { describe, expect, it } from "vitest";
import { classifyAdminQueueRow } from "./adminQueue";
import {
  buildReviewPriorityList,
  groupReviewList,
  isSameEventFromAnotherSource,
  prioritizeNotInSource,
  scoreReviewPriority,
  splitPastStale,
  splitPossibleForDisplay,
  splitVisibleReviewRows,
  type ReviewPriorityInput,
} from "./reviewPriority";
import type { Source, Venue } from "./types";

/**
 * Review prioritisation (coverage work, phase 2). The fixtures are the real
 * Production rows from the 2026-10-16 read-only audit (titles, venues,
 * sources and description text as stored), so the tiers below are the ones
 * an admin would actually have seen.
 */

const NOW = new Date("2026-10-16T12:00:00+02:00");

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
  venue("v-module", "MODULE", ["Module Copenhagen", "Module CPH"]),
  venue("v-den-anden-side", "Den Anden Side", ["DAS"]),
  venue("v-kb3", "KB3"),
  venue("v-gravity", "Gravity Copenhagen", ["Gravity CPH"]),
  venue("v-basement", "Basement", ["Basement CPH", "Basement Vesterbro", "Basement Bar"]),
  venue("v-poolen", "Poolen", ["Poolen Copenhagen"]),
  venue("v-pylonen", "Pylonen"),
  venue("v-vega", "VEGA"),
];

const TRUST = new Map<string, Source["trustLevel"]>([
  ["src-hvaderpaa", "medium"],
  ["src-kultunaut", "medium"],
  ["src-billetto", "medium"],
  ["src-pylonen", "medium"],
  ["src-poolen", "high"],
  ["src-fb-test", "low"],
]);

const CTX = { venues: VENUES, sourceTrust: TRUST, now: NOW };

function dq(overrides: Partial<ReviewPriorityInput> = {}): ReviewPriorityInput {
  return {
    id: "dq-test",
    probableTitle: "An Event",
    probableStart: "2026-10-30T23:00:00+01:00",
    probableEnd: null,
    probableVenueName: null,
    sourceId: "src-billetto",
    detectedLineup: [],
    predictedGenre: null,
    description: null,
    ...overrides,
  };
}

const TANZEN = dq({
  id: "dq-tanzen",
  probableTitle: "TANZEN UND SPRINGEN // Horst Haller (DE)",
  probableStart: "2026-10-17T23:59:00+02:00",
  probableVenueName: "MODULE",
  sourceId: "src-hvaderpaa",
  description: "Klubaften med Horst Haller fra Tyskland samt danske kunstnere Skarn, Anders HP, KIOSK og Aurora på MODULE i København.",
});

const DIRTY_TRANCING = dq({
  id: "dq-dirty-trancing",
  probableTitle: "Dirty Trancing X MODULE",
  probableStart: "2026-10-16T23:59:00+02:00",
  probableVenueName: "MODULE",
  sourceId: "src-hvaderpaa",
  description: "Dirty Trancing X MODULE præsenterer en nat med Nora Asteroid, DJ Macid og Captain Bubblegum på MODULE i København.",
});

const BOILER_ROOM_KULTUNAUT = dq({
  id: "dq-boiler-room-kn",
  probableTitle: "Boiler Room",
  probableStart: "2026-12-11T21:00:00+01:00",
  probableVenueName: "Poolen",
  sourceId: "src-kultunaut",
  detectedLineup: ["Boiler Room"],
});

const BOILER_ROOM_POOLEN = dq({
  id: "dq-boiler-room-poolen",
  probableTitle: "Boiler Room",
  probableStart: "2026-12-11T21:00:00+01:00",
  probableVenueName: "Poolen",
  sourceId: "src-poolen",
});

const THE_PRODIGY = dq({
  id: "dq-prodigy",
  probableTitle: "The Prodigy",
  probableStart: "2026-11-17T19:00:00+01:00",
  probableVenueName: "Royal Arena",
  sourceId: "src-kultunaut",
  detectedLineup: ["The Prodigy"],
});

const FINAL_DESCENT = dq({
  id: "dq-final-descent",
  probableTitle: "Final Descent: Amina Hocine (SE) + Barbara Skovmand (DK)",
  probableStart: "2026-11-06T19:00:00+01:00",
  probableVenueName: "Basement Bar",
  sourceId: "src-kultunaut",
});

const FLUIDITY_DAY_1 = dq({
  id: "dq-fluidity-1",
  probableTitle: "Fluidity Festival, day 1",
  probableStart: "2026-10-22T20:00:00+02:00",
  probableVenueName: "Pylonen",
  sourceId: "src-pylonen",
  description: "Organiser: Fluid Sound Collective\n\nDate: 22.10.2026\n\nTime: 20.00 – 01.00\n\nDescription: Open decks for FLINTA DJ's",
});

// Real Billetto "Insufficient evidence" noise from the same audit.
const BILLETTO_NOISE = [
  dq({ id: "dq-beer", probableTitle: "Ølsmagning / Beer Tasting", probableVenueName: "Ølmand Bar & Bottleshop", description: "Come join us for a guided tasting with 5-6 different beers." }),
  dq({ id: "dq-comedy", probableTitle: "Proud Phoenix Comedy Showcase", probableVenueName: "Proud Mary Pub", description: "See Elise Smidt, Derek Hartman and Ulug Bek live at Proud Mary Copenhagen on 30th October" }),
  dq({ id: "dq-mooncakes", probableTitle: "Søndagsskolen # 10 ~ Mooncakes with Baijie Curdt-Christiansen", probableVenueName: "Alle Tiders", description: "Lær at lave magiske snowskin mooncakes med Baijie - book din plads nu!" }),
  dq({ id: "dq-torrpedorr", probableTitle: "Torrpedorr På Basement", probableVenueName: "Basement", description: "Vi spiller koncert på legendariske Basement. Glæd dig til en grineren aften." }),
  dq({ id: "dq-lecture", probableTitle: "Har AI en inderside?", probableVenueName: "Kulturhuset Islands Brygge", description: "Om bevidsthed, animisme og det mere-end-menneskelige" }),
];

describe("scoreReviewPriority — known cases from the 2026-10-16 Production queue", () => {
  it("puts TANZEN UND SPRINGEN (MODULE, no genre word) in the likely tier, citing the venue and the club-night wording", () => {
    const p = scoreReviewPriority(TANZEN, CTX);
    expect(p.tier).toBe("likely");
    expect(p.relevanceState).toBe("missing_genre_info");
    expect(p.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["strong_venue", "dj_or_club_description", "starts_within_72h"]));
    expect(p.startsWithin72h).toBe(true);
    expect(p.recommendedAction).toBe("Pick a genre and publish");
  });

  it("puts Dirty Trancing (MODULE, a DJ named only in the description) in the likely tier", () => {
    expect(scoreReviewPriority(DIRTY_TRANCING, CTX).tier).toBe("likely");
  });

  it("puts Boiler Room in the likely tier from either source, on the format name alone at a mixed venue", () => {
    expect(scoreReviewPriority(BOILER_ROOM_KULTUNAUT, CTX).tier).toBe("likely");
    const poolen = scoreReviewPriority(BOILER_ROOM_POOLEN, CTX);
    expect(poolen.tier).toBe("likely");
    expect(poolen.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["dj_or_club_title", "source_quality"]));
  });

  it("puts The Prodigy in the possible tier: only KultuNaut's category speaks for it, and its venue is not registered", () => {
    const p = scoreReviewPriority(THE_PRODIGY, CTX);
    expect(p.tier).toBe("possible");
    expect(p.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["source_category", "lineup", "venue_unresolved"]));
    expect(p.recommendedAction).toMatch(/only the listing category/);
  });

  it("puts Final Descent (Basement Bar via KultuNaut, no lineup parsed) in the possible tier, without penalising the mixed venue", () => {
    const p = scoreReviewPriority(FINAL_DESCENT, CTX);
    expect(p.tier).toBe("possible");
    expect(p.signals.some((s) => s.points < 0)).toBe(false);
  });

  it("leaves Fluidity day 1 to Pylonen's manual-review routing: its description alone ('open decks … DJ's') is not enough for the likely tier", () => {
    // Pylonen is a manual-review source, so its rows reach Needs review
    // through classifyAdminQueueRow and never sit in Insufficient evidence;
    // this list is not their way in. The description signal still shows.
    const p = scoreReviewPriority(FLUIDITY_DAY_1, CTX);
    expect(p.signals.map((s) => s.key)).toContain("dj_or_club_description");
    expect(p.tier).toBe("none");
    expect(
      classifyAdminQueueRow(
        {
          overallConfidence: "low",
          holdReason: "no_genre_evidence",
          venueResolvedDecision: null,
          missingFields: [],
          probableStart: FLUIDITY_DAY_1.probableStart,
          probableEnd: null,
          lastSeenAt: "2026-10-16T11:52:00+02:00",
          sourceId: "src-pylonen",
          probableTitle: FLUIDITY_DAY_1.probableTitle,
          detectedLineup: [],
          predictedGenre: null,
        },
        { lastCompleteSyncAt: "2026-10-16T11:52:00+02:00", now: NOW },
      ),
    ).toBe("needs_review");
  });

  it("leaves real Billetto non-music rows out of both tiers", () => {
    for (const item of BILLETTO_NOISE) {
      expect(scoreReviewPriority(item, CTX).tier, item.probableTitle).toBe("none");
    }
  });
});

describe("scoreReviewPriority — venue signals", () => {
  it("never lets a supporting venue (KB3, Gravity) qualify a row on its own", () => {
    const kb3 = scoreReviewPriority(dq({ probableVenueName: "KB3", detectedLineup: ["Someone"] }), CTX);
    expect(kb3.signals.map((s) => s.key)).toContain("supporting_venue");
    expect(kb3.tier).toBe("none");
  });

  it("lets a supporting venue raise a row that has its own qualifying evidence", () => {
    const withVenue = scoreReviewPriority(dq({ probableVenueName: "KB3", description: "All night long with a local DJ" }), CTX);
    const without = scoreReviewPriority(dq({ probableVenueName: "Somewhere", description: "All night long with a local DJ" }), CTX);
    expect(withVenue.tier).toBe("likely");
    expect(withVenue.relevanceScore).toBe(without.relevanceScore + 1);
  });

  it("does not penalise mixed venues: the same DJ night scores the same at VEGA as at an unknown room", () => {
    const vega = scoreReviewPriority(dq({ probableTitle: "Rave Night", probableVenueName: "VEGA" }), CTX);
    const other = scoreReviewPriority(dq({ probableTitle: "Rave Night", probableVenueName: "Somewhere" }), CTX);
    expect(vega.tier).toBe("likely");
    expect(vega.relevanceScore).toBe(other.relevanceScore);
  });

  it("matches a strong venue through its aliases", () => {
    expect(scoreReviewPriority(dq({ probableVenueName: "Module CPH", detectedLineup: ["X"] }), CTX).signals.map((s) => s.key)).toContain("strong_venue");
  });
});

describe("scoreReviewPriority — missing genre information vs real uncertainty", () => {
  it("marks a row whose own text names a non-electronic genre as uncertain and keeps it out of the likely tier", () => {
    const p = scoreReviewPriority(
      dq({ probableVenueName: "MODULE", probableTitle: "Release party", description: "En aften med rock og punk fra de lokale bands." }),
      CTX,
    );
    expect(p.relevanceState).toBe("uncertain_relevance");
    expect(p.signals.map((s) => s.key)).toContain("conflicting_genre");
    expect(p.tier).toBe("none");
  });

  it("drops a KultuNaut category-only row to none when its text names a non-electronic genre", () => {
    const p = scoreReviewPriority(dq({ sourceId: "src-kultunaut", probableTitle: "Some Band", description: "Svensk heavy metal i særklasse." }), CTX);
    expect(p.tier).toBe("none");
  });

  it("does not treat an artist's own name as a genre (masked lineup)", () => {
    const p = scoreReviewPriority(dq({ probableVenueName: "MODULE", detectedLineup: ["Daft Punk Tribute DJs"], probableTitle: "Daft Punk Tribute DJs" }), CTX);
    expect(p.relevanceState).toBe("missing_genre_info");
  });
});

describe("scoreReviewPriority — urgency, dates and source quality", () => {
  it("adds urgency for the next 72 hours to priority, never to the relevance score", () => {
    const soon = scoreReviewPriority(dq({ probableTitle: "Rave", probableStart: "2026-10-17T22:00:00+02:00" }), CTX);
    const later = scoreReviewPriority(dq({ probableTitle: "Rave", probableStart: "2026-11-20T22:00:00+01:00" }), CTX);
    expect(soon.relevanceScore).toBe(later.relevanceScore);
    expect(soon.priority).toBe(later.priority + 3);
    expect(soon.startsWithin72h).toBe(true);
    expect(later.startsWithin72h).toBe(false);
  });

  it("keeps a row with no start date and asks for the date first", () => {
    const p = scoreReviewPriority(dq({ probableTitle: "Rave", probableStart: null }), CTX);
    expect(p.tier).toBe("likely");
    expect(p.hoursToStart).toBeNull();
    expect(p.recommendedAction).toBe("Add the start date, then review");
  });

  it("asks for the venue when the venue is not registered", () => {
    expect(scoreReviewPriority(dq({ probableTitle: "Rave", probableVenueName: "Nowhere Club" }), CTX).recommendedAction).toMatch(/venue/);
  });

  it("counts a low-trust source against the score", () => {
    const low = scoreReviewPriority(dq({ probableTitle: "Rave", sourceId: "src-fb-test" }), CTX);
    const medium = scoreReviewPriority(dq({ probableTitle: "Rave", sourceId: "src-billetto" }), CTX);
    expect(low.relevanceScore).toBe(medium.relevanceScore - 1);
  });

  it("never changes the input row", () => {
    const item = dq({ probableVenueName: "MODULE", detectedLineup: ["A"] });
    const before = JSON.stringify(item);
    scoreReviewPriority(item, CTX);
    expect(JSON.stringify(item)).toBe(before);
  });
});

describe("buildReviewPriorityList", () => {
  const ALL = [TANZEN, DIRTY_TRANCING, BOILER_ROOM_KULTUNAUT, BOILER_ROOM_POOLEN, THE_PRODIGY, FINAL_DESCENT, ...BILLETTO_NOISE];

  it("puts every known relevant case in a tier and no Billetto noise anywhere", () => {
    const list = buildReviewPriorityList(ALL, CTX);
    const likely = list.likely.map((r) => r.item.id);
    const possible = list.possible.map((r) => r.item.id);
    expect(likely).toEqual(expect.arrayContaining(["dq-tanzen", "dq-dirty-trancing", "dq-boiler-room-kn", "dq-boiler-room-poolen"]));
    expect(possible).toEqual(expect.arrayContaining(["dq-prodigy", "dq-final-descent"]));
    expect([...likely, ...possible].some((id) => BILLETTO_NOISE.some((n) => n.id === id))).toBe(false);
  });

  it("ranks the events starting within 72 hours first", () => {
    const list = buildReviewPriorityList(ALL, CTX);
    expect(list.likely.slice(0, 2).map((r) => r.item.id)).toEqual(["dq-dirty-trancing", "dq-tanzen"]);
    expect(list.urgentCount).toBe(2);
  });

  it("drops rows whose event is already over", () => {
    const over = dq({ id: "dq-over", probableTitle: "Rave", probableStart: "2026-10-10T22:00:00+02:00" });
    expect(buildReviewPriorityList([over], CTX).likely).toHaveLength(0);
  });

  it("orders ties by start, then title", () => {
    const a = dq({ id: "a", probableTitle: "B Rave", probableStart: "2026-11-20T22:00:00+01:00" });
    const b = dq({ id: "b", probableTitle: "A Rave", probableStart: "2026-11-20T22:00:00+01:00" });
    const c = dq({ id: "c", probableTitle: "C Rave", probableStart: "2026-11-19T22:00:00+01:00" });
    expect(buildReviewPriorityList([a, b, c], CTX).likely.map((r) => r.item.id)).toEqual(["c", "b", "a"]);
  });
});

describe("splitPastStale", () => {
  it("separates upcoming rows the source no longer lists from expired ones, keeping undated rows with the expired", () => {
    const upcoming = dq({ id: "up", probableStart: "2026-10-22T20:00:00+02:00" });
    const past = dq({ id: "past", probableStart: "2026-10-01T20:00:00+02:00" });
    const undated = dq({ id: "undated", probableStart: null });
    const split = splitPastStale([upcoming, past, undated], NOW);
    expect(split.upcomingNotInSource.map((r) => r.id)).toEqual(["up"]);
    expect(split.expired.map((r) => r.id)).toEqual(["past", "undated"]);
  });
});

describe("buildReviewPriorityList — 72-hour counts per tier", () => {
  it("counts urgent likely and urgent possible rows separately", () => {
    const list = buildReviewPriorityList(
      [
        dq({ id: "l", probableTitle: "Rave", probableStart: "2026-10-17T22:00:00+02:00" }),
        dq({ id: "p", sourceId: "src-kultunaut", probableTitle: "Some Act", probableStart: "2026-10-18T20:00:00+02:00" }),
        dq({ id: "later", probableTitle: "Rave", probableStart: "2026-11-20T22:00:00+01:00" }),
      ],
      CTX,
    );
    expect(list).toMatchObject({ urgentCount: 2, urgentLikelyCount: 1, urgentPossibleCount: 1 });
  });
});

describe("splitVisibleReviewRows", () => {
  const rows = (n: number, tier: "likely" | "possible") =>
    Array.from({ length: n }, (_, i) => ({
      item: dq({ id: `${tier}-${i}` }),
      priority: scoreReviewPriority(dq({ id: `${tier}-${i}`, probableTitle: tier === "likely" ? "Rave" : "Act", sourceId: "src-kultunaut" }), CTX),
    }));
  const list = (likely: number, possible: number) => ({
    likely: rows(likely, "likely"),
    possible: rows(possible, "possible"),
    urgentCount: 0,
    urgentLikelyCount: 0,
    urgentPossibleCount: 0,
  });

  it("fills free slots up to 15 with possible rows when there are fewer likely rows (the 2026-10-17 shape: 3 + 28)", () => {
    const v = splitVisibleReviewRows(list(3, 28));
    expect([v.likelyShown.length, v.possibleShown.length, v.likelyHidden.length, v.possibleHidden.length]).toEqual([3, 12, 0, 16]);
    expect(v.possibleShown[0].item.id).toBe("possible-0");
  });

  it("shows no possible rows when there are 15 or more likely rows", () => {
    const v = splitVisibleReviewRows(list(17, 5));
    expect([v.likelyShown.length, v.possibleShown.length, v.likelyHidden.length, v.possibleHidden.length]).toEqual([15, 0, 2, 5]);
  });

  it("handles empty and short lists", () => {
    expect(splitVisibleReviewRows(list(0, 4)).possibleShown).toHaveLength(4);
    expect(splitVisibleReviewRows(list(0, 0)).likelyShown).toHaveLength(0);
  });
});

describe("prioritizeNotInSource", () => {
  it("ranks dropped upcoming rows that look electronic and keeps the rest by date, without judging why they disappeared", () => {
    const twilight = dq({ id: "twilight", probableTitle: "Twilight Rave", probableVenueName: "Pumpehuset", sourceId: "src-pumpehuset", probableStart: "2026-10-23T21:00:00+02:00" });
    const klangbad = dq({ id: "klangbad", probableTitle: "Klangbad med lyden af gong", probableStart: "2026-11-20T18:00:00+01:00" });
    const sewing = dq({ id: "sewing", probableTitle: "Prøv en hobby: Syworkshop", probableStart: "2026-11-01T18:00:00+01:00" });
    const review = prioritizeNotInSource([klangbad, twilight, sewing], CTX);
    expect(review.prioritized.likely.map((r) => r.item.id)).toEqual(["twilight"]);
    expect(review.prioritized.possible).toHaveLength(0);
    expect(review.others.map((r) => r.id)).toEqual(["sewing", "klangbad"]);
  });

  it("does not count the source category for rows the source no longer lists — no points, no penalty, no cancellation verdict", () => {
    // Real 2026-10-17 cases: Pumpehuset no longer lists these under Elektronisk.
    const roben = dq({ id: "roben", probableTitle: "Roben & Knud", probableVenueName: "Pumpehuset", sourceId: "src-pumpehuset", probableStart: "2026-12-03T20:00:00+01:00" });
    const marwan = dq({ id: "marwan", probableTitle: "Marwan - 20-års jubilæumskoncert", sourceId: "src-pumpehuset", probableStart: "2027-04-29T20:00:00+02:00" });
    const review = prioritizeNotInSource([roben, marwan], CTX);
    expect(review.prioritized.possible).toHaveLength(0);
    expect(review.others.map((r) => r.id)).toEqual(["roben", "marwan"]);

    const listed = scoreReviewPriority(roben, CTX);
    const dropped = scoreReviewPriority(roben, { ...CTX, sourceStillLists: false });
    expect(listed.tier).toBe("possible");
    expect(dropped.tier).toBe("none");
    expect(dropped.relevanceScore).toBe(listed.relevanceScore - 2);
    expect(dropped.signals.some((s) => s.points < 0)).toBe(false);
    expect(dropped.signals.map((s) => s.key)).toContain("source_category_not_counted");
    expect(JSON.stringify(dropped)).not.toMatch(/cancel/i);
  });

  it("keeps a dropped row that has its own evidence (Twilight Rave) in the likely tier without the category points", () => {
    const twilight = dq({ id: "twilight", probableTitle: "Twilight Rave", sourceId: "src-pumpehuset", probableStart: "2026-10-23T21:00:00+02:00" });
    const row = prioritizeNotInSource([twilight], CTX).prioritized.likely[0];
    expect(row.priority.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["dj_or_club_title", "source_category_not_counted"]));
    expect(row.priority.signals.map((s) => s.key)).not.toContain("source_category");
  });
});

describe("groupReviewList / isSameEventFromAnotherSource — display-only grouping of the same event from two sources", () => {
  const VEGA_ROOMS: Venue = { ...venue("v-vega", "VEGA"), rooms: [{ name: "Store VEGA" }, { name: "Lille VEGA" }] };
  const GVENUES = [...VENUES.filter((v) => v.id !== "v-vega"), VEGA_ROOMS];
  const GCTX = { ...CTX, venues: GVENUES };

  // The real 2026-10-17 pair: KultuNaut and Poolen both list Boiler Room at Poolen on 11 December.
  const BR_KN = dq({ id: "br-kn", probableTitle: "Boiler Room", probableVenueName: "Poolen", sourceId: "src-kultunaut", probableStart: "2026-12-11T21:00:00+01:00", detectedLineup: ["Boiler Room"] });
  const BR_POOLEN = dq({ id: "br-poolen", probableTitle: "Boiler Room", probableVenueName: "Poolen", sourceId: "src-poolen", probableStart: "2026-12-11T21:00:00+01:00", detectedLineup: ["Boiler Room"] });

  it("groups Boiler Room from KultuNaut and Poolen into one entry, keeping both rows", () => {
    const grouped = groupReviewList(buildReviewPriorityList([BR_KN, BR_POOLEN], GCTX), GVENUES);
    expect(grouped.likely).toHaveLength(1);
    expect([grouped.likely[0].primary.item.id, ...grouped.likely[0].others.map((r) => r.item.id)].sort()).toEqual(["br-kn", "br-poolen"]);
  });

  it("before grouping the pair takes two of the 15 places, after grouping one", () => {
    const list = buildReviewPriorityList([BR_KN, BR_POOLEN], GCTX);
    expect(splitVisibleReviewRows(list).likelyShown).toHaveLength(2);
    expect(splitVisibleReviewRows(groupReviewList(list, GVENUES)).likelyShown).toHaveLength(1);
  });

  it("never groups different dates (the same series on two nights)", () => {
    const nextWeek = { ...BR_POOLEN, id: "br-next", probableStart: "2026-12-18T21:00:00+01:00" };
    expect(isSameEventFromAnotherSource(BR_KN, nextWeek, GVENUES)).toBe(false);
  });

  it("never groups different rooms at the same venue on the same night", () => {
    const store = dq({ id: "store", probableTitle: "Rave Night", probableVenueName: "VEGA", probableSubVenue: "Store VEGA", sourceId: "src-kultunaut", detectedLineup: ["DJ A"] });
    const lille = dq({ id: "lille", probableTitle: "Rave Night", probableVenueName: "VEGA", probableSubVenue: "Lille VEGA", sourceId: "src-billetto", detectedLineup: ["DJ A"] });
    expect(isSameEventFromAnotherSource(store, lille, GVENUES)).toBe(false);
  });

  it("never groups two rows from the same source (it may list an early and a late show)", () => {
    const early = { ...BR_KN, id: "early", probableStart: "2026-12-11T18:00:00+01:00" };
    expect(isSameEventFromAnotherSource(BR_KN, { ...BR_KN, id: "copy" }, GVENUES)).toBe(false);
    expect(groupReviewList(buildReviewPriorityList([BR_KN, early], GCTX), GVENUES).likely).toHaveLength(2);
  });

  it("never groups shows more than two hours apart, even from different sources", () => {
    const late = { ...BR_POOLEN, id: "late", probableStart: "2026-12-11T23:30:00+01:00" };
    expect(isSameEventFromAnotherSource(BR_KN, late, GVENUES)).toBe(false);
  });

  it("never groups on title and night alone: different venues, an unresolved venue or no lineup on either side", () => {
    expect(isSameEventFromAnotherSource(BR_KN, { ...BR_POOLEN, probableVenueName: "MODULE" }, GVENUES)).toBe(false);
    expect(isSameEventFromAnotherSource(BR_KN, { ...BR_POOLEN, probableVenueName: "Nowhere Club" }, GVENUES)).toBe(false);
    expect(isSameEventFromAnotherSource({ ...BR_KN, detectedLineup: [] }, { ...BR_POOLEN, detectedLineup: [] }, GVENUES)).toBe(false);
  });

  it("never groups different headliners on the same night at the same venue", () => {
    const a = dq({ id: "a", probableTitle: "Club Night", probableVenueName: "MODULE", sourceId: "src-hvaderpaa", detectedLineup: ["Horst Haller"] });
    const b = dq({ id: "b", probableTitle: "Club Night", probableVenueName: "MODULE", sourceId: "src-kultunaut", detectedLineup: ["Someone Else"] });
    expect(isSameEventFromAnotherSource(a, b, GVENUES)).toBe(false);
  });

  it("puts a possible duplicate inside its likely twin and counts the event once in the 72-hour warning", () => {
    const soonKn = { ...BR_KN, id: "soon-kn", probableStart: "2026-10-17T21:00:00+02:00" };
    const soonPoolen = { ...BR_POOLEN, id: "soon-poolen", probableTitle: "Boiler Room", probableStart: "2026-10-17T21:00:00+02:00" };
    const grouped = groupReviewList(buildReviewPriorityList([soonKn, soonPoolen], GCTX), GVENUES);
    expect(grouped.likely).toHaveLength(1);
    expect(grouped.possible).toHaveLength(0);
    expect(grouped).toMatchObject({ urgentCount: 1, urgentLikelyCount: 1, urgentPossibleCount: 0 });
  });

  it("keeps the ranked order and never changes the rows", () => {
    const solo = dq({ id: "solo", probableTitle: "Rave", probableStart: "2026-10-17T22:00:00+02:00" });
    const list = buildReviewPriorityList([BR_KN, BR_POOLEN, solo], GCTX);
    const before = JSON.stringify(list);
    const grouped = groupReviewList(list, GVENUES);
    expect(grouped.likely.map((g) => g.primary.item.id)).toEqual([list.likely[0].item.id, ...grouped.likely.slice(1).map((g) => g.primary.item.id)]);
    expect(grouped.likely[0].primary.item.id).toBe("solo");
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe("splitPossibleForDisplay — each possible event once, urgent ones in full", () => {
  const at = (id: string, hours: number | null, urgent = false) => ({
    primary: {
      item: dq({ id, probableTitle: id, probableStart: hours === null ? null : new Date(CTX.now.getTime() + hours * 3_600_000).toISOString() }),
      priority: { ...scoreReviewPriority(dq({ id }), CTX), hoursToStart: hours, startsWithin72h: urgent },
    },
    others: [],
  });

  it("puts urgent events in full and the rest into time buckets by start date, leaving empty buckets out", () => {
    const groups = [at("a", 30, true), at("b", 100), at("c", 400), at("d", 2000), at("e", 150), at("f", null)];
    const display = splitPossibleForDisplay(groups);
    expect(display.urgent.map((g) => g.primary.item.id)).toEqual(["a"]);
    expect(display.buckets.map((b) => [b.label, b.groups.map((g) => g.primary.item.id)])).toEqual([
      ["Next 7 days", ["b", "e"]],
      ["8–30 days", ["c"]],
      ["Later", ["d"]],
      ["No date", ["f"]],
    ]);
    const all = [...display.urgent, ...display.buckets.flatMap((b) => b.groups)].map((g) => g.primary.item.id);
    expect(all.sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(splitPossibleForDisplay([at("x", 500)]).buckets.map((b) => b.key)).toEqual(["next_30_days"]);
  });

  it("orders a bucket by start date even when the ranking put a later event first", () => {
    const display = splitPossibleForDisplay([at("later-but-ranked-first", 600), at("earlier", 300)]);
    expect(display.buckets[0].groups.map((g) => g.primary.item.id)).toEqual(["earlier", "later-but-ranked-first"]);
  });

  it("an event is urgent when any of its sources' listings starts within 72 hours", () => {
    const group = at("g", 200);
    const urgentTwin = at("g2", 60, true).primary;
    expect(splitPossibleForDisplay([{ ...group, others: [urgentTwin] }]).urgent).toHaveLength(1);
  });
});
