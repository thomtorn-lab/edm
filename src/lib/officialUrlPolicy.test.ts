import { describe, expect, it } from "vitest";
import { allowedOfficialEventUrl, isHvaderpaaUrl } from "./officialUrlPolicy";
import { buildDiscoveryQueueClassificationPatch, buildSyncPatch, type DiscoveryQueueTarget, type SyncTargetEvent } from "./sync";
import type { RawCandidateEvent } from "./adapters/types";

/**
 * HvadErPå ban (product rule, 2026-11-15): hvaderpaa.dk is never an Official
 * Event URL. A HvadErPå import's official link must point at the organizer,
 * the venue or their own event page; otherwise the field stays empty.
 */

const HVP = "https://hvaderpaa.dk/da/event/19246/";
const VENUE_PAGE = "https://www.denandenside.com/events/order-of-magnitude";

describe("isHvaderpaaUrl / allowedOfficialEventUrl", () => {
  it("matches hvaderpaa.dk by hostname, with or without www/subdomain, any case", () => {
    for (const url of [HVP, "https://www.hvaderpaa.dk/da/event/1/", "http://HVADERPAA.DK/", "https://m.hvaderpaa.dk/x"]) {
      expect(isHvaderpaaUrl(url)).toBe(true);
      expect(allowedOfficialEventUrl(url)).toBeNull();
    }
  });

  it("never matches lookalikes or other hosts, and keeps them unchanged", () => {
    for (const url of [VENUE_PAGE, "https://nothvaderpaa.dk/e/1", "https://example.com/?ref=hvaderpaa.dk", "https://hvaderpaa.dk.example.com/"]) {
      expect(isHvaderpaaUrl(url)).toBe(false);
      expect(allowedOfficialEventUrl(url)).toBe(url);
    }
  });

  it("null/empty/invalid input", () => {
    expect(isHvaderpaaUrl(null)).toBe(false);
    expect(allowedOfficialEventUrl(null)).toBeNull();
    expect(allowedOfficialEventUrl("")).toBeNull();
    expect(isHvaderpaaUrl("not a url")).toBe(false);
  });
});

function raw(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
  return {
    sourceId: "src-hvaderpaa",
    sourceUrl: HVP,
    stableSourceUrl: true,
    sourceLinkUrl: HVP,
    title: "Order Of Magnitude: Quake",
    description: null,
    artists: [],
    startDatetime: "2026-09-26T21:59:00.000Z",
    endDatetime: null,
    venueName: "Den Anden Side",
    officialEventUrl: null,
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
    ...overrides,
  };
}

function target(overrides: Partial<SyncTargetEvent> = {}): SyncTargetEvent {
  return {
    id: "e-1",
    title: "Order Of Magnitude: Quake",
    description: null,
    artists: [],
    venueId: "v-den-anden-side",
    subVenue: null,
    startDatetime: "2026-09-26T21:59:00.000Z",
    endDatetime: null,
    officialEventUrl: HVP,
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    primaryGenre: "techno",
    canonicalSourceId: "src-hvaderpaa",
    overriddenFields: [],
    soldOut: false,
    cancelled: false,
    postponed: false,
    ...overrides,
  };
}

const resolved = { resolvedVenueId: null, normalizedArtists: [], genre: null, genreConfidence: "low" as const };

describe("buildSyncPatch — a stored hvaderpaa.dk Official Event URL is always removed", () => {
  it("cleared when the source has no organizer/venue link", () => {
    expect(buildSyncPatch(raw(), resolved, target()).patch.officialEventUrl).toBeNull();
  });

  it("replaced by the venue's own page when the source now has one", () => {
    expect(buildSyncPatch(raw({ officialEventUrl: VENUE_PAGE }), resolved, target()).patch.officialEventUrl).toBe(VENUE_PAGE);
  });

  it("an incoming hvaderpaa.dk URL is never written, from any source", () => {
    const patch = buildSyncPatch(raw({ sourceId: "src-billetto", officialEventUrl: HVP }), resolved, target({ officialEventUrl: null })).patch;
    expect(patch).not.toHaveProperty("officialEventUrl");
  });

  it("a real official URL already stored is never cleared by a HvadErPå sync without one", () => {
    expect(buildSyncPatch(raw(), resolved, target({ officialEventUrl: VENUE_PAGE })).patch).not.toHaveProperty("officialEventUrl");
  });
});

function dq(overrides: Partial<DiscoveryQueueTarget> = {}): DiscoveryQueueTarget {
  return {
    status: "pending",
    overriddenFields: [],
    predictedGenre: "techno",
    genreConfidence: "medium",
    overallConfidence: "medium",
    holdReason: null,
    probableTicketUrl: null,
    probableOfficialEventUrl: HVP,
    ...overrides,
  } as DiscoveryQueueTarget;
}
const fresh = { genre: "techno", genreConfidence: "medium", decision: "review_queue" } as const;

describe("buildDiscoveryQueueClassificationPatch — a stored hvaderpaa.dk probableOfficialEventUrl is always removed", () => {
  it("cleared when the fresh sync has no official link, even under an admin override", () => {
    expect(buildDiscoveryQueueClassificationPatch({ ...fresh, officialEventUrl: null }, dq()).probableOfficialEventUrl).toBeNull();
    expect(
      buildDiscoveryQueueClassificationPatch({ ...fresh, officialEventUrl: null }, dq({ overriddenFields: ["probableOfficialEventUrl"] })).probableOfficialEventUrl,
    ).toBeNull();
  });

  it("replaced by the venue's own page when the fresh sync has one", () => {
    expect(buildDiscoveryQueueClassificationPatch({ ...fresh, officialEventUrl: VENUE_PAGE }, dq()).probableOfficialEventUrl).toBe(VENUE_PAGE);
  });

  it("a fresh hvaderpaa.dk URL is never filled into an empty row", () => {
    expect(
      buildDiscoveryQueueClassificationPatch({ ...fresh, officialEventUrl: HVP }, dq({ probableOfficialEventUrl: null })),
    ).not.toHaveProperty("probableOfficialEventUrl");
  });
});
