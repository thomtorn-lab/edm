import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  compareDateKeys,
  crossesMidnight,
  effectiveEndInstant,
  groupByMonth,
  isEventInProgress,
  isNextWeekend,
  isPastEvent,
  isThisWeekend,
  isTonight,
  nightlifeDateKey,
  nextWeekendRange,
  sortByStart,
  thisWeekendRange,
  weekdayOfDateKey,
  type NightlifeEvent,
} from "./datetime";

// All fixture times use +02:00 (Danish summer time / CEST).

describe("nightlifeDateKey", () => {
  it("keeps an evening timestamp on its own calendar day", () => {
    const key = nightlifeDateKey(new Date("2026-08-15T23:59:00+02:00"));
    expect(key).toEqual({ year: 2026, month: 8, day: 15 });
  });

  it("rolls a post-midnight, pre-cutoff timestamp back to the previous night", () => {
    const key = nightlifeDateKey(new Date("2026-08-16T02:30:00+02:00"));
    expect(key).toEqual({ year: 2026, month: 8, day: 15 });
  });

  it("treats 06:00 and later as a new day", () => {
    const key = nightlifeDateKey(new Date("2026-08-16T06:00:00+02:00"));
    expect(key).toEqual({ year: 2026, month: 8, day: 16 });
  });

  it("rolls across a month boundary correctly", () => {
    const key = nightlifeDateKey(new Date("2026-09-01T01:00:00+02:00"));
    expect(key).toEqual({ year: 2026, month: 8, day: 31 });
  });

  it("rolls across a year boundary correctly", () => {
    const key = nightlifeDateKey(new Date("2027-01-01T03:00:00+01:00"));
    expect(key).toEqual({ year: 2026, month: 12, day: 31 });
  });
});

describe("isTonight", () => {
  it("matches an event later the same evening", () => {
    const now = new Date("2026-08-15T18:00:00+02:00");
    const event: NightlifeEvent = { startDatetime: "2026-08-15T23:00:00+02:00", endDatetime: null };
    expect(isTonight(event, now)).toBe(true);
  });

  it("still matches an overnight event when checked at 3am (same night)", () => {
    const now = new Date("2026-08-16T03:00:00+02:00");
    const event: NightlifeEvent = { startDatetime: "2026-08-15T23:59:00+02:00", endDatetime: "2026-08-16T06:00:00+02:00" };
    expect(isTonight(event, now)).toBe(true);
  });

  it("matches an event that itself starts after midnight but belongs to tonight's night", () => {
    const now = new Date("2026-08-15T20:00:00+02:00");
    const event: NightlifeEvent = { startDatetime: "2026-08-16T01:00:00+02:00", endDatetime: null };
    expect(isTonight(event, now)).toBe(true);
  });

  it("does not match tomorrow night's event", () => {
    const now = new Date("2026-08-15T18:00:00+02:00");
    const event: NightlifeEvent = { startDatetime: "2026-08-16T23:00:00+02:00", endDatetime: null };
    expect(isTonight(event, now)).toBe(false);
  });

  it("stops matching last night's event once past the 06:00 cutoff", () => {
    const now = new Date("2026-08-16T09:00:00+02:00");
    const event: NightlifeEvent = { startDatetime: "2026-08-15T23:59:00+02:00", endDatetime: "2026-08-16T06:00:00+02:00" };
    expect(isTonight(event, now)).toBe(false);
  });
});

