import { describe, expect, it } from "vitest";
import { assessDuplicate, decideDuplicateAction, findBestDuplicateMatch, normalizeUrl } from "./dedup";

describe("assessDuplicate", () => {
  it("high confidence: same venue, same date, strong title/lineup match", () => {
    const a = { title: "Fast Forward", artists: ["ROTOR", "HALVDAN"], venueId: "v-hangaren", startDatetime: "2026-08-15T23:59:00+02:00" };
    const b = { title: "Fast Forward @ Hangaren", artists: ["ROTOR", "HALVDAN", "GRIT."], venueId: "v-hangaren", startDatetime: "2026-08-15T23:30:00+02:00" };
    const result = assessDuplicate(a, b);
    expect(result.confidence).toBe("high");
  });

  it("medium (review), never auto-merged: same date, same artists, no venue confirmation", () => {
    // Strong lineup overlap alone, without a confirmed shared venue or a
    // unique-identifier URL match, is deliberately NOT enough for AUTO_LINK
    // — "same venue + same date alone must never be enough" cuts both ways:
    // a lineup match with no venue evidence at all still needs a human,
    // it just doesn't get auto-rejected either.
    const a = { title: "Kasst", artists: ["KASST", "MRK."], venueId: "v-culture-box", startDatetime: "2026-09-19T23:30:00+02:00" };
    const b = { title: "Kasst presents: Culture Box Showcase", artists: ["KASST", "MRK."], venueId: null, startDatetime: "2026-09-19T22:00:00+02:00" };
    const result = assessDuplicate(a, b);
    expect(result.confidence).toBe("medium");
    expect(decideDuplicateAction(result.confidence)).toBe("review_queue");
  });

  it("does not merge same venue + same date with clearly different lineups", () => {
    const a = { title: "Box Standard", artists: ["NAILS", "TEODORA LUX"], venueId: "v-culture-box", startDatetime: "2026-08-14T23:30:00+02:00" };
    const b = { title: "Underground Sessions", artists: ["MONA STILL", "PETRA VOSS"], venueId: "v-culture-box", startDatetime: "2026-08-14T23:00:00+02:00" };
    const result = assessDuplicate(a, b);
    expect(result.confidence).not.toBe("high");
    expect(decideDuplicateAction(result.confidence)).not.toBe("auto_merge_if_safe");
  });

  it("returns none for events on different nights even at the same venue", () => {
    const a = { title: "Box Standard", artists: ["NAILS"], venueId: "v-culture-box", startDatetime: "2026-08-14T23:30:00+02:00" };
    const b = { title: "Box Standard", artists: ["NAILS"], venueId: "v-culture-box", startDatetime: "2026-08-21T23:30:00+02:00" };
    expect(assessDuplicate(a, b).confidence).toBe("none");
  });

  it("treats a post-midnight duplicate report as the same night as its evening counterpart", () => {
    const a = { title: "Fast Forward", artists: ["ROTOR"], venueId: "v-hangaren", startDatetime: "2026-08-15T23:59:00+02:00" };
    const b = { title: "Fast Forward", artists: ["ROTOR"], venueId: "v-hangaren", startDatetime: "2026-08-16T01:30:00+02:00" };
    expect(assessDuplicate(a, b).confidence).toBe("high");
  });
});

describe("decideDuplicateAction", () => {
  it("maps confidence tiers to the correct workflow action", () => {
    expect(decideDuplicateAction("high")).toBe("auto_merge_if_safe");
    expect(decideDuplicateAction("medium")).toBe("review_queue");
    expect(decideDuplicateAction("low")).toBe("keep_separate");
    expect(decideDuplicateAction("none")).toBe("keep_separate");
  });
});

