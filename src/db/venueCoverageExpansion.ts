import { eq } from "drizzle-orm";
import { db } from "./client";
import { venues } from "./schema";
import { createVenue, updateVenueAddress, updateVenueProfile } from "./writes";

/**
 * One-time Production reference-data correction + addition (venue coverage
 * expansion audit, 2026-08-29; revised twice after re-audit rounds). Two
 * independent kinds of write, both narrow and idempotent-checked before
 * applying:
 *
 * 1. Address corrections for two already-registered, already-real venues —
 *    BETA2300, WAREHOUSE9. See src/lib/data/venues.ts's per-venue comments
 *    for the full evidence. KB18 is deliberately EXCLUDED from this round:
 *    secondary sources suggest a different/still-active address, but
 *    first-party 2026 evidence wasn't strong enough to justify a Production
 *    write — left untouched pending a dedicated verification pass (never
 *    deleted or deactivated). Address fixes never touch curation status,
 *    name, or any other field.
 *
 * 2. Adds one new real physical venue — Pylonen (Christians Brygge 31,
 *    under the Langebro bridge) — via the existing human-gated
 *    createVenue() path (the same one DiscoveryQueue's "Create new venue"
 *    action uses), then sets its editorial copy via updateVenueProfile().
 *    Verified directly against the venue's own official site
 *    (pylonen.horse, live-fetched HTTP 200): exact address/GPS match, and a
 *    real booked 2026 programme (15 events through December) including
 *    confirmed house/techno day parties from the established Copenhagen
 *    crew Pleasure Control. Never adds any event or source — this is
 *    registry/curated-guide data only.
 *
 * Solvang Hallen is deliberately NOT touched by this script: three
 * independent search rounds (including Danish-language terms) found zero
 * evidence it is a real, current venue at all. No address correction is
 * possible without a verified source to correct it against, and no
 * deletion is performed per instruction — it is flagged in the audit
 * report for a future verification/removal pass instead.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/venueCoverageExpansion.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/venueCoverageExpansion.ts --mode=apply --confirm=VENUE-COVERAGE-EXPANSION-2026-08-29
 *
 * --mode=plan is entirely read-only. --mode=apply re-verifies every expected
 * fact immediately before each write and skips (never aborts the whole run)
 * any single item whose current state no longer matches what was reviewed —
 * each action here is independent of the others.
 */

const ADDRESS_FIXES: { venueId: string; expectedCurrent: string; corrected: string }[] = [
  { venueId: "v-beta2300", expectedCurrent: "Nørrebrogade 200, 2200 København N", corrected: "Øresundsvej 6, 2300 København S" },
  { venueId: "v-warehouse9", expectedCurrent: "Underground pladsen 9, 1620 København V", corrected: "Rosenlunds Allé 5, Baghuset, 2720 Vanløse" },
];

const PYLONEN = {
  name: "Pylonen",
  address: "Christians Brygge 31, 1219 Copenhagen K",
  city: "Copenhagen" as const,
  postalCode: "1219",
  websiteUrl: "https://pylonen.horse/",
  description:
    "Temporary art-and-event space under the Langebro bridge, running a mixed 2026 season that includes house and techno day parties from Copenhagen crews like Pleasure Control.",
  shortDescription:
    "Temporary outdoor/indoor space under Langebro bridge, running a mixed 2026 programme of art, markets and parties, including house and techno nights from local crews like Pleasure Control.",
  venueProfile:
    'Pylonen is a temporary event and art space built into the raw edge under the Langebro bridge at Christians Brygge, on the water between Vesterbro and Christianshavn. Framed by its organisers as "a raw edge between water, traffic and the unknown," it runs a full seasonal programme mixing art, markets, performance and outdoor parties rather than a single fixed genre identity. Its electronic programming includes outdoor day parties from established Copenhagen house and techno crews such as Pleasure Control, alongside a residency slot from the Fluid Sound Collective. As a temporary, seasonally-organised space rather than a permanent club, its exact form can change between seasons, but its current 2026 installation runs a booked calendar through December.',
};

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

async function runAddressFixes(apply: boolean) {
  console.log("\n" + "=".repeat(80));
  console.log("ADDRESS CORRECTIONS");
  console.log("=".repeat(80));
  for (const fix of ADDRESS_FIXES) {
    const row = await loadVenue(fix.venueId);
    if (!row) {
      console.log(`SKIP ${fix.venueId}: not found.`);
      continue;
    }
    console.log(`${fix.venueId} (${row.name}): current="${row.address}"`);
    if (row.address !== fix.expectedCurrent) {
      console.log(`  SKIP: address no longer matches the reviewed value (expected "${fix.expectedCurrent}") — state has changed since review, not applying blindly.`);
      continue;
    }
    console.log(`  Intended: "${fix.expectedCurrent}" -> "${fix.corrected}"`);
    if (apply) {
      await updateVenueAddress(fix.venueId, fix.corrected);
      const after = await loadVenue(fix.venueId);
      console.log(`  APPLIED. Read-back address: "${after?.address}"`);
    }
  }
}

async function runPylonenAdd(apply: boolean) {
  console.log("\n" + "=".repeat(80));
  console.log("ADD VENUE: Pylonen");
  console.log("=".repeat(80));
  const existingRows = await db.select().from(venues);
  const bySlug = existingRows.find((v) => v.slug === "pylonen");
  if (bySlug) {
    console.log(`SKIP: a venue with slug "pylonen" already exists (${bySlug.id}) — not creating a duplicate.`);
    return;
  }
  console.log(`Intended: create venue "${PYLONEN.name}" at "${PYLONEN.address}", then set its editorial profile.`);
  if (apply) {
    const result = await createVenue(PYLONEN, { confirmed: true });
    console.log(`  createVenue -> created=${result.created}, id=${result.venue.id}`);
    await updateVenueProfile(result.venue.id, {
      description: PYLONEN.description,
      shortDescription: PYLONEN.shortDescription,
      venueProfile: PYLONEN.venueProfile,
    });
    const after = await loadVenue(result.venue.id);
    console.log("  Read-back:", after ? { id: after.id, slug: after.slug, name: after.name, address: after.address, description: after.description, shortDescription: after.shortDescription } : null);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }
  if (mode === "apply" && args.confirm !== "VENUE-COVERAGE-EXPANSION-2026-08-29") {
    throw new Error("--mode=apply requires --confirm=VENUE-COVERAGE-EXPANSION-2026-08-29");
  }

  await runAddressFixes(mode === "apply");
  await runPylonenAdd(mode === "apply");

  console.log("\n" + (mode === "plan" ? "PLAN ONLY — no writes were made." : "APPLY complete — see APPLIED/read-back lines above for what actually changed."));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
