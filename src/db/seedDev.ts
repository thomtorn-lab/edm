/**
 * Development/demo seed — loads the FULL Phase-1 fixture set: the real
 * venue/source registries (via seedVenues(), shared with the production
 * bootstrap) PLUS sample events, sample discovery-queue items, and the
 * sources' staged demo sync-health states (e.g. Gravity's fabricated
 * "degraded" example). Useful for seeing the full UI locally with
 * something to look at — NEVER appropriate for a real deployment.
 *
 * For production, use `npm run db:seed:production`
 * (src/db/bootstrapProduction.ts) instead, which seeds only the real
 * venue/source registries and inserts no demo content at all.
 *
 * Idempotent: safe to re-run, upserts by primary key.
 */
import { db } from "./client";
import { sources, events, discoveryQueue } from "./schema";
import { seedVenues } from "./referenceData";
import { SOURCES } from "../lib/data/sources";
import { EVENTS } from "../lib/data/events";
import { DISCOVERY_QUEUE } from "../lib/data/discoveryQueue";
import { sql } from "drizzle-orm";

async function seed() {
  const venueCount = await seedVenues();
  console.log(`Seeded ${venueCount} venues.`);

  console.log(`Seeding ${SOURCES.length} sources (including staged demo sync-health states)...`);
  for (const s of SOURCES) {
    const { lastSuccessfulSync, lastAttemptedSync, ...rest } = s;
    await db
      .insert(sources)
      .values({
        ...rest,
        lastSuccessfulSync: lastSuccessfulSync ? new Date(lastSuccessfulSync) : null,
        lastAttemptedSync: lastAttemptedSync ? new Date(lastAttemptedSync) : null,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          ...rest,
          lastSuccessfulSync: lastSuccessfulSync ? new Date(lastSuccessfulSync) : null,
          lastAttemptedSync: lastAttemptedSync ? new Date(lastAttemptedSync) : null,
        },
      });
  }

  console.log(`Seeding ${EVENTS.length} sample events...`);
  for (const e of EVENTS) {
    const row = {
      ...e,
      startDatetime: new Date(e.startDatetime),
      endDatetime: e.endDatetime ? new Date(e.endDatetime) : null,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
      lastSourceCheck: e.lastSourceCheck ? new Date(e.lastSourceCheck) : null,
      lastChanged: e.lastChanged ? new Date(e.lastChanged) : null,
      overriddenFields: [] as string[],
    };
    await db.insert(events).values(row).onConflictDoUpdate({ target: events.id, set: row });
  }

  console.log(`Seeding ${DISCOVERY_QUEUE.length} sample discovery queue items...`);
  for (const d of DISCOVERY_QUEUE) {
    const row = {
      ...d,
      probableStart: d.probableStart ? new Date(d.probableStart) : null,
    };
    await db.insert(discoveryQueue).values(row).onConflictDoUpdate({ target: discoveryQueue.id, set: row });
  }

  console.log("\nDev seed complete (includes sample/demo content — never run this against production; use `npm run db:seed:production` there instead).");
  await db.execute(sql`SELECT 1`); // sanity ping before exit
  process.exit(0);
}

seed().catch((err) => {
  console.error("Dev seed failed:", err);
  process.exit(1);
});
