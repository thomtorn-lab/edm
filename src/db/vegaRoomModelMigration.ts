import { eq } from "drizzle-orm";
import { db } from "./client";
import { venues } from "./schema";
import { updateVenueAliases, updateVenueRooms } from "./writes";

/**
 * One-time Production data correction (generalized sub-venue model,
 * 2026-09-06 — VEGA venue model cleanup follow-up). The earlier VEGA fix
 * registered "Store VEGA"/"Lille VEGA" as plain ALIASES of v-vega (an
 * interim state deliberately kept in place to avoid regressing the Ideal
 * Bar mis-resolution bug it fixed). Now that the generalized rooms model
 * exists (Venue.rooms/VenueRoom — see src/lib/types.ts), this script moves
 * those two strings from v-vega's `aliases` into its `rooms`, so room
 * identity is preserved through resolution instead of being discarded.
 *
 * Idempotent-checked: skips cleanly if the aliases are already gone / rooms
 * are already set, so a re-run (or an out-of-order dispatch) is always safe.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/vegaRoomModelMigration.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/vegaRoomModelMigration.ts --mode=apply --confirm=VEGA-ROOM-MODEL-MIGRATION-2026-09-06
 */

const VEGA_ROOM_ALIASES_TO_REMOVE = ["Store VEGA", "Lille VEGA"];
const VEGA_ROOMS = [{ name: "Store VEGA" }, { name: "Lille VEGA" }];

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

async function run(apply: boolean) {
  console.log("\n" + "=".repeat(80));
  console.log("MOVE VEGA ROOMS: aliases -> rooms");
  console.log("=".repeat(80));

  const row = await loadVenue("v-vega");
  if (!row) {
    console.log("SKIP: v-vega not found (the VEGA venue model cleanup migration must run first).");
    return;
  }

  console.log(`v-vega current aliases = ${JSON.stringify(row.aliases)}`);
  console.log(`v-vega current rooms   = ${JSON.stringify(row.rooms)}`);

  const hasAliasesToRemove = VEGA_ROOM_ALIASES_TO_REMOVE.some((a) => row.aliases.includes(a));
  const roomsAlreadySet =
    Array.isArray(row.rooms) &&
    (row.rooms as { name: string }[]).length === VEGA_ROOMS.length &&
    VEGA_ROOMS.every((r) => (row.rooms as { name: string }[]).some((existing) => existing.name === r.name));

  if (!hasAliasesToRemove && roomsAlreadySet) {
    console.log("SKIP: already migrated — no room aliases present, rooms already set. Nothing to do.");
    return;
  }

  const newAliases = row.aliases.filter((a) => !VEGA_ROOM_ALIASES_TO_REMOVE.includes(a));
  console.log(`Intended aliases: ${JSON.stringify(row.aliases)} -> ${JSON.stringify(newAliases)}`);
  console.log(`Intended rooms:   ${JSON.stringify(row.rooms)} -> ${JSON.stringify(VEGA_ROOMS)}`);

  if (apply) {
    if (!roomsAlreadySet) {
      await updateVenueRooms("v-vega", VEGA_ROOMS);
    }
    if (hasAliasesToRemove) {
      await updateVenueAliases("v-vega", newAliases);
    }
    const after = await loadVenue("v-vega");
    console.log("  Read-back:", after ? { id: after.id, slug: after.slug, name: after.name, aliases: after.aliases, rooms: after.rooms } : null);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }
  if (mode === "apply" && args.confirm !== "VEGA-ROOM-MODEL-MIGRATION-2026-09-06") {
    throw new Error("--mode=apply requires --confirm=VEGA-ROOM-MODEL-MIGRATION-2026-09-06");
  }

  await run(mode === "apply");

  console.log("\n" + (mode === "plan" ? "PLAN ONLY — no writes were made." : "APPLY complete — see APPLIED/read-back lines above for what actually changed."));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
