import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";

/**
 * One-time, single-row Production correction (2026-10-14): the lineup of
 * Culture Box Fri 16 Oct 2026, event e-8a410de7.
 *
 * The row's title/artists/description were hand-edited in the admin UI on
 * 2026-09-09 and 2026-09-11, so they are protected from the sync
 * (overriddenFields). Since then the venue removed ALX from the Red Box
 * lineup, and the edited `artists` never listed the Black Box headliners.
 * Re-verified against culture-box.com on 2026-10-13: Black Box is CHICH,
 * KALLAX, REXXX M; Red Box (The Gathering) is SHK, GEORGEBOX, GEORGEOUS,
 * DANI PANDA. SHK and GEORGEOUS have no link on the venue page, which is why
 * simply un-protecting the fields would lose them (the adapter drops unlinked
 * names) — hence this targeted correction instead.
 *
 * Writes exactly two content fields, `artists` and `description`, plus the
 * same audit metadata every admin edit sets (updated_at, last_changed, one
 * event_change_log row by "admin"). title, overridden_fields,
 * manual_override, published, start/end, and every other column are
 * untouched: overridden_fields already lists both fields, so they stay
 * protected from the sync.
 *
 * Safety:
 *   - The event id, the expected current state and the new values are
 *     constants in this file, so the reviewed diff IS the change. No input
 *     can widen it to another event or field.
 *   - --mode=plan (the workflow's default) only reads: prints the current
 *     row, every precondition, and the exact before/after of both fields.
 *   - --mode=apply needs --confirm=CORRECT-CULTURE-BOX-E-8A410DE7, aborts on
 *     any precondition mismatch, and the write itself is ONE guarded SQL
 *     statement: the UPDATE only matches if every checked column still has
 *     its expected value (so a change between the check and the write also
 *     aborts), and the change-log insert happens in that same statement, so
 *     either both land or neither does. Nothing matched -> nothing written.
 *   - Once applied, the expected state no longer matches, so a re-run of
 *     either mode reports "already applied" and writes nothing.
 *
 *   node --env-file=.env.local --import tsx src/db/cultureBoxOct16LineupCorrection.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/cultureBoxOct16LineupCorrection.ts --mode=apply --confirm=CORRECT-CULTURE-BOX-E-8A410DE7
 *
 * Run by .github/workflows/culture-box-e-8a410de7-lineup-correction.yml with
 * the DATABASE_URL repository secret only — no admin login or password.
 */

export const EVENT_ID = "e-8a410de7";
export const CONFIRM_TOKEN = "CORRECT-CULTURE-BOX-E-8A410DE7";

const PROSE =
  "Do you like real underground techno?\n" +
  "Chich from Luxembourg is the real thing! A part of the techno scene for decades, he’s a DJ and producer, as well as the label boss of Black Pitch Music. Chich headlines Black Box with heavy support from two of Copenhagen’s true underground heroes – Kallax and Rexxx M.\n" +
  "The community behind The Gathering is hosting Red Box with support from all their friends. They bring a lineup featuring ";
const PROSE_END =
  ", playing an eclectic mix of global electronic sounds while always focusing on building safer, more inclusive spaces where diverse communities connect through music. See you there.\n\n" +
  "Black Box\nCHICH, KALLAX, REXXX M\n\nRed Box\n";

/** Production state as read (read-only) on 2026-10-13 19:27 UTC. Every value is re-checked before writing. */
export const EXPECTED = {
  title: "CHICH, KALLAX, REXXX M, THE GATHERING",
  venueId: "v-culture-box",
  canonicalSourceId: "src-culture-box",
  startDatetime: "2026-10-16T20:00:00.000Z",
  published: true,
  manualOverride: true,
  overriddenFields: ["title", "artists", "description"],
  updatedAt: "2026-09-11T07:27:59.812Z",
  artists: ["SHK", "GEORGEBOX", "GEORGEOUS", "DANI PANDA", "ALX"],
  description: `${PROSE}SHK, GeorgeBox, Georgeous, Dani Panda, and ALX${PROSE_END}GEORGEBOX, GEORGEOUS, DANI PANDA, ALX`,
} as const;

