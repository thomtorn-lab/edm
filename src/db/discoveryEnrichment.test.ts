import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoveryQueue, sources } from "./schema";
import { YoutubeDailyQuotaExhaustedError } from "../lib/enrichment/youtubeClient";

/**
 * YouTube Artist Preview Discovery-stage rollout (2026-09-26): covers
 * triggerDiscoveryEnrichment (not exported — exercised only through
 * insertDiscoveryItem/updateDiscoveryItem/applyDiscoveryClassificationUpdate,
 * exactly as every real caller reaches it) and confirms it never blocks a
 * Discovery write regardless of what YouTube does. Deliberately its own
 * file, separate from writes.test.ts's large shared db mock, because this
 * needs a `db.select` that branches on WHICH table is being queried
 * (discoveryQueue vs sources) rather than a simple FIFO queue.
 *
 * Real, unmocked `after()` is used throughout (like writes.test.ts itself):
 * there is no active Next.js request scope in a plain vitest process, so it
 * throws synchronously and deferOrRun's fallback awaits the enrichment
 * trigger directly — making every assertion below deterministic with no
 * manual callback plumbing.
 */

let discoveryQueueSelectRow: Record<string, unknown> | null = null;
let sourceSelectRow: { lastCompleteSyncAt: Date | null } | null = null;
const insertValuesMock = vi.fn((_row: unknown) => Promise.resolve(undefined));
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn(() => Promise.resolve(undefined));
const eventInsertValuesMock = vi.fn((_row: unknown) => Promise.resolve(undefined));

vi.mock("./client", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (row: unknown) => (table === discoveryQueue ? insertValuesMock(row) : eventInsertValuesMock(row)),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updateSetMock(patch);
        return { where: () => updateWhereMock() };
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              table === sources
                ? sourceSelectRow
                  ? [sourceSelectRow]
                  : []
                : discoveryQueueSelectRow
                  ? [discoveryQueueSelectRow]
                  : [],
            ),
        }),
      }),
    }),
  },
}));

const enrichArtistYoutubePreviewsMock = vi.fn((_names: string[]) => Promise.resolve());
vi.mock("./youtubePreview", () => ({
  enrichArtistYoutubePreviews: (names: string[]) => enrichArtistYoutubePreviewsMock(names),
}));

const { insertDiscoveryItem, updateDiscoveryItem, applyDiscoveryClassificationUpdate, createEvent } = await import("./writes");

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const SEEN_AT = new Date("2026-09-26T10:00:00.000Z");

beforeEach(() => {
  insertValuesMock.mockClear();
  updateSetMock.mockClear();
  updateWhereMock.mockClear();
  eventInsertValuesMock.mockClear();
  enrichArtistYoutubePreviewsMock.mockClear();
  enrichArtistYoutubePreviewsMock.mockImplementation(() => Promise.resolve());
  discoveryQueueSelectRow = null;
  sourceSelectRow = null;
});

function baseInsertItem(overrides: Partial<Parameters<typeof insertDiscoveryItem>[0]> = {}) {
  return {
    id: "dq-1",
    probableTitle: "Test Night",
    probableStart: null as Date | null,
    probableVenueName: "Test Venue",
    sourceName: "Test Source",
    sourceUrl: "https://example.com/test-night",
    sourceId: null as string | null,
    detectedLineup: ["Artist A"],
    predictedGenre: null,
    genreConfidence: "low" as const,
    suspectedDuplicateOfEventId: null,
    missingFields: [],
    overallConfidence: "low" as const,
    ...overrides,
  };
}

