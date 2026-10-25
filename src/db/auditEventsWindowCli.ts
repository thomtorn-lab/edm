/**
 * CLI for the read-only published-events window audit — see
 * src/db/auditEventsWindow.ts. Run by
 * .github/workflows/audit-events-window-readonly.yml:
 *
 *   node --import tsx src/db/auditEventsWindowCli.ts --from=2026-10-12 --to=2026-10-18
 *
 * Reads DATABASE_URL from the environment and never prints it.
 */
import { Client } from "pg";
import { buildAuditWindow, runEventsWindowAudit, type EventsWindowReport } from "./auditEventsWindow";
import { RELEVANCE_RECHECK_LIMITATIONS } from "./auditRelevance";

function readArg(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  if (!arg) throw new Error(`Missing required --${name}=YYYY-MM-DD argument.`);
  return arg.slice(prefix.length);
}

export function printReport(report: EventsWindowReport): void {
  const { window } = report;
  console.log(`== Published events, Copenhagen local ${window.from} 00:00 → day after ${window.to} 06:00 ==`);
  console.log(`UTC bounds: [${window.startUtc}, ${window.endUtc})`);
  console.log(`Total published events in window: ${report.totalPublishedInWindow}`);
  console.log(`Completeness check (row count vs. independent count, all sources incl. none): ${report.completenessCheck}`);
  console.log("Count by canonical source:");
  for (const c of report.countBySource) console.log(`  ${c.sourceId ?? "(none — admin-pasted)"}: ${c.count}`);

  console.log(`\n== Events (${report.events.length}) ==`);
  for (const e of report.events) console.log(JSON.stringify(e));

  const manualGenre = report.events.filter((e) => e.genreManuallySet.length > 0);
  console.log(`\n== Genre set manually by an admin (${manualGenre.length}) — editorial decisions, never change automatically ==`);
  for (const e of manualGenre) console.log(`  ${e.id}  ${e.startLocal}  ${e.title}  [${e.primaryGenre}; ${e.subgenres.join("+")}; manual: ${e.genreManuallySet.join(", ")}]`);

  const doubtful = report.events.filter((e) => e.relevanceRecheck && e.relevanceRecheck.relevance !== "strong");
  console.log(
    `\n== Electronic-relevance recheck: weak/none (${doubtful.length}) — CURRENT recomputation, NOT the historical publish decision; nothing changed ==`,
  );
  console.log("Known limits of this recheck:");
  for (const limit of RELEVANCE_RECHECK_LIMITATIONS) console.log(`  * ${limit}`);
  for (const e of doubtful) {
    const r = e.relevanceRecheck!;
    console.log(`  ${e.id}  ${e.startLocal}  ${e.title}  [${r.relevance}${r.trustedElectronicSource ? ", trusted source" : ""}]`);
    for (const reason of r.reasons) console.log(`      - ${reason}`);
  }

  const danish = report.events.filter((e) => e.descriptionReadsDanish || e.withheldSourceDescription);
  console.log(`\n== Danish descriptions (${danish.length}) — for QA reporting; nothing is changed or translated ==`);
  for (const e of danish) {
    const flags = [
      e.descriptionReadsDanish ? "shown description reads as Danish" : null,
      e.withheldSourceDescription ? "source has a Danish text not shown publicly (admin sees it)" : null,
    ];
    console.log(`  ${e.id}  ${e.startLocal}  ${e.title}  [${e.sourceId ?? "admin-pasted"}; ${flags.filter(Boolean).join("; ")}]`);
  }

  const edge = report.events.filter((e) => e.edgeFlags.length > 0);
  console.log(`\n== Window-edge events (${edge.length}) — confirm whether they belong in scope ==`);
  for (const e of edge) console.log(`  ${e.id}  ${e.startLocal}  ${e.title}  [${e.edgeFlags.join(", ")}]`);

  console.log(`\n== Duplicate candidates (${report.duplicateCandidates.length}) ==`);
  for (const d of report.duplicateCandidates) console.log(JSON.stringify(d));
}

async function main() {
  const window = buildAuditWindow(readArg("from"), readArg("to"));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runEventsWindowAudit(client, window);
    printReport(report);
    console.log("\nTransaction rolled back (read-only).");
    if (report.completenessCheck !== "ok") {
      console.error("::error::Row count and independent count disagree — coverage is not proven complete.");
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /auditEventsWindowCli\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("::error::auditEventsWindowCli.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
