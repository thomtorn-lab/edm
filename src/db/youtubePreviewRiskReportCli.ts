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
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { runYoutubePreviewRiskReport, type EventEntry, type JournalEntry, type NameEntry, type RiskReport } from "./youtubePreviewRiskReport";
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

function formatEvent(e: EventEntry): string {
  const h = e.headliner;
  const lines = [
    `  - ${e.start.slice(0, 10)}  ${e.slug}  [${e.outcome}${e.outcomeDetail ? `: ${e.outcomeDetail}` : ""}]`,
    `    lineup: ${e.lineup.slice(0, 8).join(", ")}${e.lineup.length > 8 ? `, … (+${e.lineup.length - 8})` : ""}`,
    `    headliner: ${h.headliners.length > 0 ? h.headliners.join(" + ") : "—"} (${h.confidence})${h.flags.length > 0 ? `  flags: ${h.flags.join(", ")}` : ""}`,
  ];
  for (const c of h.candidates) {
    const sig = h.signals.filter((s) => s.artist === c.artist).map((s) => `${s.type}${s.group === "strong" ? "" : `/${s.group}`}: "${s.excerpt}"`);
    lines.push(`      evidence for ${c.artist}: ${sig.join(" | ")}`);
  }
  const shown = e.shownToday;
  if (e.manualOverride) lines.push(`    event override: mode ${e.manualOverride.mode}${e.manualOverride.videoId ? `, video ${e.manualOverride.videoId}` : ""}, available ${e.manualOverride.available} → ${e.manualOverride.decision}`);
  lines.push(
    shown
      ? `    shown today (${e.shownTodayBasis}): ${shown.manualPin ? "[manual pin] " : ""}${shown.artist} — "${shown.videoTitle ?? ""}" (${shown.channelTitle ?? "?"})${shown.isHeadliner ? " [headliner]" : ""}${shown.solo ? "" : ` B2B with ${shown.partners.join(", ")}${shown.outsiders.length > 0 ? ` (not performing: ${shown.outsiders.join(", ")})` : ""}`}${shown.proposedFailures.length > 0 ? ` — fails proposed: ${shown.proposedFailures.join(", ")}` : ""}`
      : `    shown today: no video (${e.shownTodayBasis})`,
  );
  for (const v of e.headliners) {
    const alts = v.verifiedAlternatives.map((a) => `${a.videoId} "${a.title}"${a.solo ? " [solo]" : ` [B2B ${a.partners.join(", ")}]`}`);
    lines.push(`    headliner ${v.artist}: cache ${v.cacheStatus}${v.video ? `, video "${v.video.videoTitle ?? ""}"${v.video.solo ? " [solo]" : ` [B2B ${v.video.partners.join(", ")}]`}` : ""}${alts.length > 0 ? `; verified alternatives: ${alts.join("; ")}` : ""}`);
  }
  lines.push(
    `    simulated choice: ${e.simulated.artist ?? (e.simulated.reason === "manual_choice_kept" ? "manual choice" : "no video")} (${e.simulated.reason})` +
      `${e.simulated.changesFromToday ? " — CHANGES what is shown today" : ""}` +
      `${e.simulated.requiresVisibleArtistName ? " — REQUIRES the artist name to be shown visibly (not the headliner)" : ""}`,
  );
  return lines.join("\n");
}

