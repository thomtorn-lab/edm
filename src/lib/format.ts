import { crossesMidnight, getCopenhagenParts, type NightlifeEvent } from "./datetime";

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

/** e.g. "23:59" or "23:59–06:00" (with +1 if the end lands on the next calendar day). */
export function formatTimeRangeLabel(event: NightlifeEvent): string {
  const start = formatTimeLabel(event.startDatetime);
  if (!event.endDatetime) return start;
  const end = formatTimeLabel(event.endDatetime);
  return crossesMidnight(event) ? `${start}–${end} +1` : `${start}–${end}`;
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
