import { fileURLToPath } from "node:url";
import { eq, inArray, gt, and } from "drizzle-orm";
import { db } from "./client";
import { events, artistYoutubePreviewCache } from "./schema";
import { cleanArtistDisplayName, normalizeArtistName, isPlaceholderArtistName } from "@/lib/enrichment/genreEnrichment";
import { getOrMatchArtistYoutubePreview } from "@/lib/enrichment/youtubePreviewMatching";
import * as youtubeClient from "@/lib/enrichment/youtubeClient";
import { YoutubeDailyQuotaExhaustedError } from "@/lib/enrichment/youtubeClient";
import { drizzleCacheStore } from "./youtubePreview";
import { isPastEvent } from "@/lib/datetime";

/**
 * One-time YouTube Artist Preview cache backfill for the CURRENT/
 * FUTURE-VISIBLE published catalogue (automated Artist Preview V1 merge
 * review, 2026-09-25, items 2 and 3 — item 3 narrows scope to visible
 * events only, using the exact same effective-end semantics as the public
 * site rather than a new date rule invented for this script).
 *
 * Why this exists: matching only ever runs at src/db/writes.ts::createEvent,
 * for a newly-ingested/approved event — no already-published event is
 * touched retroactively. Without running this once after deploy, every
 * artist already in the catalogue would show no preview until they happen
 * to appear in a brand-new event. Scoped to visible events only (per
 * src/lib/datetime.ts::isPastEvent, the same rule every other page already
 * uses) so quota is never spent on a long-past event's lineup nobody can
 * see a preview for anyway.
 *
 * Never touches `events` rows — reads `events.artists`/`startDatetime`/
 * `endDatetime` only to build the distinct artist-name worklist, and every
 * write goes through the exact same cache-first Rule A matcher production
 * ingestion uses (getOrMatchArtistYoutubePreview + the real Postgres cache
 * store from src/db/youtubePreview.ts), which only ever writes to
 * artist_youtube_preview_cache. Idempotent by construction: cache-first
 * matching means re-running this script (in full, from the start) after a
 * partial/interrupted run skips every artist already cached and fresh —
 * no separate resume-checkpoint mechanism is needed. No Rule B, no new
 * identity heuristics, no view-count/subscriber thresholds: this calls the
 * identical matcher production ingestion uses, nothing looser or stricter
 * (per the 2026-09-25 product decision accepting the documented V1
 * own-channel limitation as-is).
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBackfill.ts --mode=plan [--limit=N]
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBackfill.ts --mode=apply --confirm=BACKFILL-YOUTUBE-PREVIEW [--batch-size=20] [--limit=N]
 *
 * --mode=plan is entirely read-only (same projection as
 * `inspectSource.ts --mode=youtube-preview-backfill-plan`, reproduced here
 * so the exact code path that will run the backfill also plans it) and
 * also reports how many of the visible-event artists are already cached
 * and fresh, so --mode=apply's real remaining cost is visible up front.
 * --mode=apply requires the literal --confirm token (this codebase's
 * established one-time-script safety convention — see
 * src/db/tonserCleanup.ts) and processes the distinct-artist worklist one
 * at a time, paced to stay well clear of YouTube's short-window rate limit
 * (confirmed live, 2026-09-25 benchmark validation, to be tighter than a
 * naive per-request pace assumes), with a longer pause between batches. It
 * aborts early — rather than burning through the rest of the worklist to
 * no effect — if several lookups in a row fail outright, since that's the
 * signature of exhausted quota, not of individual bad artist names (an
 * unmatchable name fails closed to a cached "abstain", never a thrown
 * error — see getOrMatchArtistYoutubePreview's own doc comment).
 *
 * Prioritized batch rollout (2026-09-25 product decision): both modes
 * select from UNCACHED artists only, ordered by (1) the earliest
 * currently/future-visible event they appear on, (2) normalized name as a
 * deterministic tie-breaker — never a popularity/view-count heuristic, and
 * cap the selection at --limit, which defaults to DEFAULT_BATCH_LIMIT (50)
 * rather than the full backlog. This keeps a single invocation small and
 * quota-safe by default; a later batch is a separate, explicit re-run with
 * a fresh --limit, never automatic. --batch-size is unrelated: it's the
 * existing inter-request pacing group size within whatever batch --limit
 * selects, not a second cap.
 */

