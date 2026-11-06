import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { eventChangeLog, events } from "./schema";

/**
 * One-time Production correction for the eight published events whose start
 * time was shifted one hour early by the admin Discovery Queue editor bug
 * (fixed in PR #190, 2026-11-06): the editor pre-filled the UTC hour and saved
 * it back as Copenhagen time, and the shifted value was recorded as a manual
 * "startDatetime" lock. Each row below was verified against its live source
 * (KultuNaut / Pumpehuset) with inspect-source adapter-dry-run on 2026-11-06.
 *
 * For each row this sets ONLY startDatetime to the source's time and removes
 * ONLY "startDatetime" from overriddenFields. endDatetime, its lock and every
 * other field stay exactly as they are; no Rescheduled flag is set.
 *
 * Usage (see .github/workflows/correct-start-time-shift.yml):
 *   --mode=plan    read-only: compares Production with the expected values
 *   --mode=apply --confirm=CORRECT-8-START-TIMES
 *                  one transaction; re-checks every row under a row lock and
 *                  aborts with no write at all if any row differs
 *   --mode=verify  read-only: confirms the corrected state
 */

const CONFIRM = "CORRECT-8-START-TIMES";

interface Target {
  id: string;
  label: string;
  badStart: string; // current (shifted) value, UTC
  correctStart: string; // source value, UTC
  end: string | null; // must be unchanged before and after
}

// Eros for you first: it takes place 7 Nov 2026. All dates are in CET (UTC+1).
const TARGETS: Target[] = [
  { id: "e-f380f598", label: "Eros for you (VEGA) 7/11 20:00 -> 21:00", badStart: "2026-11-07T19:00:00.000Z", correctStart: "2026-11-07T20:00:00.000Z", end: null },
  { id: "e-bac45828", label: "Notion (VEGA) 21/11 21:00 -> 22:00", badStart: "2026-11-21T20:00:00.000Z", correctStart: "2026-11-21T21:00:00.000Z", end: null },
  { id: "e-c12db530", label: "Kontravoid + Spike Hellis (BETA) 9/12 19:00 -> 20:00", badStart: "2026-12-09T18:00:00.000Z", correctStart: "2026-12-09T19:00:00.000Z", end: "2026-12-09T22:00:00.000Z" },
  { id: "e-cc7001c6", label: "Night Journeys: Eurohead (Pumpehuset) 17/12 20:00 -> 21:00", badStart: "2026-12-17T19:00:00.000Z", correctStart: "2026-12-17T20:00:00.000Z", end: "2026-12-17T22:59:00.000Z" },
  { id: "e-6742f78d", label: "FLINTA PRIDE CPH vol. 2 (Pumpehuset) 8/1 20:00 -> 21:00", badStart: "2027-01-08T19:00:00.000Z", correctStart: "2027-01-08T20:00:00.000Z", end: null },
  { id: "e-1dbbf6e9", label: "SHERELLE (Pumpehuset) 5/2 20:00 -> 21:00", badStart: "2027-02-05T19:00:00.000Z", correctStart: "2027-02-05T20:00:00.000Z", end: null },
  { id: "e-4220b510", label: "Aname (Rust) 19/2 19:00 -> 20:00", badStart: "2027-02-19T18:00:00.000Z", correctStart: "2027-02-19T19:00:00.000Z", end: null },
  { id: "e-4b3f0027", label: "Jersey (Pumpehuset) 5/3 20:00 -> 21:00", badStart: "2027-03-05T19:00:00.000Z", correctStart: "2027-03-05T20:00:00.000Z", end: "2027-03-05T22:59:00.000Z" },
];

type Row = typeof events.$inferSelect;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function copenhagen(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "short", timeStyle: "short" }).format(d);
}

function describe(row: Row) {
  return {
    title: row.title,
    published: row.published,
    start: `${iso(row.startDatetime)} (${copenhagen(row.startDatetime)})`,
    end: `${iso(row.endDatetime)} (${copenhagen(row.endDatetime)})`,
    overriddenFields: row.overriddenFields,
    dateChanged: row.dateChanged,
    timeChanged: row.timeChanged,
  };
}

