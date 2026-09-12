import { describe, expect, it } from "vitest";
import { formatFullDateRangeLabel, formatRowDateRangeLabel, formatTimeRangeLabel } from "./format";

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

describe("formatRowDateRangeLabel — multi-day event date-range display", () => {
  it("shows a single date for a same-day event", () => {
    // 20:00 -> 23:00 CEST, both 2026-08-10.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-08-10T18:00:00.000Z",
      endDatetime: "2026-08-10T21:00:00.000Z",
    });
    expect(label).toBe("MON 10 AUG");
  });

  it("shows a full range for an overnight event ending the next calendar day", () => {
    // Fri 9 Oct 22:00 CEST -> Sat 10 Oct 06:00 CEST.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: "2026-10-10T04:00:00.000Z",
    });
    expect(label).toBe("FRI 9 OCT – SAT 10 OCT");
  });

  it("shows the true final calendar date for an event spanning three days", () => {
    // Fri 9 Oct 22:00 CEST -> Sun 11 Oct 05:00 CEST (a real ~31h festival shape).
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: "2026-10-11T03:00:00.000Z",
    });
    expect(label).toBe("FRI 9 OCT – SUN 11 OCT");
  });

  it("falls back to a single date when there is no end datetime — never invents an end date", () => {
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: null,
    });
    expect(label).toBe("FRI 9 OCT");
  });

  it("handles a month boundary", () => {
    // Fri 30 Oct 23:00 CET -> Sat 31 Oct... actually crossing into November.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-31T21:00:00.000Z", // 2026-10-31 22:00 CET (DST already ended)
      endDatetime: "2026-11-01T04:00:00.000Z", // 2026-11-01 05:00 CET
    });
    expect(label).toBe("SAT 31 OCT – SUN 1 NOV");
  });

  it("handles a year boundary (New Year's Eve into New Year's Day)", () => {
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-12-31T22:00:00.000Z", // 2026-12-31 23:00 CET
      endDatetime: "2027-01-01T04:00:00.000Z", // 2027-01-01 05:00 CET
    });
    expect(label).toBe("THU 31 DEC – FRI 1 JAN");
  });

  it("Copenhagen-local edge case: same UTC calendar day, but CPH's +2 DST offset already puts it on the next CPH day — still shown as a range", () => {
    // 23:00Z is 01:00 CEST the *next* day; 02:00Z next day is 04:00 CEST, same CPH day as the start.
    // Both UTC-day-adjacent-looking timestamps land on the SAME UTC date pairing being irrelevant —
    // the point is the CPH day already rolled over relative to the UTC date of the start instant.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-08-10T22:00:00.000Z", // 2026-08-11 00:00 CEST — already the next CPH day
      endDatetime: "2026-08-11T02:00:00.000Z", // 2026-08-11 04:00 CEST — same CPH day as start
    });
    // Both instants share the SAME Copenhagen calendar date (11 Aug) despite the start's UTC
    // timestamp reading "10 Aug" — a UTC-naive comparison would wrongly see two different UTC
    // dates here and call it a range; the correct CPH-local comparison shows a single date.
    expect(label).toBe("TUE 11 AUG");
  });

  it("Copenhagen-local edge case: same UTC calendar day, but CPH midnight crossing makes it a genuine multi-day range", () => {
    // A classic Friday-night-into-Saturday-morning club night that never leaves a single UTC date.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-08-14T21:00:00.000Z", // 2026-08-14 23:00 CEST (Friday)
      endDatetime: "2026-08-14T23:00:00.000Z", // 2026-08-15 01:00 CEST (Saturday) — same UTC date as start
    });
    expect(label).toBe("FRI 14 AUG – SAT 15 AUG");
  });
});

describe("formatFullDateRangeLabel — multi-day event date-range display (event detail page)", () => {
  it("shows a single full date for a same-day event", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-08-10T18:00:00.000Z",
      endDatetime: "2026-08-10T21:00:00.000Z",
    });
    expect(label).toBe("Monday 10 August 2026");
  });

  it("shows a full date range spanning three calendar days", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: "2026-10-11T03:00:00.000Z",
    });
    expect(label).toBe("Friday 9 October 2026 – Sunday 11 October 2026");
  });

  it("falls back to a single date when there is no end datetime", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: null,
    });
    expect(label).toBe("Friday 9 October 2026");
  });

  it("carries the year across a year-boundary range", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-12-31T22:00:00.000Z",
      endDatetime: "2027-01-01T04:00:00.000Z",
    });
    expect(label).toBe("Thursday 31 December 2026 – Friday 1 January 2027");
  });
});
