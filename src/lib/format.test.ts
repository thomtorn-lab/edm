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

describe("formatRowDateRangeLabel — overnight vs. true multi-day event date display (product rule, 2026-09-12)", () => {
  it("shows a single date for a same-day event", () => {
    // 20:00 -> 23:00 CEST, both 2026-08-10.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-08-10T18:00:00.000Z",
      endDatetime: "2026-08-10T21:00:00.000Z",
    });
    expect(label).toBe("MON 10 AUG");
  });

  it("shows the start date only for a normal overnight event ending the next calendar day — the time range already communicates it runs overnight", () => {
    // Fri 9 Oct 22:00 CEST -> Sat 10 Oct 06:00 CEST.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: "2026-10-10T04:00:00.000Z",
    });
    expect(label).toBe("FRI 9 OCT");
  });

  it("shows a full range exactly at the 2-calendar-day threshold", () => {
    // Fri 9 Oct 22:00 CEST -> Sun 11 Oct 01:00 CEST (2 calendar days later).
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: "2026-10-10T23:00:00.000Z",
    });
    expect(label).toBe("FRI 9 OCT – SUN 11 OCT");
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

  it("handles a month boundary that is only an overnight event — start date only, no range", () => {
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-31T21:00:00.000Z", // 2026-10-31 22:00 CET (DST already ended)
      endDatetime: "2026-11-01T04:00:00.000Z", // 2026-11-01 05:00 CET
    });
    expect(label).toBe("SAT 31 OCT");
  });

  it("handles a genuine multi-day month-boundary range", () => {
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-31T21:00:00.000Z", // 2026-10-31 22:00 CET
      endDatetime: "2026-11-02T04:00:00.000Z", // 2026-11-02 05:00 CET — 2 calendar days later
    });
    expect(label).toBe("SAT 31 OCT – MON 2 NOV");
  });

  it("handles a year boundary that is only an overnight event (New Year's Eve into New Year's Day) — start date only, no range", () => {
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-12-31T22:00:00.000Z", // 2026-12-31 23:00 CET
      endDatetime: "2027-01-01T04:00:00.000Z", // 2027-01-01 05:00 CET
    });
    expect(label).toBe("THU 31 DEC");
  });

  it("handles a genuine multi-day year-boundary range", () => {
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-12-30T22:00:00.000Z", // 2026-12-30 23:00 CET
      endDatetime: "2027-01-01T04:00:00.000Z", // 2027-01-01 05:00 CET — 2 calendar days later
    });
    expect(label).toBe("WED 30 DEC – FRI 1 JAN");
  });

  it("Copenhagen-local edge case: same UTC calendar day, but CPH's +2 DST offset already puts it on the next CPH day — still a single date", () => {
    // 23:00Z is 01:00 CEST the *next* day; 02:00Z next day is 04:00 CEST, same CPH day as the start.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-08-10T22:00:00.000Z", // 2026-08-11 00:00 CEST — already the next CPH day
      endDatetime: "2026-08-11T02:00:00.000Z", // 2026-08-11 04:00 CEST — same CPH day as start
    });
    // Both instants share the SAME Copenhagen calendar date (11 Aug) despite the start's UTC
    // timestamp reading "10 Aug" — a UTC-naive comparison would wrongly see two different UTC
    // dates here; the correct CPH-local comparison shows a single date.
    expect(label).toBe("TUE 11 AUG");
  });

  it("Copenhagen-local edge case: same UTC calendar day, but CPH midnight crossing — still just an overnight event, single date only", () => {
    // A classic Friday-night-into-Saturday-morning club night that never leaves a single UTC date.
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-08-14T21:00:00.000Z", // 2026-08-14 23:00 CEST (Friday)
      endDatetime: "2026-08-14T23:00:00.000Z", // 2026-08-15 01:00 CEST (Saturday) — same UTC date as start
    });
    expect(label).toBe("FRI 14 AUG");
  });

  it("DST fall-back trap: elapsed real time is 35h (would floor to 1 day under a naive duration/24 check) but the true Copenhagen calendar-day span is 2 — shows the full range", () => {
    // Fri 23 Oct 22:00 CEST -> Sun 25 Oct 08:00 CET, spanning Denmark's DST fall-back
    // (03:00 CEST -> 02:00 CET overnight 24->25 Oct 2026).
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-10-23T20:00:00.000Z",
      endDatetime: "2026-10-25T07:00:00.000Z",
    });
    expect(label).toBe("FRI 23 OCT – SUN 25 OCT");
  });

  it("DST spring-forward overnight event loses an hour (7h elapsed) but still spans only 1 calendar day — single date, not a range", () => {
    // Sat 28 Mar 22:00 CET -> Sun 29 Mar 06:00 CEST, spanning Denmark's DST spring-forward
    // (02:00 -> 03:00 overnight 28->29 Mar 2026).
    const label = formatRowDateRangeLabel({
      startDatetime: "2026-03-28T21:00:00.000Z",
      endDatetime: "2026-03-29T04:00:00.000Z",
    });
    expect(label).toBe("SAT 28 MAR");
  });
});

describe("formatFullDateRangeLabel — overnight vs. true multi-day event date display (event detail page, product rule 2026-09-12)", () => {
  it("shows a single full date for a same-day event", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-08-10T18:00:00.000Z",
      endDatetime: "2026-08-10T21:00:00.000Z",
    });
    expect(label).toBe("Monday 10 August 2026");
  });

  it("shows the start date only for a normal overnight event ending the next calendar day", () => {
    // Fri 9 Oct 22:00 CEST -> Sat 10 Oct 06:00 CEST.
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-10-09T20:00:00.000Z",
      endDatetime: "2026-10-10T04:00:00.000Z",
    });
    expect(label).toBe("Friday 9 October 2026");
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

  it("shows only the start date for a year-boundary event that is merely overnight (New Year's Eve into New Year's Day)", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-12-31T22:00:00.000Z",
      endDatetime: "2027-01-01T04:00:00.000Z",
    });
    expect(label).toBe("Thursday 31 December 2026");
  });

  it("carries the year across a genuine multi-day year-boundary range", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-12-30T22:00:00.000Z",
      endDatetime: "2027-01-01T04:00:00.000Z",
    });
    expect(label).toBe("Wednesday 30 December 2026 – Friday 1 January 2027");
  });

  it("DST fall-back trap: 35h elapsed (would floor to 1 day under a naive duration check) but the true Copenhagen calendar-day span is 2 — shows the full range", () => {
    const label = formatFullDateRangeLabel({
      startDatetime: "2026-10-23T20:00:00.000Z",
      endDatetime: "2026-10-25T07:00:00.000Z",
    });
    expect(label).toBe("Friday 23 October 2026 – Sunday 25 October 2026");
  });
});
