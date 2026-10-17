/**
 * CLI for the read-only YouTube preview risk report — see
 * src/db/youtubePreviewRiskReport.ts. Run by
 * .github/workflows/youtube-preview-risk-report-readonly.yml:
 *
 *   node --import tsx src/db/youtubePreviewRiskReportCli.ts --out=youtube-preview-risk-report.json
 *
 * Reads DATABASE_URL from the environment and never prints it. Never calls
 * YouTube. The optional --out file is written on the runner only.
 */
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { runYoutubePreviewRiskReport, type NameEntry, type RiskReport } from "./youtubePreviewRiskReport";
import type { AcceptedReplay } from "@/lib/enrichment/youtubePreviewRuleReplay";

function readOptionalArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function formatReplay(r: AcceptedReplay): string {
  const parts = [
    `  - ${r.artist}${r.manualBlock ? " [manually blocked]" : ""}`,
    `    video: ${r.videoId} "${r.videoTitle ?? ""}" (channel: ${r.channelTitle ?? "?"}, ${r.channelMatch ?? "?"} channel, matched on ${r.matchedOn} query)`,
    `    replay outcome: ${r.outcome}`,
  ];
  if (r.proposedFailures.length > 0) parts.push(`    proposed rules failed: ${r.proposedFailures.join(", ")}`);
  if (r.failsCurrentRules) parts.push(`    fails CURRENT production rules: ${r.currentRulesReason}`);
  if (r.alternative) parts.push(`    stored alternative passing every rule: ${r.alternative.videoId} "${r.alternative.title}" (${r.alternative.channelTitle}) — review only, never applied`);
  if (r.unverifiedPassingCandidates > 0) parts.push(`    other stored candidates passing every rule but never verified: ${r.unverifiedPassingCandidates}`);
  return parts.join("\n");
}

function formatName(n: NameEntry): string {
  return `  - "${n.name}"  [${n.rules.join(", ")}]  events: ${n.eventsTotal} (visible ${n.eventsVisible}), discovery: ${n.discoveryTotal} (pending ${n.discoveryPending}), cache: ${n.cacheStatus}`;
}

export function printReport(report: RiskReport): void {
  const { rules, names } = report;
  console.log(`== YouTube preview risk report (read-only), generated ${report.generatedAt} ==`);

  console.log("\n== 1. Offline replay of proposed identity rules ==");
  for (const [rule, text] of Object.entries(rules.proposedRules)) console.log(`  ${rule}: ${text}`);
  console.log(`Cache rows: ${rules.cacheRows} (accepted ${rules.acceptedRows}, abstain ${rules.abstainRows}, manually blocked ${rules.manuallyBlockedRows})`);
  console.log(`Replay outcomes for accepted rows: ${JSON.stringify(rules.outcomeCounts)}`);
  console.log(`\nAccepted matches touched by a proposed rule (${rules.affectedByProposedRules.length}) — none of them is blocked or replaced by this report:`);
  for (const r of rules.affectedByProposedRules) console.log(formatReplay(r));
  console.log(`\nAccepted matches today's production rules would no longer accept (${rules.failingCurrentRules.length}):`);
  for (const r of rules.failingCurrentRules) console.log(formatReplay(r));
  console.log(`\nAccepted rows that could not be replayed (${rules.notReplayable.length}):`);
  for (const r of rules.notReplayable) console.log(`  - ${r.artist} (${r.videoId ?? "no video id"})`);

  console.log("\n== 2. Non-artist name classification (report only) ==");
  console.log(`Distinct lineup names (events + discovery_queue, all statuses): ${names.distinctNames}`);
  console.log(`Verdicts: ${JSON.stringify(names.verdictCounts)}`);
  console.log(`Rule hits: ${JSON.stringify(names.ruleCounts)}`);
  console.log(`\nFlagged names that currently HOLD AN ACCEPTED MATCH (${names.flaggedWithAcceptedMatch.length}) — potential false positives, review before any rule is enforced:`);
  for (const n of names.flaggedWithAcceptedMatch) console.log(formatName(n));
  console.log(`\nWould be skipped as not an artist (${names.notArtist.length}):`);
  for (const n of names.notArtist) console.log(formatName(n));
  console.log(`\nReal name with source decoration — search name could be cleaned, never skipped (${names.cleanable.length}):`);
  for (const n of names.cleanable) console.log(formatName(n));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runYoutubePreviewRiskReport(client);
    printReport(report);
    const out = readOptionalArg("out");
    if (out) {
      writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(`\nFull report written to ${out}.`);
    }
    console.log("\nTransaction rolled back (read-only). No YouTube calls were made.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /youtubePreviewRiskReportCli\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("::error::youtubePreviewRiskReportCli.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
