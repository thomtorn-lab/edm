import { getCopenhagenParts } from "../datetime";

/**
 * ISO 8601 week identifier (e.g. "2026-W41") for an instant, computed from
 * its Europe/Copenhagen calendar date (via the existing getCopenhagenParts
 * helper, not the server's own timezone). This is the natural key the
 * weekly send job's idempotency/resume design is built on (see
 * db/newsletter.ts) — one row per (subscriber, isoWeek), so re-running the
 * job any number of times within the same calendar week always targets the
 * same set of rows. Standard ISO week algorithm (nearest-Thursday rule),
 * deliberately independent of send TIME — only the calendar date matters,
 * so firing the scheduled job via either of the two DST-adjusted UTC cron
 * entries (see send-newsletter.yml) always resolves to the same week.
 */
export function getIsoWeek(date: Date): string {
  const { year, month, day } = getCopenhagenParts(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday determines the ISO year/week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNumber = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}
