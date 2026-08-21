import { describe, expect, it } from "vitest";
import { assessMovedEvent, findBestMovedEventMatch, type ExistingSameSourceEvent, type MovedEventCandidate } from "./movedEventDetection";

const EXISTING: ExistingSameSourceEvent = {
  title: "tonser",
  artists: ["tonser"],
  venueId: "v-pumpehuset",
  startDatetime: "2026-09-19T21:00:00+02:00",
  officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2026/",
  ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
  residentAdvisorUrl: null,
};

describe("assessMovedEvent (data-quality Workstream C — moved/rescheduled first-party events)", () => {
  it("is 'high' confidence when the candidate shares a ticket URL with an existing event at a different date (tonser-type evidence)", () => {
    const candidate: MovedEventCandidate = {
      title: "tonser",
      artists: ["tonser"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T21:00:00+01:00",
      officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2027-flyttet/",
      ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
    };
    const result = assessMovedEvent(candidate, EXISTING);
    expect(result.confidence).toBe("high");
  });

  it("is 'medium' confidence with explicit reschedule wording and a strong title/lineup match, but no shared URL", () => {
    const candidate: MovedEventCandidate = {
      title: "tonser",
      artists: ["tonser"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T21:00:00+01:00",
      description: "This show has been moved to a new date.",
      officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2027-flyttet/",
      ticketUrl: "https://www.ticketmaster.dk/event/tonser-new-billetter/999999",
    };
    const result = assessMovedEvent(candidate, EXISTING);
    expect(result.confidence).toBe("medium");
  });

  it("is 'none' when only the title/artist match — never merges/hides solely on name match", () => {
    const candidate: MovedEventCandidate = {
      title: "tonser",
      artists: ["tonser"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T21:00:00+01:00",
      officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2027-flyttet/",
      ticketUrl: "https://www.ticketmaster.dk/event/tonser-new-billetter/999999",
    };
    const result = assessMovedEvent(candidate, EXISTING);
    expect(result.confidence).toBe("none");
  });

  it("is 'none' when the date is actually the same (that's normal dedup's job, not this module's)", () => {
    const candidate: MovedEventCandidate = { ...EXISTING };
    const result = assessMovedEvent(candidate, EXISTING);
    expect(result.confidence).toBe("none");
  });

  it("is 'none' across different venues, even with a shared URL and strong title match", () => {
    const candidate: MovedEventCandidate = {
      title: "tonser",
      artists: ["tonser"],
      venueId: "v-hangaren",
      startDatetime: "2027-02-20T21:00:00+01:00",
      ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
    };
    const result = assessMovedEvent(candidate, EXISTING);
    expect(result.confidence).toBe("none");
  });

  it("is 'none' for a completely unrelated event at the same venue on a different date", () => {
    const candidate: MovedEventCandidate = {
      title: "Some Other Artist",
      artists: ["Some Other Artist"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T21:00:00+01:00",
      ticketUrl: "https://www.ticketmaster.dk/event/other-billetter/000000",
    };
    const result = assessMovedEvent(candidate, EXISTING);
    expect(result.confidence).toBe("none");
  });

  it("recognizes real Danish first-party reschedule wording (real tonser production evidence: 'er flyttet til den 20. februar 2027')", () => {
    const candidate: MovedEventCandidate = {
      title: "tonser",
      artists: ["tonser"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T20:00:00+01:00",
      description:
        "NB! Koncerten har tidligere været annonceret til den 19. september 2026, men er flyttet til den 20. februar 2027. Købte billetter gælder til den nye dato.",
      officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2/",
      ticketUrl: "https://www.ticketmaster.dk/event/tonser-new-billetter/999999",
    };
    const result = assessMovedEvent(candidate, EXISTING);
    expect(result.confidence).toBe("medium");
  });
});

describe("findBestMovedEventMatch", () => {
  it("finds the strongest match among several same-source existing events", () => {
    const other: ExistingSameSourceEvent = {
      title: "Unrelated Night",
      artists: ["Unrelated Artist"],
      venueId: "v-pumpehuset",
      startDatetime: "2026-10-01T21:00:00+02:00",
      officialEventUrl: "https://pumpehuset.dk/koncerter/unrelated/",
    };
    const candidate: MovedEventCandidate = {
      title: "tonser",
      artists: ["tonser"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T21:00:00+01:00",
      ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
    };
    const withIds = [{ ...other, id: "e-other" }, { ...EXISTING, id: "e-tonser" }];
    const best = findBestMovedEventMatch(candidate, withIds);
    expect(best?.match.id).toBe("e-tonser");
    expect(best?.assessment.confidence).toBe("high");
  });

  it("returns null when nothing qualifies", () => {
    const candidate: MovedEventCandidate = {
      title: "Completely Different Show",
      artists: ["Nobody"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T21:00:00+01:00",
    };
    const withIds = [{ ...EXISTING, id: "e-tonser" }];
    expect(findBestMovedEventMatch(candidate, withIds)).toBeNull();
  });

  it("recurring-series guard: caps 'high' to 'medium' when 2+ other existing events already share this title, instead of auto-attaching (never merges separate recurring editions solely on identity match, even with a coincidentally shared generic ticket URL)", () => {
    const recurring = {
      title: "Monthly Rave",
      artists: ["Resident Selectors"],
      venueId: "v-pumpehuset",
      ticketUrl: "https://secure.tickster.com/generic-monthly-rave-landing-page",
    };
    const edition1 = { ...recurring, startDatetime: "2026-01-15T21:00:00+01:00", id: "e-jan" };
    const edition2 = { ...recurring, startDatetime: "2026-02-15T21:00:00+01:00", id: "e-feb" };
    const candidate: MovedEventCandidate = {
      title: "Monthly Rave",
      artists: ["Resident Selectors"],
      venueId: "v-pumpehuset",
      startDatetime: "2026-03-15T21:00:00+01:00",
      ticketUrl: "https://secure.tickster.com/generic-monthly-rave-landing-page",
    };
    const best = findBestMovedEventMatch(candidate, [edition1, edition2]);
    expect(best).not.toBeNull();
    expect(best?.assessment.confidence).toBe("medium");
  });

  it("a genuine one-off reschedule (exactly one prior instance) still gets 'high' — the recurring-series guard only kicks in at 2+", () => {
    const withIds = [{ ...EXISTING, id: "e-tonser" }];
    const candidate: MovedEventCandidate = {
      title: "tonser",
      artists: ["tonser"],
      venueId: "v-pumpehuset",
      startDatetime: "2027-02-20T21:00:00+01:00",
      ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
    };
    const best = findBestMovedEventMatch(candidate, withIds);
    expect(best?.assessment.confidence).toBe("high");
  });
});
