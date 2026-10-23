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

// Awaitable directly (createEvent's own `events` row insert) AND chainable
// with .onConflictDoNothing() (recordSourceLink's `source_event_links`
// insert) — both real shapes db.insert(...).values(...) takes in writes.ts,
// so a full publishDiscoveryItem happy path (admin + public link integrity,
// 2026-09-08) can now be exercised end to end rather than only its early
// guard-throw branches, as every test below this originally stopped short of.
const insertValuesMock = vi.fn((row: unknown) => {
  void row; // typed only so insertValuesMock.mock.calls[n][0] below stays indexable — the mock ignores the actual value
  const resolved = Promise.resolve(undefined);
  return Object.assign(resolved, { onConflictDoNothing: () => Promise.resolve(undefined) });
});

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

// createEvent's YouTube Artist Preview cache warm-up (2026-09-25) is
// deliberately mocked out here rather than exercised through this file's
// generic db mock above — every fixture below uses an empty lineup, so in
// practice the real hook never reaches a db call either way, but mocking it
// explicitly keeps that independent of any future fixture adding a
// non-empty detectedLineup, and lets the "never blocks event creation"
// contract be tested directly (see the dedicated describe block below).
const enrichArtistYoutubePreviewsMock = vi.fn(async (artistNames: string[]) => {
  void artistNames;
});
vi.mock("./youtubePreview", () => ({
  enrichArtistYoutubePreviews: (artistNames: string[]) => enrichArtistYoutubePreviewsMock(artistNames),
}));

const {
  insertDiscoveryItem,
  adminUnpublishEvent,
  adminRepublishEvent,
  publishDiscoveryItem,
  applyAdminEventEdit,
  updateDiscoveryItem,
  applySourceCancellationUnpublish,
  applySourceCancellationRestore,
  adminOverrideSourceCancellation,
  adminClearRescheduledStatus,
  applySourceSyncPatch,
} = await import("./writes");
const { buildSyncPatch } = await import("../lib/sync");
const { END_BEFORE_START_ERROR } = await import("../lib/datetime");

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
  enrichArtistYoutubePreviewsMock.mockClear();
  enrichArtistYoutubePreviewsMock.mockImplementation(async () => {});
});

describe("createEvent — YouTube Artist Preview cache warm-up never blocks event creation", () => {
  it("still creates the event when enrichArtistYoutubePreviews rejects", async () => {
    enrichArtistYoutubePreviewsMock.mockImplementation(async () => {
      throw new Error("YouTube API unreachable");
    });
    selectResults = [[{ ...item, status: "pending", detectedLineup: ["Kasper Bjørke"] }]];

    await expect(publishDiscoveryItem("dq-abc123", "v-poolen")).resolves.toBeDefined();
    expect(enrichArtistYoutubePreviewsMock).toHaveBeenCalledWith(["Kasper Bjørke"]);
  });
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

  it("stores a trimmed optional note and includes it in the change-log entry", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await adminUnpublishEvent("e-1", "cancelled", "  promoter confirmed by email  ");

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.adminUnpublishNote).toBe("promoter confirmed by email");
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ note: "reason: cancelled; note: promoter confirmed by email" }),
    );
  });

  it("stores null for an omitted, empty, or whitespace-only note — never an empty string", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];
    await adminUnpublishEvent("e-1", "cancelled");
    expect(updateSetMock.mock.calls[0][0].adminUnpublishNote).toBeNull();

    selectResults = [[{ id: "e-1", overriddenFields: [] }]];
    await adminUnpublishEvent("e-1", "cancelled", "   ");
    expect(updateSetMock.mock.calls[0][0].adminUnpublishNote).toBeNull();
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
    expect(patch.adminUnpublishNote).toBeNull();
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

describe("applySourceCancellationUnpublish (source-driven cancellation safety, 2026-09-07)", () => {
  it("sets published=false and stamps sourceCancelledAt/sourceCancelledBySourceId/sourceCancellationEvidence, without touching adminUnpublishReason or manualOverride", async () => {
    await applySourceCancellationUnpublish("e-1", "src-poolen", 'Poolen status badge "Aflyst"');

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(false);
    expect(patch.sourceCancelledAt).toBeInstanceOf(Date);
    expect(patch.sourceCancelledBySourceId).toBe("src-poolen");
    expect(patch.sourceCancellationEvidence).toBe('Poolen status badge "Aflyst"');
    expect(patch.manualOverride).toBeUndefined();
    expect(patch.adminUnpublishReason).toBeUndefined();
  });

  it("stores a null evidence string as-is (no evidence recorded)", async () => {
    await applySourceCancellationUnpublish("e-1", "src-pumpehuset", null);
    expect(updateSetMock.mock.calls[0][0].sourceCancellationEvidence).toBeNull();
  });

  it("logs the change to the audit trail attributed to the source, not 'admin'", async () => {
    await applySourceCancellationUnpublish("e-1", "src-poolen", "aflyst");
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e-1", changedBy: "src-poolen", changeType: "auto_unpublish" }),
    );
  });
});

describe("applySourceCancellationRestore (source-driven cancellation safety, 2026-09-07)", () => {
  it("sets published=true and clears all three source-cancellation fields together", async () => {
    await applySourceCancellationRestore("e-1", "src-billetto");

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(true);
    expect(patch.sourceCancelledAt).toBeNull();
    expect(patch.sourceCancelledBySourceId).toBeNull();
    expect(patch.sourceCancellationEvidence).toBeNull();
    expect(patch.manualOverride).toBeUndefined();
  });

  it("logs the change to the audit trail attributed to the source", async () => {
    await applySourceCancellationRestore("e-1", "src-billetto");
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e-1", changedBy: "src-billetto", changeType: "auto_publish" }),
    );
  });
});

describe("adminOverrideSourceCancellation (source-driven cancellation safety, 2026-09-07, Section 5)", () => {
  it("sets published=true, clears source-cancellation fields, and sets manualOverride/overriddenFields to protect against the same source re-firing on the next sync", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await adminOverrideSourceCancellation("e-1");

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(true);
    expect(patch.sourceCancelledAt).toBeNull();
    expect(patch.sourceCancelledBySourceId).toBeNull();
    expect(patch.sourceCancellationEvidence).toBeNull();
    expect(patch.manualOverride).toBe(true);
    expect(patch.overriddenFields).toContain("published");
  });

  it("logs the change to the audit trail attributed to 'admin'", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];
    await adminOverrideSourceCancellation("e-1");
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e-1", changedBy: "admin", changeType: "admin_override_source_cancellation" }),
    );
  });

  it("preserves any other already-overridden field alongside 'published'", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: ["title"] }]];
    await adminOverrideSourceCancellation("e-1");
    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.overriddenFields).toEqual(expect.arrayContaining(["title", "published"]));
  });

  it("throws when the event does not exist", async () => {
    selectResults = [[]];
    await expect(adminOverrideSourceCancellation("e-missing")).rejects.toThrow("Event e-missing not found");
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});