describe("findBestDuplicateMatch", () => {
  it("picks the strongest match among several candidates", () => {
    const candidate = { title: "Kasst", artists: ["KASST", "MRK."], venueId: "v-culture-box", startDatetime: "2026-09-19T23:30:00+02:00" };
    const existing = [
      { id: "e-1", title: "Unrelated Night", artists: ["OTHER"], venueId: "v-jolene", startDatetime: "2026-09-19T23:00:00+02:00" },
      { id: "e-2", title: "Kasst", artists: ["KASST", "MRK.", "SILT"], venueId: "v-culture-box", startDatetime: "2026-09-19T23:30:00+02:00" },
    ];
    const best = findBestDuplicateMatch(candidate, existing);
    expect(best?.match.id).toBe("e-2");
    expect(best?.assessment.confidence).toBe("high");
  });

  it("returns null when nothing shares the same night", () => {
    const candidate = { title: "Kasst", artists: ["KASST"], venueId: "v-culture-box", startDatetime: "2026-09-19T23:30:00+02:00" };
    const existing = [{ id: "e-1", title: "Kasst", artists: ["KASST"], venueId: "v-culture-box", startDatetime: "2026-09-26T23:30:00+02:00" }];
    expect(findBestDuplicateMatch(candidate, existing)).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("normalizes protocol, www, trailing slash, and drops tracking params, sorting what's left", () => {
    const a = normalizeUrl("https://billetto.dk/e/Show?utm_source=fb&utm_campaign=x&id=1");
    const b = normalizeUrl("http://www.billetto.dk/e/Show/?id=1&fbclid=abc123");
    expect(a).toBe("https://billetto.dk/e/Show?id=1");
    expect(b).toBe("https://billetto.dk/e/Show?id=1");
    expect(a).toBe(b);
  });

  it("preserves a meaningful fragment (room anchor) rather than stripping it", () => {
    expect(normalizeUrl("https://culture-box.com/event/fri-28-august/#black-box")).toBe(
      "https://culture-box.com/event/fri-28-august#black-box",
    );
  });

  it("returns null for null/empty input", () => {
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});

describe("evidence-based model regression coverage", () => {
  const NIGHT = "2026-08-22T20:00:00+02:00";
  const NIGHT_LATER = "2026-08-22T22:00:00+02:00";

  it("same date/time, different venue, unrelated titles -> NOT_DUPLICATE", () => {
    const a = { title: "Teenage Mutants B2B Schaarup", artists: ["Teenage Mutants", "Schaarup"], venueId: "v-hangaren", startDatetime: NIGHT };
    const b = { title: "Timo Maas, Ryan Dank", artists: ["Timo Maas", "Ryan Dank"], venueId: "v-culture-box", startDatetime: NIGHT_LATER };
    expect(assessDuplicate(a, b).confidence).toBe("none");
  });

  it("same venue/date, unrelated titles -> NOT_DUPLICATE", () => {
    const a = { title: "Nastia", artists: [], venueId: "v-hangaren", startDatetime: NIGHT };
    const b = { title: "Damian Lazarus", artists: [], venueId: "v-hangaren", startDatetime: NIGHT_LATER };
    expect(assessDuplicate(a, b).confidence).toBe("none");
  });

  it("same Resident Advisor URL, same event -> AUTO_LINK", () => {
    const a = { title: "Konfusia", artists: ["Konfusia"], venueId: "v-hangaren", startDatetime: NIGHT, residentAdvisorUrl: "https://ra.co/events/2514076" };
    const b = { title: "Konfusia (Hangaren)", artists: ["Konfusia", "TBA"], venueId: "v-hangaren", startDatetime: NIGHT_LATER, residentAdvisorUrl: "https://ra.co/events/2514076" };
    expect(assessDuplicate(a, b).confidence).toBe("high");
    expect(decideDuplicateAction(assessDuplicate(a, b).confidence)).toBe("auto_merge_if_safe");
  });

  it("same Billetto ticket URL across sources -> AUTO_LINK", () => {
    const a = {
      title: "Infected Mushroom",
      artists: ["Infected Mushroom"],
      venueId: "v-poolen",
      startDatetime: NIGHT,
      ticketUrl: "https://billetto.dk/e/infected-mushroom-30th-anniversary-tour-billetter-1879852?utm_source=organiser&utm_medium=share",
    };
    // A future Billetto listing: its own officialEventUrl IS the ticket URL
    // already stored on the Poolen side — venue not yet resolved on this side.
    const b = {
      title: "Infected Mushroom — 30th Anniversary Tour",
      artists: [] as string[],
      venueId: null,
      startDatetime: NIGHT,
      officialEventUrl: "https://billetto.dk/e/infected-mushroom-30th-anniversary-tour-billetter-1879852",
    };
    expect(assessDuplicate(a, b).confidence).toBe("high");
  });

  it("cross-field URL match (ticket/RA on one side vs official on the other) -> AUTO_LINK", () => {
    const a = { title: "Nastia", artists: ["Nastia"], venueId: "v-hangaren", startDatetime: NIGHT, ticketUrl: "https://ra.co/events/2500089", residentAdvisorUrl: "https://ra.co/events/2500089" };
    const b = { title: "Nastia (RA listing)", artists: ["Nastia"], venueId: "v-hangaren", startDatetime: NIGHT, officialEventUrl: "https://ra.co/events/2500089" };
    expect(assessDuplicate(a, b).confidence).toBe("high");
  });

  it("Culture Box Black Box vs Red Box sharing an identical RA URL -> NOT_DUPLICATE (room anchor wins)", () => {
    const blackBox = {
      title: "Black Box: Timo Maas, Ryan Dank, Baltza",
      artists: ["Timo Maas", "Ryan Dank", "Baltza"],
      venueId: "v-culture-box",
      startDatetime: NIGHT,
      officialEventUrl: "https://culture-box.com/event/sat-22-august-2026/#black-box",
      residentAdvisorUrl: "https://ra.co/events/2489665",
    };
    const redBox = {
      title: "Red Box: Fia2TheFloor, Amittet, Tinki, Delff",
      artists: ["Fia2TheFloor", "Amittet", "Tinki", "Delff"],
      venueId: "v-culture-box",
      startDatetime: NIGHT,
      officialEventUrl: "https://culture-box.com/event/sat-22-august-2026/#red-box",
      // Real Production confirmed pattern: the venue reuses ONE RA link across both rooms.
      residentAdvisorUrl: "https://ra.co/events/2489665",
    };
    const result = assessDuplicate(blackBox, redBox);
    expect(result.confidence).toBe("none");
  });

  it("a generic, whole-night ticket URL never overrides a room-anchor contradiction", () => {
    // Same idea as the Culture Box case, generalized: any room-partitioned
    // source's shared "whole night" link (ticket, RA, or otherwise) must not
    // beat an explicit room-identity contradiction on officialEventUrl.
    const a = { title: "Room A show", artists: ["Artist One"], venueId: "v-warehouse9", startDatetime: NIGHT, officialEventUrl: "https://warehouse9.example/night/2026-08-22#room-a", ticketUrl: "https://tickets.example/whole-night-pass" };
    const b = { title: "Room B show", artists: ["Artist Two"], venueId: "v-warehouse9", startDatetime: NIGHT, officialEventUrl: "https://warehouse9.example/night/2026-08-22#room-b", ticketUrl: "https://tickets.example/whole-night-pass" };
    expect(assessDuplicate(a, b).confidence).toBe("none");
  });

  it("same room + strong artist/title overlap -> AUTO_LINK", () => {
    const a = {
      title: "Black Box: Timo Maas, Ryan Dank, Baltza",
      artists: ["Timo Maas", "Ryan Dank", "Baltza"],
      venueId: "v-culture-box",
      startDatetime: NIGHT,
      officialEventUrl: "https://culture-box.com/event/sat-22-august-2026/#black-box",
    };
    const b = {
      title: "Timo Maas, Ryan Dank, Baltza",
      artists: ["Timo Maas", "Ryan Dank", "Baltza"],
      venueId: "v-culture-box",
      startDatetime: NIGHT,
      officialEventUrl: "https://culture-box.com/event/sat-22-august-2026/#black-box",
    };
    expect(assessDuplicate(a, b).confidence).toBe("high");
  });

  it("same room + partial artist/title overlap only -> REVIEW_DUPLICATE, never auto-merged", () => {
    const a = { title: "Black Box: X, Y, Z", artists: ["X", "Y", "Z"], venueId: "v-culture-box", startDatetime: NIGHT };
    const b = { title: "Black Box: X, W", artists: ["X", "W"], venueId: "v-culture-box", startDatetime: NIGHT };
    const result = assessDuplicate(a, b);
    expect(result.confidence).toBe("medium");
    expect(decideDuplicateAction(result.confidence)).toBe("review_queue");
  });

  it("conflicting headliners -> NOT_DUPLICATE even at the same venue and night", () => {
    const a = { title: "Black Box: Timo Maas, Ryan Dank", artists: ["Timo Maas", "Ryan Dank"], venueId: "v-culture-box", startDatetime: NIGHT };
    const b = { title: "Black Box: Anii, Aurora & Mane Maid", artists: ["Anii", "Aurora & Mane Maid"], venueId: "v-culture-box", startDatetime: NIGHT };
    expect(assessDuplicate(a, b).confidence).toBe("none");
  });

  it("a shared URL is tempered to REVIEW, not AUTO_LINK, when declared lineups clearly conflict", () => {
    const a = { title: "Show Alpha", artists: ["Artist One"], venueId: "v-hangaren", startDatetime: NIGHT, ticketUrl: "https://ra.co/events/7777" };
    const b = { title: "Show Beta", artists: ["Someone Else"], venueId: "v-hangaren", startDatetime: NIGHT, ticketUrl: "https://ra.co/events/7777" };
    const result = assessDuplicate(a, b);
    expect(result.confidence).toBe("medium");
  });

  it("generic title words only (no distinctive tokens, no lineup) -> NOT_DUPLICATE", () => {
    const a = { title: "Techno Party Night", artists: [] as string[], venueId: "v-hangaren", startDatetime: NIGHT };
    const b = { title: "House Rave Session", artists: [] as string[], venueId: "v-hangaren", startDatetime: NIGHT };
    expect(assessDuplicate(a, b).confidence).toBe("none");
  });

  it("tracking-param URL variants of the same event still match -> AUTO_LINK", () => {
    const a = { title: "Benny Benassi", artists: ["Benny Benassi"], venueId: "v-poolen", startDatetime: NIGHT, ticketUrl: "https://secure.tickster.com/3nbkn6wh5xbd7c3?c=fvl9pr3&utm_source=newsletter" };
    const b = { title: "Benny Benassi", artists: ["Benny Benassi"], venueId: "v-poolen", startDatetime: NIGHT, ticketUrl: "http://www.secure.tickster.com/3nbkn6wh5xbd7c3/?c=fvl9pr3" };
    expect(assessDuplicate(a, b).confidence).toBe("high");
  });

  it("no duplicate signal anywhere -> NOT_DUPLICATE", () => {
    const a = { title: "", artists: [] as string[], venueId: null, startDatetime: NIGHT };
    const b = { title: "", artists: [] as string[], venueId: null, startDatetime: NIGHT };
    expect(assessDuplicate(a, b).confidence).toBe("none");
  });
});
