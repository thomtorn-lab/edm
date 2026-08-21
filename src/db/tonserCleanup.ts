import { eq } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";
import { clearManualOverride, setEventPublished } from "./writes";

/**
 * One-time, tonser-only Production cleanup (Electronic CPH data-quality
 * follow-up review, "TONSer duplicate cleanup" — approved in principle,
 * exact plan re-confirmed across three review rounds). Pumpehuset's
 * "tonser" show was rescheduled from 2026-09-19 to 2027-02-20; both the
 * stale original row and the moved replacement are separately published,
 * sharing one Tickster ticket URL — real first-party evidence (the moved
 * row's own page text: "Koncerten er flyttet til den 20. februar 2027").
 * This unpublishes only the stale row — never deletes it, never touches
 * the replacement, never touches source_event_links (provenance).
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/tonserCleanup.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/tonserCleanup.ts --mode=apply --confirm=CLEANUP-TONSER-STALE-ROW
 *   node --env-file=.env.local --import tsx src/db/tonserCleanup.ts --mode=fix-manual-override --confirm=FIX-TONSER-MANUAL-OVERRIDE
 *
 * --mode=plan is entirely read-only (no write statement is even reachable
 * in that branch). --mode=apply re-verifies every expected fact about both
 * rows immediately before writing and ABORTS (no write) if Production
 * state has materially changed since this plan was validated — the exact
 * IDs, the exact dates, both still published, and the shared ticket URL
 * are all re-checked, not assumed.
 *
 * --mode=fix-manual-override is a narrow follow-up correction (Data Quality
 * & Trust, Round 5): --mode=apply's own write went through setEventPublished
 * for convenience, which (via applyAdminEventEdit) unconditionally sets
 * manualOverride=true and adds "published" to overriddenFields — an
 * unintended side effect this cleanup never meant to introduce (the
 * approved plan was "unpublish, preserve row/provenance", never "turn this
 * into an editorial override"). This mode clears exactly that: manualOverride
 * back to false and "published" removed from overriddenFields on the STALE
 * row only, after re-verifying it is still exactly the row this cleanup
 * unpublished (same id, same date, still published=false, still
 * manualOverride=true) — aborts on any mismatch, never touches the 2027
 * canonical row, never re-publishes anything.
 */

