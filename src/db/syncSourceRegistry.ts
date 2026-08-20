/**
 * One-off, explicitly scoped Production source-registry correction:
 * re-applies ONLY the static configuration fields (see
 * src/lib/sourceRegistry.ts::toProductionSourceRow) for the source id(s)
 * given on the command line, reusing the exact same upsert logic as the
 * full bootstrap (seedSourcesProduction in src/db/referenceData.ts) — same
 * guarantee that a source's real accumulated sync-health fields
 * (lastSuccessfulSync/lastAttemptedSync/lastError/eventsFound/eventsUpdated)
 * are never reset, since those are excluded from the update-on-conflict
 * set. Never touches venues, any other source's row, events,
 * discovery_queue, or source_event_links — and never runs a migration.
 *
 * For seeding EVERY source, use `npm run db:seed:production` instead; this
 * script deliberately refuses to run with zero ids so it can never be
 * mistaken for that.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/syncSourceRegistry.ts <source-id> [<source-id> ...]
 */
import { seedSourcesProduction } from "./referenceData";
import { getSourceById } from "../lib/data/sources";

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error(
      "::error::Usage: syncSourceRegistry.ts <source-id> [<source-id> ...] — at least one source id is required. This script never seeds every source; use `npm run db:seed:production` for that.",
    );
    process.exit(1);
  }
  for (const id of ids) {
    if (!/^src-[a-z0-9-]+$/.test(id)) {
      console.error(`::error::Invalid source id "${id}" — must match src-[a-z0-9-]+.`);
      process.exit(1);
    }
    if (!getSourceById(id)) {
      console.error(`::error::"${id}" is not defined in src/lib/data/sources.ts — check for a typo before running against Production.`);
      process.exit(1);
    }
  }

  const count = await seedSourcesProduction(ids);
  console.log(`Synced static configuration for ${count}/${ids.length} requested source id(s): ${ids.join(", ")}.`);
  console.log("Untouched: every other source's row, venues, events, discovery_queue, source_event_links.");
  process.exit(0);
}

main().catch((err) => {
  console.error("syncSourceRegistry.ts FAILED:", err);
  process.exit(1);
});
