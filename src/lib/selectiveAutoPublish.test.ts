import { describe, expect, it } from "vitest";
import { isSelectiveAutoPublishCandidate, findSyncMatch, type SelectiveAutoPublishInput } from "./sync";
import { runIngestionPipeline, type ExistingEventForDedup } from "./adapters/pipeline";
import type { RawCandidateEvent } from "./adapters/types";
import { VENUES } from "./data/venues";
import { resolveVenue } from "./normalize";

/**
 * Selective auto-publish for HvadErPå (2026-11-13). The rule itself is pure
 * (isSelectiveAutoPublishCandidate); the pipeline-level cases below run the
 * real runIngestionPipeline so the decision/relevance/genre/dedup inputs are
 * the ones Production would actually compute, not hand-picked values.
 */

const qualifying: SelectiveAutoPublishInput = {
  decision: "review_queue",
  relevance: "strong",
  genre: "electronic-other",
  resolvedVenueId: "v-jolene",
  duplicateOfEventId: null,
  duplicateConfidence: "none",
};

describe("isSelectiveAutoPublishCandidate — rule", () => {
  it.each(["v-den-anden-side", "v-module", "v-jolene", "v-baggen"])("HvadErPå at %s with strong relevance, a genre and no duplicate qualifies", (venue) => {
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, resolvedVenueId: venue })).toBe(true);
  });

  it("a specific genre and an auto_publish decision also qualify", () => {
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, genre: "techno", decision: "auto_publish" })).toBe(true);
  });

  it("Electronic / Other is accepted only alongside strong relevance", () => {
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, genre: "electronic-other", relevance: "weak" })).toBe(false);
  });

  it("never a hold decision (e.g. Baggen no_genre_evidence)", () => {
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, decision: "hold", genre: null, resolvedVenueId: "v-baggen" })).toBe(false);
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, decision: "hold" })).toBe(false);
  });

  it("no genre, weak or no relevance -> not eligible", () => {
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, genre: null })).toBe(false);
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, relevance: "weak" })).toBe(false);
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, relevance: "none" })).toBe(false);
  });

  it.each(["high", "medium", "low"] as const)("any possible duplicate (%s) -> not eligible", (confidence) => {
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, duplicateOfEventId: "e-1", duplicateConfidence: confidence })).toBe(false);
  });

  it("unresolved venue or any venue outside the four -> not eligible", () => {
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, resolvedVenueId: null })).toBe(false);
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, resolvedVenueId: "v-vega" })).toBe(false);
    expect(isSelectiveAutoPublishCandidate("src-hvaderpaa", { ...qualifying, resolvedVenueId: "v-culture-box" })).toBe(false);
  });

  it.each(["src-kultunaut", "src-pylonen", "src-culture-box", "src-billetto", "src-alice", "src-klub-werkstatt"])(
    "other sources are never affected, even with an otherwise-qualifying result (%s)",
    (source) => {
      expect(isSelectiveAutoPublishCandidate(source, qualifying)).toBe(false);
    },
  );
});

function hvaderpaa(overrides: Partial<RawCandidateEvent>): RawCandidateEvent {
  const text = overrides.description ?? "";
  return {
    sourceId: "src-hvaderpaa",
    sourceUrl: "https://hvaderpaa.dk/da/event/1/",
    title: "Night",
    description: text,
    relevanceText: text,
    artists: [],
    startDatetime: "2026-11-20T23:00:00+01:00",
    endDatetime: "2026-11-21T05:00:00+01:00",
    venueName: "Jolene",
    officialEventUrl: overrides.sourceUrl ?? "https://hvaderpaa.dk/da/event/1/",
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
    ...overrides,
  } as RawCandidateEvent;
}

function eligible(raw: RawCandidateEvent, existingEvents: ExistingEventForDedup[] = []) {
  const result = runIngestionPipeline(raw, { venues: VENUES, existingEvents });
  return { result, eligible: isSelectiveAutoPublishCandidate("src-hvaderpaa", result) };
}

