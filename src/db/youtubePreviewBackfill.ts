import { fileURLToPath } from "node:url";
import { eq, inArray, gt, and } from "drizzle-orm";
import { db } from "./client";
import { events, artistYoutubePreviewCache, discoveryQueue, sources } from "./schema";
import { cleanArtistDisplayName, normalizeArtistName, isPlaceholderArtistName } from "@/lib/enrichment/genreEnrichment";
import { getOrMatchArtistYoutubePreview } from "@/lib/enrichment/youtubePreviewMatching";
import * as youtubeClient from "@/lib/enrichment/youtubeClient";
import { YoutubeDailyQuotaExhaustedError } from "@/lib/enrichment/youtubeClient";
import { drizzleCacheStore } from "./youtubePreview";
import { isPastEvent } from "@/lib/datetime";
import { classifyAdminQueueRow } from "@/lib/adminQueue";
import type { ConfidenceLevel } from "@/lib/types";
import type { HoldReason } from "@/lib/adapters/pipeline";
import type { PublishDecision } from "@/lib/classification";
import type { GenreSlug } from "@/lib/taxonomy";

/**
 * One-time YouTube Artist Preview cache backfill for the full approved
 * relevant population (automated Artist Preview V1 merge review,
 * 2026-09-25, items 2 and 3 — item 3 narrows scope to visible events only,
 * using the exact same effective-end semantics as the public site rather
 * than a new date rule invented for this script; scope widened 2026-09-27
 * to also include the same Discovery-stage population the automatic
 * enrichment hook and read-only backlog-projection diagnostic already
 * cover — see buildWorklist's own doc comment below for the fix and why
 * the worklist previously undercounted the real backlog).
 *
 * Why this exists: matching only ever runs at src/db/writes.ts::createEvent
 * (on publish) and src/db/writes.ts::triggerDiscoveryEnrichment (on a
 * Discovery row landing in Needs Review/Venue Blocked) — no already-
 * existing published event or Discovery row is touched retroactively by
 * either of those. Without running this once after deploy (and periodically
 * thereafter, since a pending Discovery row's classification is re-derived
 * on every sync), every artist already in the catalogue at either stage
 * would show no preview until something re-triggers the automatic hooks.
 * Scoped to visible events only (per src/lib/datetime.ts::isPastEvent, the
 * same rule every other page already uses) so quota is never spent on a
 * long-past event's lineup nobody can see a preview for anyway, and to
 * Discovery rows currently classified Needs Review/Venue Blocked only (per
 * classifyAdminQueueRow, src/lib/adminQueue.ts) — the same actionable
 * population an admin can see and act on right now.
 *
 * Never touches `events` or `discovery_queue` rows — reads
 * `events.artists`/`startDatetime`/`endDatetime` and (for pending Discovery
 * rows) the same fields classifyAdminQueueRow needs, only to build the
 * distinct artist-name worklist — and every write goes through the exact
 * same cache-first Rule A matcher production ingestion uses
 * (getOrMatchArtistYoutubePreview + the real Postgres cache store from
 * src/db/youtubePreview.ts), which only ever writes to
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
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBackfill.ts --mode=apply --confirm=BACKFILL-YOUTUBE-PREVIEW [--batch-size=20] [--limit=N] [--artist="Exact Artist Name"]
 *
 * --artist (apply mode only, 2026-09-26 smoke-test addition): scopes the run
 * to exactly one normalized artist name, ignoring --limit entirely. Matches
 * a single uncached worklist entry (or does nothing, logging why, if that
 * name isn't an uncached artist in the combined relevant population) —
 * never falls back to processing anyone else.
 *
 * --mode=plan is entirely read-only (same combined-population projection as
 * `inspectSource.ts --mode=youtube-preview-backlog-projection`, reproduced
 * here so the exact code path that will run the backfill also plans it) and
 * also reports how many of the combined-population artists are already
 * cached and fresh, so --mode=apply's real remaining cost is visible up
 * front.
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
 * Sentinel "no known date" priority marker for a Discovery-only artist whose
 * row carries no resolved probableStart (e.g. still missing a date field) —
 * sorts after every real event date, same spirit as adminQueue.ts's own
 * compareUpcomingFirst treating a missing date as sinking to the bottom,
 * never as "soonest"/"unknown-but-urgent". If the same normalized artist
 * also appears on a real dated event/Discovery row, the merge below always
 * keeps the earlier real date — this sentinel only surfaces when NO dated
 * mention exists anywhere in the combined pool.
 */
