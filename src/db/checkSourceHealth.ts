import { getSources } from "@/lib/queries";
import { describeSourceHealth, getSourceHealth } from "@/lib/sourceHealth";

/**
 * Proactive, read-only source-health monitor. Run on a schedule by
 * .github/workflows/monitor-source-health.yml so a degraded or stale
 * source turns that workflow run red even if nobody happens to open
 * /admin — the admin page's "Source health" section (src/app/admin/page.tsx)
 * shows the same getSourceHealth verdicts for on-demand inspection, this
 * script is the proactive/automated half.
 *
 * Scoped to every source with a real, automated (cron-synced) adapter in
 * Production today. Only ever reads the `sources` table; never writes
 * anything. Pre-launch QA audit (2026-08-29) found ALICE, Gravity,
 * Pumpehuset, and Billetto had gone live with automated syncs but were never
 * added here, so a silently-broken selector on any of them would go
 * completely unalerted.
 */
const MONITORED_SOURCE_IDS = [
  "src-hangaren",
  "src-culture-box",
  "src-poolen",
  "src-pumpehuset",
  "src-alice",
  "src-billetto",
  "src-gravity",
];

async function main() {
  const now = new Date();
  const sources = await getSources();

  const missing = MONITORED_SOURCE_IDS.filter((id) => !sources.some((s) => s.id === id));
  if (missing.length > 0) {
    console.error(`::error::Monitored source id(s) not found in the sources table: ${missing.join(", ")}`);
  }

  let unhealthyCount = 0;
  for (const id of MONITORED_SOURCE_IDS) {
    const source = sources.find((s) => s.id === id);
    if (!source) continue;

    const health = getSourceHealth(source, now);
    const reason = describeSourceHealth(source, now);

    // One structured JSON line per source — easy to grep/parse from the
    // Actions log regardless of which field turns out to matter later.
    console.log(
      JSON.stringify({
        sourceId: source.id,
        sourceName: source.sourceName,
        health,
        reason,
        syncFrequency: source.syncFrequency,
        lastSuccessfulSync: source.lastSuccessfulSync,
        lastAttemptedSync: source.lastAttemptedSync,
        lastError: source.lastError,
        eventsFound: source.eventsFound,
        eventsUpdated: source.eventsUpdated,
      }),
    );

    // "degraded" and "stale" are the two verdicts that mean a human should
    // look — skipped_concurrent, review_queue/hold candidates, and zero
    // auto-published events never produce either of these on their own
    // (see src/lib/sourceHealth.ts and src/db/sync.ts).
    if (health === "degraded" || health === "stale") {
      console.error(`::error::${source.sourceName} (${source.id}) is ${health}: ${reason}`);
      unhealthyCount++;
    }
  }

  const healthyCount = MONITORED_SOURCE_IDS.length - missing.length - unhealthyCount;
  console.log(`\n${healthyCount}/${MONITORED_SOURCE_IDS.length} monitored source(s) healthy.`);
  process.exit(unhealthyCount > 0 || missing.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SOURCE HEALTH CHECK FAILED TO RUN:", err);
  process.exit(1);
});
