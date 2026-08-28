import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * insertDiscoveryItem is the single, shared insertion point for
 * genuinely-new discovery_queue rows (both the source sync loop and the
 * admin "Add event from URL" tool route through it — see db/sync.ts and
 * app/api/admin/extract/route.ts). It deliberately does ONLY the DB write
 * and echoes back the fields a notification needs — it does NOT send any
 * notification itself, so that callers can decide when to notify (the sync
 * loop batches after all DB writes finish; the admin route awaits a single
 * notification directly). See lib/discoveryNotification.ts.
 */

const insertValuesMock = vi.fn().mockResolvedValue(undefined);

vi.mock("./client", () => ({
  db: {
    insert: () => ({ values: insertValuesMock }),
  },
}));

const { insertDiscoveryItem } = await import("./writes");

const item = {
  id: "dq-abc123",
  probableTitle: "Nachtdigital Showcase",
  probableStart: new Date("2026-09-12T22:00:00Z"),
  probableVenueName: "Culture Box",
  sourceName: "src-culture-box",
  sourceUrl: "https://culture-box.com/events/nachtdigital",
  detectedLineup: [] as string[],
  predictedGenre: "techno" as const,
  genreConfidence: "high" as const,
  suspectedDuplicateOfEventId: null,
  missingFields: ["ticketUrl"],
  overallConfidence: "medium" as const,
};

beforeEach(() => {
  insertValuesMock.mockClear();
});

describe("insertDiscoveryItem", () => {
  it("inserts the row with status 'pending'", async () => {
    await insertDiscoveryItem(item);

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith({ ...item, status: "pending" });
  });

  it("echoes back exactly the fields a notification needs, without sending anything itself", async () => {
    const result = await insertDiscoveryItem(item);

    expect(result).toEqual({
      id: item.id,
      probableTitle: item.probableTitle,
      probableStart: item.probableStart,
      probableVenueName: item.probableVenueName,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      predictedGenre: item.predictedGenre,
      genreConfidence: item.genreConfidence,
      overallConfidence: item.overallConfidence,
      missingFields: item.missingFields,
    });
  });
});