/** The only two fields written. */
export const CORRECTED = {
  artists: ["CHICH", "KALLAX", "REXXX M", "SHK", "GEORGEBOX", "GEORGEOUS", "DANI PANDA"],
  description: `${PROSE}SHK, GeorgeBox, Georgeous, and Dani Panda${PROSE_END}SHK, GEORGEBOX, GEORGEOUS, DANI PANDA`,
} as const;

export const CHANGE_LOG_NOTE =
  "One-off correction (cultureBoxOct16LineupCorrection.ts): venue removed ALX; artists gains the Black Box lineup CHICH, KALLAX, REXXX M; description's Red Box line gains SHK.";

export interface CorrectionRow {
  id: string;
  title: string;
  venueId: string;
  canonicalSourceId: string | null;
  startDatetime: Date;
  endDatetime: Date | null;
  published: boolean;
  adminUnpublishReason: string | null;
  cancelled: boolean;
  manualOverride: boolean;
  overriddenFields: string[];
  updatedAt: Date;
  lastChanged: Date | null;
  artists: string[];
  description: string | null;
}

export interface CorrectionDeps {
  loadRow(): Promise<CorrectionRow | null>;
  /** Number of event rows updated (0 or 1). */
  applyGuardedWrite(): Promise<number>;
  log(line: string): void;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function isAlreadyApplied(row: CorrectionRow): boolean {
  return sameList(row.artists, CORRECTED.artists) && row.description === CORRECTED.description;
}

/** Every deviation from the reviewed state; empty means safe to write. */
export function checkPreconditions(row: CorrectionRow | null): string[] {
  if (!row) return [`Event ${EVENT_ID} not found.`];
  const problems: string[] = [];
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
    }
  };
  expect("id", row.id, EVENT_ID);
  expect("title", row.title, EXPECTED.title);
  expect("venueId", row.venueId, EXPECTED.venueId);
  expect("canonicalSourceId", row.canonicalSourceId, EXPECTED.canonicalSourceId);
  expect("startDatetime", row.startDatetime.toISOString(), EXPECTED.startDatetime);
  expect("published", row.published, EXPECTED.published);
  expect("adminUnpublishReason", row.adminUnpublishReason, null);
  expect("cancelled", row.cancelled, false);
  expect("manualOverride", row.manualOverride, EXPECTED.manualOverride);
  expect("overriddenFields", row.overriddenFields, EXPECTED.overriddenFields);
  // Any admin edit or sync write since the review moves updated_at.
  expect("updatedAt", row.updatedAt.toISOString(), EXPECTED.updatedAt);
  expect("artists", row.artists, EXPECTED.artists);
  if (row.description !== EXPECTED.description) {
    problems.push("description differs from the reviewed text (see the current value printed above).");
  }
  return problems;
}

/** Human-readable before/after of exactly the fields written. */
export function describeChange(): string[] {
  const lines: string[] = [];
  lines.push("artists:");
  lines.push(`  before: ${JSON.stringify(EXPECTED.artists)}`);
  lines.push(`  after:  ${JSON.stringify(CORRECTED.artists)}`);
  lines.push("description (changed lines only):");
  const before = EXPECTED.description.split("\n");
  const after = CORRECTED.description.split("\n");
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] === after[i]) continue;
    lines.push(`  line ${i + 1}:`);
    lines.push(`  - ${before[i] ?? ""}`);
    lines.push(`  + ${after[i] ?? ""}`);
  }
  lines.push("Also set, as by every admin edit: updated_at and last_changed = now(); one event_change_log row");
  lines.push(`  (changed_by "admin", change_type "update", fields_changed ["artists","description"]).`);
  lines.push("Unchanged: title, overridden_fields, manual_override, published, start/end, and every other column.");
  return lines;
}

function summarize(row: CorrectionRow) {
  return {
    ...row,
    startDatetime: row.startDatetime.toISOString(),
    endDatetime: row.endDatetime?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    lastChanged: row.lastChanged?.toISOString() ?? null,
  };
}