/** Problems that make a row unsafe to correct (empty = matches the reviewed pre-correction state). */
function preProblems(t: Target, row: Row | undefined): string[] {
  if (!row) return [`${t.id} not found`];
  const p: string[] = [];
  if (iso(row.startDatetime) !== t.badStart) p.push(`${t.id} start is ${iso(row.startDatetime)}, expected ${t.badStart}`);
  if (iso(row.endDatetime) !== t.end) p.push(`${t.id} end is ${iso(row.endDatetime)}, expected ${t.end}`);
  if (!row.overriddenFields.includes("startDatetime")) p.push(`${t.id} has no startDatetime lock`);
  return p;
}

function postProblems(t: Target, row: Row | undefined): string[] {
  if (!row) return [`${t.id} not found`];
  const p: string[] = [];
  if (iso(row.startDatetime) !== t.correctStart) p.push(`${t.id} start is ${iso(row.startDatetime)}, expected ${t.correctStart}`);
  if (iso(row.endDatetime) !== t.end) p.push(`${t.id} end is ${iso(row.endDatetime)}, expected ${t.end}`);
  if (row.overriddenFields.includes("startDatetime")) p.push(`${t.id} still has a startDatetime lock`);
  return p;
}

async function loadRows(): Promise<Map<string, Row>> {
  const rows = await db.select().from(events).where(inArray(events.id, TARGETS.map((t) => t.id)));
  return new Map(rows.map((r) => [r.id, r]));
}

function report(rows: Map<string, Row>, check: (t: Target, row: Row | undefined) => string[]): string[] {
  const all: string[] = [];
  for (const t of TARGETS) {
    const row = rows.get(t.id);
    const problems = check(t, row);
    all.push(...problems);
    console.log(`\n${problems.length === 0 ? "OK  " : "DIFF"} ${t.id} — ${t.label}`);
    console.log(JSON.stringify(row ? describe(row) : null, null, 2));
    for (const p of problems) console.log(`  ! ${p}`);
  }
  return all;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=")];
    }),
  );
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply" && mode !== "verify") throw new Error('--mode must be "plan", "apply" or "verify"');

  if (mode === "verify") {
    const problems = report(await loadRows(), postProblems);
    console.log("\n=== SUMMARY ===");
    console.log(problems.length === 0 ? `VERIFIED: all ${TARGETS.length} events have the corrected start, unchanged end and no startDatetime lock.` : `NOT VERIFIED:\n${problems.join("\n")}`);
    if (problems.length > 0) process.exitCode = 1;
    return;
  }

  const problems = report(await loadRows(), preProblems);
  console.log("\n=== SUMMARY ===");
  if (problems.length > 0) {
    console.log(`ABORT: ${problems.length} difference(s) from the reviewed state — no write made:\n${problems.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`All ${TARGETS.length} events match the expected pre-correction values.`);
  if (mode === "plan") {
    console.log(`PLAN ONLY — no writes. Apply with --mode=apply --confirm=${CONFIRM}.`);
    return;
  }
  if (args.confirm !== CONFIRM) throw new Error(`--mode=apply requires --confirm=${CONFIRM}`);

  await db.transaction(async (tx) => {
    for (const t of TARGETS) {
      // Re-check under a row lock: the write only proceeds from the reviewed state.
      const [row] = await tx.select().from(events).where(eq(events.id, t.id)).for("update");
      const p = preProblems(t, row);
      if (p.length > 0) throw new Error(`Aborted, nothing written: ${p.join("; ")}`);
      const overriddenFields = row.overriddenFields.filter((f) => f !== "startDatetime");
      await tx
        .update(events)
        .set({
          startDatetime: new Date(t.correctStart),
          overriddenFields,
          updatedAt: new Date(),
          lastChanged: new Date(),
        })
        .where(eq(events.id, t.id));
      await tx.insert(eventChangeLog).values({
        id: `log-${randomUUID()}`,
        eventId: t.id,
        changedBy: "admin",
        changeType: "update",
        fieldsChanged: ["startDatetime", "overriddenFields"],
        note: `Start-time shift correction (PR #190 editor bug): ${t.badStart} -> ${t.correctStart}; removed the erroneous startDatetime lock.`,
      });
    }
  });
  console.log(`APPLIED: ${TARGETS.length} events corrected in one transaction.`);

  const after = report(await loadRows(), postProblems);
  console.log(after.length === 0 ? `\nVERIFIED after write: all ${TARGETS.length} correct.` : `\nPOST-CHECK FAILED:\n${after.join("\n")}`);
  if (after.length > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