function asExisting(raw: RawCandidateEvent, id: string, artists: string[]): ExistingEventForDedup {
  const venue = resolveVenue(raw.venueName!, VENUES)!.venue;
  return {
    id,
    title: raw.title,
    artists,
    venueId: venue.id,
    subVenue: null,
    startDatetime: raw.startDatetime!,
    sourceId: "src-hvaderpaa",
    officialEventUrl: raw.officialEventUrl,
    ticketUrl: null,
    residentAdvisorUrl: raw.residentAdvisorUrl,
    adminUnpublished: false,
  };
}

describe("selective auto-publish — real pipeline cases", () => {
  it("Baggen event without genre evidence (DNMI-shaped, even with an RA link) stays in the manual queue", () => {
    const { result, eligible: ok } = eligible(
      hvaderpaa({
        title: "DNMI",
        venueName: "Baggen",
        artists: ["CøkiT", "Aerocell", "Ziggy Stardubb"],
        residentAdvisorUrl: "https://ra.co/events/2583668",
        description: "A full night of deep, driving music. Heavy basslines, groove and tension that builds slowly.",
      }),
    );
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("no_genre_evidence");
    expect(ok).toBe(false);
  });

  it("a documented electronic night at Jolene with a specific genre is eligible", () => {
    const { result, eligible: ok } = eligible(
      hvaderpaa({
        title: "Some Traces Of House",
        artists: ["Mendon", "DJ HNRKSN"],
        description: "A night of deep house and techno on the Jolene dancefloor.",
        genreHint: "house",
        genreConfidenceHint: "medium",
      }),
    );
    expect(result.relevance).toBe("strong");
    expect(ok).toBe(true);
  });

  it("re-syncing the same event after it was auto-published never qualifies again (matched, not re-created)", () => {
    const raw = hvaderpaa({
      title: "Some Traces Of House",
      artists: ["Mendon", "DJ HNRKSN"],
      description: "A night of deep house and techno on the Jolene dancefloor.",
      genreHint: "house",
      genreConfidenceHint: "medium",
    });
    const existing = [asExisting(raw, "e-created", ["Mendon", "DJ HNRKSN"])];
    const { result, eligible: ok } = eligible(raw, existing);
    expect(ok).toBe(false);
    expect(result.duplicateConfidence).toBe("high");
    // The sync loop then takes its existing update path for this match.
    expect(findSyncMatch(null, result.duplicateOfEventId, result.duplicateConfidence)).toEqual({ kind: "high-confidence-duplicate", eventId: "e-created" });
  });

  it("a second listing of the same night in the same fetch (the real 10 Sep 'Some Traces of House' pair) is not auto-published once the first exists", () => {
    const first = hvaderpaa({
      sourceUrl: "https://hvaderpaa.dk/da/event/100/",
      title: "Some Traces Of House",
      startDatetime: "2026-09-10T22:00:00+02:00",
      endDatetime: "2026-09-11T03:00:00+02:00",
      artists: ["Mendon", "DJ HNRKSN"],
      description: "A night of deep house on the Jolene dancefloor.",
      genreHint: "house",
      genreConfidenceHint: "medium",
    });
    const second = hvaderpaa({
      sourceUrl: "https://hvaderpaa.dk/da/event/101/",
      title: "Some Traces of House with Mendon & DJ HNRKSN",
      startDatetime: "2026-09-10T22:00:00+02:00",
      endDatetime: "2026-09-11T03:00:00+02:00",
      artists: ["Mendon", "DJ HNRKSN"],
      description: "A night of deep house on the Jolene dancefloor.",
      genreHint: "house",
      genreConfidenceHint: "medium",
    });
    expect(eligible(first).eligible).toBe(true);
    const { result, eligible: ok } = eligible(second, [asExisting(first, "e-first", ["Mendon", "DJ HNRKSN"])]);
    expect(result.duplicateConfidence).not.toBe("none");
    expect(ok).toBe(false);
  });
});
