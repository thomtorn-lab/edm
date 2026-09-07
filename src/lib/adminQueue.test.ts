import { describe, expect, it } from "vitest";
import {
  classifyAdminQueueRow,
  deriveAdminUnpublishedRows,
  groupAdminQueueRows,
  buildPublishedQueueRows,
  resolvePublishedCanonicalEventId,
  type AdminQueueClassifiable,
} from "./adminQueue";
import type { DiscoveryQueueItem, EventRecord, Source, Venue } from "./types";

/**
 * Admin Discovery Queue cleanup/actionable views, 2026-09-06 (Section 15 of
 * the brief). Covers classifyAdminQueueRow's category assignment and the
 * precedence between categories it documents — never the query/UI layer,
 * which is exercised elsewhere.
 *
 * venueResolvedDecision is null on every "venue already resolved" fixture
 * below, matching computeVenueResolvedCounterfactual's real contract (see
 * its doc comment in src/lib/adapters/pipeline.ts): the counterfactual is
 * only ever non-null for a row whose venue is actually unresolved.
 */

const NOW = new Date("2026-09-06T12:00:00+02:00");
const SYNC = { lastCompleteSyncAt: "2026-09-06T10:00:00+02:00", now: NOW };

function row(overrides: Partial<AdminQueueClassifiable> = {}): AdminQueueClassifiable {
  return {
    overallConfidence: "high",
    holdReason: null,
    venueResolvedDecision: null,
    missingFields: [],
    probableStart: "2026-09-10T22:00:00+02:00",
    probableEnd: "2026-09-11T04:00:00+02:00",
    lastSeenAt: "2026-09-06T10:00:00+02:00", // >= lastCompleteSyncAt -> current
    ...overrides,
  };
}

describe("classifyAdminQueueRow", () => {
  it("an actionable, current, upcoming, resolved-venue row is NEEDS_REVIEW", () => {
    expect(classifyAdminQueueRow(row(), SYNC)).toBe("needs_review");
  });

  it("venue unresolved with an auto_publish counterfactual -> VENUE_BLOCKED", () => {
    expect(
      classifyAdminQueueRow(row({ venueResolvedDecision: "auto_publish", holdReason: "incomplete_data" }), SYNC),
    ).toBe("venue_blocked");
  });

  it("venue unresolved with a review_queue counterfactual -> VENUE_BLOCKED", () => {
    expect(
      classifyAdminQueueRow(row({ venueResolvedDecision: "review_queue", holdReason: "incomplete_data" }), SYNC),
    ).toBe("venue_blocked");
  });

  it("no_genre_evidence hold reason on an otherwise-resolved row -> INSUFFICIENT", () => {
    expect(classifyAdminQueueRow(row({ holdReason: "no_genre_evidence" }), SYNC)).toBe("insufficient");
  });

  it("incomplete_data hold reason -> INSUFFICIENT", () => {
    expect(classifyAdminQueueRow(row({ holdReason: "incomplete_data" }), SYNC)).toBe("insufficient");
  });

  it("low_confidence hold reason -> INSUFFICIENT", () => {
    expect(classifyAdminQueueRow(row({ holdReason: "low_confidence" }), SYNC)).toBe("insufficient");
  });

  it("negative_relevance hold reason -> REJECTED", () => {
    expect(classifyAdminQueueRow(row({ holdReason: "negative_relevance" }), SYNC)).toBe("rejected");
  });

  it("source_cancelled hold reason -> REJECTED (source-driven cancellation safety, 2026-09-07) — never left actionable in Needs Review, never deleted", () => {
    expect(classifyAdminQueueRow(row({ holdReason: "source_cancelled" }), SYNC)).toBe("rejected");
  });

  it("a stale row (lastSeenAt behind the source's last complete sync) -> PAST_STALE", () => {
    expect(classifyAdminQueueRow(row({ lastSeenAt: "2026-09-01T00:00:00+02:00" }), SYNC)).toBe("past_stale");
  });

  it("a row from a current source but with a definite past date -> PAST_STALE", () => {
    expect(
      classifyAdminQueueRow(
        row({ probableStart: "2026-09-01T22:00:00+02:00", probableEnd: "2026-09-02T04:00:00+02:00" }),
        SYNC,
      ),
    ).toBe("past_stale");
  });

  it("PAST_STALE takes precedence over an unresolved venue on the same row", () => {
    expect(
      classifyAdminQueueRow(
        row({
          lastSeenAt: "2026-09-01T00:00:00+02:00",
          venueResolvedDecision: "auto_publish",
          holdReason: "incomplete_data",
        }),
        SYNC,
      ),
    ).toBe("past_stale");
  });

  it("a row with BOTH an unresolved venue and a real negative_relevance blocker is not miscategorized as pure venue-blocked", () => {
    // The venue-resolved counterfactual itself lands on "hold" here (not
    // auto_publish/review_queue) because negative_relevance would still hold
    // it even with the venue fixed — so classifyVenueBlock falls through to
    // "other_blockers" and the real holdReason decides, exactly per the
    // "multiple blockers must NOT be presented as pure venue-blocked"
    // requirement (Section 4 of the brief).
    expect(
      classifyAdminQueueRow(row({ venueResolvedDecision: "hold", holdReason: "negative_relevance" }), SYNC),
    ).toBe("rejected");
  });

  it("low-confidence noise with a legacy null holdReason does NOT enter Needs Review", () => {
    expect(classifyAdminQueueRow(row({ holdReason: null, overallConfidence: "low" }), SYNC)).toBe("insufficient");
  });

  it("a legacy row with null holdReason but high overallConfidence still resolves to NEEDS_REVIEW", () => {
    expect(classifyAdminQueueRow(row({ holdReason: null, overallConfidence: "high" }), SYNC)).toBe("needs_review");
  });
});

