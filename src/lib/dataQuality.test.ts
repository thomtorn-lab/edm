import { describe, expect, it } from "vitest";
import { buildDataQualityReport, detectEventDataQualityIssues, type DataQualityEvent, type EventChangeEntry } from "./dataQuality";

/**
 * Admin data-quality warnings. Fixtures are real Production events from the
 * 2026-10-16 read-only audit (times as stored, in UTC).
 */

const NOW = new Date("2026-10-16T12:00:00Z");

function ev(overrides: Partial<DataQualityEvent> = {}): DataQualityEvent {
  return {
    id: "e-test",
    title: "A Night",
    startDatetime: "2026-10-30T21:00:00Z",
    endDatetime: null,
    published: true,
    canonicalSourceId: "src-test",
    artists: [],
    primaryGenre: "electronic-other",
    venueId: "v-test",
    ...overrides,
  };
}

function change(overrides: Partial<EventChangeEntry> = {}): EventChangeEntry {
  return {
    eventId: "e-test",
    changedBy: "src-pumpehuset",
    changeType: "sync",
    fieldsChanged: ["startDatetime"],
    createdAt: "2026-10-14T12:29:49Z",
    ...overrides,
  };
}

const keys = (event: DataQualityEvent, changes: EventChangeEntry[] = []) => detectEventDataQualityIssues(event, changes, NOW).map((i) => i.key);

