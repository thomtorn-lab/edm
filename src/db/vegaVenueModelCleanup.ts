import { eq } from "drizzle-orm";
import { db } from "./client";
import { venues } from "./schema";
import { createVenue, updateVenueAliases, updateVenueProfile } from "./writes";

/**
 * One-time Production venue-model correction (VEGA venue model cleanup,
 * 2026-09-06). Two independent, idempotent-checked writes:
 *
 * 1. Registers the new VEGA parent venue (v-vega) via the existing
 *    human-gated createVenue() path, then sets its editorial copy —
 *    exact same two-step pattern venueCoverageExpansion.ts used for
 *    Pylonen (createVenue with a blank description, then
 *    updateVenueProfile for the real copy).
 * 2. Corrects Ideal Bar's (v-vega-ideal-bar) aliases: removes the wrong
 *    "Lille VEGA Ideal Bar" compound (never real source evidence, and a
 *    conflation with the VEGA parent's own "Lille VEGA" alias under the
 *    corrected model) while keeping every other alias unchanged.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/vegaVenueModelCleanup.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/vegaVenueModelCleanup.ts --mode=apply --confirm=VEGA-VENUE-MODEL-CLEANUP-2026-09-06
 */

const VEGA = {
  name: "VEGA",
  address: "Enghavevej 40, 1674 København V",
  city: "Copenhagen" as const,
  postalCode: "1674",
  websiteUrl: "https://vega.dk/",
  description:
    "One of Copenhagen's best-known concert venues, built around two main halls — Store VEGA and Lille VEGA — hosting touring bands and larger concerts across genres.",
  shortDescription:
    "Landmark concert-hall complex built around two main rooms, Store VEGA and Lille VEGA, hosting touring bands and larger concerts across genres; electronic bookings are occasional rather than the norm.",
  venueProfile:
    "VEGA is one of Copenhagen's best-known concert venues, occupying a landmark 1950s trade-union assembly building in Vesterbro. Its programme is built around two main halls — Store VEGA, the larger of the two, and Lille VEGA, the smaller mid-size room — both primarily booked for touring bands and concerts spanning genres rather than dedicated club programming. Electronic acts do play VEGA's main stages from time to time, but genuinely electronic-defining nights are the exception on these two halls rather than the rule; VEGA's own dedicated, consistently electronic room is Ideal Bar, its separate basement club (see below) — a distinct venue in its own right, not a room under VEGA. VEGA's scale and reputation make it one of Copenhagen's primary destinations for larger-capacity touring shows, with Store VEGA and Lille VEGA together covering most of that programme.",
};

const IDEAL_BAR_ALIASES_CORRECTED = ["Ideal Bar", "Vega Ideal Bar", "VEGA (Ideal Bar)"];

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

async function runVegaAdd(apply: boolean) {
  console.log("\n" + "=".repeat(80));
  console.log("ADD VENUE: VEGA (parent)");
  console.log("=".repeat(80));
  const existingRows = await db.select().from(venues);
  const bySlug = existingRows.find((v) => v.slug === "vega");
  if (bySlug) {
    console.log(`SKIP: a venue with slug "vega" already exists (${bySlug.id}) — not creating a duplicate.`);
    return;
  }
  console.log(`Intended: create venue "${VEGA.name}" at "${VEGA.address}" with aliases ["Store VEGA", "Lille VEGA"], then set its editorial profile.`);
  if (apply) {
    const result = await createVenue(
      { name: VEGA.name, address: VEGA.address, city: VEGA.city, postalCode: VEGA.postalCode, websiteUrl: VEGA.websiteUrl },
      { confirmed: true },
    );
    console.log(`  createVenue -> created=${result.created}, id=${result.venue.id}`);
    // planVenueCreation() always starts aliases at [] — set the real ones now.
    await updateVenueAliases(result.venue.id, ["Store VEGA", "Lille VEGA"]);
    await updateVenueProfile(result.venue.id, {
      description: VEGA.description,
      shortDescription: VEGA.shortDescription,
      venueProfile: VEGA.venueProfile,
    });
    const after = await loadVenue(result.venue.id);
    console.log("  Read-back:", after ? { id: after.id, slug: after.slug, name: after.name, aliases: after.aliases, address: after.address } : null);
  }
}

async function runIdealBarAliasFix(apply: boolean) {
  console.log("\n" + "=".repeat(80));
  console.log("FIX ALIASES: VEGA (Ideal Bar)");
  console.log("=".repeat(80));
  const row = await loadVenue("v-vega-ideal-bar");
  if (!row) {
    console.log("SKIP: v-vega-ideal-bar not found.");
    return;
  }
  console.log(`v-vega-ideal-bar (${row.name}): current aliases = ${JSON.stringify(row.aliases)}`);
  if (!row.aliases.includes("Lille VEGA Ideal Bar")) {
    console.log("  SKIP: 'Lille VEGA Ideal Bar' is not currently present — nothing to remove (already correct, or state changed since review).");
    return;
  }
  console.log(`  Intended: ${JSON.stringify(row.aliases)} -> ${JSON.stringify(IDEAL_BAR_ALIASES_CORRECTED)}`);
  if (apply) {
    await updateVenueAliases("v-vega-ideal-bar", IDEAL_BAR_ALIASES_CORRECTED);
    const after = await loadVenue("v-vega-ideal-bar");
    console.log(`  APPLIED. Read-back aliases: ${JSON.stringify(after?.aliases)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }
  if (mode === "apply" && args.confirm !== "VEGA-VENUE-MODEL-CLEANUP-2026-09-06") {
    throw new Error("--mode=apply requires --confirm=VEGA-VENUE-MODEL-CLEANUP-2026-09-06");
  }

  await runVegaAdd(mode === "apply");
  await runIdealBarAliasFix(mode === "apply");

  console.log("\n" + (mode === "plan" ? "PLAN ONLY — no writes were made." : "APPLY complete — see APPLIED/read-back lines above for what actually changed."));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
