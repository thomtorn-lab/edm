import { eq } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";
import { applyAdminEventEdit } from "./writes";

/**
 * One-time, single-row Production correction (public-visibility QA
 * follow-up, 2026-09-04, "FIX PUBLIC EVENT INTEGRITY" work package).
 *
 * This is the SAME recurring-slot bug already corrected once for e-b118e399
 * (see hangarenEndDatetimeCorrection.ts, applied 2026-08-29): Hangaren's own
 * source data for a "KARRUSEL AFTERPARTY" Fri/Sat listing gives it a ~33-hour
 * span (start 12:00 Copenhagen -> end 21:00 Copenhagen the FOLLOWING day)
 * instead of the real same-evening 12:00 -> 21:00 window every correctly-
 * dated instance of this recurring slot uses (see
 * hangarenAdapter.test.ts's "known real-source anomaly" describe block,
 * which now documents both known instances). This is the second occurrence
 * of the identical bug shape on the identical recurring slot — see the
 * event-integrity diagnostic's end-time audit and the final report's
 * "remaining risks" section for why this is treated as a narrow, recurring
 * source-data issue corrected instance-by-instance via the existing
 * manual-override mechanism, not a general duration-based runtime rule
 * (real Production data has a genuine ~31h multi-day festival only 2 hours
 * shorter than this ~33h error, so no fixed duration threshold can safely
 * tell them apart).
 *
 * Uses applyAdminEventEdit (not a raw UPDATE) so the corrected endDatetime is
 * recorded as manually overridden — Hangaren syncs every few hours, and
 * without this, the next sync would simply re-read the same wrong value from
 * the source and silently restore it. Only "endDatetime" is added to
 * overriddenFields: no other field on this row is touched or protected.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/hangarenToccororoEndDatetimeCorrection.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/hangarenToccororoEndDatetimeCorrection.ts --mode=apply --confirm=CORRECT-HANGAREN-E-7A7308E0
 *
 * --mode=plan is entirely read-only (no write statement is even reachable in
 * that branch). --mode=apply re-verifies every expected fact about the row
 * immediately before writing and ABORTS (no write) if Production state has
 * materially changed since this was reviewed: exact id, title, venue,
 * startDatetime, and the exact known-bad endDatetime are all re-checked, not
 * assumed.
 */

const EVENT_ID = "e-7a7308e0";
const EXPECTED_TITLE = "KARRUSEL AFTERPARTY: TOCCORORO Meilgaarden WE.LL";
const EXPECTED_VENUE_ID = "v-hangaren";
const EXPECTED_START_ISO = "2026-08-29T10:00:00.000Z"; // Sat 29 Aug 2026 12:00 Copenhagen
const EXPECTED_BAD_END_ISO = "2026-08-30T19:00:00.000Z"; // Sun 30 Aug 2026 21:00 Copenhagen (wrong)
const CORRECTED_END_ISO = "2026-08-29T19:00:00.000Z"; // Sat 29 Aug 2026 21:00 Copenhagen (correct)

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

async function loadRow() {
  const [row] = await db.select().from(events).where(eq(events.id, EVENT_ID)).limit(1);
  return row ?? null;
}

function summarize(row: NonNullable<Awaited<ReturnType<typeof loadRow>>>) {
  return {
    id: row.id,
    title: row.title,
    venueId: row.venueId,
    startDatetime: row.startDatetime.toISOString(),
    endDatetime: row.endDatetime ? row.endDatetime.toISOString() : null,
    published: row.published,
    manualOverride: row.manualOverride,
    overriddenFields: row.overriddenFields,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }

  const before = await loadRow();
  console.log("=".repeat(80));
  console.log(`Row (${EVENT_ID}):`, before ? summarize(before) : null);
  console.log("=".repeat(80));

  const problems: string[] = [];
  if (!before) {
    problems.push(`Event ${EVENT_ID} not found.`);
  } else {
    if (before.title !== EXPECTED_TITLE) problems.push(`Title is "${before.title}", expected "${EXPECTED_TITLE}".`);
    if (before.venueId !== EXPECTED_VENUE_ID) problems.push(`venueId is "${before.venueId}", expected "${EXPECTED_VENUE_ID}".`);
    if (before.startDatetime.toISOString() !== EXPECTED_START_ISO) {
      problems.push(`startDatetime is ${before.startDatetime.toISOString()}, expected ${EXPECTED_START_ISO}.`);
    }
    const currentEnd = before.endDatetime ? before.endDatetime.toISOString() : null;
    if (currentEnd !== EXPECTED_BAD_END_ISO) {
      problems.push(`endDatetime is ${currentEnd}, expected the known-bad value ${EXPECTED_BAD_END_ISO} — Production state has changed since this was reviewed, or this row was already corrected.`);
    }
    if (before.manualOverride || before.overriddenFields.includes("endDatetime")) {
      problems.push(`Row already has manualOverride/overriddenFields covering endDatetime — a human has already made a deliberate decision about this field; aborting rather than overriding it.`);
    }
  }

  if (problems.length > 0) {
    console.log("\nABORTING — Production state differs from the reviewed state:");
    for (const p of problems) console.log(`  - ${p}`);
    if (mode === "apply") {
      throw new Error("Aborted: Production state differs materially from the reviewed state (see problems above). No write was made.");
    }
    console.log("\n(mode=plan — no write would be attempted anyway.)");
    return;
  }

  console.log("\nAll expected facts re-confirmed: exact id/title/venue/startDatetime match, endDatetime is exactly the known-bad Sun 21:00 value, not already manually overridden.");
  console.log(`Intended write: applyAdminEventEdit(${EVENT_ID}, { endDatetime: new Date("${CORRECTED_END_ISO}") })`);
  console.log("Effect: endDatetime -> 2026-08-29T19:00:00.000Z (Sat 21:00 Copenhagen); manualOverride -> true; overriddenFields gains \"endDatetime\" — protecting this field from the next Hangaren sync, which would otherwise restore the known-bad source value. No other field is touched.");

  if (mode === "apply") {
    if (args.confirm !== "CORRECT-HANGAREN-E-7A7308E0") {
      throw new Error("--mode=apply requires --confirm=CORRECT-HANGAREN-E-7A7308E0");
    }
    await applyAdminEventEdit(EVENT_ID, { endDatetime: new Date(CORRECTED_END_ISO) });
    console.log(`\nAPPLIED: ${EVENT_ID} endDatetime corrected.`);

    const after = await loadRow();
    console.log("\n-- read-back after write --");
    console.log(`${EVENT_ID}:`, after ? summarize(after) : null);
  } else {
    console.log("\nPLAN ONLY — no writes were made. Re-run with --mode=apply --confirm=CORRECT-HANGAREN-E-7A7308E0 to apply.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