describe("weekend ranges", () => {
  it("computes this-weekend range from a Wednesday as the upcoming Fri-Sun", () => {
    const now = new Date("2026-08-12T12:00:00+02:00"); // Wednesday
    const { friday, sunday } = thisWeekendRange(now);
    expect(friday).toEqual({ year: 2026, month: 8, day: 14 });
    expect(sunday).toEqual({ year: 2026, month: 8, day: 16 });
  });

  it("computes this-weekend range from within Saturday as already-started weekend", () => {
    const now = new Date("2026-08-15T12:00:00+02:00"); // Saturday
    const { friday, sunday } = thisWeekendRange(now);
    expect(friday).toEqual({ year: 2026, month: 8, day: 14 });
    expect(sunday).toEqual({ year: 2026, month: 8, day: 16 });
  });

  it("computes this-weekend range from Sunday correctly", () => {
    const now = new Date("2026-08-16T12:00:00+02:00"); // Sunday
    const { friday, sunday } = thisWeekendRange(now);
    expect(friday).toEqual({ year: 2026, month: 8, day: 14 });
    expect(sunday).toEqual({ year: 2026, month: 8, day: 16 });
  });

  it("next weekend is always 7 days after this weekend", () => {
    const now = new Date("2026-08-12T12:00:00+02:00");
    const { friday } = nextWeekendRange(now);
    expect(friday).toEqual({ year: 2026, month: 8, day: 21 });
  });

  it("isThisWeekend includes a Sunday-night event and excludes a Monday event", () => {
    const now = new Date("2026-08-12T12:00:00+02:00");
    const sundayEvent: NightlifeEvent = { startDatetime: "2026-08-16T22:00:00+02:00", endDatetime: null };
    const mondayEvent: NightlifeEvent = { startDatetime: "2026-08-17T22:00:00+02:00", endDatetime: null };
    expect(isThisWeekend(sundayEvent, now)).toBe(true);
    expect(isThisWeekend(mondayEvent, now)).toBe(false);
  });

  it("isThisWeekend includes an event that starts after midnight on Sunday morning (Sat-night carryover)", () => {
    const now = new Date("2026-08-12T12:00:00+02:00");
    const event: NightlifeEvent = { startDatetime: "2026-08-16T02:00:00+02:00", endDatetime: null };
    expect(isThisWeekend(event, now)).toBe(true);
  });

  it("isNextWeekend does not overlap isThisWeekend", () => {
    const now = new Date("2026-08-12T12:00:00+02:00");
    const event: NightlifeEvent = { startDatetime: "2026-08-21T23:00:00+02:00", endDatetime: null };
    expect(isThisWeekend(event, now)).toBe(false);
    expect(isNextWeekend(event, now)).toBe(true);
  });
});

describe("sorting", () => {
  it("sorts by real start instant, not by nightlife day string", () => {
    const events: NightlifeEvent[] = [
      { startDatetime: "2026-08-16T01:00:00+02:00", endDatetime: null }, // belongs to Aug 15 night, but later instant
      { startDatetime: "2026-08-15T22:00:00+02:00", endDatetime: null },
    ];
    const sorted = sortByStart(events);
    expect(sorted[0].startDatetime).toBe("2026-08-15T22:00:00+02:00");
    expect(sorted[1].startDatetime).toBe("2026-08-16T01:00:00+02:00");
  });
});

