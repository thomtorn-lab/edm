import {
  addDaysToDateKey,
  compareDateKeys,
  copenhagenWallClockToUtc,
  getCopenhagenParts,
  hasTrustworthyEndDatetime,
  type DateKey,
  type NightlifeEvent,
} from "./datetime";

/**
 * Homepage "Time of Day" filter. Five half-open Copenhagen wall-clock
 * periods that together cover the whole day with no gaps or overlaps:
 * [06,09) [09,12) [12,18) [18,24) [00,06).
 */
export const TIME_OF_DAY_PERIODS = ["early-morning", "late-morning", "afternoon", "evening", "night"] as const;

export type TimeOfDayPeriod = (typeof TIME_OF_DAY_PERIODS)[number];

export const TIME_OF_DAY_LABEL: Record<TimeOfDayPeriod, string> = {
  "early-morning": "Early Morning",
  "late-morning": "Late Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

/** [startHour, endHour) in Copenhagen local time; 24 means the next day's midnight. */
const PERIOD_HOURS: Record<TimeOfDayPeriod, [number, number]> = {
  "early-morning": [6, 9],
  "late-morning": [9, 12],
  afternoon: [12, 18],
  evening: [18, 24],
  night: [0, 6],
};

/** Safety bound on the per-date loop; any span this long already overlaps every period. */
const MAX_DAYS = 31;

function periodAtHour(hour: number): TimeOfDayPeriod {
  return TIME_OF_DAY_PERIODS.find((p) => hour >= PERIOD_HOURS[p][0] && hour < PERIOD_HOURS[p][1]) as TimeOfDayPeriod;
}

function periodInstants(key: DateKey, period: TimeOfDayPeriod): [number, number] {
  const [startHour, endHour] = PERIOD_HOURS[period];
  const start = copenhagenWallClockToUtc(key, startHour, 0).getTime();
  const end = endHour === 24
    ? copenhagenWallClockToUtc(addDaysToDateKey(key, 1), 0, 0).getTime()
    : copenhagenWallClockToUtc(key, endHour, 0).getTime();
  return [start, end];
}

/**
 * Whether an event takes place during any of `selected`. No selection
 * matches everything.
 *
 * - Known, valid end time (hasTrustworthyEndDatetime): matches every period
 *   the half-open span [start, end) overlaps, on every Copenhagen date it
 *   touches — so 23:59-08:00 is Evening + Night + Early Morning, and an
 *   event ending exactly 18:00 is not Evening.
 * - Missing or invalid end time: matches only the period it starts in. The
 *   06:00-next-morning fallback (effectiveEndInstant) is deliberately NOT
 *   used here — it decides when an event expires, not when it happens.
 */
export function matchesTimeOfDay(event: NightlifeEvent, selected: readonly TimeOfDayPeriod[]): boolean {
  if (selected.length === 0) return true;
  const start = new Date(event.startDatetime);

  if (!hasTrustworthyEndDatetime(event)) {
    return selected.includes(periodAtHour(getCopenhagenParts(start).hour));
  }

  const startMs = start.getTime();
  const end = new Date(event.endDatetime as string);
  const endMs = end.getTime();
  const s = getCopenhagenParts(start);
  const e = getCopenhagenParts(end);
  const lastKey: DateKey = { year: e.year, month: e.month, day: e.day };
  let key: DateKey = { year: s.year, month: s.month, day: s.day };

  for (let i = 0; i < MAX_DAYS && compareDateKeys(key, lastKey) <= 0; i++) {
    for (const period of selected) {
      const [pStart, pEnd] = periodInstants(key, period);
      if (startMs < pEnd && endMs > pStart) return true;
    }
    key = addDaysToDateKey(key, 1);
  }
  // Only reachable for a span longer than MAX_DAYS, which covers every period.
  return compareDateKeys(key, lastKey) <= 0;
}

export function parseTimeOfDayList(raw: string | null | undefined): TimeOfDayPeriod[] {
  if (!raw) return [];
  const values = raw.split(",").map((v) => v.trim());
  return TIME_OF_DAY_PERIODS.filter((p) => values.includes(p));
}
