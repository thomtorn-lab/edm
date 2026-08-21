import { describe, expect, it } from "vitest";
import { formatTimeRangeLabel } from "./format";

describe("formatTimeRangeLabel — overnight display (frontend polish, Round 7)", () => {
  it("shows a plain start–end range with no '+1' annotation when the event crosses midnight", () => {
    // 22:00 CEST -> 06:00 CEST next day (20:00Z -> 04:00Z next day).
    const label = formatTimeRangeLabel({
      startDatetime: "2026-08-10T20:00:00.000Z",
      endDatetime: "2026-08-11T04:00:00.000Z",
    });
    expect(label).toBe("22:00–06:00");
    expect(label).not.toContain("+1");
  });

  it("shows a plain start–end range for a same-day event too", () => {
    const label = formatTimeRangeLabel({
      startDatetime: "2026-08-10T18:00:00.000Z",
      endDatetime: "2026-08-10T20:00:00.000Z",
    });
    expect(label).toBe("20:00–22:00");
  });

  it("shows only the start time when there is no end time", () => {
    const label = formatTimeRangeLabel({
      startDatetime: "2026-08-10T20:00:00.000Z",
      endDatetime: null,
    });
    expect(label).toBe("22:00");
  });

  it("never mutates the underlying event's stored datetime strings", () => {
    const event = { startDatetime: "2026-08-10T20:00:00.000Z", endDatetime: "2026-08-11T04:00:00.000Z" };
    const before = { ...event };
    formatTimeRangeLabel(event);
    expect(event).toEqual(before);
  });
});