const NO_KNOWN_DATE_SENTINEL = new Date("9999-12-31T00:00:00.000Z");

/**
 * Distinct normalized artist names across the full approved relevant
 * population (scope fix, 2026-09-27 — see this file's own top-of-file doc
 * comment): (A) every CURRENT/FUTURE-VISIBLE published event
 * (src/lib/datetime.ts::isPastEvent === false — the same effective-end rule
 * the public site uses everywhere else) UNION (B) every pending
 * discovery_queue row currently classified NEEDS_REVIEW or VENUE_BLOCKED via
 * classifyAdminQueueRow (src/lib/adminQueue.ts) — the exact same function,
 * and exact same category pair, the admin queue itself groups rows with and
 * the automatic Discovery-stage enrichment hook (triggerDiscoveryEnrichment,
 * src/db/writes.ts) already triggers on, never a separately-derived
 * "relevant" definition. INSUFFICIENT/REJECTED/PAST_STALE rows and every
 * non-pending status are excluded, same as that hook.
 *
 * Each distinct normalized name is mapped to one real raw display form (the
 * raw form is what's actually passed to the matcher — matching re-normalizes
 * from it) and the earliest date it's associated with across BOTH pools
 * (a published event's real startDatetime, or a Discovery row's
 * probableStart, falling back to NO_KNOWN_DATE_SENTINEL when that row has no
 * resolved date) — so an artist appearing in both pools keeps whichever date
 * is earlier, never double-counted. Sorted by that earliest date, then
 * normalized name as a deterministic tie-breaker (2026-09-25 prioritized
 * rollout) — never popularity/view-count, which V1 deliberately doesn't
 * measure.
 */
