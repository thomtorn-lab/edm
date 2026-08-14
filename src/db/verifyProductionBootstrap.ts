/**
 * Repeatable proof that a completely empty database can be prepared for
 * production with exactly three steps — migrations, the production
 * reference bootstrap, a real Hangaren sync — and that after this:
 * no demo/fake events exist, the required venue/source records exist, and
 * the sync genuinely works.
 *
 * DESTRUCTIVE: this script starts by dropping and recreating the `public`
 * (and `drizzle`) schema on whatever DATABASE_URL it's pointed at, to
 * guarantee it's starting from a truly empty database — exactly what a
 * fresh production database looks like before first deploy. Refuses to run
 * unless DATABASE_URL is obviously local, or ALLOW_DESTRUCTIVE_RESET=1 is
 * set — never point this at a real database you care about.
 */
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client";
import { discoveryQueue, events, sources, venues } from "./schema";
import { seedVenues, seedSourcesProduction } from "./referenceData";
import { runSourceSync } from "./sync";
import { createHangarenAdapter, HANGAREN_SOURCE_ID } from "@/lib/adapters/hangarenAdapter";
import { VENUES } from "@/lib/data/venues";
import { SOURCES } from "@/lib/data/sources";

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function assertSafeToDestroy() {
  const url = process.env.DATABASE_URL ?? "";
  const looksLocal = /localhost|127\.0\.0\.1|::1/.test(url);
  if (!looksLocal && process.env.ALLOW_DESTRUCTIVE_RESET !== "1") {
    console.error(
      "Refusing to run: this script DROPS the entire schema before starting.\n" +
        "DATABASE_URL doesn't look like a local database. If you're certain this is a\n" +
        "disposable database, re-run with ALLOW_DESTRUCTIVE_RESET=1. Never point this\n" +
        "at a real production database.",
    );
    process.exit(1);
  }
}

async function main() {
  assertSafeToDestroy();
  console.log("=== Empty database -> migrations -> production bootstrap -> real Hangaren sync ===\n");

  console.log("Step 0: reset to a truly empty database");
  // Dropping the schema itself requires schema-owner privileges the app's
  // own DB role won't have in a real deployment (e.g. Supabase); dropping
  // the specific tables it created via migrate() only needs table-owner
  // privileges, which it does have.
  for (const table of ["event_change_log", "source_event_links", "discovery_queue", "events", "sources", "venues"]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`));
  }
  // drizzle-kit's own migration-tracking schema — edm_app owns this one
  // (it's the role that created it), unlike `public` which Postgres itself
  // owns by default.
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  console.log("  done.\n");

  console.log("Step 1: migrations (drizzle-orm/node-postgres/migrator, same migrations/ dir as `npm run db:migrate`)");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  const [{ regclass: eventsTableExists }] = (await db.execute(sql`SELECT to_regclass('public.events') AS regclass`)).rows as { regclass: string | null }[];
  check("events table exists after migration", eventsTableExists !== null);
  const [{ regclass: sourcesTableExists }] = (await db.execute(sql`SELECT to_regclass('public.sources') AS regclass`)).rows as { regclass: string | null }[];
  check("sources table exists after migration", sourcesTableExists !== null);

  console.log("\nStep 2: production reference bootstrap (npm run db:seed:production's entry point, called directly)");
  const venueCount = await seedVenues();
  const sourceCount = await seedSourcesProduction();
  check(`all ${VENUES.length} real venues seeded`, venueCount === VENUES.length);
  check(`all ${SOURCES.length} real sources seeded`, sourceCount === SOURCES.length);

  const eventRowsAfterBootstrap = await db.select().from(events);
  check("ZERO events after bootstrap — no demo/fake content", eventRowsAfterBootstrap.length === 0, `found ${eventRowsAfterBootstrap.length}`);
  const discoveryRowsAfterBootstrap = await db.select().from(discoveryQueue);
  check("ZERO discovery-queue items after bootstrap — no demo content", discoveryRowsAfterBootstrap.length === 0, `found ${discoveryRowsAfterBootstrap.length}`);

  const [hangarenVenue] = await db.select().from(venues).where(eq(venues.id, "v-hangaren"));
  check("required venue v-hangaren exists", Boolean(hangarenVenue));
  const [hangarenSource] = await db.select().from(sources).where(eq(sources.id, HANGAREN_SOURCE_ID));
  check("required source src-hangaren exists", Boolean(hangarenSource));
  check(
    "source health is neutral ('never synced yet') before any sync — not the fixture's fabricated demo numbers",
    hangarenSource?.lastSuccessfulSync === null && hangarenSource?.eventsFound === 0 && hangarenSource?.lastError === null,
  );

  console.log("\nStep 3: real live Hangaren sync against this empty-but-bootstrapped database");
  const summary = await runSourceSync(HANGAREN_SOURCE_ID, "Hangaren", createHangarenAdapter());
  check("sync outcome ok", summary.outcome === "ok", JSON.stringify(summary));
  check("sync found real events on the live source", summary.candidatesFound > 0, `found ${summary.candidatesFound}`);
  check(
    "sync produced real results (created and/or queued for review)",
    summary.created + summary.updated + summary.queuedForReview > 0,
    JSON.stringify(summary),
  );

  const eventsAfterSync = await db.select().from(events);
  check(
    "every event after the sync is real, attributed to Hangaren — still zero fake/demo events",
    eventsAfterSync.length === summary.created && eventsAfterSync.every((e) => e.canonicalSourceId === HANGAREN_SOURCE_ID),
    `${eventsAfterSync.length} events, canonicalSourceIds: ${[...new Set(eventsAfterSync.map((e) => e.canonicalSourceId))]}`,
  );

  const [sourceAfterSync] = await db.select().from(sources).where(eq(sources.id, HANGAREN_SOURCE_ID));
  check(
    "source health now reflects the real sync that just ran",
    sourceAfterSync.lastSuccessfulSync !== null && sourceAfterSync.eventsFound === summary.candidatesFound,
  );

  console.log("\nStep 4: re-run the production bootstrap — must be idempotent and must NOT wipe the real sync history from step 3");
  const venueCountBeforeRerun = (await db.select().from(venues)).length;
  const sourceCountBeforeRerun = (await db.select().from(sources)).length;
  const healthBeforeRerun = sourceAfterSync;
  await seedVenues();
  await seedSourcesProduction();
  const venueCountAfterRerun = (await db.select().from(venues)).length;
  const sourceCountAfterRerun = (await db.select().from(sources)).length;
  check("re-running seeds no duplicate venues", venueCountAfterRerun === venueCountBeforeRerun, `${venueCountBeforeRerun} -> ${venueCountAfterRerun}`);
  check("re-running seeds no duplicate sources", sourceCountAfterRerun === sourceCountBeforeRerun, `${sourceCountBeforeRerun} -> ${sourceCountAfterRerun}`);
  const [sourceAfterRerun] = await db.select().from(sources).where(eq(sources.id, HANGAREN_SOURCE_ID));
  check(
    "src-hangaren's REAL accumulated sync history survives the re-run untouched (not reset to neutral)",
    sourceAfterRerun.lastSuccessfulSync?.getTime() === healthBeforeRerun.lastSuccessfulSync?.getTime() &&
      sourceAfterRerun.eventsFound === healthBeforeRerun.eventsFound,
    `before: ${JSON.stringify({ last: healthBeforeRerun.lastSuccessfulSync, found: healthBeforeRerun.eventsFound })}, after: ${JSON.stringify({ last: sourceAfterRerun.lastSuccessfulSync, found: sourceAfterRerun.eventsFound })}`,
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
