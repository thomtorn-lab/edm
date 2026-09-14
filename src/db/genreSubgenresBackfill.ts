import { eq } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";
import { applyAdminEventEdit } from "./writes";

/**
 * One-time Production correction (genre taxonomy audit, 2026-09-14): 4
 * published events carry primaryGenre="electronic-other" with an empty
 * subgenres array. Every public consumer (displayGenres — the event badge —
 * and the Genre filter, see src/lib/taxonomy.ts) reads subgenres only, never
 * primaryGenre directly, so these 4 events currently show no genre badge and
 * never match the Electronic / Other filter despite having a resolved genre.
 * Root cause: legacy data from before the 2026-08-29 QA fix (see db/sync.ts's
 * own comment on that fix) that kept subgenres in lockstep with primaryGenre
 * on the auto-publish creation path — all 4 rows were first seen 2026-08-24,
 * five days earlier, and predate it. The current write paths
 * (db/sync.ts's buildSyncPatch, db/writes.ts's publishDiscoveryItem, and now
 * applyAdminEventEdit's own derivation guard) all already keep the two
 * fields in lockstep, so this is a one-time backfill, not a recurring job.
 *
 * Only ever sets subgenres — never primaryGenre (already correct) or any
 * other field.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/genreSubgenresBackfill.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/genreSubgenresBackfill.ts --mode=apply --confirm=BACKFILL-ELECTRONIC-OTHER-SUBGENRES
 *
 * --mode=plan is entirely read-only. --mode=apply re-verifies every expected
 * fact about all 4 rows immediately before writing and ABORTS (no write) if
 * Production state has materially changed since this plan was validated.
 */

const TARGET_IDS = ["e-2a601312", "e-73c8f2de", "e-b118e399", "e-33b3d36f"] as const;
const EXPECTED_PRIMARY_GENRE = "electronic-other";

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

async function loadRow(id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }

  const rows = await Promise.all(TARGET_IDS.map(loadRow));

  console.log("=".repeat(80));
  for (const [i, id] of TARGET_IDS.entries()) {
    const row = rows[i];
    console.log(
      `${id}:`,
      row
        ? { title: row.title, published: row.published, primaryGenre: row.primaryGenre, subgenres: row.subgenres, manualOverride: row.manualOverride, overriddenFields: row.overriddenFields }
        : null,
    );
  }
  console.log("=".repeat(80));

  const problems: string[] = [];
  for (const [i, id] of TARGET_IDS.entries()) {
    const row = rows[i];
    if (!row) {
      problems.push(`${id}: not found.`);
      continue;
    }
    if (!row.published) problems.push(`${id}: not published — expected published=true, aborting rather than acting on an unexpected state.`);
    if (row.primaryGenre !== EXPECTED_PRIMARY_GENRE) {
      problems.push(`${id}: primaryGenre is "${row.primaryGenre}", expected "${EXPECTED_PRIMARY_GENRE}" — aborting rather than guessing what subgenres should become.`);
    }
    if ((row.subgenres?.length ?? 0) > 0) {
      problems.push(`${id}: subgenres is already non-empty (${JSON.stringify(row.subgenres)}) — nothing to do, aborting rather than overwriting.`);
    }
    if (row.overriddenFields?.includes("subgenres")) {
      problems.push(`${id}: subgenres is already admin-overridden — a human has already made a deliberate decision about this field; aborting rather than overriding it.`);
    }
  }

  if (problems.length > 0) {
    console.log("\nABORTING — Production state differs from the validated state for at least one row:");
    for (const p of problems) console.log(`  - ${p}`);
    if (mode === "apply") {
      throw new Error("Aborted: Production state differs materially from the validated state (see problems above). No write was made.");
    }
    console.log("\n(mode=plan — no write would be attempted anyway.)");
    return;
  }

  console.log(`\nAll expected facts re-confirmed for all ${TARGET_IDS.length} rows: published=true, primaryGenre="${EXPECTED_PRIMARY_GENRE}", subgenres=[], not already overridden.`);
  console.log(`Intended write per row: applyAdminEventEdit(id, { subgenres: ["${EXPECTED_PRIMARY_GENRE}"] }) — primaryGenre and every other field untouched.`);

  if (mode === "apply") {
    if (args.confirm !== "BACKFILL-ELECTRONIC-OTHER-SUBGENRES") {
      throw new Error("--mode=apply requires --confirm=BACKFILL-ELECTRONIC-OTHER-SUBGENRES");
    }
    for (const id of TARGET_IDS) {
      await applyAdminEventEdit(id, { subgenres: [EXPECTED_PRIMARY_GENRE] });
      console.log(`APPLIED: ${id} subgenres set to ["${EXPECTED_PRIMARY_GENRE}"].`);
    }

    console.log("\n-- read-back after write --");
    for (const id of TARGET_IDS) {
      const after = await loadRow(id);
      console.log(`${id}:`, after ? { title: after.title, published: after.published, primaryGenre: after.primaryGenre, subgenres: after.subgenres } : null);
    }
  } else {
    console.log(`\nPLAN ONLY — no writes were made. Re-run with --mode=apply --confirm=BACKFILL-ELECTRONIC-OTHER-SUBGENRES to apply.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