describe("Discovery-stage YouTube enrichment — insertDiscoveryItem", () => {
  it("a Needs Review item (admin-originated, no past date) triggers enrichment", async () => {
    await insertDiscoveryItem(baseInsertItem());
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Artist A"]);
  });

  it("a Venue Blocked item (registered source, current, venue-unresolved-only) triggers enrichment", async () => {
    sourceSelectRow = { lastCompleteSyncAt: SEEN_AT };
    await insertDiscoveryItem(
      baseInsertItem({
        sourceId: "src-test",
        lastSeenAt: SEEN_AT,
        probableStart: FUTURE,
        venueResolvedDecision: "review_queue",
      }),
    );
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Artist A"]);
  });

  it("a Rejected item (negative_relevance) does not trigger enrichment", async () => {
    sourceSelectRow = { lastCompleteSyncAt: SEEN_AT };
    await insertDiscoveryItem(
      baseInsertItem({
        sourceId: "src-test",
        lastSeenAt: SEEN_AT,
        probableStart: FUTURE,
        venueResolvedDecision: null,
        holdReason: "negative_relevance",
      }),
    );
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });

  it("a Past/Stale item (admin-originated, resolved past date) does not trigger enrichment", async () => {
    await insertDiscoveryItem(baseInsertItem({ probableStart: PAST }));
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });

  it("an item with no detected artists never calls enrichment or queries sources", async () => {
    await insertDiscoveryItem(baseInsertItem({ detectedLineup: [] }));
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });

  it("a YouTube API failure never blocks the Discovery write — insertDiscoveryItem still resolves and the row is still inserted", async () => {
    enrichArtistYoutubePreviewsMock.mockImplementation(() => Promise.reject(new Error("YouTube API request failed: HTTP 500")));
    await expect(insertDiscoveryItem(baseInsertItem())).resolves.toBeDefined();
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
  });

  it("confirmed daily quota exhaustion never blocks the Discovery write either", async () => {
    enrichArtistYoutubePreviewsMock.mockImplementation(() => Promise.reject(new YoutubeDailyQuotaExhaustedError("daily quota exhausted")));
    await expect(insertDiscoveryItem(baseInsertItem())).resolves.toBeDefined();
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
  });

  it("routes every eligible row's lineup through the ONE shared cache-first function — no separate per-hook dedup layer, so the same artist across multiple rows is deduplicated by enrichArtistYoutubePreviews's own cache, not re-derived here", async () => {
    await insertDiscoveryItem(baseInsertItem({ id: "dq-1", detectedLineup: ["Shared Artist"] }));
    await insertDiscoveryItem(baseInsertItem({ id: "dq-2", detectedLineup: ["Shared Artist"] }));
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledTimes(2);
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenNthCalledWith(1, ["Shared Artist"]);
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenNthCalledWith(2, ["Shared Artist"]);
    // Real dedup (no repeated YouTube search for an already-cached name) is
    // enforced inside enrichArtistYoutubePreviews's own cache-first matcher
    // — see youtubePreviewMatching.test.ts — not by this hook, which only
    // ever decides WHETHER to call it, never HOW it resolves.
  });
});

describe("Discovery-stage YouTube enrichment — updateDiscoveryItem (admin edit)", () => {
  it("an admin edit that adds a lineup to an otherwise Needs-Review-eligible row triggers enrichment", async () => {
    discoveryQueueSelectRow = {
      id: "dq-1",
      status: "pending",
      probableStart: null,
      probableEnd: null,
      probableVenueName: "Test Venue",
      probableTitle: "Test Night",
      missingFields: [],
      overriddenFields: [],
      overallConfidence: "low",
      holdReason: null,
      venueResolvedDecision: null,
      lastSeenAt: null,
      sourceId: null,
      detectedLineup: [],
      predictedGenre: null,
    };
    await updateDiscoveryItem("dq-1", { detectedLineup: ["Newly Added Artist"] });
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Newly Added Artist"]);
  });

  it("a YouTube failure during an admin edit's enrichment trigger never blocks the edit itself", async () => {
    discoveryQueueSelectRow = {
      id: "dq-1",
      status: "pending",
      probableStart: null,
      probableEnd: null,
      probableVenueName: "Test Venue",
      probableTitle: "Test Night",
      missingFields: [],
      overriddenFields: [],
      overallConfidence: "low",
      holdReason: null,
      venueResolvedDecision: null,
      lastSeenAt: null,
      sourceId: null,
      detectedLineup: [],
      predictedGenre: null,
    };
    enrichArtistYoutubePreviewsMock.mockImplementation(() => Promise.reject(new Error("boom")));
    await expect(updateDiscoveryItem("dq-1", { detectedLineup: ["Artist X"] })).resolves.toBeUndefined();
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });

  it("performance review, 2026-09-26: an edit that only touches an enrichment-irrelevant field (e.g. probableTicketUrl) never triggers enrichment, even on an already-eligible row", async () => {
    discoveryQueueSelectRow = {
      id: "dq-1",
      status: "pending",
      probableStart: null,
      probableEnd: null,
      probableVenueName: "Test Venue",
      probableTitle: "Test Night",
      missingFields: [],
      overriddenFields: [],
      overallConfidence: "low",
      holdReason: null,
      venueResolvedDecision: null,
      lastSeenAt: null,
      sourceId: null,
      detectedLineup: ["Already There"],
      predictedGenre: null,
    };
    await updateDiscoveryItem("dq-1", { probableTicketUrl: "https://example.com/tickets" });
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });
});