function discoveryItem(overrides: Partial<DiscoveryQueueItem> = {}): DiscoveryQueueItem {
  return {
    id: "dq-1",
    probableTitle: "Test Night",
    probableStart: "2026-09-10T22:00:00+02:00",
    probableEnd: "2026-09-11T04:00:00+02:00",
    probableTicketUrl: null,
    probableFree: false,
    probableVenueName: "Test Venue",
    probableSubVenue: null,
    sourceName: "Test Source",
    sourceUrl: "https://example.com/events/1",
    sourceId: "src-test",
    detectedLineup: [],
    predictedGenre: "techno",
    genreConfidence: "high",
    suspectedDuplicateOfEventId: null,
    missingFields: [],
    overallConfidence: "high",
    status: "pending",
    holdReason: null,
    lastSeenAt: "2026-09-06T10:00:00+02:00",
    venueResolvedDecision: null,
    venueResolvedHoldReason: null,
    ...overrides,
  };
}

function eventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "e-1",
    title: "Test Night",
    slug: "test-night",
    description: null,
    artists: [],
    startDatetime: "2026-09-10T22:00:00+02:00",
    endDatetime: "2026-09-11T04:00:00+02:00",
    timezone: "Europe/Copenhagen",
    venueId: "v-1",
    subVenue: null,
    primaryGenre: "techno",
    subgenres: [],
    genreConfidence: "high",
    officialEventUrl: "https://example.com/events/1",
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    imageUrl: null,
    priceFrom: null,
    currency: null,
    soldOut: false,
    cancelled: false,
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    adminUnpublishReason: null,
    adminUnpublishNote: null,
    adminUnpublishedAt: null,
    sourceCancelledAt: null,
    sourceCancelledBySourceId: null,
    sourceCancellationEvidence: null,
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: "src-test",
    createdAt: "2026-09-01T00:00:00+02:00",
    updatedAt: "2026-09-01T00:00:00+02:00",
    lastSourceCheck: null,
    lastChanged: null,
    ...overrides,
  };
}

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "v-1",
    slug: "test-venue",
    name: "Test Venue",
    aliases: [],
    address: "Somewhere 1",
    city: "Copenhagen",
    postalCode: "1000",
    websiteUrl: null,
    description: "",
    shortDescription: null,
    venueProfile: null,
    ...overrides,
  };
}

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-test",
    sourceName: "Test Source",
    sourceType: "official-venue",
    baseUrl: "https://example.com/",
    roles: ["discovery", "ingestion"],
    adapter: "test-adapter",
    trustLevel: "high",
    autoPublish: true,
    syncFrequency: "every 6h",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "",
    lastCompleteSyncAt: "2026-09-06T10:00:00+02:00",
    ...overrides,
  };
}

