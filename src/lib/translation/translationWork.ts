import { isPastEvent } from "../datetime";
import { descriptionHash } from "./englishDescription";

/** A failed description is retried on later runs at most this many times in total, until its text changes. */
export const MAX_TRANSLATION_ATTEMPTS = 3;

export type TranslationWorkRow = {
  eventId: string;
  slug: string;
  description: string;
  startDatetime: string;
  endDatetime: string | null;
  cached: { sourceHash: string; status: string; attempts: number } | null;
};

/**
 * Whether an event's description still needs a translation run: never
 * processed, its text changed since the cached result (hash mismatch), or a
 * failure that still has retries left. An unchanged, already-handled
 * description is never sent again.
 */
export function needsTranslationWork(row: TranslationWorkRow): boolean {
  const { cached } = row;
  if (!cached) return true;
  if (cached.sourceHash !== descriptionHash(row.description)) return true;
  return cached.status === "failed" && cached.attempts < MAX_TRANSLATION_ATTEMPTS;
}

/**
 * The rows to process this run, most useful first: upcoming/ongoing events
 * by start time (soonest first), then past events, most recent first —
 * their pages stay reachable, but nobody is planning to go to them.
 */
export function selectTranslationWork(rows: TranslationWorkRow[], now: Date, limit: number): TranslationWorkRow[] {
  const pending = rows.filter(needsTranslationWork);
  const upcoming = pending.filter((r) => !isPastEvent(r, now)).sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
  const past = pending.filter((r) => isPastEvent(r, now)).sort((a, b) => b.startDatetime.localeCompare(a.startDatetime));
  return [...upcoming, ...past].slice(0, Math.max(0, limit));
}

/** Attempt count to store after this run's result for a row. */
export function nextAttemptCount(row: TranslationWorkRow, succeeded: boolean): number {
  const sameText = row.cached !== null && row.cached.sourceHash === descriptionHash(row.description);
  const previous = sameText ? row.cached!.attempts : 0;
  return succeeded ? previous : previous + 1;
}
