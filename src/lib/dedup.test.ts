import { describe, expect, it } from "vitest";
import { assessDuplicate, decideDuplicateAction, findBestDuplicateMatch } from "./dedup";

describe("assessDuplicate", () => {
  it("high confidence: same venue, same date, strong title/lineup match", () => {
    const a = { title: "Fast Forward", artists: ["ROTOR", "HALVDAN"], venueId: "v-hangaren", startDatetime: "2026-08-15T23:59:00+02:00" };
    const b = { title: "Fast Forward @ Hangaren", artists: ["ROTOR", "HALVDAN", "GRIT."], venueId: "v-hangaren", startDatetime: "2026-08-15T23:30:00+02:00" };
    const result = assessDuplicate(a, b);
    expect(result.confidence).toBe("high");
  });

  it("high confidence: same date, same artists, slightly different title, no venue match", () => {
    const a = { title: "Kasst", artists: ["KASST", "MRK."], venueId: "v-culture-box", startDatetime: "2026-09-19T23:30:00+02:00" };
    const b = { title: "Kasst presents: Culture Box Showcase", artists: ["KASST", "MRK."], venueId: null, startDatetime: "2026-09-19T22:00:00+02:00" };
    const result = assessDuplicate(a, b);
    expect(result.confidence).toBe("high");
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
