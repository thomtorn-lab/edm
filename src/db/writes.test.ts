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

// Queue of rows returned by successive db.select().from().where().limit()
// calls, consumed in call order (admin unpublish/cancellation safety,
// 2026-09-06 — adminUnpublishEvent/adminRepublishEvent/publishDiscoveryItem's
// duplicate guard all read an existing row via this exact chain shape).
let selectResults: unknown[][] = [];
const selectMock = vi.fn(() => ({
  from: () => ({
    where: () => ({
      limit: () => Promise.resolve(selectResults.shift() ?? []),
    }),
  }),
}));
const updateSetMock = vi.fn();
const updateMock = vi.fn(() => ({
  set: (patch: Record<string, unknown>) => {
    updateSetMock(patch);
    return { where: () => Promise.resolve(undefined) };
  },
}));

vi.mock("./client", () => ({
  db: {
    insert: () => ({ values: insertValuesMock }),
    select: () => selectMock(),
    update: () => updateMock(),
  },
}));

const { insertDiscoveryItem, adminUnpublishEvent, adminRepublishEvent, publishDiscoveryItem, applyAdminEventEdit } = await import("./writes");

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
  selectMock.mockClear();
  updateMock.mockClear();
  updateSetMock.mockClear();
  selectResults = [];
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

describe("adminUnpublishEvent (admin unpublish/cancellation safety, 2026-09-06)", () => {
  it("sets published=false, stamps adminUnpublishReason/adminUnpublishedAt, and protects 'published' via overriddenFields", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await adminUnpublishEvent("e-1", "cancelled");

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(false);
    expect(patch.adminUnpublishReason).toBe("cancelled");
    expect(patch.adminUnpublishedAt).toBeInstanceOf(Date);
    expect(patch.manualOverride).toBe(true);
    expect(patch.overriddenFields).toContain("published");
  });

  it("records an audit change-log entry naming the reason", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await adminUnpublishEvent("e-1", "duplicate");

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e-1", changedBy: "admin", changeType: "admin_unpublish", note: "reason: duplicate" }),
    );
  });

  it("throws when the event does not exist", async () => {
    selectResults = [[]];
    await expect(adminUnpublishEvent("e-missing", "other")).rejects.toThrow("Event e-missing not found");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("preserves any other already-overridden field alongside 'published'", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: ["title"] }]];

    await adminUnpublishEvent("e-1", "incorrect_data");

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.overriddenFields).toEqual(expect.arrayContaining(["title", "published"]));
  });
});

describe("adminRepublishEvent ('Publish Again') (admin unpublish/cancellation safety, 2026-09-06)", () => {
  it("clears the override and sets published=true", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: ["published"] }]];

    await adminRepublishEvent("e-1");

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(true);
    expect(patch.adminUnpublishReason).toBeNull();
    expect(patch.adminUnpublishedAt).toBeNull();
    expect(patch.overriddenFields).not.toContain("published");
  });

  it("is safe to call on an event that was never admin-unpublished — no admin-override-specific requirement blocks it", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await expect(adminRepublishEvent("e-1")).resolves.toBeUndefined();
    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(true);
  });

  it("keeps manualOverride true if other fields remain hand-corrected, false otherwise", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: ["published", "title"] }]];
    await adminRepublishEvent("e-1");
    expect(updateSetMock.mock.calls[0][0].manualOverride).toBe(true);

    selectResults = [[{ id: "e-2", overriddenFields: ["published"] }]];
    await adminRepublishEvent("e-2");
    expect(updateSetMock.mock.calls[1][0].manualOverride).toBe(false);
  });

  it("throws when the event does not exist", async () => {
    selectResults = [[]];
    await expect(adminRepublishEvent("e-missing")).rejects.toThrow("Event e-missing not found");
  });
});

describe("publishDiscoveryItem's admin-unpublish duplicate guard (admin unpublish/cancellation safety, 2026-09-06)", () => {
  const pendingItem = {
    id: "dq-1",
    status: "pending",
    probableStart: new Date("2026-09-12T22:00:00Z"),
    suspectedDuplicateOfEventId: "e-existing",
  };

  it("refuses to publish a Discovery Queue item suspected to duplicate an admin-unpublished event", async () => {
    selectResults = [[pendingItem], [{ id: "e-existing", title: "Jasho Club // Poolen Outside", adminUnpublishReason: "cancelled" }]];

    await expect(publishDiscoveryItem("dq-1", "v-poolen")).rejects.toThrow(/admin-unpublished event/);
  });

  it("does not raise the admin-unpublish guard when the suspected duplicate was never admin-unpublished", async () => {
    selectResults = [[pendingItem], [{ id: "e-existing", title: "Some Other Night", adminUnpublishReason: null }]];

    await publishDiscoveryItem("dq-1", "v-poolen").catch((err: unknown) => {
      // createEvent's own DB writes aren't fully mocked in this file — any
      // failure past this point is a mock-shape limitation, not the guard.
      if (err instanceof Error) expect(err.message).not.toMatch(/admin-unpublished event/);
    });
  });

  it("skips the guard entirely (no extra event lookup) when the item has no suspected duplicate", async () => {
    selectResults = [[{ ...pendingItem, suspectedDuplicateOfEventId: null }]];

    await publishDiscoveryItem("dq-1", "v-poolen").catch(() => {
      // Same mock-shape caveat as above — only the guard's own behavior
      // (not calling db.select a second time) is under test here.
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});

describe("applyAdminEventEdit — generic PATCH bypass safety (admin unpublish/cancellation safety, 2026-09-06)", () => {
  it("a plain {published: true} edit on an admin-unpublished event clears the stale override in the same write — the exact generic-PATCH bypass this guards against: 'published' stays in EDITABLE_EVENT_FIELDS, so this function is the only enforcement point", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], adminUnpublishReason: "cancelled" }]];

    await applyAdminEventEdit("e-1", { published: true });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(true);
    expect(patch.adminUnpublishReason).toBeNull();
    expect(patch.adminUnpublishedAt).toBeNull();
  });

  it("does not touch adminUnpublishReason for an ordinary field edit unrelated to publication", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], adminUnpublishReason: "cancelled" }]];

    await applyAdminEventEdit("e-1", { title: "Corrected Title" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch).not.toHaveProperty("adminUnpublishReason");
    expect(patch).not.toHaveProperty("adminUnpublishedAt");
  });

  it("does not touch adminUnpublishReason when published:true is set on an event that was never admin-unpublished", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], adminUnpublishReason: null }]];

    await applyAdminEventEdit("e-1", { published: true });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch).not.toHaveProperty("adminUnpublishReason");
    expect(patch).not.toHaveProperty("adminUnpublishedAt");
  });

  it("does not clear the override on {published: false} — only published:true triggers the clear", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], adminUnpublishReason: "cancelled" }]];

    await applyAdminEventEdit("e-1", { published: false });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(false);
    expect(patch).not.toHaveProperty("adminUnpublishReason");
  });
});
