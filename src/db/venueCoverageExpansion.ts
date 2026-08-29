import { eq } from "drizzle-orm";
import { db } from "./client";
import { venues } from "./schema";
import { createVenue, updateVenueAddress, updateVenueProfile } from "./writes";

/**
 * One-time Production reference-data correction + addition (venue coverage
 * expansion audit, 2026-08-29). Two independent kinds of write, both narrow
 * and idempotent-checked before applying:
 *
 * 1. Address corrections for three already-registered, already-real venues
 *    whose stored address does not match any independently-verified source
 *    (KB18, BETA2300, WAREHOUSE9 — see src/lib/data/venues.ts's per-venue
 *    comments for the evidence). Never touches curation status, name, or
 *    any other field.
 *
 * 2. Adds one new real physical venue — Ungdomshuset (Dortheavej 61,
 *    Bispebjerg) — via the existing human-gated createVenue() path (the
 *    same one DiscoveryQueue's "Create new venue" action uses), then sets
 *    its editorial copy via updateVenueProfile() so it renders correctly on
 *    curated /venues from the moment src/lib/data/venues.ts's
 *    CURATED_VENUE_SLUGS addition reaches Production. Never adds any event
 *    or source — this is registry/curated-guide data only.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/venueCoverageExpansion.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/venueCoverageExpansion.ts --mode=apply --confirm=VENUE-COVERAGE-EXPANSION-2026-08-29
 *
 * --mode=plan is entirely read-only. --mode=apply re-verifies every expected
 * fact immediately before each write and skips (never aborts the whole run)
 * any single item whose current state no longer matches what was reviewed —
 * each of the 4 actions here is independent of the other 3.
 */

const ADDRESS_FIXES: { venueId: string; expectedCurrent: string; corrected: string }[] = [
  { venueId: "v-kb18", expectedCurrent: "Krusågade 18, 1719 København V", corrected: "Kødboderne 18, 1714 København V" },
  { venueId: "v-beta2300", expectedCurrent: "Nørrebrogade 200, 2200 København N", corrected: "Øresundsvej 6, 2300 København S" },
  { venueId: "v-warehouse9", expectedCurrent: "Underground pladsen 9, 1620 København V", corrected: "Halmtorvet 11 C, 1700 København V" },
];

const UNGDOMSHUSET = {
  name: "Ungdomshuset",
  address: "Dortheavej 61, 2400 København NV",
  city: "Copenhagen" as const,
  postalCode: "2400",
  websiteUrl: null,
  description:
    "Volunteer-run social centre and underground music venue in Bispebjerg, hosting punk, hardcore and DIY concerts alongside recurring rave, electro and techno nights.",
  shortDescription:
    "Volunteer-run, autonomist social centre in Bispebjerg with a powerful soundsystem, hosting punk and hardcore alongside a recurring basement rave, electro and techno night.",
  venueProfile:
    'Ungdomshuset ("the Youth House") is a volunteer-run social centre in Bispebjerg, rebuilt at Dortheavej 61 in 2013 after its original Nørrebro building was demolished. It operates as a focal point for Copenhagen\'s autonomist and leftist scenes, with a strict door policy against racism, sexism, homophobia, violence and hard drugs, and bar prices kept deliberately low. Its programme spans punk, hardcore and DIY concerts alongside a powerful soundsystem built for club-style nights, including a recurring basement party mixing electro, techno and rave classics. Ungdomshuset\'s non-commercial, community-run model makes it one of Copenhagen\'s longest-standing alternatives to the city\'s mainstream club circuit.',
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

async function runUngdomshusetAdd(apply: boolean) {
  console.log("\n" + "=".repeat(80));
  console.log("ADD VENUE: Ungdomshuset");
  console.log("=".repeat(80));
  const existingRows = await db.select().from(venues);
  const bySlug = existingRows.find((v) => v.slug === "ungdomshuset");
  if (bySlug) {
    console.log(`SKIP: a venue with slug "ungdomshuset" already exists (${bySlug.id}) — not creating a duplicate.`);
    return;
  }
  console.log(`Intended: create venue "${UNGDOMSHUSET.name}" at "${UNGDOMSHUSET.address}", then set its editorial profile.`);
  if (apply) {
    const result = await createVenue(UNGDOMSHUSET, { confirmed: true });
    console.log(`  createVenue -> created=${result.created}, id=${result.venue.id}`);
    await updateVenueProfile(result.venue.id, {
      description: UNGDOMSHUSET.description,
      shortDescription: UNGDOMSHUSET.shortDescription,
      venueProfile: UNGDOMSHUSET.venueProfile,
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
  await runUngdomshusetAdd(mode === "apply");

  console.log("\n" + (mode === "plan" ? "PLAN ONLY — no writes were made." : "APPLY complete — see APPLIED/read-back lines above for what actually changed."));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