describe("groupAdminQueueRows", () => {
  it("assigns each row to exactly one category, and every group's total equals the input length", () => {
    const items = [
      discoveryItem({ id: "dq-needs-review" }),
      discoveryItem({ id: "dq-venue-blocked", venueResolvedDecision: "auto_publish", holdReason: "incomplete_data" }),
      discoveryItem({ id: "dq-insufficient", holdReason: "no_genre_evidence" }),
      discoveryItem({ id: "dq-rejected", holdReason: "negative_relevance" }),
      discoveryItem({ id: "dq-stale", lastSeenAt: "2026-09-01T00:00:00+02:00" }),
    ];
    const sourceSync = new Map([["src-test", "2026-09-06T10:00:00+02:00"]]);
    const groups = groupAdminQueueRows(items, sourceSync, NOW);

    expect(groups.needs_review.map((i) => i.id)).toEqual(["dq-needs-review"]);
    expect(groups.venue_blocked.map((i) => i.id)).toEqual(["dq-venue-blocked"]);
    expect(groups.insufficient.map((i) => i.id)).toEqual(["dq-insufficient"]);
    expect(groups.rejected.map((i) => i.id)).toEqual(["dq-rejected"]);
    expect(groups.past_stale.map((i) => i.id)).toEqual(["dq-stale"]);

    const totalGrouped = Object.values(groups).reduce((sum, g) => sum + g.length, 0);
    expect(totalGrouped).toBe(items.length);

    // No item id appears in more than one group.
    const seen = new Set<string>();
    for (const group of Object.values(groups)) {
      for (const item of group) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
    }
  });

  it("a row with no matching source in the freshness map reads as no freshness signal (never crashes, never assumed current)", () => {
    const items = [discoveryItem({ sourceId: "src-unknown" })];
    const groups = groupAdminQueueRows(items, new Map(), NOW);
    expect(groups.past_stale.map((i) => i.id)).toEqual(["dq-1"]);
  });

  it("Needs review sorts by soonest upcoming date first, a missing date sinking to the bottom", () => {
    const items = [
      discoveryItem({ id: "dq-no-date", probableStart: null }),
      discoveryItem({ id: "dq-later", probableStart: "2026-09-20T22:00:00+02:00" }),
      discoveryItem({ id: "dq-soonest", probableStart: "2026-09-08T22:00:00+02:00" }),
    ];
    const sourceSync = new Map([["src-test", "2026-09-06T10:00:00+02:00"]]);
    const groups = groupAdminQueueRows(items, sourceSync, NOW);
    expect(groups.needs_review.map((i) => i.id)).toEqual(["dq-soonest", "dq-later", "dq-no-date"]);
  });

  it("Needs review breaks a same-date tie by higher overall confidence first", () => {
    const items = [
      discoveryItem({ id: "dq-low", overallConfidence: "medium" }),
      discoveryItem({ id: "dq-high", overallConfidence: "high" }),
    ];
    const sourceSync = new Map([["src-test", "2026-09-06T10:00:00+02:00"]]);
    const groups = groupAdminQueueRows(items, sourceSync, NOW);
    expect(groups.needs_review.map((i) => i.id)).toEqual(["dq-high", "dq-low"]);
  });

  it("Insufficient sorts by freshest evidence (lastSeenAt) first", () => {
    const items = [
      discoveryItem({ id: "dq-older", holdReason: "no_genre_evidence", lastSeenAt: "2026-09-06T10:00:00+02:00" }),
      discoveryItem({ id: "dq-newer", holdReason: "no_genre_evidence", lastSeenAt: "2026-09-06T20:00:00+02:00" }),
    ];
    const sourceSync = new Map([["src-test", "2026-09-06T10:00:00+02:00"]]);
    const groups = groupAdminQueueRows(items, sourceSync, NOW);
    expect(groups.insufficient.map((i) => i.id)).toEqual(["dq-newer", "dq-older"]);
  });

  it("Past/stale sorts most-recently-relevant first (most recent probable date first)", () => {
    const items = [
      discoveryItem({ id: "dq-long-past", lastSeenAt: "2026-08-01T00:00:00+02:00", probableStart: "2026-08-01T22:00:00+02:00" }),
      discoveryItem({ id: "dq-recent-past", lastSeenAt: "2026-09-05T00:00:00+02:00", probableStart: "2026-09-05T22:00:00+02:00" }),
    ];
    const sourceSync = new Map([["src-test", "2026-09-06T10:00:00+02:00"]]);
    const groups = groupAdminQueueRows(items, sourceSync, NOW);
    expect(groups.past_stale.map((i) => i.id)).toEqual(["dq-recent-past", "dq-long-past"]);
  });

  it("a row that has moved out of the pending set (e.g. after Publish/Ignore) is absent from every group, since only pending items are ever passed in", () => {
    // admin/page.tsx pre-filters to status === "pending" before calling
    // groupAdminQueueRows — this documents that contract directly: an item
    // simply isn't in the input once published/ignored, so it can't land
    // in Needs Review or any other pending-only tab.
    const stillPending = [discoveryItem({ id: "dq-1" })];
    const groups = groupAdminQueueRows(stillPending, new Map([["src-test", "2026-09-06T10:00:00+02:00"]]), NOW);
    expect(groups.needs_review.map((i) => i.id)).toEqual(["dq-1"]);

    const afterPublish: DiscoveryQueueItem[] = []; // the published row is no longer status "pending"
    const groupsAfter = groupAdminQueueRows(afterPublish, new Map([["src-test", "2026-09-06T10:00:00+02:00"]]), NOW);
    expect(groupsAfter.needs_review).toEqual([]);
  });
});