describe("end times", () => {
  it("flags La Malafamera: the end is 18.5 hours before the start", () => {
    const issues = detectEventDataQualityIssues(
      ev({ title: "La Malafamera - Halloween Edition", startDatetime: "2026-10-24T21:30:00Z", endDatetime: "2026-10-24T03:00:00Z" }),
      [],
      NOW,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: "end_not_after_start", severity: "error" });
    expect(issues[0].message).toContain("05:00");
    expect(issues[0].message).toContain("23:30");
  });

  it("flags BØLLEBAS: the end is five days before the start", () => {
    expect(keys(ev({ title: "BØLLEBAS", startDatetime: "2026-11-06T22:00:00Z", endDatetime: "2026-11-01T06:00:00Z" }))).toEqual(["end_not_after_start"]);
  });

  it("flags an end equal to the start", () => {
    expect(keys(ev({ endDatetime: "2026-10-30T21:00:00Z" }))).toEqual(["end_not_after_start"]);
  });

  it("warns when the end is more than 36 hours after the start", () => {
    expect(keys(ev({ startDatetime: "2026-10-30T20:00:00Z", endDatetime: "2026-11-01T10:00:00Z" }))).toEqual(["end_far_after_start"]);
  });

  // Real 2026-10-16 Production cases (UTC as stored).
  const REPTILE_RAVE = ev({ title: "The Final Reptile Rave - HELL", primaryGenre: "trance", venueId: "v-vega", startDatetime: "2026-10-17T18:00:00Z", endDatetime: "2026-10-17T21:30:00Z" });
  const GLOD = ev({ title: "GLØD 4 år - 3XB + Signal + dj", venueId: "v-lygten-station", startDatetime: "2026-10-30T19:00:00Z", endDatetime: "2026-10-30T22:30:00Z" });
  const ZOUMER = ev({ title: "Zoumer + Ela Lung", artists: ["Zoumer", "Ela Lung"], venueId: "v-klein", startDatetime: "2026-11-13T19:30:00Z", endDatetime: "2026-11-13T21:30:00Z" });
  const LA_TENE = ev({ title: "La Tène FR/CH", artists: ["La Tène"], venueId: "v-alice", startDatetime: "2026-11-20T19:00:00Z", endDatetime: "2026-11-20T22:00:00Z" });
  const RASTER = ev({ title: "raster. 30 years anniversary", venueId: "v-alice", startDatetime: "2026-11-28T19:00:00Z", endDatetime: "2026-11-28T22:59:00Z" });

  it("marks a club night that ends before 01:00 as a possible inconsistency, not an error (The Final Reptile Rave, 20:00–23:30)", () => {
    const issues = detectEventDataQualityIssues(REPTILE_RAVE, [], NOW);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: "early_end_for_evening_start", severity: "possible_inconsistency" });
    expect(issues[0].message).toContain("DJ / rave / club-night wording");
    expect(issues[0].message).toContain("20:00");
    expect(issues[0].message).toContain("23:30");
  });

  it("flags GLØD 4 år on the DJ in its title", () => {
    expect(keys(GLOD)).toEqual(["early_end_for_evening_start"]);
  });

  it("does not flag ordinary concerts that end in the evening (Zoumer + Ela Lung at KLEIN, La Tène and raster. at ALICE)", () => {
    expect(keys(ZOUMER)).toEqual([]);
    expect(keys(LA_TENE)).toEqual([]);
    expect(keys(RASTER)).toEqual([]);
  });

  it("never flags on the venue alone: a generic electronic concert at MODULE ending at 23:00 passes", () => {
    expect(keys(ev({ title: "Live: Some Band", venueId: "v-module", startDatetime: "2026-10-30T19:00:00Z", endDatetime: "2026-10-30T22:00:00Z" }))).toEqual([]);
  });

  it("needs a club venue or a late start before a dance-floor genre counts", () => {
    const techno = { title: "Some Artist", primaryGenre: "techno" as const, endDatetime: "2026-10-30T22:30:00Z" };
    expect(keys(ev({ ...techno, venueId: "v-vega", startDatetime: "2026-10-30T19:00:00Z" }))).toEqual([]);
    expect(keys(ev({ ...techno, venueId: "v-module", startDatetime: "2026-10-30T19:00:00Z" }))).toEqual(["early_end_for_evening_start"]);
    expect(keys(ev({ ...techno, venueId: "v-vega", startDatetime: "2026-10-30T21:00:00Z", endDatetime: "2026-10-30T23:30:00Z" }))).toEqual(["early_end_for_evening_start"]);
  });

  it("does not treat electro, ambient or generic electronic genres as club evidence on their own", () => {
    for (const primaryGenre of ["electro", "ambient-experimental", "electronic-other"] as const) {
      expect(keys(ev({ title: "Some Artist", primaryGenre, venueId: "v-module", startDatetime: "2026-10-30T21:00:00Z", endDatetime: "2026-10-30T22:30:00Z" }))).toEqual([]);
    }
  });

  it("does not flag a normal club night ending in the morning, a daytime event, or no end time", () => {
    expect(keys(ev({ title: "Rave", startDatetime: "2026-10-30T22:00:00Z", endDatetime: "2026-10-31T05:00:00Z" }))).toEqual([]);
    expect(keys(ev({ title: "Rave", startDatetime: "2026-10-18T14:30:00Z", endDatetime: "2026-10-18T18:00:00Z" }))).toEqual([]);
    expect(keys(ev({ title: "Rave", endDatetime: null }))).toEqual([]);
  });

  it("uses Copenhagen local time across the DST change (25 Oct 2026)", () => {
    // 20:00–00:30 CEST on the 24th (summer time): an early end.
    expect(keys(ev({ title: "Rave", startDatetime: "2026-10-24T18:00:00Z", endDatetime: "2026-10-24T22:30:00Z" }))).toEqual(["early_end_for_evening_start"]);
    // The clocks go back at 01:00Z on the 25th, so 23:30Z is still 01:30 CEST: not an early end.
    expect(keys(ev({ title: "Rave", startDatetime: "2026-10-24T18:00:00Z", endDatetime: "2026-10-24T23:30:00Z" }))).toEqual([]);
    // 21:00 CET start, 04:00 CET end: a normal night.
    expect(keys(ev({ title: "Rave", startDatetime: "2026-10-31T20:00:00Z", endDatetime: "2026-11-01T03:00:00Z" }))).toEqual([]);
  });
});

