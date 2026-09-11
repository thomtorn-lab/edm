import { inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { discoveryQueue } from "./schema";

/**
 * One-time Production data correction (Ignore Persistence historical
 * cleanup, 2026-09-11 — addendum to the Ignore Persistence fix). The fix
 * itself (src/db/sync.ts::isIgnoredCandidate) stops NEW duplicates from
 * being created; it does nothing retroactively. This script repairs the 19
 * historical cases the read-only `ignore-persistence-audit` inspectSource.ts
 * mode found: a `pending` discovery_queue row that shares its exact
 * source_url with an already-`ignored` row for the same identity — reusing
 * the identical exact-match-on-source_url semantics the fix itself uses
 * (see isIgnoredCandidate's own doc comment), never a fuzzy/normalized
 * match.
 *
 * Narrow by construction: the candidate query only ever selects rows with
 * status = 'pending' — published/merged rows structurally cannot appear as
 * a candidate no matter what their source_url is, and a pending row whose
 * source_url has no matching ignored row is left completely untouched.
 * Idempotent: a second run finds zero candidates once the first has
 * applied, since no pending row is then left sharing an ignored row's url.
 *
 * Deliberately NOT a new generalized cleanup step wired into every sync —
 * see this task's own explicit instruction. One-time script, run once via
 * its own temporary workflow, then the workflow is removed exactly like
 * vegaVenueModelCleanup.ts's own was.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/ignorePersistenceCleanup.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/ignorePersistenceCleanup.ts --mode=apply --confirm=IGNORE-PERSISTENCE-CLEANUP-2026-09-11
 */

interface CandidateRow {
  id: string;
  source_url: string;
  source_id: string | null;
  status: string;
}

const CANDIDATES_QUERY = sql`
  SELECT dq.id, dq.source_url, dq.source_id, dq.status
  FROM discovery_queue dq
  WHERE dq.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM discovery_queue dq2
      WHERE dq2.source_url = dq.source_url AND dq2.status = 'ignored'
    )
  ORDER BY dq.source_url, dq.created_at
`;

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

async function plan() {
  console.log("\n" + "=".repeat(80));
  console.log("PLAN: Ignore Persistence historical cleanup");
  console.log("=".repeat(80));

  const result = await db.execute(CANDIDATES_QUERY);
  const rows = result.rows as unknown as CandidateRow[];

  const distinctUrls = new Set(rows.map((r) => r.source_url));
  const distinctSourceIds = new Set(rows.map((r) => r.source_id ?? "(null)"));
  const nonPending = rows.filter((r) => r.status !== "pending");

  console.log(`Affected pending rows: ${rows.length}`);
  console.log(`Distinct source_urls: ${distinctUrls.size}`);
  console.log(`Affected source_ids: ${JSON.stringify([...distinctSourceIds].sort())}`);
  console.log(
    `Any candidate not status='pending' (expected: none — the query itself only selects status='pending'): ${nonPending.length}`,
  );
  console.log(
    "Exact-match rule: every candidate was matched by literal source_url string equality against an existing " +
      "'ignored' row (the SQL EXISTS clause above uses '=', never ILIKE/fuzzy) — no candidate can fail this rule " +
      "by construction.",
  );
  console.log("\nCandidate rows:");
  console.log(JSON.stringify(rows, null, 2));

  return rows;
}

async function apply(confirm: string | undefined) {
  if (confirm !== "IGNORE-PERSISTENCE-CLEANUP-2026-09-11") {
    throw new Error("--mode=apply requires --confirm=IGNORE-PERSISTENCE-CLEANUP-2026-09-11");
  }

  console.log("\n" + "=".repeat(80));
  console.log("APPLY: Ignore Persistence historical cleanup");
  console.log("=".repeat(80));

  const result = await db.transaction(async (tx) => {
    // Re-select inside the transaction — a consistent snapshot taken
    // immediately before the write, not the plan-mode read from a possibly
    // earlier moment.
    const candidatesResult = await tx.execute(CANDIDATES_QUERY);
    const candidates = candidatesResult.rows as unknown as CandidateRow[];
    const nonPending = candidates.filter((r) => r.status !== "pending");
    if (nonPending.length > 0) {
      throw new Error(
        `Refusing to apply: ${nonPending.length} candidate row(s) are not status='pending' — ${JSON.stringify(nonPending)}`,
      );
    }
    if (candidates.length === 0) {
      console.log("No candidates found — nothing to do (already clean, or plan/apply race with another run).");
      return { candidates, updated: [] as { id: string }[] };
    }

    const ids = candidates.map((r) => r.id);
    const updated = await tx
      .update(discoveryQueue)
      .set({ status: "ignored", resolvedAt: new Date() })
      .where(inArray(discoveryQueue.id, ids))
      .returning({ id: discoveryQueue.id });

    return { candidates, updated };
  });

  console.log(`Repaired ${result.updated.length} row(s):`);
  console.log(JSON.stringify(result.updated, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode !== "plan" && mode !== "apply") {
    throw new Error('--mode must be "plan" or "apply"');
  }

  if (mode === "plan") {
    await plan();
  } else {
    await apply(args.confirm);
  }

  console.log("\n" + (mode === "plan" ? "PLAN ONLY — no writes were made." : "APPLY complete — see repaired rows above."));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
