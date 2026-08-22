import { eq } from "drizzle-orm";
import { db } from "./client";
import { venues } from "./schema";
import { VENUES } from "../lib/data/venues";

/**
 * One-time, narrow content sync (Venue Directory Quality release-gate
 * audit follow-up): the release-gate audit flagged several venueProfile/
 * shortDescription/description values as factual-risk (unverified
 * capacity/equipment/size figures, historical-tenant claims, operating-
 * day claims, demographic claims, reputation language). Those 10 venues'
 * copy was sanitized in src/lib/data/venues.ts, but the earlier
 * bootstrapProduction.ts run already wrote the PRE-sanitization copy to
 * the shared DB, so this syncs exactly those 10 rows' content fields —
 * nothing else. It does not touch sources, does not touch any other
 * venue's row, and does not re-run seedSourcesProduction.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/syncVenueCopySanitization.ts
 */
const SANITIZED_VENUE_IDS = [
  "v-culture-box",
  "v-module",
  "v-h15",
  "v-hotel-cecil",
  "v-tap1",
  "v-underwerket",
  "v-baggen",
  "v-bolsjefabrikken",
  "v-poolen",
  "v-vega-ideal-bar",
];

async function main() {
  console.log("Venue copy sanitization sync — updating description/shortDescription/venueProfile on exactly 10 rows.\n");
  let updated = 0;
  for (const id of SANITIZED_VENUE_IDS) {
    const venue = VENUES.find((v) => v.id === id);
    if (!venue) {
      throw new Error(`Expected venue "${id}" not found in VENUES — aborting without writing.`);
    }
    await db
      .update(venues)
      .set({
        description: venue.description,
        shortDescription: venue.shortDescription,
        venueProfile: venue.venueProfile,
        updatedAt: new Date(),
      })
      .where(eq(venues.id, id));
    console.log(`Updated ${id} (${venue.name}).`);
    updated++;
  }
  console.log(`\nDone. ${updated}/${SANITIZED_VENUE_IDS.length} rows updated. No other fields, venues, or tables touched.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Venue copy sanitization sync failed:", err);
  process.exit(1);
});
