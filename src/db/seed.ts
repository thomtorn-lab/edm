/**
 * Loads the existing sample fixtures (src/lib/data/*.ts) into Postgres.
 * This is the "safe seed/development-data mechanism" the fixtures are kept
 * for — they're no longer read directly by the app (see src/lib/queries.ts),
 * but they remain the source of truth for local/dev/test seed data instead
 * of being deleted.
 *
 * Idempotent: safe to re-run, upserts by primary key.
 */
import { db } from "./client";
import { venues, sources, events, discoveryQueue } from "./schema";
import { VENUES } from "../lib/data/venues";
import { SOURCES } from "../lib/data/sources";
import { EVENTS } from "../lib/data/events";
import { DISCOVERY_QUEUE } from "../lib/data/discoveryQueue";
import { sql } from "drizzle-orm";

async function seed() {
  console.log(`Seeding ${VENUES.length} venues...`);
  for (const v of VENUES) {
    await db
      .insert(venues)
      .values(v)
      .onConflictDoUpdate({ target: venues.id, set: { ...v, updatedAt: new Date() } });
  }

  console.log(`Seeding ${SOURCES.length} sources...`);
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

  console.log(`Seeding ${EVENTS.length} events...`);
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

  console.log(`Seeding ${DISCOVERY_QUEUE.length} discovery queue items...`);
  for (const d of DISCOVERY_QUEUE) {
    const row = {
      ...d,
      probableStart: d.probableStart ? new Date(d.probableStart) : null,
    };
    await db.insert(discoveryQueue).values(row).onConflictDoUpdate({ target: discoveryQueue.id, set: row });
  }

  console.log("Seed complete.");
  await db.execute(sql`SELECT 1`); // sanity ping before exit
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
