import { describe, expect, it } from "vitest";
import { buildOverrideScopeReport, EVENT_ID_LIST_CAP, NO_CANONICAL_SOURCE, type OverrideScopeEventRow } from "./overrideScope";

function row(id: string, overrides: Partial<OverrideScopeEventRow> = {}): OverrideScopeEventRow {
  return {
    id,
    canonicalSourceId: "src-pumpehuset",
    overriddenFields: [],
    linkedSourceIds: ["src-pumpehuset"],
    recentlySyncingSourceIds: [],
    createdBy: "src-pumpehuset",
    adminLoggedFields: [],
    ...overrides,
  };
}

const ALL_CORE = ["title", "description", "artists", "startDatetime", "venueId", "primaryGenre"];

describe("buildOverrideScopeReport", () => {
  it("counts events with a lock, locks per field, and all-core-locked events", () => {
    const report = buildOverrideScopeReport([
      row("e-free"),
      row("e-one", { overriddenFields: ["artists"], adminLoggedFields: ["artists"] }),
      row("e-all", { canonicalSourceId: null, createdBy: "admin", linkedSourceIds: [], overriddenFields: [...ALL_CORE, "endDatetime"] }),
    ]);

    expect(report.upcomingPublishedEvents).toBe(3);
    expect(report.withAnyLock).toEqual({ count: 2, eventIds: ["e-all", "e-one"], truncated: false });
    expect(report.allCoreContentLocked.eventIds).toEqual(["e-all"]);
    expect(report.lockCountsByField.find((f) => f.field === "artists")).toEqual({
      field: "artists",
      locked: 2,
      documentedByAdminEdit: 1,
      noLoggedAdminEdit: 1,
    });
    expect(report.lockCountsByField.find((f) => f.field === "endDatetime")?.noLoggedAdminEdit).toBe(1);
  });

  it("splits by canonical source and labels admin-created events", () => {
    const report = buildOverrideScopeReport([
      row("e-1"),
      row("e-2", { overriddenFields: ["title"] }),
      row("e-3", { canonicalSourceId: null, createdBy: "admin-paste", overriddenFields: ALL_CORE }),
    ]);
    expect(report.bySource).toEqual([
      { source: "src-pumpehuset", events: 2, withAnyLock: 1, allCoreContentLocked: 0 },
      { source: NO_CANONICAL_SOURCE, events: 1, withAnyLock: 1, allCoreContentLocked: 1 },
    ]);
    expect(report.lockedEventsByCreator).toEqual([
      { createdBy: "admin-paste", events: 1 },
      { createdBy: "src-pumpehuset", events: 1 },
    ]);
  });

  it("counts events matched by two or more distinct sources across links and recent syncs", () => {
    const report = buildOverrideScopeReport([
      row("e-single", { recentlySyncingSourceIds: ["src-pumpehuset"] }),
      row("e-two", { recentlySyncingSourceIds: ["src-kultunaut"], overriddenFields: ["startDatetime"] }),
      row("e-two-links", { linkedSourceIds: ["src-pumpehuset", "src-hvaderpaa"] }),
    ]);
    expect(report.multipleSources).toEqual({ count: 2, eventIds: ["e-two", "e-two-links"], truncated: false, withAnyLock: 1 });
  });

  it("caps every event-id list", () => {
    const rows = Array.from({ length: EVENT_ID_LIST_CAP + 5 }, (_, i) => row(`e-${String(i).padStart(3, "0")}`, { overriddenFields: ALL_CORE }));
    const report = buildOverrideScopeReport(rows);
    expect(report.allCoreContentLocked.count).toBe(EVENT_ID_LIST_CAP + 5);
    expect(report.allCoreContentLocked.eventIds).toHaveLength(EVENT_ID_LIST_CAP);
    expect(report.allCoreContentLocked.truncated).toBe(true);
  });

  it("returns an empty, well-formed report for no events", () => {
    const report = buildOverrideScopeReport([]);
    expect(report.upcomingPublishedEvents).toBe(0);
    expect(report.withAnyLock.count).toBe(0);
    expect(report.lockCountsByField).toEqual([]);
  });
});
