import type { Source } from "./types";

/**
 * Pure logic for building a production-safe source-registry row — no
 * database import, so this is testable in isolation (referenceData.test.ts)
 * without a live Postgres connection. src/db/referenceData.ts is the
 * DB-touching caller.
 */

type SourceStaticFields = Omit<
  Source,
  "lastSuccessfulSync" | "lastAttemptedSync" | "lastError" | "eventsFound" | "eventsUpdated"
>;

export interface ProductionSourceRow {
  /** Full row to use on first INSERT: static config + a neutral "never synced yet" health state. */
  insertRow: SourceStaticFields & {
    lastSuccessfulSync: null;
    lastAttemptedSync: null;
    lastError: null;
    eventsFound: 0;
    eventsUpdated: 0;
  };
  /** Fields to write on a re-run (ON CONFLICT). Deliberately excludes every
   *  health field, so re-running the bootstrap never resets a source's real
   *  accumulated sync history back to neutral. */
  updateSet: SourceStaticFields;
}

/**
 * Splits a source fixture into its static configuration (identity,
 * classification, trust level, integration note — real research about a
 * real external source, safe for production) and its sync-health fields,
 * which in the fixture are FABRICATED demo numbers standing in for what a
 * real/degraded source might look like (e.g. Gravity's staged "0 events
 * parsed from the last 3 attempts" error — the real Gravity page does
 * currently 404, but that specific message was never produced by a real
 * sync attempt).
 */
export function toProductionSourceRow(fixture: Source): ProductionSourceRow {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarded on purpose, this is the strip
  const { lastSuccessfulSync, lastAttemptedSync, lastError, eventsFound, eventsUpdated, ...staticFields } = fixture;
  return {
    insertRow: {
      ...staticFields,
      lastSuccessfulSync: null,
      lastAttemptedSync: null,
      lastError: null,
      eventsFound: 0,
      eventsUpdated: 0,
    },
    updateSet: staticFields,
  };
}
