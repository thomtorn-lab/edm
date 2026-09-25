import { eq } from "drizzle-orm";
import { db } from "./client";
import { events } from "./schema";
import { cleanArtistDisplayName, normalizeArtistName, isPlaceholderArtistName } from "@/lib/enrichment/genreEnrichment";
import { getOrMatchArtistYoutubePreview } from "@/lib/enrichment/youtubePreviewMatching";
import * as youtubeClient from "@/lib/enrichment/youtubeClient";
import { drizzleCacheStore } from "./youtubePreview";

/**
 * One-time YouTube Artist Preview cache backfill for the EXISTING published
 * catalogue (automated Artist Preview V1 merge review, 2026-09-25, item 2).
 *
 * Why this exists: matching only ever runs at src/db/writes.ts::createEvent,
 * for a newly-ingested/approved event — no already-published event is
 * touched retroactively. Without running this once after deploy, every
 * artist already in the catalogue would show no preview until they happen
 * to appear in a brand-new event, which could be months away for a
 * recurring resident or never for an act that already played its one date.
 *
 * Never touches `events` rows — reads `events.artists` only to build the
 * distinct artist-name worklist, and every write goes through the exact
 * same cache-first Rule A matcher production ingestion uses
 * (getOrMatchArtistYoutubePreview + the real Postgres cache store from
 * src/db/youtubePreview.ts), which only ever writes to
 * artist_youtube_preview_cache. Idempotent by construction: cache-first
 * matching means re-running this script (in full, from the start) after a
 * partial/interrupted run skips every artist already cached and fresh —
 * no separate resume-checkpoint mechanism is needed. No Rule B: this calls
 * the identical matcher production ingestion uses, nothing looser.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBackfill.ts --mode=plan
 *   node --env-file=.env.local --import tsx src/db/youtubePreviewBackfill.ts --mode=apply --confirm=BACKFILL-YOUTUBE-PREVIEW [--batch-size=20] [--limit=N]
 *
 * --mode=plan is entirely read-only (same projection as
 * `inspectSource.ts --mode=youtube-preview-backfill-plan`, reproduced here
 * so the exact code path that will run the backfill also plans it).
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
 */

const BATCH_SIZE_DEFAULT = 20;
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

/** Distinct normalized artist names across every currently-published event, each mapped to one real raw display form (the raw form is what's actually passed to the matcher — matching re-normalizes from it; this map is for a stable, deduplicated worklist and readable logging). */
async function buildWorklist(): Promise<{ normalized: string; raw: string }[]> {
  const rows = await db.select({ artists: events.artists }).from(events).where(eq(events.published, true));
  const seen = new Map<string, string>();
  for (const row of rows) {
    for (const raw of row.artists) {
      if (isPlaceholderArtistName(raw)) continue;
      const normalized = normalizeArtistName(cleanArtistDisplayName(raw));
      if (!normalized || seen.has(normalized)) continue;
      seen.set(normalized, raw);
    }
  }
  return [...seen.entries()].map(([normalized, raw]) => ({ normalized, raw }));
}

async function runPlan(): Promise<void> {
  const worklist = await buildWorklist();
  const estimatedFallback = Math.ceil(worklist.length * 0.35);
  const estimatedUnits = worklist.length * 100 + estimatedFallback * 100;
  console.log(`Distinct artists to backfill: ${worklist.length}`);
  console.log(`Estimated quota cost: ~${estimatedUnits} units (10,000/day default budget)`);
  console.log(`At batch size ${BATCH_SIZE_DEFAULT}, this is ${Math.ceil(worklist.length / BATCH_SIZE_DEFAULT)} batch(es).`);
  if (estimatedUnits > 8000) {
    console.log(
      "This exceeds a safe single-day quota budget — run with --limit=N across multiple days, or rely on the script's own consecutive-failure abort (safe: already-processed artists are cached and won't be re-looked-up on a later run).",
    );
  }
  console.log("\nFirst 20 (of the full worklist, for a quick sanity check):");
  for (const { raw } of worklist.slice(0, 20)) console.log(`  - ${raw}`);
}

async function runApply(batchSize: number, limit: number | null): Promise<void> {
  let worklist = await buildWorklist();
  if (limit != null) worklist = worklist.slice(0, limit);
  console.log(`Backfilling ${worklist.length} distinct artist(s), paced ${INTER_ARTIST_DELAY_MS}ms apart in batches of ${batchSize}...`);

  let consecutiveFailures = 0;
  let processed = 0;
  for (let i = 0; i < worklist.length; i++) {
    const { raw } = worklist[i];
    if (i > 0 && i % batchSize === 0) {
      console.log(`--- batch boundary (${i}/${worklist.length}) ---`);
      await sleep(INTER_BATCH_DELAY_MS);
    } else if (i > 0) {
      await sleep(INTER_ARTIST_DELAY_MS);
    }

    try {
      const result = await getOrMatchArtistYoutubePreview(raw, drizzleCacheStore, youtubeClient);
      console.log(`  [${result.status.toUpperCase()}] "${raw}"${result.videoId ? ` -> ${result.videoId}` : ""}`);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      console.error(`  [FAILED] "${raw}": ${err instanceof Error ? err.message : String(err)}`);
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT_THRESHOLD) {
        console.error(
          `\nAborting: ${consecutiveFailures} consecutive failures — this looks like exhausted quota, not individual bad artist names (those fail closed to a cached "abstain", never a thrown error). Processed ${processed}/${worklist.length} before stopping. Safe to re-run this script later (or tomorrow, once quota resets) — already-cached artists are skipped.`,
        );
        return;
      }
    }
    processed++;
  }
  console.log(`\nDone. Processed ${processed}/${worklist.length}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode === "plan") {
    await runPlan();
    return;
  }
  if (mode === "apply") {
    if (args.confirm !== CONFIRM_TOKEN) {
      console.error(`::error::--mode=apply requires --confirm=${CONFIRM_TOKEN}`);
      process.exit(1);
    }
    const batchSize = args["batch-size"] ? Number(args["batch-size"]) : BATCH_SIZE_DEFAULT;
    const limit = args.limit ? Number(args.limit) : null;
    await runApply(batchSize, limit);
    return;
  }
  console.error("::error::--mode=<plan|apply> is required.");
  process.exit(1);
}

main().catch((err) => {
  console.error("::error::youtubePreviewBackfill.ts FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