async function buildWorklist(): Promise<WorklistEntry[]> {
  const byNormalized = new Map<string, WorklistEntry>();
  const addMention = (raw: string, candidateStart: Date) => {
    if (isPlaceholderArtistName(raw)) return;
    const normalized = normalizeArtistName(cleanArtistDisplayName(raw));
    if (!normalized) return;
    const existing = byNormalized.get(normalized);
    if (!existing) byNormalized.set(normalized, { normalized, raw, earliestStart: candidateStart });
    else if (candidateStart < existing.earliestStart) existing.earliestStart = candidateStart;
  };

  // A. Current/future-visible published events.
  const eventRows = await db
    .select({ artists: events.artists, startDatetime: events.startDatetime, endDatetime: events.endDatetime })
    .from(events)
    .where(eq(events.published, true));
  const now = new Date();
  const visibleEventRows = eventRows.filter(
    (row) => !isPastEvent({ startDatetime: row.startDatetime.toISOString(), endDatetime: row.endDatetime?.toISOString() ?? null }, now),
  );
  for (const row of visibleEventRows) {
    for (const raw of row.artists) addMention(raw, row.startDatetime);
  }

  // B. Pending discovery_queue rows classified NEEDS_REVIEW or VENUE_BLOCKED.
  // Never mutates discovery_queue — read-only, exactly like the events read
  // above.
  const dqRows = await db
    .select({
      probableTitle: discoveryQueue.probableTitle,
      probableStart: discoveryQueue.probableStart,
      probableEnd: discoveryQueue.probableEnd,
      missingFields: discoveryQueue.missingFields,
      overallConfidence: discoveryQueue.overallConfidence,
      holdReason: discoveryQueue.holdReason,
      venueResolvedDecision: discoveryQueue.venueResolvedDecision,
      lastSeenAt: discoveryQueue.lastSeenAt,
      sourceId: discoveryQueue.sourceId,
      predictedGenre: discoveryQueue.predictedGenre,
      detectedLineup: discoveryQueue.detectedLineup,
    })
    .from(discoveryQueue)
    .where(eq(discoveryQueue.status, "pending"));

  // classifyAdminQueueRow needs each row's SOURCE's real lastCompleteSyncAt
  // (see its own doc comment) — batched into one query across every distinct
  // registered source these pending rows reference, rather than a
  // per-row lookup.
  const sourceIds = [...new Set(dqRows.map((r) => r.sourceId).filter((id): id is string => id !== null))];
  const lastCompleteSyncById = new Map<string, string | null>();
  if (sourceIds.length > 0) {
    const sourceRows = await db
      .select({ id: sources.id, lastCompleteSyncAt: sources.lastCompleteSyncAt })
      .from(sources)
      .where(inArray(sources.id, sourceIds));
    for (const r of sourceRows) lastCompleteSyncById.set(r.id, r.lastCompleteSyncAt ? r.lastCompleteSyncAt.toISOString() : null);
  }

  for (const row of dqRows) {
    const lastCompleteSyncAt = row.sourceId ? (lastCompleteSyncById.get(row.sourceId) ?? null) : null;
    const category = classifyAdminQueueRow(
      {
        overallConfidence: row.overallConfidence as ConfidenceLevel,
        holdReason: row.holdReason as HoldReason,
        venueResolvedDecision: row.venueResolvedDecision as PublishDecision | null,
        missingFields: row.missingFields,
        probableStart: row.probableStart ? row.probableStart.toISOString() : null,
        probableEnd: row.probableEnd ? row.probableEnd.toISOString() : null,
        lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
        sourceId: row.sourceId,
        probableTitle: row.probableTitle,
        detectedLineup: row.detectedLineup,
        predictedGenre: row.predictedGenre as GenreSlug | null,
      },
      { lastCompleteSyncAt, now },
    );
    if (category !== "needs_review" && category !== "venue_blocked") continue;
    const earliestStart = row.probableStart ?? NO_KNOWN_DATE_SENTINEL;
    for (const raw of row.detectedLineup) addMention(raw, earliestStart);
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

  console.log(`Distinct artists across the combined relevant population (current/future-visible published events + Needs Review/Venue Blocked Discovery rows): ${worklist.length}`);
  console.log(`Already cached (fresh): ${freshCached.size}`);
  console.log(`Uncached: ${uncachedList.length}`);
  console.log(`Estimated FULL remaining backfill quota cost: ~${estimateFor(uncachedList.length)} units (10,000/day default budget) — ${Math.ceil(uncachedList.length / batchLimit)} batch(es) at size ${batchLimit}.`);

  const batch = uncachedList.slice(0, batchLimit);
  console.log(`\nPrioritized batch preview (limit=${batchLimit}, earliest-visible-event-first, normalized-name tie-break):`);
  console.log(`Selected for this batch: ${batch.length} of ${uncachedList.length} uncached`);
  if (batch.length === 0) {
    console.log("Nothing to do — every artist in the combined relevant population is already cached.");
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
  for (const { raw, earliestStart } of batch) console.log(`  - ${raw}  (earliest known date: ${earliestStart.toISOString()})`);
}

export async function runApply(paceBatchSize: number, runLimit: number, artistFilter?: string | null): Promise<void> {
  const worklist = await buildWorklist();
  let freshCached: Set<string>;
  try {
    freshCached = await getFreshCachedSet(worklist);
  } catch (err) {
    console.error(`::error::Could not query artist_youtube_preview_cache — aborting (the cache table must exist before apply can run): ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const uncachedList = worklist.filter((w) => !freshCached.has(w.normalized));

  let batch: WorklistEntry[];
  if (artistFilter) {
    // Single-artist smoke-test scoping (2026-09-26): matches on normalized
    // name, exactly the same normalization the worklist itself and the real
    // matcher both use, so "--artist" targets the identical identity a
    // production lineup would. Never falls back to --limit -- either this
    // one name resolves to exactly one uncached worklist entry, or nothing
    // runs at all.
    const targetNormalized = normalizeArtistName(cleanArtistDisplayName(artistFilter));
    batch = uncachedList.filter((w) => w.normalized === targetNormalized);
    if (batch.length === 0) {
      console.log(
        `No uncached worklist entry matches --artist="${artistFilter}" (normalized: "${targetNormalized}") — nothing to do (already cached, or no visible event or Needs Review/Venue Blocked Discovery row currently contains this artist).`,
      );
      return;
    }
  } else {
    batch = uncachedList.slice(0, runLimit);
  }
  console.log(`Backfilling ${batch.length} uncached distinct artist(s) (of ${uncachedList.length} remaining uncached, ${worklist.length} total in the combined relevant population), prioritized by earliest known date, paced ${INTER_ARTIST_DELAY_MS}ms apart in pacing groups of ${paceBatchSize}...`);

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
    const artistFilter = typeof args.artist === "string" ? args.artist : null;
    await runApply(paceBatchSize, runLimit, artistFilter);
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
