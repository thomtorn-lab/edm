import { eq } from "drizzle-orm";
import { db } from "./client";
import { venues } from "./schema";
import { updateVenuePostalCode, updateVenueProfile } from "./writes";

/**
 * One-time, narrow Production correction (venue coverage expansion
 * follow-up, 2026-08-29). The prior round's address corrections for
 * BETA2300 and WAREHOUSE9 (via updateVenueAddress, which only touches the
 * `address` column) left two fields stale and now internally inconsistent
 * with the corrected addresses:
 *
 *   - BETA2300: postal_code still "2200" (Nørrebro), address now Amager
 *     (2300); description still said "Nørrebro event space...".
 *   - WAREHOUSE9: postal_code still "1620" (Vesterbro), address now
 *     Vanløse (2720); description still said "...under Dybbølsbro...".
 *
 * This script corrects exactly those two fields on exactly those two
 * rows — never touches address, name, aliases, curation status, or any
 * other venue, and never touches events/sources.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/venueMetadataFollowup.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/venueMetadataFollowup.ts --mode=apply --confirm=VENUE-METADATA-FOLLOWUP-2026-08-29
 *
 * --mode=plan is entirely read-only. --mode=apply re-verifies every
 * expected fact (current address, current postal code, current
 * description) immediately before each row's writes and skips that row
 * (never aborts the whole run) if state has changed since review.
 */

const FIXES: {
  venueId: string;
  expectedAddress: string;
  expectedPostalCode: string;
  expectedDescription: string;
  newPostalCode: string;
  newDescription: string;
}[] = [
  {
    venueId: "v-beta2300",
    expectedAddress: "Øresundsvej 6, 2300 København S",
    expectedPostalCode: "2200",
    expectedDescription: "Nørrebro event space hosting techno and electro-leaning club nights and touring live acts.",
    newPostalCode: "2300",
    newDescription: "Amager event space hosting techno and electro-leaning club nights and touring live acts.",
  },
  {
    venueId: "v-warehouse9",
    expectedAddress: "Rosenlunds Allé 5, Baghuset, 2720 Vanløse",
    expectedPostalCode: "1620",
    expectedDescription: "Underground club under Dybbølsbro known for queer-friendly, bass-forward electronic nights.",
    newPostalCode: "2720",
    newDescription: "Performance-art venue, gallery and queer social space in Vanløse, hosting occasional club and nightlife nights alongside its core art and theatre programme.",
  },
];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const body = raw.slice(2);
    const eqIdx = body.indexOf("=");
    if (eqIdx === -1) out[body] = "true";
    else out[body.slice(0, eqIdx)] = body.slice(eqIdx + 1);
  }
  return out;
}

async function loadVenue(id: string) {
  const [row] = await db.select().from(venues).where(eq(venues.id, id)).limit(1);
  return row ?? null;
}

function summarize(row: NonNullable<Awaited<ReturnType<typeof loadVenue>>>) {
  return { id: row.id, name: row.name, address: row.address, postalCode: row.postalCode, description: row.description };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }
  if (mode === "apply" && args.confirm !== "VENUE-METADATA-FOLLOWUP-2026-08-29") {
    throw new Error("--mode=apply requires --confirm=VENUE-METADATA-FOLLOWUP-2026-08-29");
  }

  for (const fix of FIXES) {
    console.log("\n" + "=".repeat(80));
    console.log(fix.venueId);
    console.log("=".repeat(80));

    const before = await loadVenue(fix.venueId);
    if (!before) {
      console.log(`SKIP: not found.`);
      continue;
    }
    console.log("Current:", summarize(before));

    const problems: string[] = [];
    if (before.address !== fix.expectedAddress) problems.push(`address is "${before.address}", expected "${fix.expectedAddress}" — aborting, not touching address.`);
    if (before.postalCode !== fix.expectedPostalCode) problems.push(`postalCode is "${before.postalCode}", expected "${fix.expectedPostalCode}" — already changed since review.`);
    if (before.description !== fix.expectedDescription) problems.push(`description is "${before.description}", expected "${fix.expectedDescription}" — already changed since review.`);

    if (problems.length > 0) {
      console.log("SKIP — state differs from the reviewed state:");
      for (const p of problems) console.log(`  - ${p}`);
      continue;
    }

    console.log(`Intended: postalCode "${fix.expectedPostalCode}" -> "${fix.newPostalCode}"; description -> "${fix.newDescription}"`);
    if (mode === "apply") {
      await updateVenuePostalCode(fix.venueId, fix.newPostalCode);
      await updateVenueProfile(fix.venueId, { description: fix.newDescription });
      const after = await loadVenue(fix.venueId);
      console.log("APPLIED. Read-back:", after ? summarize(after) : null);
    }
  }

  console.log("\n" + (mode === "plan" ? "PLAN ONLY — no writes were made." : "APPLY complete — see APPLIED/read-back lines above for what actually changed."));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
