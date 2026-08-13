import { describe, expect, it } from "vitest";
import { buildIcsFile, googleCalendarUrl, outlookCalendarUrl, type CalendarEventInput } from "./ics";

const venue = { name: "Hangaren", address: "Refshalevej 325, 1432 København K" };

describe("calendar export", () => {
  it("produces a valid ICS VEVENT with correct UTC start/end for an overnight event", () => {
    const input: CalendarEventInput = {
      title: "Fast Forward",
      description: "Hard techno and industrial at Hangaren.",
      startDatetime: "2026-08-15T23:59:00+02:00",
      endDatetime: "2026-08-16T06:00:00+02:00",
      venue,
      eventUrl: "https://example.com/events/fast-forward",
    };
    const ics = buildIcsFile(input);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Fast Forward");
    // 23:59 CEST (+02:00) on Aug 15 = 21:59 UTC.
    expect(ics).toContain("DTSTART:20260815T215900Z");
    // 06:00 CEST on Aug 16 = 04:00 UTC.
    expect(ics).toContain("DTEND:20260816T040000Z");
    expect(ics).toContain("LOCATION:Hangaren\\, Refshalevej 325");
  });

  it("falls back to the nightlife default end time when no explicit end is given", () => {
    const input: CalendarEventInput = {
      title: "Low Signal",
      description: null,
      startDatetime: "2026-08-13T23:00:00+02:00",
      endDatetime: null,
      venue,
      eventUrl: "https://example.com/events/low-signal",
    };
    const ics = buildIcsFile(input);
    // Falls back to 06:00 the next day (04:00 UTC).
    expect(ics).toContain("DTEND:20260814T040000Z");
  });

  it("escapes special characters in title and description", () => {
    const input: CalendarEventInput = {
      title: "Night, Noise; Repeat",
      description: "Line one\nLine two",
      startDatetime: "2026-08-14T22:00:00+02:00",
      endDatetime: "2026-08-15T02:00:00+02:00",
      venue,
      eventUrl: "https://example.com/events/x",
    };
    const ics = buildIcsFile(input);
    expect(ics).toContain("SUMMARY:Night\\, Noise\\; Repeat");
    expect(ics).toContain("Line one\\nLine two");
  });

  it("builds Google and Outlook deep links with matching UTC instants", () => {
    const input: CalendarEventInput = {
      title: "Fast Forward",
      description: "Hard techno.",
      startDatetime: "2026-08-15T23:59:00+02:00",
      endDatetime: "2026-08-16T06:00:00+02:00",
      venue,
      eventUrl: "https://example.com/events/fast-forward",
    };
    const google = googleCalendarUrl(input);
    expect(google).toContain("dates=20260815T215900Z%2F20260816T040000Z");

    const outlook = outlookCalendarUrl(input);
    const url = new URL(outlook);
    expect(url.searchParams.get("startdt")).toBe(new Date("2026-08-15T23:59:00+02:00").toISOString());
  });
});