const STALE_ID = "e-71712e71"; // 2026-09-19 — to be unpublished
const CANONICAL_ID = "e-3517e218"; // 2027-02-20 — stays live, untouched
const EXPECTED_TITLE = "tonser";
const EXPECTED_STALE_DATE = "2026-09-19";
const EXPECTED_CANONICAL_DATE = "2027-02-20";

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

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function runFixManualOverride(args: Record<string, string>) {
  const stale = await loadRow(STALE_ID);
  const canonical = await loadRow(CANONICAL_ID);

  console.log("=".repeat(80));
  console.log(`Stale row (${STALE_ID}):`, stale ? { title: stale.title, start: dateOnly(stale.startDatetime), published: stale.published, manualOverride: stale.manualOverride, overriddenFields: stale.overriddenFields } : null);
  console.log(`Canonical row (${CANONICAL_ID}):`, canonical ? { title: canonical.title, start: dateOnly(canonical.startDatetime), published: canonical.published, manualOverride: canonical.manualOverride } : null);
  console.log("=".repeat(80));

  const problems: string[] = [];
  if (!stale) problems.push(`Stale row ${STALE_ID} not found.`);
  if (!canonical) problems.push(`Canonical row ${CANONICAL_ID} not found.`);
  if (stale) {
    if (stale.title.toLowerCase() !== EXPECTED_TITLE) problems.push(`Stale row title is "${stale.title}", expected "${EXPECTED_TITLE}".`);
    if (dateOnly(stale.startDatetime) !== EXPECTED_STALE_DATE) problems.push(`Stale row date is ${dateOnly(stale.startDatetime)}, expected ${EXPECTED_STALE_DATE}.`);
    if (stale.published) problems.push(`Stale row is currently published=true — this mode only ever corrects manualOverride on an already-unpublished row; aborting rather than acting on a row in an unexpected state.`);
    if (!stale.manualOverride) problems.push(`Stale row already has manualOverride=false — nothing to do, aborting rather than re-writing.`);
  }
  if (canonical) {
    if (dateOnly(canonical.startDatetime) !== EXPECTED_CANONICAL_DATE) problems.push(`Canonical row date is ${dateOnly(canonical.startDatetime)}, expected ${EXPECTED_CANONICAL_DATE}.`);
    if (!canonical.published) problems.push(`Canonical row is not published — aborting rather than acting while the live canonical is in an unexpected state.`);
  }

  if (problems.length > 0) {
    console.log("\nABORTING — Production state differs from the validated state:");
    for (const p of problems) console.log(`  - ${p}`);
    if (args.confirm) {
      throw new Error("Aborted: Production state differs materially from the validated state (see problems above). No write was made.");
    }
    console.log("\n(no --confirm given — no write would be attempted anyway.)");
    return;
  }

  console.log(`\nAll expected facts re-confirmed: ${STALE_ID} is still published=false with manualOverride=true; ${CANONICAL_ID} untouched and still published.`);
  console.log(`Intended write: clearManualOverride(${STALE_ID}, ["published"]) — manualOverride -> false, "published" removed from overriddenFields, published stays false, ${CANONICAL_ID} untouched.`);

  if (args.confirm !== "FIX-TONSER-MANUAL-OVERRIDE") {
    throw new Error("--mode=fix-manual-override requires --confirm=FIX-TONSER-MANUAL-OVERRIDE");
  }
  await clearManualOverride(STALE_ID, ["published"]);
  console.log(`\nAPPLIED: ${STALE_ID} manualOverride cleared.`);

  const staleAfter = await loadRow(STALE_ID);
  const canonicalAfter = await loadRow(CANONICAL_ID);
  console.log("\n-- read-back after write --");
  console.log(`${STALE_ID}:`, staleAfter ? { title: staleAfter.title, start: dateOnly(staleAfter.startDatetime), published: staleAfter.published, manualOverride: staleAfter.manualOverride, overriddenFields: staleAfter.overriddenFields } : null);
  console.log(`${CANONICAL_ID}:`, canonicalAfter ? { title: canonicalAfter.title, start: dateOnly(canonicalAfter.startDatetime), published: canonicalAfter.published, manualOverride: canonicalAfter.manualOverride } : null);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply" && mode !== "fix-manual-override") {
    throw new Error('--mode must be "plan", "apply" or "fix-manual-override"');
  }

  if (mode === "fix-manual-override") {
    await runFixManualOverride(args);
    return;
  }

  const stale = await loadRow(STALE_ID);
  const canonical = await loadRow(CANONICAL_ID);

  console.log("=".repeat(80));
  console.log(`Stale row (${STALE_ID}):`, stale ? { title: stale.title, start: dateOnly(stale.startDatetime), published: stale.published, manualOverride: stale.manualOverride, ticketUrl: stale.ticketUrl, officialEventUrl: stale.officialEventUrl } : null);
  console.log(`Canonical row (${CANONICAL_ID}):`, canonical ? { title: canonical.title, start: dateOnly(canonical.startDatetime), published: canonical.published, manualOverride: canonical.manualOverride, ticketUrl: canonical.ticketUrl, officialEventUrl: canonical.officialEventUrl } : null);
  console.log("=".repeat(80));

  const problems: string[] = [];
  if (!stale) problems.push(`Stale row ${STALE_ID} not found.`);
  if (!canonical) problems.push(`Canonical row ${CANONICAL_ID} not found.`);
  if (stale) {
    if (stale.title.toLowerCase() !== EXPECTED_TITLE) problems.push(`Stale row title is "${stale.title}", expected "${EXPECTED_TITLE}".`);
    if (dateOnly(stale.startDatetime) !== EXPECTED_STALE_DATE) problems.push(`Stale row date is ${dateOnly(stale.startDatetime)}, expected ${EXPECTED_STALE_DATE}.`);
    if (!stale.published) problems.push(`Stale row is already unpublished — nothing to do, aborting rather than re-writing.`);
    if (stale.manualOverride) problems.push(`Stale row has manualOverride=true — a human has already made a deliberate decision about this row; aborting rather than overriding it.`);
  }
  if (canonical) {
    if (canonical.title.toLowerCase() !== EXPECTED_TITLE) problems.push(`Canonical row title is "${canonical.title}", expected "${EXPECTED_TITLE}".`);
    if (dateOnly(canonical.startDatetime) !== EXPECTED_CANONICAL_DATE) problems.push(`Canonical row date is ${dateOnly(canonical.startDatetime)}, expected ${EXPECTED_CANONICAL_DATE}.`);
    if (!canonical.published) problems.push(`Canonical row is not published — the intended live canonical must already be published; aborting.`);
  }
  if (stale && canonical) {
    if (!stale.ticketUrl || stale.ticketUrl !== canonical.ticketUrl) {
      problems.push(`Ticket URLs no longer match (stale="${stale.ticketUrl}", canonical="${canonical.ticketUrl}") — the shared-ticket-URL evidence this cleanup was approved on is no longer true; aborting.`);
    }
  }

  if (problems.length > 0) {
    console.log("\nABORTING — Production state differs from the validated state:");
    for (const p of problems) console.log(`  - ${p}`);
    if (mode === "apply") {
      throw new Error("Aborted: Production state differs materially from the validated state (see problems above). No write was made.");
    }
    console.log("\n(mode=plan — no write would be attempted anyway.)");
    return;
  }

  console.log("\nAll expected facts re-confirmed: both rows exist, correct titles/dates, both currently published, shared ticket URL, neither manually overridden.");
  console.log(`Intended write: setEventPublished(${STALE_ID}, false) — row preserved, not deleted; source_event_links untouched; ${CANONICAL_ID} untouched.`);

  if (mode === "apply") {
    if (args.confirm !== "CLEANUP-TONSER-STALE-ROW") {
      throw new Error("--mode=apply requires --confirm=CLEANUP-TONSER-STALE-ROW");
    }
    await setEventPublished(STALE_ID, false);
    console.log(`\nAPPLIED: ${STALE_ID} unpublished.`);

    const staleAfter = await loadRow(STALE_ID);
    const canonicalAfter = await loadRow(CANONICAL_ID);
    console.log("\n-- read-back after write --");
    console.log(`${STALE_ID}:`, staleAfter ? { title: staleAfter.title, start: dateOnly(staleAfter.startDatetime), published: staleAfter.published, manualOverride: staleAfter.manualOverride } : null);
    console.log(`${CANONICAL_ID}:`, canonicalAfter ? { title: canonicalAfter.title, start: dateOnly(canonicalAfter.startDatetime), published: canonicalAfter.published, manualOverride: canonicalAfter.manualOverride } : null);
  } else {
    console.log("\nPLAN ONLY — no writes were made. Re-run with --mode=apply --confirm=CLEANUP-TONSER-STALE-ROW to apply.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