export function printReport(report: RiskReport): void {
  const { rules, names } = report;
  console.log(`== YouTube preview risk report (read-only), generated ${report.generatedAt} ==`);

  const mc = report.manualChoices;
  console.log("\n== 0. Manual choices as they stand in this database (read only — nothing is changed) ==");
  for (const c of mc.ownerChecks) console.log(`  [${c.status}] ${c.check} — ${c.detail}`);
  console.log(
    `Migrations: tracking table ${mc.migrations.trackingTablePresent ? "present" : "MISSING"}, newest recorded ${mc.migrations.latestAppliedMillis ?? "—"}, ` +
      `not recorded from this checkout: ${mc.migrations.pendingInRepo.length > 0 ? mc.migrations.pendingInRepo.join(", ") : "none"}`,
  );
  console.log(`Event overrides (${mc.overrideTable}, ${mc.eventOverrides.length} row(s)):`);
  for (const o of mc.eventOverrides) console.log(`  - ${o.eventId} ${o.slug ?? "(event not found)"}: mode ${o.mode}, video ${o.videoId ?? "—"} "${o.videoTitle ?? ""}", artist ${o.artistName ?? "—"}, available ${o.available} → ${o.decision}, updated ${o.updatedAt ?? "?"}`);
  console.log(`Artist pins, match_rule "manual" (${mc.artistPins.length}):`);
  for (const p of mc.artistPins) console.log(`  - ${p.artist}: video ${p.videoId ?? "—"} "${p.videoTitle ?? ""}", expires ${p.expiresAt ?? "?"}${p.manualBlock ? " [also blocked]" : ""}`);
  console.log(`Artist blocks, manual_block (${mc.artistBlocks.length}):`);
  for (const b of mc.artistBlocks) console.log(`  - ${b.artist}: status ${b.status}, match_rule ${b.matchRule ?? "null"}, video ${b.videoId ?? "—"}`);

  console.log("\n== 1. Offline replay of proposed identity rules ==");
  for (const [rule, text] of Object.entries(rules.proposedRules)) console.log(`  ${rule}: ${text}`);
  console.log(`Cache rows: ${rules.cacheRows} (accepted ${rules.acceptedRows}, abstain ${rules.abstainRows}, manually blocked ${rules.manuallyBlockedRows})`);
  console.log(`Replay outcomes for accepted rows (manual_pin = hand-picked, never judged by a rule): ${JSON.stringify(rules.outcomeCounts)}`);
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

  const ev = report.events;
  console.log("\n== 3. Headliner priority per upcoming event (report only — nothing is changed) ==");
  if (ev.skipped) {
    console.log(`SKIPPED (fail closed): ${ev.reason}`);
    console.error("::error::Event section skipped — the manual override table could not be read, so no event was simulated.");
    process.exitCode = 1;
    return;
  }
  console.log(`Event overrides: ${ev.eventOverrides === "table_not_present" ? "table not present in this database" : `${ev.eventOverrides.rows} row(s) — those events are left out of the simulation`}`);
  if (ev.productionFailsClosed) {
    console.log("WARNING: the override table is missing, so getEventYoutubePreview fails closed — Production shows NO video on any event page. \"Shown today\" below is therefore empty everywhere.");
    console.error("::warning::event_youtube_preview_overrides is missing — event pages show no video (fail closed).");
  }
  console.log(`Visible published events: ${ev.visibleEvents}`);
  console.log(`Headliner confidence: ${JSON.stringify(ev.confidenceCounts)}`);
  console.log(`Outcomes: ${JSON.stringify(ev.outcomeCounts)}`);
  console.log(
    `safe_alternates need: solvable only from stored evidence ${ev.safeAlternatesNeed.solvableOnlyFromEvidence}, ` +
      `B2B with non-performer and no stored solo ${ev.safeAlternatesNeed.b2bOutsiderNoAlternative}, ` +
      `headliner without any usable match ${ev.safeAlternatesNeed.headlinerWithoutMatch}`,
  );
  console.log(
    `Prose/order dependency: prose names the lineup's first entry first in ${ev.proseOrderAgreement.proseFirstEqualsLineupFirst} of ${ev.proseOrderAgreement.eventsWithProse} events with prose` +
      " (close to 100% means prose and order are not really independent)",
  );
  console.log(`\nDocumented only via a title copied into the lineup — review by hand (${ev.titleCopyNeedsReview.length}):`);
  for (const t of ev.titleCopyNeedsReview) console.log(`  - ${t}`);
  const d = ev.decision;
  console.log("\n== 4. Decision basis (simulation only — nothing is changed) ==");
  console.log(`Visible events ${d.visibleEvents}; showing a video today ${d.eventsShowingVideo}`);
  console.log(`Prioritized headliner (documented or supported_prioritized): ${d.prioritizedEvents} — shown video is the headliner ${d.shownIsHeadliner}, another artist ${d.shownIsOtherArtist}, no video ${d.shownNothing}`);
  console.log(`Another artist shown although a headliner has a usable cached video (${d.otherShownWhileHeadlinerHasCachedVideo.length}): ${d.otherShownWhileHeadlinerHasCachedVideo.join(", ") || "—"}`);
  console.log(`Shown video bills a partner not performing at the event (${d.b2bShownWithNonPerformer.length}): ${d.b2bShownWithNonPerformer.join(", ") || "—"}`);
  console.log(
    `Solvable with already-verified videos (no YouTube call): from the cache row ${d.solvableWithVerifiedVideos.fromCacheRow}, ` +
      `only from stored evidence ${d.solvableWithVerifiedVideos.fromStoredEvidenceOnly}, other performer (artist name must be shown) ${d.solvableWithVerifiedVideos.otherPerformerFallback}`,
  );
  console.log(`Missing a suitable video: ${d.missingSuitableVideo.total} (prioritized headliner without match ${d.missingSuitableVideo.prioritizedHeadlinerWithoutMatch}, headliner never really searched — evidence missing ${d.missingSuitableVideo.headlinerEvidenceMissing}, no prioritized headliner ${d.missingSuitableVideo.noPrioritizedHeadliner})`);
  console.log(`How the headliner was inferred (independent signal groups): ${JSON.stringify(d.headlinerBasis)}`);
  console.log(`Manual choices kept untouched: ${d.manualChoicesKept}`);
  console.log(`\nChanges the simulation would make (${d.changes.length}) — proposals for review, never applied:`);
  for (const c of d.changes) {
    console.log(`  - ${c.slug}: ${c.from ? `${c.from.artist} ${c.from.videoId}` : "no video"} → ${c.to ? `${c.to.artist} ${c.to.videoId}` : "no video"} (${c.reason})${c.requiresVisibleArtistName ? " — artist name must be shown" : ""}`);
  }

  const notOk = ev.events.filter((e) => e.outcome !== "ok_headliner_shown");
  console.log(`\nEvents not already showing their headliner (${notOk.length} of ${ev.events.length}; full detail for every event in the JSON):`);
  for (const e of notOk) console.log(formatEvent(e));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const journal = (JSON.parse(readFileSync(path.join(process.cwd(), "src/db/migrations/meta/_journal.json"), "utf8")) as { entries: JournalEntry[] }).entries;
    const report = await runYoutubePreviewRiskReport(client, new Date(), journal.map((j) => ({ tag: j.tag, when: j.when })));
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