describe("date and identity changes from syncs", () => {
  const STVW = ev({ id: "e-7208d716", title: "STVW pres. Punk Rave", startDatetime: "2026-11-04T19:00:00Z", published: false, canonicalSourceId: "src-pumpehuset" });
  // The real event_change_log rows for e-7208d716 on 14 October.
  const STVW_CHANGES: EventChangeEntry[] = [
    change({ eventId: "e-7208d716", fieldsChanged: ["officialEventUrl", "startDatetime", "dateChanged"], createdAt: "2026-10-14T12:29:49Z" }),
    change({ eventId: "e-7208d716", fieldsChanged: ["officialEventUrl", "startDatetime", "dateChanged"], createdAt: "2026-10-14T17:39:35Z" }),
    change({ eventId: "e-7208d716", fieldsChanged: ["officialEventUrl", "startDatetime", "dateChanged"], createdAt: "2026-10-14T21:59:31Z" }),
    change({ eventId: "e-7208d716", fieldsChanged: ["primaryGenre", "subgenres"], createdAt: "2026-10-15T12:11:58Z" }),
  ];

  it("flags STVW: three sync date changes in one day, each together with the official URL", () => {
    const issues = detectEventDataQualityIssues(STVW, STVW_CHANGES, NOW);
    expect(issues.map((i) => i.key)).toEqual(["date_flip_flop", "date_changed_with_url"]);
    expect(issues[0].message).toContain("3 times");
    expect(issues[0].message).toContain("src-pumpehuset");
  });

  it("does not flag a single date change, admin edits, or other events' changes", () => {
    expect(keys(STVW, [STVW_CHANGES[3], change({ eventId: "e-7208d716", fieldsChanged: ["startDatetime"] })])).toEqual([]);
    expect(
      keys(STVW, [
        change({ eventId: "e-7208d716", changedBy: "admin", changeType: "update", fieldsChanged: ["startDatetime", "officialEventUrl"] }),
        change({ eventId: "e-7208d716", changedBy: "admin", changeType: "update", fieldsChanged: ["startDatetime", "venueId"] }),
      ]),
    ).toEqual([]);
    expect(keys(ev({ id: "e-other" }), STVW_CHANGES)).toEqual([]);
  });

  it("ignores date changes older than 7 days for the flip-flop check", () => {
    const old = [change({ createdAt: "2026-10-01T10:00:00Z" }), change({ createdAt: "2026-10-02T10:00:00Z" })];
    expect(keys(ev(), old)).toEqual([]);
  });

  it("flags a venue changed by a sync", () => {
    expect(keys(ev(), [change({ fieldsChanged: ["venueId"] })])).toEqual(["venue_changed_by_sync"]);
  });
});

describe("buildDataQualityReport", () => {
  it("lists upcoming events with issues, errors first, then by start, and leaves past and clean events out", () => {
    const report = buildDataQualityReport(
      [
        ev({ id: "warn-early", title: "Rave", startDatetime: "2026-10-17T18:00:00Z", endDatetime: "2026-10-17T21:30:00Z" }),
        ev({ id: "error-later", startDatetime: "2026-11-06T22:00:00Z", endDatetime: "2026-11-01T06:00:00Z" }),
        ev({ id: "clean", startDatetime: "2026-10-30T22:00:00Z", endDatetime: "2026-10-31T05:00:00Z" }),
        ev({ id: "past", startDatetime: "2026-10-10T18:00:00Z", endDatetime: "2026-10-10T21:30:00Z" }),
      ],
      [],
      NOW,
    );
    expect(report.map((r) => r.event.id)).toEqual(["error-later", "warn-early"]);
  });

  it("never changes the events it checks", () => {
    const events = [ev({ endDatetime: "2026-10-30T20:00:00Z" })];
    const before = JSON.stringify(events);
    buildDataQualityReport(events, [], NOW);
    expect(JSON.stringify(events)).toBe(before);
  });
});
