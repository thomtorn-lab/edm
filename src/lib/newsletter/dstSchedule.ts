/**
 * DST-safe weekly schedule eligibility (newsletter activation safety round,
 * 2026-10-06) — decides whether a given scheduled firing is the one
 * intended to represent Thursday 10:00 Europe/Copenhagen, using only (a)
 * which of the two prepared UTC cron expressions triggered this run and
 * (b) Denmark's UTC offset for TODAY'S DATE — never the actual execution
 * clock time.
 *
 * This is deliberately execution-time-independent: GitHub Actions
 * scheduled runs can start several minutes (or, under load, much longer)
 * after their nominal trigger time, but the UTC offset for a given
 * calendar day doesn't change within that day — Denmark's DST transitions
 * happen at a fixed moment, always well outside any plausible Thursday
 * delivery delay — so reading the offset however late in the day still
 * gives the same answer it would have given at the nominal trigger time.
 * A guard that instead checked "is the current wall-clock time within a
 * window around 10:00" would reject a run that started late even though it
 * was genuinely the correct one for the day; this design can't have that
 * failure mode because it never looks at the clock at all, only the
 * calendar-day offset and which cron string fired.
 *
 * Two prepared entries are required in the workflow's schedule — "0 8 * * 4"
 * (correct during CEST) and "0 9 * * 4" (correct during CET) — exactly one
 * of which is correct for any given Thursday; this module's job is only to
 * tell the two apart, never to re-derive the schedule itself.
 */

/** Extracts the hour field from a 5-field cron expression "M H * * D" — null for anything unparseable, so a malformed/unexpected cron string fails closed (never eligible) rather than throwing. */
function parseCronHour(cronExpression: string): number | null {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const hour = Number(fields[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * Parses the "+HHMM"/"-HHMM" offset string `TZ=Europe/Copenhagen date +%z`
 * prints into whole hours. Denmark's offset is always a whole hour (+0100
 * CET or +0200 CEST), never fractional, so a non-zero minutes field (or
 * anything else unparseable) fails closed to `null` rather than guessing.
 */
export function parseUtcOffsetHours(offsetString: string): 1 | 2 | null {
  const match = offsetString.trim().match(/^([+-])(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, sign, hh, mm] = match;
  if (mm !== "00") return null;
  const hours = Number(hh) * (sign === "-" ? -1 : 1);
  return hours === 1 || hours === 2 ? hours : null;
}

/**
 * True only if `cronExpression`'s UTC hour is the one that currently
 * corresponds to 10:00 Europe/Copenhagen, given `copenhagenUtcOffsetHours`
 * (1 for CET, 2 for CEST). An unparseable cron expression fails closed
 * (never eligible) rather than throwing.
 */
export function isDstCorrectCronFiring(cronExpression: string, copenhagenUtcOffsetHours: 1 | 2): boolean {
  const cronUtcHour = parseCronHour(cronExpression);
  if (cronUtcHour === null) return false;
  const intendedUtcHour = 10 - copenhagenUtcOffsetHours; // 10:00 local expressed in UTC
  return cronUtcHour === intendedUtcHour;
}
