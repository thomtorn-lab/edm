import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { AUDIT_TABLES, buildArtistIdentityAudit, loadArtistIdentityAuditData, type ArtistIdentityAudit } from "./artistIdentityAudit";
import { beginReadOnlyTransaction } from "./readOnlyTransaction";
import { assertReadOnlyRole, readReportConnectionString } from "./reportReadOnlyGuard";

/**
 * One-off, read-only Artist Alerts identity audit (Phase A, step 1).
 *
 *   node --import tsx src/db/artistIdentityAuditCli.ts --out=artist-identity-audit.json
 *
 * Connects ONLY via DATABASE_URL_REPORT_RO (never DATABASE_URL), verifies a
 * read-only transaction AND a role proven unable to write before the first
 * report query (src/db/reportReadOnlyGuard.ts, shared with #141), runs SELECTs
 * only, and always ROLLBACKs. Prints a short summary; the full report goes
 * to the --out JSON file. Never prints the connection string.
 */

function parseOut(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--out="));
  return arg ? arg.slice("--out=".length) : null;
}

export function summarize(report: ArtistIdentityAudit): string[] {
  const s = report.alertSupport;
  return [
    `Upcoming public events: ${report.coverage.upcomingPublicEvents}`,
    `  with a high-confidence appearance: ${s.eventsWithAHighAppearance} (+${s.eventsAlsoWithPendingDecision - s.eventsWithAHighAppearance} if titles-as-artists are accepted)`,
    `  without sufficient lineup data: ${report.insufficientLineup.total} ${JSON.stringify(report.insufficientLineup.byReason)}`,
    `Appearances: ${report.appearanceBuckets.appearances} ${JSON.stringify(report.appearanceBuckets.byBucket)}`,
    `Event titles stored as artists: ${report.titleAsArtist.total} (with event word: ${report.titleAsArtist.withEventWord})`,
    `Key fixes (brackets/country codes): ${report.keyNormalisation.total}, would otherwise miss a match: ${report.keyNormalisation.wouldOtherwiseMissAMatch}`,
    `Handle conflicts: ${report.collisions.handleConflicts.total}; accent variants: ${report.collisions.diacriticVariants.total}; Discogs ambiguous/low: ${report.collisions.discogsAmbiguousOrLowIdentity.total}; short names at several venues: ${report.collisions.shortNamesAtSeveralVenues.total}`,
    `B2B entries: ${report.splits.b2bEntries.total}; possible multi-act entries: ${report.splits.possibleMultiActEntries.total}`,
    `Review backlog (estimated): ${report.reviewWorkload.initialBacklogItems}; weekly mean ${JSON.stringify(report.reviewWorkload.weeklyMean)}`,
    `Lineup changes (${report.definitions.changeWindowDays}d): ${report.lineupChanges.rows} rows on ${report.lineupChanges.distinctEvents} events`,
  ];
}

export async function runArtistIdentityAudit(connectionString: string, now = new Date()): Promise<ArtistIdentityAudit> {
  const client = new Client({ connectionString, application_name: "artist-identity-audit" });
  await client.connect();
  try {
    await beginReadOnlyTransaction(client);
    const guard = await assertReadOnlyRole(client, AUDIT_TABLES);
    console.log(`Verified: read-only transaction; role "${guard.role}" proven unable to write; ${AUDIT_TABLES.length} report tables readable.`);
    for (const w of guard.warnings) console.log(`  warning: ${w}`);
    await client.query("SET LOCAL statement_timeout = '60s'");
    const data = await loadArtistIdentityAuditData(client);
    await client.query("ROLLBACK");
    return buildArtistIdentityAudit(data, now);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function main() {
  const out = parseOut(process.argv.slice(2));
  const report = await runArtistIdentityAudit(readReportConnectionString(process.env));
  for (const line of summarize(report)) console.log(line);
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`Full report written to ${out}`);
  }
}

if (process.argv[1]?.endsWith("artistIdentityAuditCli.ts")) {
  main().catch((err) => {
    console.error(`artist-identity-audit failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
