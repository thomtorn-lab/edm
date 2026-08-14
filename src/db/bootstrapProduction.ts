/**
 * Production-safe reference-data bootstrap. Seeds ONLY the venue and
 * source registries — real data the app genuinely needs to operate (e.g.
 * the Hangaren pipeline can never resolve a venue without the v-hangaren
 * row existing, and source health can't be tracked without a src-hangaren
 * row) — and deliberately inserts NO Phase-1 demo content: no sample
 * events, no sample discovery-queue items, and no fabricated source
 * sync-history (sources get a neutral "never synced yet" health state;
 * only a real sync run is ever allowed to populate that — see
 * src/db/referenceData.ts).
 *
 * Idempotent: safe to run more than once, including against a database
 * that already has real accumulated sync history — see
 * seedSourcesProduction's doc comment for exactly what a re-run does and
 * does not touch.
 *
 * Use this in production. For local development/demo — which also wants
 * sample events and the sources' staged demo health states to look at —
 * use `npm run db:seed:dev` instead (src/db/seedDev.ts).
 */
import { sql } from "drizzle-orm";
import { db } from "./client";
import { seedVenues, seedSourcesProduction } from "./referenceData";

async function bootstrap() {
  console.log("Production reference-data bootstrap — venues + sources only, no demo content.\n");

  const venueCount = await seedVenues();
  console.log(`Venues: ${venueCount} upserted.`);

  const sourceCount = await seedSourcesProduction();
  console.log(`Sources: ${sourceCount} upserted (static configuration only — sync health left neutral/untouched).`);

  console.log(
    "\nDone. Inserted/updated: venues, sources (static config).\n" +
      "Did NOT insert: sample events, sample discovery-queue items, or fabricated source sync-history.",
  );
  await db.execute(sql`SELECT 1`); // sanity ping before exit
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error("Production bootstrap failed:", err);
  process.exit(1);
});