describe("adminClearRescheduledStatus (rescheduled-status correction, 2026-10-06)", () => {
  it("clears dateChanged and timeChanged without touching overriddenFields or manualOverride", async () => {
    selectResults = [[{ id: "e-1", dateChanged: true, timeChanged: false, overriddenFields: [], manualOverride: false }]];
    await adminClearRescheduledStatus("e-1");
    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.dateChanged).toBe(false);
    expect(patch.timeChanged).toBe(false);
    expect(patch).not.toHaveProperty("overriddenFields");
    expect(patch).not.toHaveProperty("manualOverride");
  });

  it("logs the change to the audit trail attributed to 'admin'", async () => {
    selectResults = [[{ id: "e-1", dateChanged: true, timeChanged: false, overriddenFields: [], manualOverride: false }]];
    await adminClearRescheduledStatus("e-1");
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e-1", changedBy: "admin", changeType: "admin_clear_rescheduled_status" }),
    );
  });

  it("preserves any existing overriddenFields/manualOverride on the row untouched (not part of the write at all)", async () => {
    selectResults = [[{ id: "e-1", dateChanged: true, timeChanged: true, overriddenFields: ["title"], manualOverride: true }]];
    await adminClearRescheduledStatus("e-1");
    const patch = updateSetMock.mock.calls[0][0];
    expect(patch).not.toHaveProperty("overriddenFields");
    expect(patch).not.toHaveProperty("manualOverride");
  });

  it("is an idempotent no-op when neither flag is set — no write, no change-log entry", async () => {
    selectResults = [[{ id: "e-1", dateChanged: false, timeChanged: false, overriddenFields: [], manualOverride: false }]];
    await adminClearRescheduledStatus("e-1");
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("clears timeChanged alone when only it is set", async () => {
    selectResults = [[{ id: "e-1", dateChanged: false, timeChanged: true, overriddenFields: [], manualOverride: false }]];
    await adminClearRescheduledStatus("e-1");
    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.dateChanged).toBe(false);
    expect(patch.timeChanged).toBe(false);
  });

  it("throws when the event does not exist", async () => {
    selectResults = [[]];
    await expect(adminClearRescheduledStatus("e-missing")).rejects.toThrow("Event e-missing not found");
    expect(updateSetMock).not.toHaveBeenCalled();
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

describe("publishDiscoveryItem — DQ manual Official Event/Ticket URLs (admin + public link integrity, 2026-09-08)", () => {
  const kultunautPending = {
    id: "dq-kn-1",
    status: "pending",
    probableTitle: "Nico Moreno",
    probableStart: new Date("2026-09-12T22:00:00Z"),
    probableEnd: null,
    probableSubVenue: null,
    detectedLineup: [] as string[],
    predictedGenre: "techno",
    genreConfidence: "high",
    probableFree: false,
    overallConfidence: "medium",
    sourceId: "src-kultunaut",
    sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137632",
    suspectedDuplicateOfEventId: null,
    // Kept null in the fixture on purpose (irrelevant to these tests) —
    // KultuNaut's own adapter never sets this at all post-fix; a real
    // ticket-provider URL from an entirely different source would use the
    // exact same probableTicketUrl field, unrelated to this test's focus.
    probableTicketUrl: null as string | null,
    probableOfficialEventUrl: null as string | null,
    probableResidentAdvisorUrl: null as string | null,
    description: null as string | null,
    overriddenFields: [] as string[],
  };

  function eventInsertCall() {
    return insertValuesMock.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null && "slug" in (call[0] as object),
    )?.[0] as Record<string, unknown> | undefined;
  }

  it("DQ manual Official Event URL transfers exactly to the canonical event's officialEventUrl (not the KultuNaut sourceUrl)", async () => {
    selectResults = [[{ ...kultunautPending, probableOfficialEventUrl: "https://real-official-venue.dk/event/xyz", overriddenFields: ["probableOfficialEventUrl"] }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.officialEventUrl).toBe("https://real-official-venue.dk/event/xyz");
  });

  it("with no admin-entered Official Event URL, falls back to the DQ row's own sourceUrl exactly as before (unchanged default behavior)", async () => {
    selectResults = [[{ ...kultunautPending }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.officialEventUrl).toBe(kultunautPending.sourceUrl);
  });

  it("DQ manual Ticket URL transfers exactly to the canonical event's ticketUrl", async () => {
    selectResults = [[{ ...kultunautPending, probableTicketUrl: "https://billetto.dk/e/nico-moreno-123", overriddenFields: ["probableTicketUrl"] }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.ticketUrl).toBe("https://billetto.dk/e/nico-moreno-123");
  });

  it("overriddenFields protects both manually-entered links after publish — mapped from the DQ row's own overriddenFields (probableOfficialEventUrl/probableTicketUrl) onto the new event's officialEventUrl/ticketUrl", async () => {
    selectResults = [
      [
        {
          ...kultunautPending,
          probableOfficialEventUrl: "https://real-official-venue.dk/event/xyz",
          probableTicketUrl: "https://billetto.dk/e/nico-moreno-123",
          overriddenFields: ["probableOfficialEventUrl", "probableTicketUrl"],
        },
      ],
    ];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.overriddenFields).toEqual(["officialEventUrl", "ticketUrl"]);
    expect(eventInsertCall()?.manualOverride).toBe(true);
  });

  it("a field the admin never touched at DQ stage is NOT marked overridden on the new event, even when it has a value (e.g. an adapter-populated probableTicketUrl, never hand-edited)", async () => {
    selectResults = [[{ ...kultunautPending, probableTicketUrl: "https://billetto.dk/e/adapter-populated", overriddenFields: [] }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.overriddenFields).toEqual([]);
    expect(eventInsertCall()?.manualOverride).toBe(false);
  });

  it("admin provenance remains intact: source_event_links still records the SOURCE's own sourceUrl (the KultuNaut page), never the admin's manually-entered officialEventUrl, even when they differ", async () => {
    selectResults = [[{ ...kultunautPending, probableOfficialEventUrl: "https://real-official-venue.dk/event/xyz", overriddenFields: ["probableOfficialEventUrl"] }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    const provenanceCall = insertValuesMock.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null && "role" in (call[0] as object),
    )?.[0] as Record<string, unknown> | undefined;
    expect(provenanceCall?.sourceUrl).toBe(kultunautPending.sourceUrl);
    expect(provenanceCall?.sourceUrl).not.toBe("https://real-official-venue.dk/event/xyz");
  });
});

describe("publishDiscoveryItem — Discovery two-genre support (2026-10-06)", () => {
  const pendingWithGenre = {
    id: "dq-genre-1",
    status: "pending",
    probableTitle: "Two Genre Night",
    probableStart: new Date("2026-09-12T22:00:00Z"),
    probableEnd: null,
    probableSubVenue: null,
    detectedLineup: [] as string[],
    predictedGenre: "techno",
    predictedSecondaryGenre: null as string | null,
    genreConfidence: "high",
    probableFree: false,
    overallConfidence: "medium",
    sourceId: "src-test",
    sourceUrl: "https://example.com/events/two-genre-night",
    suspectedDuplicateOfEventId: null,
    probableTicketUrl: null as string | null,
    probableOfficialEventUrl: null as string | null,
    probableResidentAdvisorUrl: null as string | null,
    description: null as string | null,
    overriddenFields: [] as string[],
  };

  function eventInsertCall() {
    return insertValuesMock.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null && "slug" in (call[0] as object),
    )?.[0] as Record<string, unknown> | undefined;
  }

  it("publishes with only one genre in subgenres when no secondary genre was ever set (existing one-genre records continue working unchanged)", async () => {
    selectResults = [[{ ...pendingWithGenre }]];
    await publishDiscoveryItem("dq-genre-1", "v-poolen");
    expect(eventInsertCall()?.primaryGenre).toBe("techno");
    expect(eventInsertCall()?.subgenres).toEqual(["techno"]);
  });

  it("publishes with both genres in subgenres, preserving primary-then-secondary ordering", async () => {
    selectResults = [[{ ...pendingWithGenre, predictedSecondaryGenre: "house" }]];
    await publishDiscoveryItem("dq-genre-1", "v-poolen");
    expect(eventInsertCall()?.primaryGenre).toBe("techno");
    expect(eventInsertCall()?.subgenres).toEqual(["techno", "house"]);
  });

  it("never duplicates a genre in subgenres even if predictedSecondaryGenre somehow equals predictedGenre", async () => {
    selectResults = [[{ ...pendingWithGenre, predictedSecondaryGenre: "techno" }]];
    await publishDiscoveryItem("dq-genre-1", "v-poolen");
    expect(eventInsertCall()?.subgenres).toEqual(["techno"]);
  });

  it("falls back to electronic-other with no secondary when predictedGenre itself was never resolved, regardless of predictedSecondaryGenre", async () => {
    selectResults = [[{ ...pendingWithGenre, predictedGenre: null, predictedSecondaryGenre: "house" }]];
    await publishDiscoveryItem("dq-genre-1", "v-poolen");
    expect(eventInsertCall()?.primaryGenre).toBe("electronic-other");
    expect(eventInsertCall()?.subgenres).toEqual(["electronic-other"]);
  });

  it("maps an admin override of ONLY the secondary genre onto the new event's primaryGenre/subgenres override protection, same as a primary-genre override", async () => {
    selectResults = [[{ ...pendingWithGenre, predictedSecondaryGenre: "house", overriddenFields: ["predictedSecondaryGenre"] }]];
    await publishDiscoveryItem("dq-genre-1", "v-poolen");
    expect(eventInsertCall()?.overriddenFields).toEqual(["primaryGenre", "subgenres"]);
    expect(eventInsertCall()?.manualOverride).toBe(true);
  });

  it("does not mark primaryGenre/subgenres as overridden when neither genre field was ever hand-edited", async () => {
    selectResults = [[{ ...pendingWithGenre, predictedSecondaryGenre: "house", overriddenFields: [] }]];
    await publishDiscoveryItem("dq-genre-1", "v-poolen");
    expect(eventInsertCall()?.overriddenFields).toEqual([]);
    expect(eventInsertCall()?.manualOverride).toBe(false);
  });
});

describe("publishDiscoveryItem — description/Resident Advisor URL/expanded field parity (unified event create/edit model, 2026-09-08)", () => {
  const kultunautPending = {
    id: "dq-kn-1",
    status: "pending",
    probableTitle: "Nico Moreno",
    probableStart: new Date("2026-09-12T22:00:00Z"),
    probableEnd: null,
    probableSubVenue: null,
    detectedLineup: [] as string[],
    predictedGenre: "techno",
    genreConfidence: "high",
    probableFree: false,
    overallConfidence: "medium",
    sourceId: "src-kultunaut",
    sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137632",
    suspectedDuplicateOfEventId: null,
    probableTicketUrl: null as string | null,
    probableOfficialEventUrl: null as string | null,
    probableResidentAdvisorUrl: null as string | null,
    description: null as string | null,
    overriddenFields: [] as string[],
  };

  function eventInsertCall() {
    return insertValuesMock.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null && "slug" in (call[0] as object),
    )?.[0] as Record<string, unknown> | undefined;
  }

  it("DQ description transfers to the canonical event's description — previously always hardcoded null regardless of what was extracted", async () => {
    selectResults = [[{ ...kultunautPending, description: "A night of raw techno.", overriddenFields: ["description"] }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.description).toBe("A night of raw techno.");
  });

  it("DQ manual Resident Advisor URL transfers exactly to the canonical event's residentAdvisorUrl, taking precedence over the ra.co-sourceUrl fallback", async () => {
    selectResults = [
      [
        {
          ...kultunautPending,
          sourceUrl: "https://ra.co/events/1234567",
          probableResidentAdvisorUrl: "https://ra.co/events/9999999",
          overriddenFields: ["probableResidentAdvisorUrl"],
        },
      ],
    ];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.residentAdvisorUrl).toBe("https://ra.co/events/9999999");
  });

  it("with no admin-entered Resident Advisor URL, falls back to the ra.co-sourceUrl heuristic exactly as before", async () => {
    selectResults = [[{ ...kultunautPending, sourceUrl: "https://ra.co/events/1234567" }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.residentAdvisorUrl).toBe("https://ra.co/events/1234567");
  });

  it("a deliberately cleared RA link stays cleared at publish, even when the row's own sourceUrl is an RA page", async () => {
    selectResults = [
      [{ ...kultunautPending, sourceUrl: "https://ra.co/events/1234567", probableResidentAdvisorUrl: null, overriddenFields: ["probableResidentAdvisorUrl"] }],
    ];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.residentAdvisorUrl).toBeNull();
    expect(eventInsertCall()?.overriddenFields).toContain("residentAdvisorUrl");
  });

  it("the RA-sourceUrl fallback checks the hostname, never a substring: extra.com / zebra.com are not Resident Advisor", async () => {
    for (const sourceUrl of ["https://extra.com/events/1", "https://zebra.com/ra.co/events/1"]) {
      insertValuesMock.mockClear();
      selectResults = [[{ ...kultunautPending, sourceUrl }]];

      await publishDiscoveryItem("dq-kn-1", "v-poolen");

      expect(eventInsertCall()?.residentAdvisorUrl).toBeNull();
    }
  });

  it("Facebook decision: publishDiscoveryItem never sets a distinct facebookUrl on a new event — officialEventUrl already carries a Facebook-sourced URL", async () => {
    selectResults = [[{ ...kultunautPending, sourceUrl: "https://facebook.com/events/123" }]];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.facebookUrl).toBeNull();
    expect(eventInsertCall()?.officialEventUrl).toBe("https://facebook.com/events/123");
  });

  it("DQ manual title/date/venue-name/lineup/genre edits all map onto the new event's overriddenFields, surviving publish the same way the URL pair already does", async () => {
    selectResults = [
      [
        {
          ...kultunautPending,
          overriddenFields: ["probableTitle", "probableStart", "probableEnd", "probableVenueName", "probableSubVenue", "detectedLineup", "predictedGenre"],
        },
      ],
    ];

    await publishDiscoveryItem("dq-kn-1", "v-poolen");

    expect(eventInsertCall()?.overriddenFields).toEqual(
      expect.arrayContaining(["title", "startDatetime", "endDatetime", "venueId", "subVenue", "artists", "primaryGenre", "subgenres"]),
    );
  });
});

describe("applyAdminEventEdit — generic PATCH bypass safety (admin unpublish/cancellation safety, 2026-09-06)", () => {
  it("a plain {published: true} edit on an admin-unpublished event clears the stale override in the same write — the exact generic-PATCH bypass this guards against: 'published' stays in EDITABLE_EVENT_FIELDS, so this function is the only enforcement point", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], adminUnpublishReason: "cancelled" }]];

    await applyAdminEventEdit("e-1", { published: true });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.published).toBe(true);
    expect(patch.adminUnpublishReason).toBeNull();
    expect(patch.adminUnpublishNote).toBeNull();
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

describe("applyAdminEventEdit — primaryGenre/subgenres lockstep (genre taxonomy audit, 2026-09-14)", () => {
  it("derives subgenres=[primaryGenre] when a patch sets primaryGenre alone — the exact gap that let primaryGenre='electronic-other'/subgenres=[] reach Production", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await applyAdminEventEdit("e-1", { primaryGenre: "electronic-other" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.primaryGenre).toBe("electronic-other");
    expect(patch.subgenres).toEqual(["electronic-other"]);
  });

  it("does not override an explicitly-provided subgenres value — a caller that already sends both fields together (e.g. EventManager.tsx) keeps full control", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await applyAdminEventEdit("e-1", { primaryGenre: "techno", subgenres: ["melodic-techno"] });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.primaryGenre).toBe("techno");
    expect(patch.subgenres).toEqual(["melodic-techno"]);
  });

  it("does not touch subgenres for an edit that never touches primaryGenre", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await applyAdminEventEdit("e-1", { title: "Corrected Title" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch).not.toHaveProperty("subgenres");
  });
});