export function parseArgs(argv: string[]): Record<string, string> {
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

/** Core dispatch, separated from main() so it's unit-testable without a database. */
export async function run(args: Record<string, string>, deps: CorrectionDeps): Promise<"planned" | "applied" | "already-applied"> {
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") throw new Error('--mode must be "plan" or "apply".');
  if (mode === "apply" && args.confirm !== CONFIRM_TOKEN) throw new Error(`--mode=apply requires --confirm=${CONFIRM_TOKEN}`);

  const before = await deps.loadRow();
  deps.log(`Current row (${EVENT_ID}): ${JSON.stringify(before ? summarize(before) : null, null, 2)}`);

  if (before && isAlreadyApplied(before)) {
    deps.log("\nALREADY APPLIED: artists and description already hold the corrected values. Nothing to do; no write made.");
    return "already-applied";
  }

  const problems = checkPreconditions(before);
  if (problems.length > 0) {
    deps.log("\nABORTING: Production state differs from the reviewed state:");
    for (const p of problems) deps.log(`  - ${p}`);
    throw new Error("Aborted: Production state differs from the reviewed state (see above). No write was made.");
  }

  deps.log("\nAll preconditions match the reviewed state. Exact change:");
  for (const line of describeChange()) deps.log(line);

  if (mode === "plan") {
    deps.log(`\nPLAN ONLY: no write made. Apply with --mode=apply --confirm=${CONFIRM_TOKEN}.`);
    return "planned";
  }

  const updated = await deps.applyGuardedWrite();
  if (updated !== 1) {
    throw new Error(`Aborted: the guarded write matched ${updated} rows (the row changed between the check and the write). Nothing was written.`);
  }
  const after = await deps.loadRow();
  deps.log(`\nAPPLIED. Read-back: ${JSON.stringify(after ? summarize(after) : null, null, 2)}`);
  if (!after || !isAlreadyApplied(after)) throw new Error("Read-back does not show the corrected values; investigate before re-running.");
  return "applied";
}

export async function loadRow(): Promise<CorrectionRow | null> {
  const [row] = await db
    .select({
      id: events.id,
      title: events.title,
      venueId: events.venueId,
      canonicalSourceId: events.canonicalSourceId,
      startDatetime: events.startDatetime,
      endDatetime: events.endDatetime,
      published: events.published,
      adminUnpublishReason: events.adminUnpublishReason,
      cancelled: events.cancelled,
      manualOverride: events.manualOverride,
      overriddenFields: events.overriddenFields,
      updatedAt: events.updatedAt,
      lastChanged: events.lastChanged,
      artists: events.artists,
      description: events.description,
    })
    .from(events)
    .where(eq(events.id, EVENT_ID))
    .limit(1);
  return row ?? null;
}

/**
 * The write: one statement. The UPDATE's WHERE repeats the preconditions, so
 * it matches 0 rows if anything moved since the check; the change-log row is
 * inserted from the UPDATE's RETURNING, so it exists exactly when the update
 * happened. Returns the number of event rows updated.
 */
/** One bound text[] parameter (a bare array in a sql`` template expands to a list of separate parameters). */
const textArray = (values: readonly string[]) => sql.param([...values]);

export async function applyGuardedWrite(): Promise<number> {
  const result = await db.execute(sql`
    with updated as (
      update events
      set artists = ${textArray(CORRECTED.artists)}::text[],
          description = ${CORRECTED.description},
          updated_at = now(),
          last_changed = now()
      where id = ${EVENT_ID}
        and title = ${EXPECTED.title}
        and venue_id = ${EXPECTED.venueId}
        and canonical_source_id = ${EXPECTED.canonicalSourceId}
        and start_datetime = ${EXPECTED.startDatetime}::timestamptz
        and published = true
        and admin_unpublish_reason is null
        and cancelled = false
        and manual_override = true
        and overridden_fields = ${textArray(EXPECTED.overriddenFields)}::text[]
        and updated_at = ${EXPECTED.updatedAt}::timestamptz
        and artists = ${textArray(EXPECTED.artists)}::text[]
        and description = ${EXPECTED.description}
      returning id
    )
    insert into event_change_log (id, event_id, changed_by, change_type, fields_changed, note)
    select ${`log-${randomUUID()}`}, id, 'admin', 'update', ${textArray(["artists", "description"])}::text[], ${CHANGE_LOG_NOTE}
    from updated
    returning event_id
  `);
  return result.rowCount ?? result.rows.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    await run(args, { loadRow, applyGuardedWrite, log: (line) => console.log(line) });
  } catch (err) {
    console.error("::error::", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}

// Only auto-run when executed directly, never on import (keeps run() testable).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("::error::cultureBoxOct16LineupCorrection.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
