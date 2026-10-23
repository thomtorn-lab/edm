import { describe, expect, it } from "vitest";
import { buildDqLegacyLockReport, eventFieldsLockedOnPublish, mappedGroupCount, PUBLISH_MAPPED_GROUPS, type DqLockRow } from "./dqLegacyLocks";

const FULL = ["probableTitle", "description", "probableVenueName", "probableSubVenue", "detectedLineup", "predictedGenre", "predictedSecondaryGenre", "probableOfficialEventUrl", "probableTicketUrl", "probableResidentAdvisorUrl", "probableFree", "probableStart", "probableEnd"];
const NOW = new Date("2026-10-18T12:00:00Z");
function row(id: string, o: Partial<DqLockRow> = {}): DqLockRow {
  return { id, sourceId: "src-pumpehuset", overriddenFields: [], probableStart: new Date("2026-11-01T19:00:00Z"), lastSeenAt: new Date("2026-10-18T05:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z"), ...o };
}

describe("dq legacy lock pattern", () => {
  it("the pre-#151 full DQ save maps to all 12 event fields", () => {
    expect(mappedGroupCount(FULL)).toBe(PUBLISH_MAPPED_GROUPS.length);
    expect(eventFieldsLockedOnPublish(FULL)).toBe(12);
    expect(eventFieldsLockedOnPublish(["detectedLineup"])).toBe(1);
    expect(eventFieldsLockedOnPublish(["predictedGenre", "predictedSecondaryGenre"])).toBe(2);
    expect(eventFieldsLockedOnPublish(["probableFree"])).toBe(0);
  });

  it("counts full/partial patterns, publishable and current rows, and creation before/after #151", () => {
    const report = buildDqLegacyLockReport(
      [
        row("dq-full-live", { overriddenFields: FULL }),
        row("dq-full-past", { overriddenFields: FULL, probableStart: new Date("2026-10-01T19:00:00Z") }),
        row("dq-full-stale", { overriddenFields: FULL, lastSeenAt: new Date("2026-09-01T00:00:00Z") }),
        row("dq-full-admin", { overriddenFields: FULL.filter((k) => k !== "probableFree" && k !== "predictedSecondaryGenre"), sourceId: null, lastSeenAt: null }),
        row("dq-partial-new", { overriddenFields: ["detectedLineup"], createdAt: new Date("2026-10-18T09:00:00Z") }),
        row("dq-none"),
      ],
      NOW,
    );
    expect(report.pendingRows).toBe(6);
    expect(report.fullPattern).toMatchObject({ rows: 4, publishable: 3, publishableAndCurrent: 2, withFullFormMarker: 3, createdBeforePr151: 4, createdAfterPr151: 0 });
    expect(report.fullPattern.publishableIds.ids).toEqual(["dq-full-admin", "dq-full-live", "dq-full-stale"]);
    expect(report.partialPattern).toEqual({ rows: 1, publishable: 1, createdAfterPr151: 1 });
    expect(report.byEventFieldsLocked).toEqual([
      { eventFields: 0, rows: 1 },
      { eventFields: 1, rows: 1 },
      { eventFields: 12, rows: 4 },
    ]);
    expect(report.fullPattern.bySource).toEqual([
      { source: "src-pumpehuset", rows: 3, publishable: 2 },
      { source: "(admin: Add event from URL)", rows: 1, publishable: 1 },
    ]);
  });
});
