/**
 * Maintains qa-status.json in the private QA repository. Run only by
 * .github/workflows/qa-export-readonly.yml, right after a successful export:
 *
 *   node --import tsx src/lib/qaStatusCli.ts --snapshot=qa-snapshot.json \
 *     --status=qa-status.json --results-dir=qa-results --out=qa-status.json
 *
 * 1. applies new ChatGPT result files (against the fingerprints they checked),
 * 2. reconciles the register with the new snapshot (new → pending, changed → reopened),
 * 3. with --worklist-out, writes qa-worklist.json (src/lib/qaWorklist.ts) from both.
 * Files only: no database, no network. Prints counts and rejection reasons,
 * never event content (this repository's Actions logs are public).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { QaSnapshot } from "@/db/exportQaSnapshot";
import { applyQaResults, emptyQaStatus, QA_CATEGORIES, reconcileQaStatus, validateQaStatus, type QaInput, type QaStatus } from "./qaStatus";
import { buildQaWorklist, serializeQaWorklist } from "./qaWorklist";

export const QA_SNAPSHOT_SCHEMA = 3;

type SnapshotLike = {
  schema_version: number;
  generated_at: string;
  validation: { passed: boolean };
  events: { id: string; category_fingerprints: Record<string, string> }[];
};

export function snapshotInputs(snapshot: SnapshotLike): QaInput[] {
  if (snapshot.schema_version !== QA_SNAPSHOT_SCHEMA) throw new Error(`Snapshot schema_version ${snapshot.schema_version}, expected ${QA_SNAPSHOT_SCHEMA}`);
  if (snapshot.validation?.passed !== true) throw new Error("Snapshot did not pass validation");
  return snapshot.events.flatMap((e) =>
    QA_CATEGORIES.map((category) => {
      const fp = e.category_fingerprints?.[category];
      if (typeof fp !== "string" || !/^[a-f0-9]{64}$/.test(fp)) throw new Error(`Snapshot event ${e.id} has no ${category} fingerprint`);
      return { subject_id: e.id, category, source_fingerprint: fp };
    }),
  );
}

export function updateRegister(previous: QaStatus, snapshot: SnapshotLike, results: { name: string; content: string }[], now: Date): QaStatus {
  const inputs = snapshotInputs(snapshot);
  const withResults = applyQaResults(previous, results, now);
  const next = reconcileQaStatus(withResults, inputs, snapshot.generated_at);
  validateQaStatus(next);
  return next;
}

function arg(name: string): string {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  if (!a) throw new Error(`Missing required --${name}= argument.`);
  return a.slice(name.length + 3);
}

function optionalArg(name: string): string | null {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}

function main() {
  const statusPath = arg("status");
  const resultsDir = arg("results-dir");
  const snapshot = JSON.parse(readFileSync(arg("snapshot"), "utf8")) as SnapshotLike;
  let previous: unknown;
  if (existsSync(statusPath)) {
    previous = JSON.parse(readFileSync(statusPath, "utf8"));
  } else {
    console.log("No qa-status.json yet: starting a new register (generation 0).");
    previous = emptyQaStatus();
  }
  validateQaStatus(previous);
  const results = existsSync(resultsDir)
    ? readdirSync(resultsDir).filter((f) => f.endsWith(".json")).map((f) => ({ name: `qa-results/${f}`, content: readFileSync(path.join(resultsDir, f), "utf8") }))
    : [];
  const next = updateRegister(previous, snapshot, results, new Date());
  writeFileSync(arg("out"), JSON.stringify(next, null, 2) + "\n");
  // Worklist (2026-11-28): derived from the same snapshot and the register just written; it changes neither.
  const worklistOut = optionalArg("worklist-out");
  if (worklistOut) {
    const worklist = buildQaWorklist(snapshot as unknown as QaSnapshot, next);
    writeFileSync(worklistOut, serializeQaWorklist(worklist));
    console.log(`Worklist: ${worklist.summary.events_listed} events, findings ${JSON.stringify(worklist.summary.findings_by_kind)}.`);
  }

  const newRuns = next.runs.slice(previous.runs.length);
  console.log(`Register generation ${next.generation}, snapshot ${next.snapshot_generated_at}.`);
  console.log(`Result files processed this time: ${newRuns.length}`);
  for (const r of newRuns) {
    console.log(`  ${r.result_file}: accepted ${r.accepted}, rejected ${r.rejected.length}; discovery ${r.discovery?.status ?? "missing"}, production_technical ${r.production_technical?.status ?? "missing"}`);
    for (const x of r.rejected.slice(0, 20)) console.log(`    rejected ${x.ref}: ${x.reason}`);
    if (r.rejected.length > 20) console.log(`    … ${r.rejected.length - 20} more (see qa-status.json)`);
  }
  console.log(`Coverage of current events: ${JSON.stringify(next.coverage)}`);
}

if (process.argv[1] && /qaStatusCli\.ts$/.test(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error("::error::qaStatusCli.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