describe("PUBLISHED tab resolution", () => {
  it("a merged row resolves via its persisted suspectedDuplicateOfEventId", () => {
    const item = discoveryItem({ status: "merged", suspectedDuplicateOfEventId: "e-existing" });
    expect(resolvePublishedCanonicalEventId(item, [eventRecord({ id: "e-existing" })])).toBe("e-existing");
  });

  it("a published row resolves via the canonicalSourceId + officialEventUrl best-effort match", () => {
    const item = discoveryItem({ status: "published", sourceId: "src-test", sourceUrl: "https://example.com/events/1" });
    const events = [eventRecord({ id: "e-2", canonicalSourceId: "src-test", officialEventUrl: "https://example.com/events/1" })];
    expect(resolvePublishedCanonicalEventId(item, events)).toBe("e-2");
  });

  it("buildPublishedQueueRows surfaces the canonical event's current title/venue for a published row", () => {
    const item = discoveryItem({ status: "published", sourceId: "src-test", sourceUrl: "https://example.com/events/1" });
    const events = [eventRecord({ id: "e-2", title: "Renamed Night", venueId: "v-2", canonicalSourceId: "src-test", officialEventUrl: "https://example.com/events/1" })];
    const venuesById = new Map([["v-2", venue({ id: "v-2", name: "New Venue" })]]);
    const rows = buildPublishedQueueRows([item], events, venuesById);
    expect(rows).toEqual([
      { item, canonicalEventId: "e-2", canonicalTitle: "Renamed Night", canonicalVenueName: "New Venue" },
    ]);
  });

  it("a pending row is never resolved by resolvePublishedCanonicalEventId", () => {
    expect(resolvePublishedCanonicalEventId(discoveryItem({ status: "pending" }), [eventRecord()])).toBeNull();
  });

  it("excludes a row whose canonical event is now admin-unpublished — real Production case, Jasho Club // Poolen Outside: its discoveryQueue row stays status=published forever (admin unpublish never rewrites it), so without this filter it would show in both PUBLISHED and UNPUBLISHED BY ADMIN at once", () => {
    const item = discoveryItem({ id: "dq-jasho", status: "published", sourceId: "src-test", sourceUrl: "https://example.com/events/1" });
    const events = [
      eventRecord({
        id: "e-jasho",
        title: "Jasho Club // Poolen Outside",
        canonicalSourceId: "src-test",
        officialEventUrl: "https://example.com/events/1",
        published: false,
        adminUnpublishReason: "cancelled",
        adminUnpublishedAt: "2026-09-06T09:00:00+02:00",
      }),
    ];
    expect(buildPublishedQueueRows([item], events, new Map())).toEqual([]);
  });
});

describe("deriveAdminUnpublishedRows", () => {
  it("a canonical event carrying the persistent admin-unpublish override appears in UNPUBLISHED BY ADMIN", () => {
    const events = [
      eventRecord({ id: "e-jasho", title: "Jasho Club // Poolen Outside", adminUnpublishReason: "cancelled", adminUnpublishedAt: "2026-09-06T09:00:00+02:00" }),
      eventRecord({ id: "e-normal" }), // published, never touched by admin — must NOT appear
    ];
    const venuesById = new Map([["v-1", venue()]]);
    const sourcesById = new Map([["src-test", source()]]);
    const rows = deriveAdminUnpublishedRows(events, venuesById, sourcesById);

    expect(rows).toEqual([
      {
        eventId: "e-jasho",
        title: "Jasho Club // Poolen Outside",
        reason: "cancelled",
        note: null,
        unpublishedAt: "2026-09-06T09:00:00+02:00",
        venueName: "Test Venue",
        sourceName: "Test Source",
      },
    ]);
  });

  it("carries the optional admin note through, admin-UI-only", () => {
    const events = [
      eventRecord({ id: "e-jasho", adminUnpublishReason: "cancelled", adminUnpublishNote: "promoter confirmed by email" }),
    ];
    const rows = deriveAdminUnpublishedRows(events, new Map(), new Map());
    expect(rows[0].note).toBe("promoter confirmed by email");
  });

  it("never mixes an ordinary rejected/held discoveryQueue candidate into this list — it only ever reads events.adminUnpublishReason", () => {
    const events = [eventRecord({ adminUnpublishReason: null })];
    expect(deriveAdminUnpublishedRows(events, new Map(), new Map())).toEqual([]);
  });

  it("sorts most recently unpublished first (Section 6)", () => {
    const events = [
      eventRecord({ id: "e-older", adminUnpublishReason: "cancelled", adminUnpublishedAt: "2026-09-01T09:00:00+02:00" }),
      eventRecord({ id: "e-newer", adminUnpublishReason: "duplicate", adminUnpublishedAt: "2026-09-06T09:00:00+02:00" }),
    ];
    const rows = deriveAdminUnpublishedRows(events, new Map(), new Map());
    expect(rows.map((r) => r.eventId)).toEqual(["e-newer", "e-older"]);
  });
});
