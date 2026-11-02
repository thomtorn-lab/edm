import { describe, expect, it, vi } from "vitest";
import { isPastEvent } from "./datetime";

/**
 * Supabase egress work, 2026-11-01: the public event lists now leave out
 * clearly-past events in SQL (upcomingCandidateCondition in queries.ts):
 *   start_datetime >= now - UPCOMING_PREFILTER_LOOKBACK_MS  OR  end_datetime > now
 * That is only safe if it is a SUPERSET of what isPastEvent keeps — an event
 * still running must never disappear early. This checks it exhaustively over
 * a grid of "now" instants (both DST switches, nightlife-day cutoffs) and
 * event start/end shapes: no end, an end before the start (untrustworthy),
 * and ends from minutes to days after the start.
 */

vi.mock("@/db/client", () => ({ db: {} }));
const { UPCOMING_PREFILTER_LOOKBACK_MS } = await import("./queries");

/** JS mirror of the SQL condition (NULL end never satisfies `end > now`). */
function prefilterKeeps(start: Date, end: Date | null, now: Date): boolean {
  return start.getTime() >= now.getTime() - UPCOMING_PREFILTER_LOOKBACK_MS || (end !== null && end.getTime() > now.getTime());
}

const HOUR = 3_600_000;
const NOWS = [
  "2026-03-29T00:30:00.000Z", // night of the spring DST switch (CET → CEST)
  "2026-03-29T04:59:00.000Z", // 06:59 CEST, just after the nightlife-day cutoff
  "2026-06-15T03:59:00.000Z", // 05:59 CEST, just before the cutoff
  "2026-06-15T04:00:00.000Z", // 06:00 CEST, exactly the cutoff
  "2026-10-25T00:30:00.000Z", // night of the autumn DST switch (CEST → CET)
  "2026-10-25T04:30:00.000Z", // 05:30 CET: an event from 06:00 CEST the day before is still on — its nightlife day lasts 25h
  "2026-10-25T05:00:00.000Z", // 06:00 CET, the cutoff right after the switch
  "2026-12-31T23:00:00.000Z", // New Year, 00:00 CET
].map((iso) => new Date(iso));
// End offsets relative to start: none, before/equal to start, and 15 min … 6 days after.
const END_OFFSETS_H: (number | null)[] = [null, -2, 0, 0.25, 4, 10, 23, 30, 49, 72, 100, 144];

describe("upcoming SQL pre-filter never drops an event isPastEvent still shows", () => {
  it("holds for every start within 6 days before to 1 day after now, every end shape, at every 'now' in the grid", () => {
    let checked = 0;
    let keptByRule = 0;
    for (const now of NOWS) {
      for (let startOffsetMin = -6 * 24 * 60; startOffsetMin <= 24 * 60; startOffsetMin += 15) {
        const start = new Date(now.getTime() + startOffsetMin * 60_000);
        for (const endOffset of END_OFFSETS_H) {
          const end = endOffset === null ? null : new Date(start.getTime() + endOffset * HOUR);
          const shown = !isPastEvent({ startDatetime: start.toISOString(), endDatetime: end?.toISOString() ?? null }, now);
          checked++;
          if (!shown) continue;
          keptByRule++;
          if (!prefilterKeeps(start, end, now)) {
            throw new Error(`pre-filter would drop a still-shown event: now=${now.toISOString()} start=${start.toISOString()} end=${end?.toISOString() ?? null}`);
          }
        }
      }
    }
    // Sanity: the grid really exercises both outcomes.
    expect(keptByRule).toBeGreaterThan(1000);
    expect(checked - keptByRule).toBeGreaterThan(1000);
  });

  it("does drop events that are clearly over — the point of the filter", () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    const weekOld = new Date(now.getTime() - 7 * 24 * HOUR);
    expect(prefilterKeeps(weekOld, null, now)).toBe(false);
    expect(prefilterKeeps(weekOld, new Date(weekOld.getTime() + 6 * HOUR), now)).toBe(false);
    // …but keeps a multi-day event that started long ago and is still running.
    expect(prefilterKeeps(weekOld, new Date(now.getTime() + 24 * HOUR), now)).toBe(true);
  });
});
