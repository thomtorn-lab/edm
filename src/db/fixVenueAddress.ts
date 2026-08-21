import { eq } from "drizzle-orm";
import { db } from "./client";
import { venues } from "./schema";
import { updateVenueAddress } from "./writes";

/**
 * One-time, narrow venue-data correction (partner-ready polish pass —
 * Hangaren address fix). Venues are seeded once from
 * src/lib/data/venues.ts at bootstrap and never automatically re-synced
 * from that fixture, so a code-level address correction there does not by
 * itself reach an already-seeded Production/Preview database. This script
 * corrects one venue's stored address directly.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/fixVenueAddress.ts \
 *     --mode=plan --venue=v-hangaren --address="Refshalevej 185, 1432 København K"
 *   node --env-file=.env.local --import tsx src/db/fixVenueAddress.ts \
 *     --mode=apply --venue=v-hangaren --address="Refshalevej 185, 1432 København K" \
 *     --confirm=FIX-VENUE-ADDRESS
 *
 * --mode=plan is read-only (no write statement reachable in that branch)
 * and only prints the venue's current vs. proposed address. --mode=apply
 * requires the exact confirmation string.
 */

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) out[body] = "true";
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  const venueId = args.venue;
  const newAddress = args.address;
  if (mode !== "plan" && mode !== "apply") throw new Error('--mode must be "plan" or "apply"');
  if (!venueId) throw new Error("--venue=<venue id> is required");
  if (!newAddress) throw new Error("--address=<new address> is required");

  const [existing] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
  if (!existing) throw new Error(`Venue ${venueId} not found`);

  console.log(`Venue: ${existing.name} (${existing.id})`);
  console.log(`Current address: "${existing.address}"`);
  console.log(`Proposed address: "${newAddress}"`);

  if (existing.address === newAddress) {
    console.log("Already correct — nothing to do.");
    return;
  }

  if (mode === "apply") {
    if (args.confirm !== "FIX-VENUE-ADDRESS") {
      throw new Error("--mode=apply requires --confirm=FIX-VENUE-ADDRESS");
    }
    await updateVenueAddress(venueId, newAddress);
    console.log("APPLIED.");
  } else {
    console.log("\nPLAN ONLY — no write was made. Re-run with --mode=apply --confirm=FIX-VENUE-ADDRESS to apply.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
