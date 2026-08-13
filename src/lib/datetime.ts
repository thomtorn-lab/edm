/**
 * Nightlife-aware date logic for Europe/Copenhagen.
 *
 * Electronic music events routinely run past midnight (23:59 -> 06:00 is one
 * continuous night). Treating that as two calendar days breaks "Tonight",
 * weekend filters and archival timing. Instead every instant is mapped to a
 * "nightlife day": the calendar date it conceptually belongs to, where
 * anything before NIGHT_CUTOFF_HOUR (06:00 local) still belongs to the
 * previous day's night.
 *
 * All wall-clock reads go through Intl with an explicit Europe/Copenhagen
 * timeZone so this is correct regardless of the server's own timezone.
 */

const CPH_TZ = "Europe/Copenhagen";

/** Anything before this local hour is still considered part of the previous night. */
export const NIGHT_CUTOFF_HOUR = 6;

export interface DateKey {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface CphParts extends DateKey {
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0 = Sunday .. 6 = Saturday
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CPH_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

export function getCopenhagenParts(date: Date): CphParts {
  const parts = partsFormatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekday: WEEKDAY_INDEX[map.weekday],
  };
}

export function addDaysToDateKey(key: DateKey, days: number): DateKey {
  const d = new Date(Date.UTC(key.year, key.month - 1, key.day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function dateKeyToOrdinal(key: DateKey): number {
  return Date.UTC(key.year, key.month - 1, key.day, 12, 0, 0);
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  return dateKeyToOrdinal(a) - dateKeyToOrdinal(b);
}

export function dateKeysEqual(a: DateKey, b: DateKey): boolean {
  return compareDateKeys(a, b) === 0;
}

export function dateKeyInRange(key: DateKey, start: DateKey, end: DateKey): boolean {
  return compareDateKeys(key, start) >= 0 && compareDateKeys(key, end) <= 0;
}

export function dateKeyToString(key: DateKey): string {
  return `${key.year}-${String(key.month).padStart(2, "0")}-${String(key.day).padStart(2, "0")}`;
}

export function weekdayOfDateKey(key: DateKey): number {
  return new Date(Date.UTC(key.year, key.month - 1, key.day, 12, 0, 0)).getUTCDay();
}

/**
 * The nightlife day an instant belongs to: the calendar date, except that
 * anything between midnight and NIGHT_CUTOFF_HOUR rolls back to the previous
 * day (a 01:00 close-out is still "last night").
 */
export function nightlifeDateKey(date: Date): DateKey {
  const parts = getCopenhagenParts(date);
  const today: DateKey = { year: parts.year, month: parts.month, day: parts.day };
  return parts.hour < NIGHT_CUTOFF_HOUR ? addDaysToDateKey(today, -1) : today;
}

/** Converts a Copenhagen local wall-clock time to the correct UTC instant, DST-safe. */
export function copenhagenWallClockToUtc(key: DateKey, hour: number, minute: number): Date {
  let guess = new Date(Date.UTC(key.year, key.month - 1, key.day, hour, minute, 0));
  for (let i = 0; i < 2; i++) {
    const parts = getCopenhagenParts(guess);
    const guessedMinutes = parts.hour * 60 + parts.minute;
    const wantedMinutes = hour * 60 + minute;
    const dayDiff =
      (dateKeyToOrdinal({ year: parts.year, month: parts.month, day: parts.day }) -
        dateKeyToOrdinal(key)) /
      86_400_000;
    const diffMinutes = wantedMinutes - guessedMinutes - dayDiff * 24 * 60;
    guess = new Date(guess.getTime() + diffMinutes * 60_000);
  }
  return guess;
}

interface WeekendRange {
  friday: DateKey;
  sunday: DateKey;
}

function currentWeekendRange(todayKey: DateKey): WeekendRange {
  const weekday = weekdayOfDateKey(todayKey);
  let fridayOffset: number;
  if (weekday === 5) fridayOffset = 0; // Fri
  else if (weekday === 6) fridayOffset = -1; // Sat
  else if (weekday === 0) fridayOffset = -2; // Sun
  else fridayOffset = 5 - weekday; // Mon-Thu, days until Friday

  const friday = addDaysToDateKey(todayKey, fridayOffset);
  const sunday = addDaysToDateKey(friday, 2);
  return { friday, sunday };
}

export function thisWeekendRange(now: Date): WeekendRange {
  return currentWeekendRange(nightlifeDateKey(now));
}

export function nextWeekendRange(now: Date): WeekendRange {
  const { friday } = currentWeekendRange(nightlifeDateKey(now));
  const nextFriday = addDaysToDateKey(friday, 7);
  return { friday: nextFriday, sunday: addDaysToDateKey(nextFriday, 2) };
}

export interface NightlifeEvent {
  startDatetime: string;
  endDatetime: string | null;
}

export function isTonight(event: NightlifeEvent, now: Date): boolean {
  const eventKey = nightlifeDateKey(new Date(event.startDatetime));
  const todayKey = nightlifeDateKey(now);
  return dateKeysEqual(eventKey, todayKey);
}

export function isThisWeekend(event: NightlifeEvent, now: Date): boolean {
  const eventKey = nightlifeDateKey(new Date(event.startDatetime));
  const { friday, sunday } = thisWeekendRange(now);
  return dateKeyInRange(eventKey, friday, sunday);
}

export function isNextWeekend(event: NightlifeEvent, now: Date): boolean {
  const eventKey = nightlifeDateKey(new Date(event.startDatetime));
  const { friday, sunday } = nextWeekendRange(now);
  return dateKeyInRange(eventKey, friday, sunday);
}

/**
 * The instant an event is considered over for archival purposes. Falls back
 * to 06:00 on the day following its nightlife day when no explicit end time
 * is known, since Copenhagen club nights routinely run to that hour.
 */
export function effectiveEndInstant(event: NightlifeEvent): Date {
  if (event.endDatetime) return new Date(event.endDatetime);
  const start = new Date(event.startDatetime);
  const key = nightlifeDateKey(start);
  const nextDay = addDaysToDateKey(key, 1);
  return copenhagenWallClockToUtc(nextDay, NIGHT_CUTOFF_HOUR, 0);
}

export function isPastEvent(event: NightlifeEvent, now: Date): boolean {
  return effectiveEndInstant(event).getTime() <= now.getTime();
}

export function isEventInProgress(event: NightlifeEvent, now: Date): boolean {
  const start = new Date(event.startDatetime).getTime();
  const end = effectiveEndInstant(event).getTime();
  return start <= now.getTime() && now.getTime() < end;
}

/** Sorts events chronologically by real start instant (never by nightlife day alone). */
export function sortByStart<T extends NightlifeEvent>(events: T[]): T[] {
  return [...events].sort(
    (a, b) => new Date(a.startDatetime).getTime() - new Date(b.startDatetime).getTime(),
  );
}

/** Groups events by the calendar month of their nightlife day, in chronological order. */
export function groupByMonth<T extends NightlifeEvent>(events: T[]): { monthKey: string; year: number; month: number; events: T[] }[] {
  const sorted = sortByStart(events);
  const groups = new Map<string, { year: number; month: number; events: T[] }>();
  for (const event of sorted) {
    const key = nightlifeDateKey(new Date(event.startDatetime));
    const monthKey = `${key.year}-${String(key.month).padStart(2, "0")}`;
    if (!groups.has(monthKey)) groups.set(monthKey, { year: key.year, month: key.month, events: [] });
    groups.get(monthKey)!.events.push(event);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([monthKey, v]) => ({ monthKey, ...v }));
}

export function crossesMidnight(event: NightlifeEvent): boolean {
  if (!event.endDatetime) return false;
  const startKey = getCopenhagenParts(new Date(event.startDatetime));
  const endKey = getCopenhagenParts(new Date(event.endDatetime));
  return startKey.day !== endKey.day || startKey.month !== endKey.month || startKey.year !== endKey.year;
}