const BATCH_SIZE_DEFAULT = 20;
const DEFAULT_BATCH_LIMIT = 50;
const INTER_ARTIST_DELAY_MS = 1500;
const INTER_BATCH_DELAY_MS = 5000;
const CONSECUTIVE_FAILURE_ABORT_THRESHOLD = 5;
const CONFIRM_TOKEN = "BACKFILL-YOUTUBE-PREVIEW";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether a failed lookup should abort the batch immediately rather than
 * only after CONSECUTIVE_FAILURE_ABORT_THRESHOLD in a row (daily-quota
 * safety fix, 2026-09-26 — confirmed live: the ordinary consecutive-failure
 * guard let a batch burn through several more lookups, each guaranteed to
 * fail the same way, before stopping). A confirmed daily search-quota
 * exhaustion (youtubeClient.ts's YoutubeDailyQuotaExhaustedError, thrown
 * only when the API's own error body names a per-day quota limit) will not
 * resolve by continuing or retrying — unlike an ordinary/transient
 * failure, which still goes through the existing threshold below.
 */
export function shouldAbortImmediately(err: unknown): boolean {
  return err instanceof YoutubeDailyQuotaExhaustedError;
}

interface WorklistEntry {
  normalized: string;
  raw: string;
  earliestStart: Date;
}

/**
 * Distinct normalized artist names across every CURRENT/FUTURE-VISIBLE
 * published event (src/lib/datetime.ts::isPastEvent === false — the same
 * effective-end rule the public site uses everywhere else), each mapped to
 * one real raw display form (the raw form is what's actually passed to the
 * matcher — matching re-normalizes from it) and the earliest visible
 * event's startDatetime it appears on. Sorted by that earliest date, then
 * normalized name as a deterministic tie-breaker (2026-09-25 prioritized
 * rollout) — never popularity/view-count, which V1 deliberately doesn't
 * measure.
 */
async function buildWorklist(): Promise<WorklistEntry[]> {
  const rows = await db
    .select({ artists: events.artists, startDatetime: events.startDatetime, endDatetime: events.endDatetime })
    .from(events)
    .where(eq(events.published, true));
  const now = new Date();
  const visibleRows = rows.filter(
    (row) => !isPastEvent({ startDatetime: row.startDatetime.toISOString(), endDatetime: row.endDatetime?.toISOString() ?? null }, now),
  );
  const byNormalized = new Map<string, WorklistEntry>();
  for (const row of visibleRows) {
    for (const raw of row.artists) {
      if (isPlaceholderArtistName(raw)) continue;
      const normalized = normalizeArtistName(cleanArtistDisplayName(raw));
      if (!normalized) continue;
      const existing = byNormalized.get(normalized);
      if (!existing) byNormalized.set(normalized, { normalized, raw, earliestStart: row.startDatetime });
      else if (row.startDatetime < existing.earliestStart) existing.earliestStart = row.startDatetime;
    }
  }
  return [...byNormalized.values()].sort(
    (a, b) => a.earliestStart.getTime() - b.earliestStart.getTime() || a.normalized.localeCompare(b.normalized),
  );
}

/** Which of `worklist`'s normalized names already have a fresh (unexpired) cache row — read-only, never creates the table. */
async function getFreshCachedSet(worklist: { normalized: string }[]): Promise<Set<string>> {
  if (worklist.length === 0) return new Set();
  const names = worklist.map((w) => w.normalized);
  const rows = await db
    .select({ n: artistYoutubePreviewCache.artistNameNormalized })
    .from(artistYoutubePreviewCache)
    .where(and(inArray(artistYoutubePreviewCache.artistNameNormalized, names), gt(artistYoutubePreviewCache.expiresAt, new Date())));
  return new Set(rows.map((r) => r.n));
}

async function runPlan(batchLimit: number): Promise<void> {
  const worklist = await buildWorklist();
  let freshCached = new Set<string>();
  try {
    freshCached = await getFreshCachedSet(worklist);
  } catch (err) {
    console.log(`(artist_youtube_preview_cache not queryable yet — expected pre-merge: ${err instanceof Error ? err.message : String(err)})`);
  }
  const uncachedList = worklist.filter((w) => !freshCached.has(w.normalized));
  const estimateFor = (n: number) => n * 100 + Math.ceil(n * 0.35) * 100;

  console.log(`Distinct artists on current/future-visible events: ${worklist.length}`);
  console.log(`Already cached (fresh): ${freshCached.size}`);
  console.log(`Uncached: ${uncachedList.length}`);
  console.log(`Estimated FULL remaining backfill quota cost: ~${estimateFor(uncachedList.length)} units (10,000/day default budget) — ${Math.ceil(uncachedList.length / batchLimit)} batch(es) at size ${batchLimit}.`);

  const batch = uncachedList.slice(0, batchLimit);
  console.log(`\nPrioritized batch preview (limit=${batchLimit}, earliest-visible-event-first, normalized-name tie-break):`);
  console.log(`Selected for this batch: ${batch.length} of ${uncachedList.length} uncached`);
  if (batch.length === 0) {
    console.log("Nothing to do — every current/future-visible artist is already cached.");
    return;
  }
  const earliest = batch.reduce((min, b) => (b.earliestStart < min ? b.earliestStart : min), batch[0].earliestStart);
  const latest = batch.reduce((max, b) => (b.earliestStart > max ? b.earliestStart : max), batch[0].earliestStart);
  const batchEstimate = estimateFor(batch.length);
  console.log(`Earliest event date represented: ${earliest.toISOString()}`);
  console.log(`Latest event date represented: ${latest.toISOString()}`);
  console.log(`Estimated quota cost for THIS batch: ~${batchEstimate} units`);
  console.log(batchEstimate > 8000 ? "WARNING: exceeds the 8,000-unit safe single-batch budget — pass a smaller --limit." : "SAFE: within the 8,000-unit safe single-batch budget.");
  console.log("\nSelected artists, in priority order:");
  for (const { raw, earliestStart } of batch) console.log(`  - ${raw}  (earliest visible event: ${earliestStart.toISOString()})`);
}

export async function runApply(paceBatchSize: number, runLimit: number): Promise<void> {
  const worklist = await buildWorklist();
  let freshCached: Set<string>;
  try {
    freshCached = await getFreshCachedSet(worklist);
  } catch (err) {
    console.error(`::error::Could not query artist_youtube_preview_cache — aborting (the cache table must exist before apply can run): ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const uncachedList = worklist.filter((w) => !freshCached.has(w.normalized));
  const batch = uncachedList.slice(0, runLimit);
  console.log(`Backfilling ${batch.length} uncached distinct artist(s) (of ${uncachedList.length} remaining uncached, ${worklist.length} total visible), prioritized by earliest visible event, paced ${INTER_ARTIST_DELAY_MS}ms apart in pacing groups of ${paceBatchSize}...`);

  let consecutiveFailures = 0;
  let processed = 0;
  let accepted = 0;
  let abstained = 0;
  let failed = 0;
  for (let i = 0; i < batch.length; i++) {
    const { raw } = batch[i];
    if (i > 0 && i % paceBatchSize === 0) {
      console.log(`--- pacing pause (${i}/${batch.length}) ---`);
      await sleep(INTER_BATCH_DELAY_MS);
    } else if (i > 0) {
      await sleep(INTER_ARTIST_DELAY_MS);
    }

    try {
      const result = await getOrMatchArtistYoutubePreview(raw, drizzleCacheStore, youtubeClient);
      if (result.status === "accepted") accepted++;
      else abstained++;
      console.log(`  [${result.status.toUpperCase()}] "${raw}"${result.videoId ? ` -> ${result.videoId}` : ""}`);
      consecutiveFailures = 0;
    } catch (err) {
      failed++;
      console.error(`  [FAILED] "${raw}": ${err instanceof Error ? err.message : String(err)}`);
      if (shouldAbortImmediately(err)) {
        console.error(
          `\nAborting immediately: YouTube's own response confirms the DAILY search quota is exhausted — continuing would only produce more of the same failure until it resets. Processed ${processed}/${batch.length} before stopping. Safe to re-run this script later (once quota resets) — already-cached artists are skipped.`,
        );
        console.log(`\nSummary before abort: processed=${processed} accepted=${accepted} abstained=${abstained} failed=${failed}`);
        return;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT_THRESHOLD) {
        console.error(
          `\nAborting: ${consecutiveFailures} consecutive failures — this looks like exhausted quota, not individual bad artist names (those fail closed to a cached "abstain", never a thrown error). Processed ${processed}/${batch.length} before stopping. Safe to re-run this script later (or tomorrow, once quota resets) — already-cached artists are skipped.`,
        );
        console.log(`\nSummary before abort: processed=${processed} accepted=${accepted} abstained=${abstained} failed=${failed}`);
        return;
      }
    }
    processed++;
  }
  console.log(`\nDone. processed=${processed}/${batch.length} accepted=${accepted} abstained=${abstained} failed=${failed}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode === "plan") {
    const batchLimit = args.limit ? Number(args.limit) : DEFAULT_BATCH_LIMIT;
    await runPlan(batchLimit);
    return;
  }
  if (mode === "apply") {
    if (args.confirm !== CONFIRM_TOKEN) {
      console.error(`::error::--mode=apply requires --confirm=${CONFIRM_TOKEN}`);
      process.exit(1);
    }
    const paceBatchSize = args["batch-size"] ? Number(args["batch-size"]) : BATCH_SIZE_DEFAULT;
    const runLimit = args.limit ? Number(args.limit) : DEFAULT_BATCH_LIMIT;
    await runApply(paceBatchSize, runLimit);
    return;
  }
  console.error("::error::--mode=<plan|apply> is required.");
  process.exit(1);
}

// Only auto-run when this file is executed directly (node ... youtubePreviewBackfill.ts),
// never on import — lets runApply/shouldAbortImmediately be unit-tested without
// triggering the CLI's argv parsing (main.catch's own top-level side effect).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("::error::youtubePreviewBackfill.ts FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