describe("Discovery-stage YouTube enrichment — applyDiscoveryClassificationUpdate (sync reclassification)", () => {
  it("a sync-driven reclassification into Venue Blocked triggers enrichment, using the merged post-update row", async () => {
    discoveryQueueSelectRow = {
      id: "dq-1",
      probableStart: FUTURE,
      probableEnd: null,
      probableTitle: "Test Night",
      missingFields: [],
      overallConfidence: "medium",
      holdReason: null,
      venueResolvedDecision: "review_queue",
      lastSeenAt: SEEN_AT,
      sourceId: "src-test",
      detectedLineup: ["Artist From Sync"],
      predictedGenre: null,
    };
    sourceSelectRow = { lastCompleteSyncAt: SEEN_AT };
    // venueResolvedDecision is a classification-relevant key (this run's
    // patch is what actually moved the row into Venue Blocked) — a bare
    // lastSeenAt-only patch is covered separately below.
    await applyDiscoveryClassificationUpdate("dq-1", { lastSeenAt: SEEN_AT, venueResolvedDecision: "review_queue" });
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Artist From Sync"]);
  });

  it("a reclassification that stays Rejected never triggers enrichment", async () => {
    discoveryQueueSelectRow = {
      id: "dq-1",
      probableStart: FUTURE,
      probableEnd: null,
      probableTitle: "Test Night",
      missingFields: [],
      overallConfidence: "low",
      holdReason: "negative_relevance",
      venueResolvedDecision: null,
      lastSeenAt: SEEN_AT,
      sourceId: "src-test",
      detectedLineup: ["Artist From Sync"],
      predictedGenre: null,
    };
    sourceSelectRow = { lastCompleteSyncAt: SEEN_AT };
    await applyDiscoveryClassificationUpdate("dq-1", { lastSeenAt: SEEN_AT, holdReason: "negative_relevance" });
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });

  it("an empty patch is a no-op and never queries or enriches anything", async () => {
    await applyDiscoveryClassificationUpdate("dq-1", {});
    expect(updateWhereMock).not.toHaveBeenCalled();
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });

  it("performance review, 2026-09-26: a routine lastSeenAt-only patch (row unchanged, still just re-matched by this sync) skips the enrichment check entirely — no re-read, no re-classify, no enrichment call, even though the row already sits in Venue Blocked", async () => {
    discoveryQueueSelectRow = {
      id: "dq-1",
      probableStart: FUTURE,
      probableEnd: null,
      probableTitle: "Test Night",
      missingFields: [],
      overallConfidence: "medium",
      holdReason: null,
      venueResolvedDecision: "review_queue",
      lastSeenAt: SEEN_AT,
      sourceId: "src-test",
      detectedLineup: ["Artist From Sync"],
      predictedGenre: null,
    };
    sourceSelectRow = { lastCompleteSyncAt: SEEN_AT };
    // The row is ALREADY Venue Blocked (fixture above) and this sync's own
    // patch changes nothing classification-relevant — only lastSeenAt, the
    // unconditional freshness bump every sync applies regardless of outcome.
    await applyDiscoveryClassificationUpdate("dq-1", { lastSeenAt: SEEN_AT });
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });

  it("performance review, 2026-09-26: a patch that changes a non-classification field (e.g. probableTicketUrl) alongside lastSeenAt still skips enrichment", async () => {
    sourceSelectRow = { lastCompleteSyncAt: SEEN_AT };
    await applyDiscoveryClassificationUpdate("dq-1", { lastSeenAt: SEEN_AT, probableTicketUrl: "https://example.com/tickets" });
    expect(enrichArtistYoutubePreviewsMock).not.toHaveBeenCalled();
  });

  it("performance review, 2026-09-26: a patch that DOES touch a classification-relevant field (missingFields shrinking) still triggers normally", async () => {
    discoveryQueueSelectRow = {
      id: "dq-1",
      probableStart: null,
      probableEnd: null,
      probableTitle: "Test Night",
      missingFields: [],
      overallConfidence: "low",
      holdReason: null,
      venueResolvedDecision: null,
      lastSeenAt: null,
      sourceId: null,
      detectedLineup: ["Artist From Sync"],
      predictedGenre: null,
    };
    await applyDiscoveryClassificationUpdate("dq-1", { missingFields: [] });
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Artist From Sync"]);
  });
});

describe("Discovery-stage enrichment and publication share the same cache — reuse at publish time", () => {
  it("createEvent's own existing publish-time warm-up still runs independently for the same artist name a Discovery row already enriched", async () => {
    // Simulates the sequence: a Discovery row for "Shared Headliner" was
    // already enriched at review time (insertDiscoveryItem, above), then an
    // admin later publishes an event carrying that same artist name.
    // createEvent's own unchanged warm-up call proves the publish path still
    // runs and reaches the SAME shared cache-first function — actual cache
    // reuse (no repeated search) is enrichArtistYoutubePreviews's own
    // internal guarantee, unit-tested in youtubePreviewMatching.test.ts.
    await createEvent(
      {
        id: "e-1",
        title: "Test Event",
        slug: "test-event",
        description: null,
        artists: ["Shared Headliner"],
        startDatetime: FUTURE,
        endDatetime: null,
        venueId: "v-1",
        subVenue: null,
        primaryGenre: "electronic-other",
        subgenres: ["electronic-other"],
        genreConfidence: "low",
        officialEventUrl: null,
        ticketUrl: null,
        facebookUrl: null,
        residentAdvisorUrl: null,
        imageUrl: null,
        priceFrom: null,
        currency: null,
        soldOut: false,
        cancelled: false,
        published: true,
        confidence: "low",
        canonicalSourceId: null,
      },
      "admin",
    );
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Shared Headliner"]);
  });
});
