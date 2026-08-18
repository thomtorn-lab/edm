import type { Source } from "./types";

export type SourceHealth = "ok" | "degraded" | "stale" | "inactive" | "discovery-only";

/**
 * A source is considered stale once it's gone this many multiples of its
 * own configured syncFrequency without a successful sync. 2x tolerates one
 * missed/delayed cycle (scheduler jitter, a transient outage that recovers
 * on the very next run) without paging on noise, while still catching a
 * genuinely broken source within one extra cycle of when it should have
 * recovered.
 */
const STALE_THRESHOLD_MULTIPLIER = 2;

const SYNC_FREQUENCY_PATTERN = /^every\s+(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|d|day|days)$/i;

/**
 * Parses fixed-cadence syncFrequency strings like "every 6h" (see
 * src/lib/data/sources.ts) into a millisecond interval. Anything that
 * doesn't match a fixed cadence — "manual", "manual coverage check" — isn't
 * on an automated schedule at all, so there's no freshness threshold to
 * compare against (returns null, meaning "never stale").
 */
export function parseSyncFrequencyMs(syncFrequency: string): number | null {
  const match = syncFrequency.trim().match(SYNC_FREQUENCY_PATTERN);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("h")) return value * 60 * 60 * 1000;
  if (unit.startsWith("m")) return value * 60 * 1000;
  if (unit.startsWith("d")) return value * 24 * 60 * 60 * 1000;
  return null;
}

/**
 * True once a source with a fixed sync cadence has gone more than
 * STALE_THRESHOLD_MULTIPLIER cycles since its last successful sync. A
 * source that has never had a successful sync yet (brand new, not run in
 * this environment) is deliberately not flagged here — see
 * src/lib/data/sources.ts's Culture Box integrationNote ("health fields
 * will populate on the first real sync").
 */
export function isStale(source: Source, now: Date = new Date()): boolean {
  if (!source.lastSuccessfulSync) return false;
  const intervalMs = parseSyncFrequencyMs(source.syncFrequency);
  if (intervalMs === null) return false;
  const elapsedMs = now.getTime() - new Date(source.lastSuccessfulSync).getTime();
  return elapsedMs > intervalMs * STALE_THRESHOLD_MULTIPLIER;
}

/**
 * Health classification for the admin source registry (spec section 43)
 * and the automated source-health monitor (src/db/checkSourceHealth.ts). A
 * source failure, an unexpected zero-event reading, or a source that's gone
 * quiet for longer than its own configured syncFrequency allows must never
 * be silently swallowed, and must never be misread as the venue itself
 * going quiet — each surfaces distinctly for a human to check.
 */
export function getSourceHealth(source: Source, now: Date = new Date()): SourceHealth {
  if (!source.active) return "inactive";
  if (!source.adapter) return "discovery-only";
  if (source.lastError) return "degraded";
  if (source.lastSuccessfulSync && source.eventsFound === 0) return "degraded";
  if (isStale(source, now)) return "stale";
  return "ok";
}

/** Human-readable reason behind a getSourceHealth verdict, for logs/UI. */
export function describeSourceHealth(source: Source, now: Date = new Date()): string {
  const health = getSourceHealth(source, now);
  switch (health) {
    case "inactive":
      return "source is marked inactive";
    case "discovery-only":
      return "no ingestion adapter configured (discovery only)";
    case "degraded":
      return source.lastError ? `last sync reported an error: ${source.lastError}` : "last successful sync reported zero events found";
    case "stale": {
      const elapsedHours = Math.round(
        (now.getTime() - new Date(source.lastSuccessfulSync as string).getTime()) / (60 * 60 * 1000),
      );
      return `no successful sync in ~${elapsedHours}h, exceeding the ${STALE_THRESHOLD_MULTIPLIER}x freshness threshold for syncFrequency "${source.syncFrequency}"`;
    }
    case "ok":
      return "healthy";
  }
}
