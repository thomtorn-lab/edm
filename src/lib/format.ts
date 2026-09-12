import { getCopenhagenParts, isMultiDayEvent, type NightlifeEvent } from "./datetime";

const WEEKDAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
export const MONTH_FULL = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** e.g. "SAT 15 AUG" */
export function formatRowDateLabel(startDatetime: string): string {
  const parts = getCopenhagenParts(new Date(startDatetime));
  return `${WEEKDAY_ABBR[parts.weekday]} ${parts.day} ${MONTH_ABBR[parts.month - 1]}`;
}

/** e.g. "23:59" */
export function formatTimeLabel(datetime: string): string {
  const parts = getCopenhagenParts(new Date(datetime));
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * e.g. "23:59" or "23:59–06:00". Never annotates an overnight end time (e.g.
 * "+1") — the event's own date label already identifies the starting date,
 * and Copenhagen nightlife-goers read an end time before the start as
 * "the following morning" without needing it spelled out.
 */
export function formatTimeRangeLabel(event: NightlifeEvent): string {
  const start = formatTimeLabel(event.startDatetime);
  if (!event.endDatetime) return start;
  const end = formatTimeLabel(event.endDatetime);
  return `${start}–${end}`;
}

/**
 * e.g. "SAT 15 AUG" for a same-day event OR a normal overnight event whose
 * end merely spills into the next Copenhagen calendar date (the time range
 * already communicates that it runs overnight — see formatTimeRangeLabel).
 * Only when the event's end instant falls 2+ Copenhagen calendar days after
 * its start (isMultiDayEvent — a true multi-day event, e.g. a festival) does
 * this show the full range, e.g. "FRI 9 OCT – SUN 11 OCT". Never inferred
 * from duration/elapsed-hours or text — the true stored start/end instants,
 * compared as Copenhagen calendar dates, decide this — and a missing
 * endDatetime always falls back to the single-date label.
 */
export function formatRowDateRangeLabel(event: NightlifeEvent): string {
  const start = formatRowDateLabel(event.startDatetime);
  if (!isMultiDayEvent(event)) return start;
  const end = formatRowDateLabel(event.endDatetime as string);
  return `${start} – ${end}`;
}

export function formatMonthAbbr(month: number): string {
  return MONTH_ABBR[month - 1];
}

/** e.g. "Aug" — title case, for user-facing nav rather than dense data badges. */
export function formatMonthAbbrTitleCase(month: number): string {
  const abbr = MONTH_ABBR[month - 1];
  return abbr.charAt(0) + abbr.slice(1).toLowerCase();
}

export function formatMonthFull(month: number): string {
  return MONTH_FULL[month - 1];
}

/** e.g. "Saturday 15 August 2026" */
export function formatFullDateLabel(datetime: string): string {
  const parts = getCopenhagenParts(new Date(datetime));
  return `${WEEKDAY_FULL[parts.weekday]} ${parts.day} ${formatMonthFull(parts.month)[0]}${formatMonthFull(parts.month).slice(1).toLowerCase()} ${parts.year}`;
}

/**
 * e.g. "Saturday 15 August 2026" for a same-day event OR a normal overnight
 * event, or "Friday 9 October 2026 – Sunday 11 October 2026" when the event
 * is a true multi-day event (isMultiDayEvent) — see formatRowDateRangeLabel
 * for the same rule at the compact row-label grain.
 */
export function formatFullDateRangeLabel(event: NightlifeEvent): string {
  const start = formatFullDateLabel(event.startDatetime);
  if (!isMultiDayEvent(event)) return start;
  const end = formatFullDateLabel(event.endDatetime as string);
  return `${start} – ${end}`;
}

/** Coarse relative time for admin/source-health UI, e.g. "2h ago", "3d ago". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function formatIsoDateForInput(datetime: string): string {
  const parts = getCopenhagenParts(new Date(datetime));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}