describe("applyAdminEventEdit — event-level link editing (officialEventUrl/ticketUrl, 2026-09-07)", () => {
  it("adds an Official Event URL where none existed and marks the field overridden", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await applyAdminEventEdit("e-1", { officialEventUrl: "https://venue.example.com/events/night" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.officialEventUrl).toBe("https://venue.example.com/events/night");
    expect(patch.overriddenFields).toContain("officialEventUrl");
    expect(patch.manualOverride).toBe(true);
  });

  it("edits an existing Official Event URL", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await applyAdminEventEdit("e-1", { officialEventUrl: "https://venue.example.com/events/corrected" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.officialEventUrl).toBe("https://venue.example.com/events/corrected");
  });

  it("clears an Official Event URL back to null and still marks it overridden (so a later sync doesn't restore it)", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], officialEventUrl: "https://venue.example.com/events/night" }]];

    await applyAdminEventEdit("e-1", { officialEventUrl: null });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.officialEventUrl).toBeNull();
    expect(patch.overriddenFields).toContain("officialEventUrl");
  });

  it("adds a Tickets URL where none existed", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

    await applyAdminEventEdit("e-1", { ticketUrl: "https://tickets.example.com/e/1" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.ticketUrl).toBe("https://tickets.example.com/e/1");
    expect(patch.overriddenFields).toContain("ticketUrl");
  });

  it("edits an existing Tickets URL", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: ["ticketUrl"] }]];

    await applyAdminEventEdit("e-1", { ticketUrl: "https://tickets.example.com/e/updated" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.ticketUrl).toBe("https://tickets.example.com/e/updated");
  });

  it("clears a Tickets URL back to null and still marks it overridden", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: ["ticketUrl"], ticketUrl: "https://tickets.example.com/e/1" }]];

    await applyAdminEventEdit("e-1", { ticketUrl: null });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.ticketUrl).toBeNull();
    expect(patch.overriddenFields).toContain("ticketUrl");
  });

  it("editing officialEventUrl on one event never touches another — overriddenFields accumulates per-row from that row's own existing list, never a shared/global list", async () => {
    selectResults = [
      [{ id: "e-A", overriddenFields: [] }],
      [{ id: "e-B", overriddenFields: ["title"] }],
    ];

    await applyAdminEventEdit("e-A", { officialEventUrl: "https://a.example.com" });
    await applyAdminEventEdit("e-B", { officialEventUrl: "https://b.example.com" });

    const patchA = updateSetMock.mock.calls[0][0];
    const patchB = updateSetMock.mock.calls[1][0];
    expect(patchA.overriddenFields).toEqual(["officialEventUrl"]);
    expect(patchB.overriddenFields).toEqual(expect.arrayContaining(["title", "officialEventUrl"]));
    expect(patchB.officialEventUrl).toBe("https://b.example.com");
    expect(patchA.officialEventUrl).toBe("https://a.example.com");
  });
});

