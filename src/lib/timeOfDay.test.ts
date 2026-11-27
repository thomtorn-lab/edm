import { describe, expect, it } from "vitest";
import { TIME_OF_DAY_PERIODS, matchesTimeOfDay, parseTimeOfDayList, type TimeOfDayPeriod } from "./timeOfDay";

/** Which of the five periods an event matches, each tested on its own. */
function periods(startDatetime: string, endDatetime: string | null): TimeOfDayPeriod[] {
  return TIME_OF_DAY_PERIODS.filter((p) => matchesTimeOfDay({ startDatetime, endDatetime }, [p]));
}

describe("matchesTimeOfDay — known end time: every overlapped period", () => {
  it("23:59 -> 08:00 is Evening, Night and Early Morning", () => {
    // January: Copenhagen is UTC+1.
    expect(periods("2026-01-16T22:59:00Z", "2026-01-17T07:00:00Z")).toEqual(["early-morning", "evening", "night"]);
  });

  it("20:00 -> 02:00 is Evening and Night", () => {
    expect(periods("2026-01-16T19:00:00Z", "2026-01-17T01:00:00Z")).toEqual(["evening", "night"]);
  });

  it("is half-open: ending exactly 18:00 is not Evening, starting exactly 18:00 is", () => {
    expect(periods("2026-01-16T11:00:00Z", "2026-01-16T17:00:00Z")).toEqual(["afternoon"]);
    expect(periods("2026-01-16T17:00:00Z", "2026-01-16T20:00:00Z")).toEqual(["evening"]);
  });

  it("a multi-day festival matches every period", () => {
    expect(periods("2026-06-12T12:00:00Z", "2026-06-14T21:00:00Z")).toEqual([...TIME_OF_DAY_PERIODS]);
  });

  it("an all-day event spanning two dates matches its daytime periods on both", () => {
    // Fri 10:00 -> Sat 11:00 (summer, UTC+2): every period.
    expect(periods("2026-06-12T08:00:00Z", "2026-06-13T09:00:00Z")).toEqual([...TIME_OF_DAY_PERIODS]);
  });

  it("uses Copenhagen time across the spring DST change (29 Mar 2026)", () => {
    // Sat 22:00 CET -> Sun 06:00 CEST: ends exactly at 06:00 local, so not Early Morning.
    expect(periods("2026-03-28T21:00:00Z", "2026-03-29T04:00:00Z")).toEqual(["evening", "night"]);
    // ... and 06:30 CEST does reach Early Morning.
    expect(periods("2026-03-28T21:00:00Z", "2026-03-29T04:30:00Z")).toEqual(["early-morning", "evening", "night"]);
  });

  it("uses Copenhagen time across the autumn DST change (25 Oct 2026)", () => {
    // Sat 23:00 CEST -> Sun 06:00 CET.
    expect(periods("2026-10-24T21:00:00Z", "2026-10-25T05:00:00Z")).toEqual(["evening", "night"]);
  });
});

describe("matchesTimeOfDay — missing or invalid end time: only the start period", () => {
  it("does not assume the 06:00-next-morning fallback", () => {
    expect(periods("2026-01-16T14:00:00Z", null)).toEqual(["afternoon"]); // 15:00
    expect(periods("2026-01-16T22:00:00Z", null)).toEqual(["evening"]); // 23:00
    expect(periods("2026-01-17T00:30:00Z", null)).toEqual(["night"]); // 01:30
  });

  it("puts a start exactly on a boundary in the later period", () => {
    expect(periods("2026-01-16T05:00:00Z", null)).toEqual(["early-morning"]); // 06:00
    expect(periods("2026-01-16T23:00:00Z", null)).toEqual(["night"]); // 00:00
  });

  it("treats an end at or before the start as missing", () => {
    expect(periods("2026-01-16T22:00:00Z", "2026-01-16T03:00:00Z")).toEqual(["evening"]);
    expect(periods("2026-01-16T22:00:00Z", "2026-01-16T22:00:00Z")).toEqual(["evening"]);
  });
});

describe("matchesTimeOfDay — selection", () => {
  it("no selection matches everything; several periods match if any one does", () => {
    const event = { startDatetime: "2026-01-16T14:00:00Z", endDatetime: null };
    expect(matchesTimeOfDay(event, [])).toBe(true);
    expect(matchesTimeOfDay(event, ["night", "afternoon"])).toBe(true);
    expect(matchesTimeOfDay(event, ["night", "evening"])).toBe(false);
  });

  it("parses a comma list in canonical order and ignores unknown values", () => {
    expect(parseTimeOfDayList("night,bogus,evening")).toEqual(["evening", "night"]);
    expect(parseTimeOfDayList(null)).toEqual([]);
  });
});