describe("groupByMonth", () => {
  it("buckets a post-midnight event into the month its night started, not the literal month", () => {
    const events: NightlifeEvent[] = [
      { startDatetime: "2026-09-01T01:30:00+02:00", endDatetime: null }, // Aug 31 night
      { startDatetime: "2026-09-05T23:00:00+02:00", endDatetime: null },
    ];
    const groups = groupByMonth(events);
    expect(groups).toHaveLength(2);
    expect(groups[0].monthKey).toBe("2026-08");
    expect(groups[0].events).toHaveLength(1);
    expect(groups[1].monthKey).toBe("2026-09");
  });

  it("returns groups in chronological order", () => {
    const events: NightlifeEvent[] = [
      { startDatetime: "2026-10-01T22:00:00+02:00", endDatetime: null },
      { startDatetime: "2026-08-01T22:00:00+02:00", endDatetime: null },
      { startDatetime: "2026-09-01T22:00:00+02:00", endDatetime: null },
    ];
    const groups = groupByMonth(events);
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

describe("archival / lifecycle", () => {
  it("an overnight event with an explicit end is not archived until that end", () => {
    const event: NightlifeEvent = { startDatetime: "2026-08-15T23:59:00+02:00", endDatetime: "2026-08-16T06:00:00+02:00" };
    expect(isPastEvent(event, new Date("2026-08-16T04:00:00+02:00"))).toBe(false);
    expect(isPastEvent(event, new Date("2026-08-16T07:00:00+02:00"))).toBe(true);
  });

  it("falls back to 06:00 the next day when no explicit end is given", () => {
    const event: NightlifeEvent = { startDatetime: "2026-08-15T23:00:00+02:00", endDatetime: null };
    const end = effectiveEndInstant(event);
    expect(end.toISOString()).toBe(new Date("2026-08-16T06:00:00+02:00").toISOString());
  });

  it("an in-progress overnight event is neither tonight-only-at-start nor archived", () => {
    const event: NightlifeEvent = { startDatetime: "2026-08-15T23:59:00+02:00", endDatetime: "2026-08-16T06:00:00+02:00" };
    const now = new Date("2026-08-16T02:00:00+02:00");
    expect(isEventInProgress(event, now)).toBe(true);
    expect(isPastEvent(event, now)).toBe(false);
  });

  it("archives immediately after a same-evening event with an explicit end passes", () => {
    const event: NightlifeEvent = { startDatetime: "2026-08-15T20:00:00+02:00", endDatetime: "2026-08-15T23:00:00+02:00" };
    expect(isPastEvent(event, new Date("2026-08-15T22:00:00+02:00"))).toBe(false);
    expect(isPastEvent(event, new Date("2026-08-15T23:30:00+02:00"))).toBe(true);
  });

  // Reproduction of a real-world report (2026-08-29 follow-up): a daytime,
  // non-overnight event — Fri 28 Aug 2026, 12:00-21:00 Copenhagen — that was
  // reported as still publicly visible the next day. With a correctly
  // stored startDatetime/endDatetime for that exact shape, isPastEvent
  // already archives it the moment 21:00 CEST passes and keeps it visible
  // right up to that instant, matching target behavior exactly — proving
  // the general archival logic itself was never the bug. (Root cause,
  // confirmed against real Hangaren source markup: this specific listing's
  // own stored endDatetime was genuinely wrong — Hangaren's own page and
  // Google Calendar export both state a 33-hour span, "Fri Aug 28, 12:00
  // PM" through "Sat Aug 29, 9:00 PM" — a source-data error our adapter
  // faithfully carried through, not a defect in this filtering logic. See
  // hangarenAdapter.test.ts's "known real-source anomaly" test for the
  // evidence trail.)
  it("a genuinely same-day daytime event (Fri 12:00-21:00, not overnight) archives exactly at its stated end, not before or after", () => {
    const event: NightlifeEvent = { startDatetime: "2026-08-28T12:00:00+02:00", endDatetime: "2026-08-28T21:00:00+02:00" };
    expect(isPastEvent(event, new Date("2026-08-28T20:59:00+02:00"))).toBe(false);
    expect(isPastEvent(event, new Date("2026-08-28T21:00:00+02:00"))).toBe(true);
    // The next day, it must never still read as current — this is exactly
    // the state a visitor checking the site "on 29 August" would observe.
    expect(isPastEvent(event, new Date("2026-08-29T12:00:00+02:00"))).toBe(true);
  });
});

describe("crossesMidnight", () => {
  it("detects an end time on the following calendar day", () => {
    const event: NightlifeEvent = { startDatetime: "2026-08-15T23:59:00+02:00", endDatetime: "2026-08-16T06:00:00+02:00" };
    expect(crossesMidnight(event)).toBe(true);
  });

  it("does not flag a same-day event", () => {
    const event: NightlifeEvent = { startDatetime: "2026-08-15T20:00:00+02:00", endDatetime: "2026-08-15T23:00:00+02:00" };
    expect(crossesMidnight(event)).toBe(false);
  });
});

describe("date key helpers", () => {
  it("addDaysToDateKey rolls month/year boundaries", () => {
    expect(addDaysToDateKey({ year: 2026, month: 8, day: 31 }, 1)).toEqual({ year: 2026, month: 9, day: 1 });
    expect(addDaysToDateKey({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it("compareDateKeys orders correctly", () => {
    expect(compareDateKeys({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 8, day: 2 })).toBeLessThan(0);
  });

  it("weekdayOfDateKey matches known Saturday", () => {
    expect(weekdayOfDateKey({ year: 2026, month: 8, day: 15 })).toBe(6);
  });
});