describe("applyAdminEventEdit — end-before-start write-path guard (ended-event write-path integrity, 2026-09-20)", () => {
  it("accepts a patch where the new end is after the new start", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T22:00:00Z"), endDatetime: null }]];

    await applyAdminEventEdit("e-1", {
      startDatetime: new Date("2026-09-19T22:00:00Z"),
      endDatetime: new Date("2026-09-20T04:00:00Z"),
    });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.endDatetime).toEqual(new Date("2026-09-20T04:00:00Z"));
  });

  it("rejects a patch where the new end equals the new start", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T22:00:00Z"), endDatetime: null }]];

    await expect(
      applyAdminEventEdit("e-1", {
        startDatetime: new Date("2026-09-19T22:00:00Z"),
        endDatetime: new Date("2026-09-19T22:00:00Z"),
      }),
    ).rejects.toThrow(END_BEFORE_START_ERROR);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects a patch where the new end is before the new start — the exact ASCEND/Disco Express shape (same calendar day, end clock-time earlier than start)", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T17:00:00Z"), endDatetime: null }]];

    await expect(
      applyAdminEventEdit("e-1", {
        startDatetime: new Date("2026-09-19T17:00:00Z"),
        endDatetime: new Date("2026-09-19T00:00:00Z"),
      }),
    ).rejects.toThrow(END_BEFORE_START_ERROR);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("accepts an overnight event whose end carries the following calendar date", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T20:00:00Z"), endDatetime: null }]];

    await applyAdminEventEdit("e-1", { endDatetime: new Date("2026-09-20T02:00:00Z") });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.endDatetime).toEqual(new Date("2026-09-20T02:00:00Z"));
  });

  it("accepts a patch that sets a start with no end at all", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T20:00:00Z"), endDatetime: null }]];

    await applyAdminEventEdit("e-1", { startDatetime: new Date("2026-09-19T21:00:00Z") });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.startDatetime).toEqual(new Date("2026-09-19T21:00:00Z"));
  });

  it("is never consulted for an edit that touches neither startDatetime nor endDatetime, even against an already-malformed existing row — an unrelated field edit on one of the known-bad Production rows must not be blocked by it", async () => {
    selectResults = [
      [{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T17:00:00Z"), endDatetime: new Date("2026-09-19T00:00:00Z") }],
    ];

    await applyAdminEventEdit("e-1", { title: "Corrected Title" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.title).toBe("Corrected Title");
  });

  it("validates the effective end against an unchanged existing start when only endDatetime is patched", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T20:00:00Z"), endDatetime: null }]];

    await expect(applyAdminEventEdit("e-1", { endDatetime: new Date("2026-09-19T18:00:00Z") })).rejects.toThrow(
      END_BEFORE_START_ERROR,
    );
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("validates a start-only patch against an unchanged existing end — rejects a new start that reaches or passes it (PR review, 2026-09-20: the mirror image of the end-only case above, proving the guard can't be bypassed by editing one field at a time)", async () => {
    selectResults = [
      [{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T20:00:00Z"), endDatetime: new Date("2026-09-20T02:00:00Z") }],
    ];

    await expect(applyAdminEventEdit("e-1", { startDatetime: new Date("2026-09-20T02:00:00Z") })).rejects.toThrow(
      END_BEFORE_START_ERROR,
    );
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("accepts a start-only patch that still precedes the unchanged existing end", async () => {
    selectResults = [
      [{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-09-19T20:00:00Z"), endDatetime: new Date("2026-09-20T02:00:00Z") }],
    ];

    await applyAdminEventEdit("e-1", { startDatetime: new Date("2026-09-19T21:00:00Z") });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.startDatetime).toEqual(new Date("2026-09-19T21:00:00Z"));
  });
});

describe("updateDiscoveryItem — end-before-start write-path guard (ended-event write-path integrity, 2026-09-20)", () => {
  const pending = {
    id: "dq-1",
    status: "pending",
    overriddenFields: [] as string[],
    missingFields: ["date"] as string[],
    probableStart: null as Date | null,
    probableEnd: null as Date | null,
    probableTitle: "Test Event",
    probableVenueName: null as string | null,
  };

  it("accepts probableEnd after probableStart", async () => {
    selectResults = [[{ ...pending }]];

    await updateDiscoveryItem("dq-1", {
      probableStart: new Date("2026-09-19T22:00:00Z"),
      probableEnd: new Date("2026-09-20T04:00:00Z"),
    });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.probableEnd).toEqual(new Date("2026-09-20T04:00:00Z"));
  });

  it("rejects probableEnd equal to probableStart", async () => {
    selectResults = [[{ ...pending }]];

    await expect(
      updateDiscoveryItem("dq-1", {
        probableStart: new Date("2026-09-19T22:00:00Z"),
        probableEnd: new Date("2026-09-19T22:00:00Z"),
      }),
    ).rejects.toThrow(END_BEFORE_START_ERROR);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects probableEnd before probableStart", async () => {
    selectResults = [[{ ...pending }]];

    await expect(
      updateDiscoveryItem("dq-1", {
        probableStart: new Date("2026-09-19T20:00:00Z"),
        probableEnd: new Date("2026-09-19T02:00:00Z"),
      }),
    ).rejects.toThrow(END_BEFORE_START_ERROR);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("accepts an overnight probableEnd on the following calendar date", async () => {
    selectResults = [[{ ...pending, probableStart: new Date("2026-09-19T20:00:00Z") }]];

    await updateDiscoveryItem("dq-1", { probableEnd: new Date("2026-09-20T02:00:00Z") });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.probableEnd).toEqual(new Date("2026-09-20T02:00:00Z"));
  });

  it("accepts probableStart set with no probableEnd", async () => {
    selectResults = [[{ ...pending }]];

    await updateDiscoveryItem("dq-1", { probableStart: new Date("2026-09-19T20:00:00Z") });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.probableStart).toEqual(new Date("2026-09-19T20:00:00Z"));
  });

  it("does not run the guard for a patch touching neither probableStart nor probableEnd", async () => {
    selectResults = [[{ ...pending, probableStart: new Date("2026-09-19T20:00:00Z"), probableEnd: new Date("2026-09-19T02:00:00Z") }]];

    await updateDiscoveryItem("dq-1", { probableTitle: "Corrected Title" });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.probableTitle).toBe("Corrected Title");
  });

  it("validates a probableStart-only patch against an unchanged existing probableEnd — rejects a new start that reaches or passes it (PR review, 2026-09-20: DQ mirror of the applyAdminEventEdit start-only case)", async () => {
    selectResults = [
      [{ ...pending, probableStart: new Date("2026-09-19T20:00:00Z"), probableEnd: new Date("2026-09-20T02:00:00Z") }],
    ];

    await expect(
      updateDiscoveryItem("dq-1", { probableStart: new Date("2026-09-20T02:00:00Z") }),
    ).rejects.toThrow(END_BEFORE_START_ERROR);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("accepts a probableStart-only patch that still precedes the unchanged existing probableEnd", async () => {
    selectResults = [
      [{ ...pending, probableStart: new Date("2026-09-19T20:00:00Z"), probableEnd: new Date("2026-09-20T02:00:00Z") }],
    ];

    await updateDiscoveryItem("dq-1", { probableStart: new Date("2026-09-19T21:00:00Z") });

    const patch = updateSetMock.mock.calls[0][0];
    expect(patch.probableStart).toEqual(new Date("2026-09-19T21:00:00Z"));
  });
});

describe("publishDiscoveryItem — end-before-start write-path guard (ended-event write-path integrity, 2026-09-20) — cannot bypass the DQ-edit guard by publishing directly", () => {
  const basePending = {
    id: "dq-1",
    status: "pending",
    probableTitle: "Test Event",
    probableSubVenue: null as string | null,
    detectedLineup: [] as string[],
    predictedGenre: "techno",
    genreConfidence: "high",
    probableFree: false,
    overallConfidence: "medium",
    sourceId: null as string | null,
    sourceUrl: "https://example.com/event",
    suspectedDuplicateOfEventId: null,
    probableTicketUrl: null as string | null,
    probableOfficialEventUrl: null as string | null,
    probableResidentAdvisorUrl: null as string | null,
    description: null as string | null,
    overriddenFields: [] as string[],
  };

  it("rejects publish when probableEnd is before probableStart, even though updateDiscoveryItem's own guard was never exercised", async () => {
    selectResults = [
      [
        {
          ...basePending,
          probableStart: new Date("2026-09-19T17:00:00Z"),
          probableEnd: new Date("2026-09-19T00:00:00Z"),
        },
      ],
    ];

    await expect(publishDiscoveryItem("dq-1", "v-copenhill")).rejects.toThrow(END_BEFORE_START_ERROR);
  });

  it("still publishes normally when probableEnd is absent", async () => {
    selectResults = [[{ ...basePending, probableStart: new Date("2026-09-19T17:00:00Z"), probableEnd: null }]];

    await expect(publishDiscoveryItem("dq-1", "v-copenhill")).resolves.toBeDefined();
  });

  it("still publishes normally when probableEnd is a valid overnight end", async () => {
    selectResults = [
      [
        {
          ...basePending,
          probableStart: new Date("2026-09-19T20:00:00Z"),
          probableEnd: new Date("2026-09-20T02:00:00Z"),
        },
      ],
    ];

    await expect(publishDiscoveryItem("dq-1", "v-copenhill")).resolves.toBeDefined();
  });
});

describe("admin saves lock only changed or cleared fields (editorial screening, priority 1 — 2026-10-17)", () => {
  // A row as AddEventFromUrl/Analyze or a sync leaves it: every editor field
  // already has a stored value the form pre-fills.
  const storedEvent = {
    id: "e-1",
    title: "The Final Reptile Rave - HELL",
    description: "Two evenings. Two worlds.",
    artists: ["DJ Aligator"],
    primaryGenre: "trance",
    subgenres: ["trance"],
    officialEventUrl: "https://vega.dk/event/dj-aligator-2026-10-16-1",
    ticketUrl: "https://www.ticketmaster.dk/event/184672081",
    residentAdvisorUrl: null as string | null,
    startDatetime: new Date("2026-10-17T19:00:00Z"),
    endDatetime: new Date("2026-10-17T21:30:00Z") as Date | null,
    overriddenFields: [] as string[],
    adminUnpublishReason: null,
  };

  // Exactly what AddEventFromUrl.tsx posts for an event: the whole editor,
  // with dates round-tripped through a minute-precision datetime-local input.
  function addEventFromUrlPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: storedEvent.title,
      description: storedEvent.description,
      artists: [...storedEvent.artists],
      primaryGenre: storedEvent.primaryGenre,
      officialEventUrl: storedEvent.officialEventUrl,
      ticketUrl: storedEvent.ticketUrl,
      residentAdvisorUrl: null,
      startDatetime: new Date(storedEvent.startDatetime),
      endDatetime: storedEvent.endDatetime ? new Date(storedEvent.endDatetime) : null,
      ...overrides,
    } as Parameters<typeof applyAdminEventEdit>[1];
  }

  function changeLogCall() {
    return insertValuesMock.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null && "fieldsChanged" in (call[0] as object),
    )?.[0] as Record<string, unknown> | undefined;
  }

  it("changed: a full-form save that only edits the artists locks artists alone — start/end/links/genre stay correctable by sync", async () => {
    selectResults = [[{ ...storedEvent }]];

    await applyAdminEventEdit("e-1", addEventFromUrlPayload({ artists: ["DJ Aligator", "Alice Ai"] }));

    const written = updateSetMock.mock.calls[0][0];
    expect(written.artists).toEqual(["DJ Aligator", "Alice Ai"]);
    expect(written.overriddenFields).toEqual(["artists"]);
    for (const untouched of ["title", "description", "startDatetime", "endDatetime", "officialEventUrl", "ticketUrl", "primaryGenre", "subgenres"]) {
      expect(written).not.toHaveProperty(untouched);
    }
    expect(changeLogCall()?.fieldsChanged).toEqual(["artists"]);
  });

  it("cleared: deliberately emptying a stored end time writes null and locks endDatetime, so a sync can't restore it", async () => {
    selectResults = [[{ ...storedEvent }]];

    await applyAdminEventEdit("e-1", addEventFromUrlPayload({ endDatetime: null }));

    const written = updateSetMock.mock.calls[0][0];
    expect(written.endDatetime).toBeNull();
    expect(written.overriddenFields).toEqual(["endDatetime"]);
    expect(changeLogCall()?.note).toBe("cleared: endDatetime");
  });

  it("unchanged: re-saving the untouched form writes nothing and creates no override or change-log row", async () => {
    selectResults = [[{ ...storedEvent }]];

    await applyAdminEventEdit("e-1", addEventFromUrlPayload());

    expect(updateSetMock).not.toHaveBeenCalled();
    expect(changeLogCall()).toBeUndefined();
  });

  it("unchanged: empty-vs-null, surrounding whitespace and a seconds-only timestamp difference are not edits", async () => {
    selectResults = [[{ ...storedEvent, startDatetime: new Date("2026-10-17T19:00:42Z") }]];

    await applyAdminEventEdit(
      "e-1",
      addEventFromUrlPayload({ title: `  ${storedEvent.title} `, residentAdvisorUrl: "", startDatetime: new Date("2026-10-17T19:00:00Z") }),
    );

    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("existing overrides are kept: a stored lock on an untouched field survives a save that changes another field", async () => {
    selectResults = [[{ ...storedEvent, overriddenFields: ["ticketUrl", "startDatetime"] }]];

    await applyAdminEventEdit("e-1", addEventFromUrlPayload({ title: "The Final Reptile Rave – HELL" }));

    const written = updateSetMock.mock.calls[0][0];
    expect(written.overriddenFields).toEqual(["ticketUrl", "startDatetime", "title"]);
    expect(written).not.toHaveProperty("ticketUrl");
    expect(written).not.toHaveProperty("startDatetime");
  });

  it("a genre edit still derives subgenres, and an unchanged genre on a full-form save derives nothing", async () => {
    selectResults = [[{ ...storedEvent }]];
    await applyAdminEventEdit("e-1", addEventFromUrlPayload({ primaryGenre: "hard-techno" }));
    expect(updateSetMock.mock.calls[0][0]).toMatchObject({ primaryGenre: "hard-techno", subgenres: ["hard-techno"] });
    expect(updateSetMock.mock.calls[0][0].overriddenFields).toEqual(["primaryGenre"]);
  });

  // Exactly what DiscoveryQueue.tsx "Save edit" posts: every editor field.
  const storedDq = {
    id: "dq-1",
    status: "pending",
    probableTitle: "MIAW",
    description: "On October 17, the cats are heading underground again.",
    probableVenueName: "Den Anden Side",
    probableSubVenue: null as string | null,
    detectedLineup: ["Liad Krispin", "Alegrando"],
    predictedGenre: "techno",
    predictedSecondaryGenre: null as string | null,
    probableOfficialEventUrl: "https://www.facebook.com/events/1092481703484520",
    probableTicketUrl: null as string | null,
    probableResidentAdvisorUrl: null as string | null,
    probableFree: false,
    probableStart: new Date("2026-10-17T21:59:00Z"),
    probableEnd: new Date("2026-10-18T06:00:00Z") as Date | null,
    missingFields: [] as string[],
    overriddenFields: [] as string[],
  };

  function dqSaveEditPayload(overrides: Record<string, unknown> = {}) {
    return {
      probableTitle: storedDq.probableTitle,
      description: storedDq.description,
      probableVenueName: storedDq.probableVenueName,
      probableSubVenue: null,
      detectedLineup: [...storedDq.detectedLineup],
      predictedGenre: storedDq.predictedGenre,
      predictedSecondaryGenre: null,
      probableOfficialEventUrl: storedDq.probableOfficialEventUrl,
      probableTicketUrl: null,
      probableResidentAdvisorUrl: null,
      probableFree: false,
      probableStart: new Date(storedDq.probableStart),
      probableEnd: storedDq.probableEnd ? new Date(storedDq.probableEnd) : null,
      ...overrides,
    } as Parameters<typeof updateDiscoveryItem>[1];
  }

  it("DQ changed: a full 'Save edit' that only fixes the lineup locks detectedLineup alone", async () => {
    selectResults = [[{ ...storedDq }]];

    await updateDiscoveryItem("dq-1", dqSaveEditPayload({ detectedLineup: ["Liad Krispin", "Alegrando", "Britney Speed"] }));

    const written = updateSetMock.mock.calls[0][0];
    expect(written.overriddenFields).toEqual(["detectedLineup"]);
    expect(written.detectedLineup).toEqual(["Liad Krispin", "Alegrando", "Britney Speed"]);
    expect(written).not.toHaveProperty("probableStart");
    expect(written).not.toHaveProperty("description");
  });

  it("DQ cleared: emptying a stored description and end time locks exactly those fields", async () => {
    selectResults = [[{ ...storedDq }]];

    await updateDiscoveryItem("dq-1", dqSaveEditPayload({ description: null, probableEnd: null }));

    const written = updateSetMock.mock.calls[0][0];
    expect(written.description).toBeNull();
    expect(written.probableEnd).toBeNull();
    expect(written.overriddenFields).toEqual(["description", "probableEnd"]);
  });

  it("DQ unchanged: an untouched 'Save edit' adds no override, and existing ones are kept", async () => {
    selectResults = [[{ ...storedDq, overriddenFields: ["predictedGenre"] }]];

    await updateDiscoveryItem("dq-1", dqSaveEditPayload());

    expect(updateSetMock.mock.calls[0][0].overriddenFields).toEqual(["predictedGenre"]);
  });

  it("DQ publish: only the fields actually changed at review become overrides on the published event", async () => {
    selectResults = [[{ ...storedDq }]];
    await updateDiscoveryItem("dq-1", dqSaveEditPayload({ probableTitle: "MIAW: Liad Krispin" }));
    const dqOverrides = updateSetMock.mock.calls[0][0].overriddenFields as string[];
    expect(dqOverrides).toEqual(["probableTitle"]);

    selectResults = [[{ ...storedDq, probableTitle: "MIAW: Liad Krispin", overriddenFields: dqOverrides, sourceId: "src-hvaderpaa", sourceUrl: "https://hvaderpaa.dk/da/event/27047/", suspectedDuplicateOfEventId: null, genreConfidence: "medium", overallConfidence: "medium" }]];
    await publishDiscoveryItem("dq-1", "v-den-anden-side");

    const inserted = insertValuesMock.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null && "slug" in (call[0] as object),
    )?.[0] as Record<string, unknown>;
    expect(inserted.overriddenFields).toEqual(["title"]);
  });
});

describe("Discovery Queue publish → later sync: only real review edits stay protected (editorial screening, priority 1 — integration)", () => {
  // A HvadErPå-style pending row as the sync left it.
  const pendingRow = {
    id: "dq-int",
    status: "pending",
    probableTitle: "MIAW",
    description: "On October 17, the cats are heading underground again.",
    probableVenueName: "Den Anden Side",
    probableSubVenue: null as string | null,
    detectedLineup: ["Liad Krispin", "Alegrando"],
    predictedGenre: "techno",
    predictedSecondaryGenre: null as string | null,
    genreConfidence: "medium",
    overallConfidence: "medium",
    probableOfficialEventUrl: "https://www.facebook.com/events/1092481703484520" as string | null,
    probableTicketUrl: "https://billetto.dk/e/miaw-1" as string | null,
    probableResidentAdvisorUrl: null as string | null,
    probableFree: false,
    probableStart: new Date("2026-10-17T21:59:00Z"),
    probableEnd: new Date("2026-10-18T06:00:00Z") as Date | null,
    missingFields: [] as string[],
    overriddenFields: [] as string[],
    sourceId: "src-hvaderpaa",
    sourceUrl: "https://hvaderpaa.dk/da/event/27047/",
    suspectedDuplicateOfEventId: null,
  };

  // DiscoveryQueue.tsx "Save edit": the whole editor, dates via datetime-local.
  function saveEditPayload(row: typeof pendingRow, overrides: Record<string, unknown> = {}) {
    return {
      probableTitle: row.probableTitle,
      description: row.description,
      probableVenueName: row.probableVenueName,
      probableSubVenue: null,
      detectedLineup: [...row.detectedLineup],
      predictedGenre: row.predictedGenre,
      predictedSecondaryGenre: null,
      probableOfficialEventUrl: row.probableOfficialEventUrl,
      probableTicketUrl: row.probableTicketUrl,
      probableResidentAdvisorUrl: null,
      probableFree: false,
      probableStart: new Date(row.probableStart),
      probableEnd: row.probableEnd ? new Date(row.probableEnd) : null,
      ...overrides,
    } as Parameters<typeof updateDiscoveryItem>[1];
  }

  /** Runs save-edit → publish, then returns the stored event row the publish inserted. */
  async function saveAndPublish(overrides: Record<string, unknown>) {
    selectResults = [[{ ...pendingRow }]];
    await updateDiscoveryItem("dq-int", saveEditPayload(pendingRow, overrides));
    const dqWrite = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    const rowAfterEdit = { ...pendingRow, ...dqWrite };

    selectResults = [[rowAfterEdit]];
    await publishDiscoveryItem("dq-int", "v-den-anden-side");
    const inserted = insertValuesMock.mock.calls.find(
      (call) => typeof call[0] === "object" && call[0] !== null && "slug" in (call[0] as object),
    )?.[0] as Record<string, unknown>;
    updateSetMock.mockClear();
    insertValuesMock.mockClear();
    return inserted;
  }

  /** The source's next run reports a corrected start, lineup and links. */
  async function syncCorrection(storedEvent: Record<string, unknown>) {
    const raw = {
      sourceId: "src-hvaderpaa",
      title: storedEvent.title as string,
      description: null,
      startDatetime: "2026-10-17T22:00:00.000Z",
      endDatetime: null,
      officialEventUrl: "https://www.facebook.com/events/2222222222",
      ticketUrl: "https://billetto.dk/e/miaw-2",
      facebookUrl: null,
      residentAdvisorUrl: "https://ra.co/events/2546637",
      imageUrl: null,
      soldOutHint: null,
      cancelledHint: null,
    } as unknown as Parameters<typeof buildSyncPatch>[0];
    const existing = {
      ...storedEvent,
      startDatetime: (storedEvent.startDatetime as Date).toISOString(),
      endDatetime: storedEvent.endDatetime ? (storedEvent.endDatetime as Date).toISOString() : null,
      soldOut: false,
      cancelled: false,
      postponed: false,
    } as unknown as Parameters<typeof buildSyncPatch>[2];
    const { patch } = buildSyncPatch(
      raw,
      { resolvedVenueId: "v-den-anden-side", normalizedArtists: ["Liad Krispin", "Alegrando", "Bonni X"], genre: null, genreConfidence: "low" },
      existing,
    );
    selectResults = [[{ ...storedEvent }]];
    return applySourceSyncPatch(storedEvent.id as string, "src-hvaderpaa", patch);
  }

  it("published with no field changes: the event gets no overrides, and the next sync updates start, artists and event links", async () => {
    const event = await saveAndPublish({});
    expect(event.overriddenFields).toEqual([]);

    const result = await syncCorrection(event);

    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(
      expect.arrayContaining(["startDatetime", "artists", "officialEventUrl", "ticketUrl", "residentAdvisorUrl"]),
    );
    const written = updateSetMock.mock.calls[0][0];
    expect(written.startDatetime).toEqual(new Date("2026-10-17T22:00:00.000Z"));
    expect(written.artists).toEqual(["Liad Krispin", "Alegrando", "Bonni X"]);
    expect(written.ticketUrl).toBe("https://billetto.dk/e/miaw-2");
  });

  it("deliberately changed and cleared fields stay protected through publish and the next sync; untouched ones still update", async () => {
    const event = await saveAndPublish({
      detectedLineup: ["Liad Krispin", "Alegrando", "Britney Speed"], // changed
      probableTicketUrl: null, // cleared
    });
    expect(event.overriddenFields).toEqual(["ticketUrl", "artists"]);
    expect(event.artists).toEqual(["Liad Krispin", "Alegrando", "Britney Speed"]);
    expect(event.ticketUrl).toBeNull();

    const result = await syncCorrection(event);

    expect(result.skipped).toEqual(expect.arrayContaining(["artists", "ticketUrl"]));
    expect(result.applied).toEqual(expect.arrayContaining(["startDatetime", "officialEventUrl", "residentAdvisorUrl"]));
    const written = updateSetMock.mock.calls[0][0];
    expect(written).not.toHaveProperty("artists");
    expect(written).not.toHaveProperty("ticketUrl");
    expect(written.startDatetime).toEqual(new Date("2026-10-17T22:00:00.000Z"));
  });
});

describe("admin saves — end/start check on the values actually stored (editorial screening, priority 1)", () => {
  it("rejects a new end that falls before the stored start, even when the form re-submits the start rounded to the minute", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-10-17T19:00:42Z"), endDatetime: null }]];

    await expect(
      applyAdminEventEdit("e-1", {
        startDatetime: new Date("2026-10-17T19:00:00Z"),
        endDatetime: new Date("2026-10-17T19:00:30Z"),
      }),
    ).rejects.toThrow(END_BEFORE_START_ERROR);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("an untouched re-save of an already malformed row neither throws nor writes (the check only runs on a real start/end change)", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-10-16T20:00:00Z"), endDatetime: new Date("2026-10-16T03:00:00Z") }]];

    await applyAdminEventEdit("e-1", {
      startDatetime: new Date("2026-10-16T20:00:00Z"),
      endDatetime: new Date("2026-10-16T03:00:00Z"),
    });

    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("a script-supplied start with its own seconds is a real change, not rounded away", async () => {
    selectResults = [[{ id: "e-1", overriddenFields: [], startDatetime: new Date("2026-10-17T19:00:00Z"), endDatetime: null }]];

    await applyAdminEventEdit("e-1", { startDatetime: new Date("2026-10-17T19:00:30Z") });

    expect(updateSetMock.mock.calls[0][0].overriddenFields).toEqual(["startDatetime"]);
  });
});

describe("applySourceSyncPatch — a locked start keeps the stored status (editorial screening, Gap B)", () => {
  beforeEach(() => {
    updateSetMock.mockClear();
    insertValuesMock.mockClear();
  });

  const stored = { id: "e-locked", overriddenFields: ["startDatetime"], postponed: true, dateChanged: false, timeChanged: false };
  const proposed = {
    startDatetime: new Date("2026-11-20T21:00:00.000Z"),
    dateChanged: true,
    postponed: false,
    cancelled: true,
    title: "Source title",
  };

  it("writes neither the blocked start nor its derived flags, but keeps independent changes", async () => {
    selectResults = [[{ ...stored }]];

    const result = await applySourceSyncPatch("e-locked", "src-pumpehuset", proposed);

    const written = updateSetMock.mock.calls[0][0];
    expect(written).not.toHaveProperty("startDatetime");
    expect(written).not.toHaveProperty("dateChanged");
    expect(written).not.toHaveProperty("postponed");
    expect(written.cancelled).toBe(true);
    expect(written.title).toBe("Source title");
    expect(result.applied).toEqual(["cancelled", "title"]);
    expect(result.heldBack).toEqual(["dateChanged", "postponed"]);
  });

  it("logs the lock and the held-back flags by field name only", async () => {
    selectResults = [[{ ...stored }]];

    await applySourceSyncPatch("e-locked", "src-pumpehuset", proposed);

    const log = insertValuesMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(log.fieldsChanged).toEqual(["cancelled", "title"]);
    expect(log.note).toBe("skipped manually-overridden fields: startDatetime; held back with the blocked start: dateChanged, postponed");
  });

  it("with only start-derived changes proposed, touches nothing but lastSourceCheck", async () => {
    selectResults = [[{ ...stored }]];

    await applySourceSyncPatch("e-locked", "src-pumpehuset", { startDatetime: proposed.startDatetime, dateChanged: true, postponed: false });

    expect(Object.keys(updateSetMock.mock.calls[0][0])).toEqual(["lastSourceCheck"]);
  });

  it("an unlocked start still writes the start and its flags", async () => {
    selectResults = [[{ ...stored, overriddenFields: [] }]];

    const result = await applySourceSyncPatch("e-locked", "src-pumpehuset", proposed);

    const written = updateSetMock.mock.calls[0][0];
    expect(written.startDatetime).toEqual(proposed.startDatetime);
    expect(written.dateChanged).toBe(true);
    expect(written.postponed).toBe(false);
    expect(result.heldBack).toEqual([]);
  });
});
