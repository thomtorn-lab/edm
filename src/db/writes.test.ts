import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * insertDiscoveryItem is the single, shared insertion point for
 * genuinely-new discovery_queue rows (both the source sync loop and the
 * admin "Add event from URL" tool route through it — see db/sync.ts and
 * app/api/admin/extract/route.ts). It is the only place that should ever
 * trigger the "new Discovery Queue item" notification, so this test
 * verifies that coupling directly, mocking the DB (per the convention in
 * db/sync.test.ts — src/db/*.ts has no other unit-level DB access) and the
 * notification module.
 */

const insertValuesMock = vi.fn().mockResolvedValue(undefined);

vi.mock("./client", () => ({
  db: {
    insert: () => ({ values: insertValuesMock }),
  },
}));

const notifyMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/discoveryNotification", () => ({
  notifyDiscoveryQueueInsert: notifyMock,
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
  notifyMock.mockClear();
});

describe("insertDiscoveryItem", () => {
  it("inserts the row with status 'pending' and then notifies exactly once with the same fields", async () => {
    await insertDiscoveryItem(item);

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith({ ...item, status: "pending" });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(item);
  });

  it("still resolves successfully even if the notification attempt rejects unexpectedly", async () => {
    notifyMock.mockRejectedValueOnce(new Error("should never happen, but must not break ingestion"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // notifyDiscoveryQueueInsert is contracted to never throw (see
    // discoveryNotification.test.ts), but insertDiscoveryItem still wraps
    // it defensively — the row is already committed, so this must resolve
    // regardless of notification behavior.
    await expect(insertDiscoveryItem(item)).resolves.toBeUndefined();
    expect(insertValuesMock).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});
