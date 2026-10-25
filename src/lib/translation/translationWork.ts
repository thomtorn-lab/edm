import { isPastEvent } from "../datetime";
import { descriptionHash } from "./englishDescription";
import type { TranslationContext } from "./descriptionTranslation";

/**
 * A failed description is retried on each of the next runs up to this many
 * attempts; after that, once a day (FAILED_RETRY_INTERVAL_MS) — it stays
 * hidden on the public site (once ENGLISH_ONLY_ABOUT_TEXTS is on) until it
 * has a valid English version, so it is
 * never given up on, but a persistently failing text can't run up cost.
 */
export const MAX_TRANSLATION_ATTEMPTS = 3;
export const FAILED_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type TranslationWorkRow = {
  eventId: string;
  slug: string;
  /** Title/venue/artists, checked to survive translation verbatim. */
  context?: TranslationContext;
  description: string;
  startDatetime: string;
  endDatetime: string | null;
  cached: { sourceHash: string; status: string; attempts: number; updatedAt?: string | null } | null;
};

/**
 * Whether an event's description still needs a translation run: never
 * processed, its text changed since the cached result (hash mismatch), or a
 * failure that still has retries left. An unchanged, already-handled
 * description is never sent again.
 */
export function needsTranslationWork(row: TranslationWorkRow, now: Date = new Date()): boolean {
  const { cached } = row;
  if (!cached) return true;
  if (cached.sourceHash !== descriptionHash(row.description)) return true;
  if (cached.status !== "failed") return false;
  if (cached.attempts < MAX_TRANSLATION_ATTEMPTS) return true;
  const last = cached.updatedAt ? Date.parse(cached.updatedAt) : NaN;
  return Number.isNaN(last) || now.getTime() - last >= FAILED_RETRY_INTERVAL_MS;
}

/**
 * The rows to process this run, most useful first: upcoming/ongoing events
 * by start time (soonest first), then past events, most recent first —
 * their pages stay reachable, but nobody is planning to go to them.
 */
export function selectTranslationWork(rows: TranslationWorkRow[], now: Date, limit: number): TranslationWorkRow[] {
  const pending = rows.filter((r) => needsTranslationWork(r, now));
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
