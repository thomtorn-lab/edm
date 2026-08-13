import type { Source } from "./types";

export type SourceHealth = "ok" | "degraded" | "inactive" | "discovery-only";

/**
 * Health classification for the admin source registry (spec section 43).
 * A source failure or an unexpected zero-event reading must never be
 * silently swallowed, and must never be misread as the venue itself going
 * quiet — it always surfaces as "degraded" for a human to check.
 */
export function getSourceHealth(source: Source): SourceHealth {
  if (!source.active) return "inactive";
  if (!source.adapter) return "discovery-only";
  if (source.lastError) return "degraded";
  if (source.lastSuccessfulSync && source.eventsFound === 0) return "degraded";
  return "ok";
}
