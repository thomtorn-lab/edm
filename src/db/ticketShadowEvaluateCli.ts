/**
 * Offline evaluation of manual QA labels against a saved ticket-replacement
 * shadow report (thomtorn-lab/edm#145). No database, no network: reads two
 * local files and prints false positives, false negatives, precision,
 * coverage and the evidence checklist.
 *
 *   node --import tsx src/db/ticketShadowEvaluateCli.ts --report=report.json --labels=qa/ticket-shadow-labels.json
 *
 * report.json is the "REPORT JSON" line printed by inspect-source's
 * ticket-replacement-shadow mode.
 */
import { readFileSync } from "node:fs";
import { evaluateShadowLabels, validateShadowLabels, type ShadowLabelsFile } from "@/lib/ticketShadowEvaluation";
import type { TicketShadowReport } from "./ticketReplacementShadow";

function readArg(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  if (!arg) throw new Error(`Missing required --${name}=<path> argument.`);
  return arg.slice(prefix.length);
}

function main(): void {
  const report = JSON.parse(readFileSync(readArg("report"), "utf-8")) as TicketShadowReport;
  const labelsFile = JSON.parse(readFileSync(readArg("labels"), "utf-8")) as unknown;
  const errors = validateShadowLabels(labelsFile);
  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  const evaluation = evaluateShadowLabels(report.decisions, (labelsFile as ShadowLabelsFile).labels);
  console.log(`== Ticket-replacement shadow evaluation: ${report.meta.sourceId}, report ${report.meta.generatedAt} ==`);
  for (const line of evaluation.evidenceChecklist) console.log(`- ${line}`);
  console.log(`Activation: ${evaluation.activation}; metrics alone are never sufficient.`);
  console.log(JSON.stringify(evaluation, null, 2));
}

main();
