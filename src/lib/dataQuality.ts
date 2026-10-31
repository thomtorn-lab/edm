import type { EventRecord } from "./types";
import type { GenreSlug } from "./taxonomy";
import { getCopenhagenParts, isPastEvent } from "./datetime";
import { hasExplicitDjOrRaveSignal } from "./adapters/deterministicGenreMapping";

/**
 * Admin data-quality warnings (coverage work, phase 2, 2026-10-17). Read-only
 * checks on upcoming events that point a human at data the public site
 * would otherwise act on silently:
 *
 * - An end time that is not after the start, or absurdly far after it. The
 *   site already ignores an end before the start (hasTrustworthyEndDatetime),
 *   but the stored data stays wrong. Real cases: "La Malafamera" (ends 18.5 h
 *   before it starts) and "BØLLEBAS" (ends 5 days before it starts).
 * - A club night that ends before 01:00: if that end time is a guess or a
 *   typo, the event leaves the homepage while it is still running (e.g.
 *   "The Final Reptile Rave", 20:00–23:30). Concerts routinely end that
 *   early (ALICE, KLEIN), so this only fires with club-night evidence and
 *   is shown as a possible inconsistency, never as an error.
 * - A start date that syncs keep changing, or that changes together with
 *   the official URL or the venue. Real case: "STVW pres. Punk Rave", where
 *   Pumpehuset listed the moved 14/10 show and its new 4/11 date side by
 *   side and both kept rewriting the same event (three date flips in a day).
 *
 * Nothing here writes, corrects or hides anything; the admin decides.
 */

export type DataQualityIssueKey =
  | "end_not_after_start"
  | "end_far_after_start"
  | "early_end_for_evening_start"
  | "date_flip_flop"
  | "date_changed_with_url"
  | "venue_changed_by_sync";

export interface DataQualityIssue {
  key: DataQualityIssueKey;
  /** "possible_inconsistency": the data may well be right; worth a glance, not a correction. */
  severity: "error" | "warning" | "possible_inconsistency";
  message: string;
}

/** One event_change_log row, as far as these checks need it. */
export interface EventChangeEntry {
  eventId: string;
  changedBy: string;
  changeType: string;
  fieldsChanged: string[];
  createdAt: string;
}

export type DataQualityEvent = Pick<
  EventRecord,
  "id" | "title" | "startDatetime" | "endDatetime" | "published" | "canonicalSourceId" | "artists" | "primaryGenre" | "venueId"
>;

export interface EventDataQualityReport<T extends DataQualityEvent = DataQualityEvent> {
  event: T;
  issues: DataQualityIssue[];
}

const HOUR_MS = 3_600_000;
/** Longer than any single Copenhagen club night; a real multi-day festival is still worth a look. */
const MAX_PLAUSIBLE_DURATION_HOURS = 36;
/** An evening start (local hour) whose end before EARLY_END_LOCAL_HOUR next morning is suspicious. */
const EVENING_START_LOCAL_HOUR = 20;
const EARLY_END_LOCAL_HOUR = 1;
const EARLY_END_MAX_DURATION_HOURS = 5;
/** A dance-floor genre on its own is club evidence only for a late start or at a club venue. */
const LATE_START_LOCAL_HOUR = 22;
const DANCEFLOOR_GENRES: ReadonlySet<GenreSlug> = new Set<GenreSlug>([
  "techno",
  "hard-techno",
  "industrial-techno",
  "hypnotic-techno",
  "industrial",
  "melodic-techno",
  "minimal-techno",
  "house",
  "deep-house",
  "tech-house",
  "progressive-house",
  "afro-house",
  "trance",
  "psytrance",
  "drum-and-bass",
  "jungle",
  "breakbeat",
  "dubstep",
  "garage",
  "hardstyle",
  "rawstyle",
  "hardcore",
  "disco",
]);
/**
 * Venues that run club nights. Supporting evidence only: a concert there is
 * never flagged on the venue alone. Same venues the admin review
 * prioritisation treats as electronic (src/lib/reviewPriority.ts, PR #146).
 */
const CLUB_VENUE_IDS: ReadonlySet<string> = new Set([
  "v-module",
  "v-den-anden-side",
  "v-culture-box",
  "v-hangaren",
  "v-gravity",
  "v-klub-werkstatt",
  "v-kb3",
]);
/** Club-night format words beyond DJ/rave, whole words only ("klubaften" is Danish for club night). */
const CLUB_FORMAT_RE = /\b(?:club ?night|klubaften|afterparty|open decks?|b2b|all night long)\b/i;
/** Sync-driven date changes this close together, this many times, look like two listings fighting. */
const FLIP_FLOP_WINDOW_DAYS = 7;
const FLIP_FLOP_MIN_CHANGES = 2;

