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

const {
  insertDiscoveryItem,
  adminUnpublishEvent,
  adminRepublishEvent,
  publishDiscoveryItem,
  applyAdminEventEdit,
  applySourceCancellationUnpublish,
  applySourceCancellationRestore,
  adminOverrideSourceCancellation,
} = await import("./writes");

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
    selectResults = [[{ id: "e-1", overriddenFields: [] }]];

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
    selectResults = [[{ id: "e-1", overriddenFields: ["ticketUrl"] }]];

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
