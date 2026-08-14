import { db } from "./client";
import { venues, sources } from "./schema";
import { VENUES } from "../lib/data/venues";
import { SOURCES } from "../lib/data/sources";
import { toProductionSourceRow } from "../lib/sourceRegistry";

/**
 * Shared by both the dev/demo seed (src/db/seedDev.ts) and the
 * production-safe bootstrap (src/db/bootstrapProduction.ts). Venues are
 * pure static reference data — real Copenhagen/Frederiksberg venues, not
 * demo content — with nothing fabricated to strip out, so both entry
 * points use this exact same function.
 *
 * Idempotent: upserts by primary key, safe to run repeatedly.
 */
export async function seedVenues(): Promise<number> {
  for (const v of VENUES) {
    await db.insert(venues).values(v).onConflictDoUpdate({ target: venues.id, set: { ...v, updatedAt: new Date() } });
  }
  return VENUES.length;
}

/**
 * Production-safe source registry seed: static configuration only, no
 * fabricated sync-history. A source's health fields
 * (lastSuccessfulSync/lastAttemptedSync/lastError/eventsFound/eventsUpdated)
 * must only ever be written by a REAL sync run
 * (src/db/writes.ts::touchSourceSyncStats) — never by a seed script. The
 * splitting logic itself lives in src/lib/sourceRegistry.ts (pure,
 * unit-tested without a database).
 *
 * Idempotent: safe to run more than once. Re-running never duplicates a
 * source (upsert by primary key) and never resets an already-synced
 * source's real health data — only the static fields are in the
 * update-on-conflict `set`.
 */
export async function seedSourcesProduction(): Promise<number> {
  for (const fixture of SOURCES) {
    const { insertRow, updateSet } = toProductionSourceRow(fixture);
    await db.insert(sources).values(insertRow).onConflictDoUpdate({ target: sources.id, set: updateSet });
  }
  return SOURCES.length;
}