function formatLocalTime(iso: string): string {
  const p = getCopenhagenParts(new Date(iso));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * Why this looks like a club night rather than a concert, or null. Wording
 * in the title/lineup counts on its own; a dance-floor genre needs a club
 * venue or a late start as well; a venue never counts on its own.
 */
function clubNightEvidence(event: DataQualityEvent, startLocalHour: number): string | null {
  const text = `${event.title} ${event.artists.join(" ")}`;
  if (hasExplicitDjOrRaveSignal(text) || CLUB_FORMAT_RE.test(text)) return "DJ / rave / club-night wording";
  if (DANCEFLOOR_GENRES.has(event.primaryGenre)) {
    if (CLUB_VENUE_IDS.has(event.venueId)) return `${event.primaryGenre} at a club venue`;
    if (startLocalHour >= LATE_START_LOCAL_HOUR) return `${event.primaryGenre}, starting late`;
  }
  return null;
}

function isSyncChange(entry: EventChangeEntry): boolean {
  return entry.changedBy !== "admin";
}

export function detectEventDataQualityIssues(event: DataQualityEvent, changes: EventChangeEntry[], now: Date): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const start = new Date(event.startDatetime).getTime();

  if (event.endDatetime) {
    const end = new Date(event.endDatetime).getTime();
    const hours = (end - start) / HOUR_MS;
    if (end <= start) {
      issues.push({
        key: "end_not_after_start",
        severity: "error",
        message: `End time (${formatLocalTime(event.endDatetime)}) is not after the start (${formatLocalTime(event.startDatetime)}). The site ignores it and assumes 06:00 the next morning; the stored end time should be corrected.`,
      });
    } else if (hours > MAX_PLAUSIBLE_DURATION_HOURS) {
      issues.push({
        key: "end_far_after_start",
        severity: "warning",
        message: `Ends ${Math.round(hours)} hours after it starts. Fine for a multi-day festival, otherwise the end date is probably wrong.`,
      });
    } else {
      const startLocal = getCopenhagenParts(new Date(event.startDatetime));
      const endLocal = getCopenhagenParts(new Date(event.endDatetime));
      const endsBeforeEarlyHour = endLocal.hour >= EVENING_START_LOCAL_HOUR || endLocal.hour < EARLY_END_LOCAL_HOUR;
      const evidence =
        startLocal.hour >= EVENING_START_LOCAL_HOUR && endsBeforeEarlyHour && hours <= EARLY_END_MAX_DURATION_HOURS
          ? clubNightEvidence(event, startLocal.hour)
          : null;
      if (evidence) {
        issues.push({
          key: "early_end_for_evening_start",
          severity: "possible_inconsistency",
          message: `Looks like a club night (${evidence}) but ends at ${formatLocalTime(event.endDatetime)} after a ${formatLocalTime(event.startDatetime)} start, so it leaves the homepage then. Fine if that is the real end time.`,
        });
      }
    }
  }

  const syncChanges = changes.filter((c) => c.eventId === event.id && isSyncChange(c));
  const windowStart = now.getTime() - FLIP_FLOP_WINDOW_DAYS * 24 * HOUR_MS;
  const recentDateChanges = syncChanges.filter((c) => c.fieldsChanged.includes("startDatetime") && new Date(c.createdAt).getTime() >= windowStart);
  if (recentDateChanges.length >= FLIP_FLOP_MIN_CHANGES) {
    const by = Array.from(new Set(recentDateChanges.map((c) => c.changedBy))).join(", ");
    issues.push({
      key: "date_flip_flop",
      severity: "warning",
      message: `Start date changed ${recentDateChanges.length} times in ${FLIP_FLOP_WINDOW_DAYS} days by ${by}. Two source listings may be feeding this one event (e.g. a moved show listed under both dates).`,
    });
  }
  if (syncChanges.some((c) => c.fieldsChanged.includes("startDatetime") && c.fieldsChanged.includes("officialEventUrl"))) {
    issues.push({
      key: "date_changed_with_url",
      severity: "warning",
      message: "A sync changed the date and the official event URL together. Check that this is still the same event and not a different listing (moved, rescheduled or a second date).",
    });
  }
  if (syncChanges.some((c) => c.fieldsChanged.includes("venueId"))) {
    issues.push({
      key: "venue_changed_by_sync",
      severity: "warning",
      message: "A sync changed the venue. Check that the event really moved.",
    });
  }

  return issues;
}

/**
 * Every upcoming event (published or not) with at least one issue, errors
 * first, then by start. Past events are left out: nothing can be done about
 * them any more.
 */
export function buildDataQualityReport<T extends DataQualityEvent>(events: T[], changes: EventChangeEntry[], now: Date): EventDataQualityReport<T>[] {
  const reports: EventDataQualityReport<T>[] = [];
  for (const event of events) {
    if (isPastEvent(event, now)) continue;
    const issues = detectEventDataQualityIssues(event, changes, now);
    if (issues.length > 0) reports.push({ event, issues });
  }
  const hasError = (r: EventDataQualityReport<T>) => r.issues.some((i) => i.severity === "error");
  reports.sort((a, b) => {
    if (hasError(a) !== hasError(b)) return hasError(a) ? -1 : 1;
    return new Date(a.event.startDatetime).getTime() - new Date(b.event.startDatetime).getTime();
  });
  return reports;
}
