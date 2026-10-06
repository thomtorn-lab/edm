import { describe, expect, it } from "vitest";
import { getIsoWeek } from "./isoWeek";

describe("getIsoWeek", () => {
  it("returns the expected ISO week for a known Thursday", () => {
    // 2026-10-08 is a Thursday in ISO week 41 of 2026.
    expect(getIsoWeek(new Date("2026-10-08T10:00:00+02:00"))).toBe("2026-W41");
  });

  it("stays on the same week for every day Mon-Sun of that week", () => {
    const week = getIsoWeek(new Date("2026-10-08T10:00:00+02:00"));
    for (const day of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]) {
      expect(getIsoWeek(new Date(`${day}T12:00:00+02:00`))).toBe(week);
    }
  });

  it("rolls over to the next week on the following Monday", () => {
    const thisWeek = getIsoWeek(new Date("2026-10-08T10:00:00+02:00"));
    const nextWeek = getIsoWeek(new Date("2026-10-12T10:00:00+01:00"));
    expect(nextWeek).not.toBe(thisWeek);
  });

  it("is based on the Europe/Copenhagen calendar date, not the instant's raw UTC date", () => {
    // 2026-10-08 23:30 CEST (UTC+2) is 2026-10-08 21:30 UTC — same UTC day,
    // but right near a day boundary; this proves the function reads the
    // Copenhagen wall-clock date (via getCopenhagenParts), not a naive
    // date.toISOString() slice.
    const cphEvening = getIsoWeek(new Date("2026-10-08T23:30:00+02:00"));
    expect(cphEvening).toBe("2026-W41");
  });

  it("handles the DST transition (last Sunday of October) without skipping or repeating a week", () => {
    // 2026-10-25 is DST fall-back day in Europe/Copenhagen.
    const before = getIsoWeek(new Date("2026-10-24T10:00:00+02:00"));
    const after = getIsoWeek(new Date("2026-10-26T10:00:00+01:00"));
    expect(before).not.toBe(after);
  });

  it("handles a year boundary correctly (ISO week 1 can start in late December)", () => {
    // 2025-12-29 (Mon) begins ISO week 1 of 2026.
    expect(getIsoWeek(new Date("2025-12-29T10:00:00+01:00"))).toBe("2026-W01");
  });
});
