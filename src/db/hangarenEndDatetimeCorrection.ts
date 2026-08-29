import { eq } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";
import { applyAdminEventEdit } from "./writes";

/**
 * One-time, single-row Production correction (public-visibility QA
 * follow-up, 2026-08-29): Hangaren's own source data (both its human-visible
 * page copy and its Google Calendar export metadata) gives the Aug 28 2026
 * "KARRUSEL AFTERPARTY: Kyle Starkey, B From E, ENNA" listing a 33-hour span
 * (Fri 12:00 -> Sat 21:00 Copenhagen) instead of the real same-evening
 * Fri 12:00 -> Fri 21:00 window every other instance of this recurring slot
 * uses (see hangarenAdapter.test.ts's "known real-source anomaly" describe
 * block for the full evidence trail: the immediately-preceding Aug 27
 * instance is correctly same-day). This is a genuine upstream source-data
 * error, not an adapter or date-filtering bug — datetime.ts, hangarenAdapter.ts
 * and every other consumer were independently verified correct. The fix is
 * this one-time, narrowly-guarded data correction, not a code change.
 *
 * Uses applyAdminEventEdit (not a raw UPDATE) so the corrected endDatetime is
 * recorded as manually overridden — Hangaren syncs every few hours, and
 * without this, the next sync would simply re-read the same wrong 21:00-
 * Saturday value from the source and silently restore it. Only "endDatetime"
 * is added to overriddenFields: no other field on this row is touched or
 * protected.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/hangarenEndDatetimeCorrection.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/hangarenEndDatetimeCorrection.ts --mode=apply --confirm=CORRECT-HANGAREN-E-B118E399
 *
 * --mode=plan is entirely read-only (no write statement is even reachable in
 * that branch). --mode=apply re-verifies every expected fact about the row
 * immediately before writing and ABORTS (no write) if Production state has
 * materially changed since this was reviewed: exact id, title, venue,
 * startDatetime, and the exact known-bad endDatetime are all re-checked, not
 * assumed. The write is therefore an implicit compare-and-set: it only ever
 * proceeds from the one specific prior state this was reviewed against.
 */

const EVENT_ID = "e-b118e399";
const EXPECTED_TITLE = "KARRUSEL AFTERPARTY: Kyle Starkey, B From E, ENNA";
const EXPECTED_VENUE_ID = "v-hangaren";
const EXPECTED_START_ISO = "2026-08-28T10:00:00.000Z"; // Fri 28 Aug 2026 12:00 Copenhagen
const EXPECTED_BAD_END_ISO = "2026-08-29T19:00:00.000Z"; // Sat 29 Aug 2026 21:00 Copenhagen (wrong)
const CORRECTED_END_ISO = "2026-08-28T19:00:00.000Z"; // Fri 28 Aug 2026 21:00 Copenhagen (correct)

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

  console.log("\nAll expected facts re-confirmed: exact id/title/venue/startDatetime match, endDatetime is exactly the known-bad Sat 21:00 value, not already manually overridden.");
  console.log(`Intended write: applyAdminEventEdit(${EVENT_ID}, { endDatetime: new Date("${CORRECTED_END_ISO}") })`);
  console.log("Effect: endDatetime -> 2026-08-28T19:00:00.000Z (Fri 21:00 Copenhagen); manualOverride -> true; overriddenFields gains \"endDatetime\" — protecting this field from the next Hangaren sync, which would otherwise restore the known-bad source value. No other field is touched.");

  if (mode === "apply") {
    if (args.confirm !== "CORRECT-HANGAREN-E-B118E399") {
      throw new Error("--mode=apply requires --confirm=CORRECT-HANGAREN-E-B118E399");
    }
    await applyAdminEventEdit(EVENT_ID, { endDatetime: new Date(CORRECTED_END_ISO) });
    console.log(`\nAPPLIED: ${EVENT_ID} endDatetime corrected.`);

    const after = await loadRow();
    console.log("\n-- read-back after write --");
    console.log(`${EVENT_ID}:`, after ? summarize(after) : null);
  } else {
    console.log("\nPLAN ONLY — no writes were made. Re-run with --mode=apply --confirm=CORRECT-HANGAREN-E-B118E399 to apply.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
