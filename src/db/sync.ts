import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import { discoveryQueue, sourceEventLinks } from "./schema";
import {
  applyDiscoveryClassificationUpdate,
  applySourceSyncPatch,
  createEvent,
  insertDiscoveryItem,
  recordSourceLink,
  touchSourceSyncStats,
} from "./writes";
import { getAllEventsAdmin, getVenues } from "@/lib/queries";
import { runIngestionPipeline, applyEnrichedGenre, type ExistingEventForDedup } from "@/lib/adapters/pipeline";
import type { SourceAdapter, RawCandidateEvent } from "@/lib/adapters/types";
import { buildDiscoveryQueueClassificationPatch, buildSyncPatch, findSyncMatch, type SyncTargetEvent } from "@/lib/sync";
import { enrichEventGenre } from "./enrichment";
import type { GenreSlug } from "@/lib/taxonomy";

/**
 * Orchestrates one full sync run for one source (task 4/5/6): fetch ->
 * pipeline -> match-or-create -> write, with source failure and
 * unexpected-zero-events handled as distinct, never-silent outcomes (spec
 * section 43) and never interpreted as event cancellation. Pure
 * decision-making lives in src/lib/sync.ts and src/lib/adapters/pipeline.ts;
 * this module is only I/O orchestration around them.
 */

export interface SyncSummary {
  sourceId: string;
  outcome: "ok" | "zero_events" | "failed" | "skipped_concurrent";
  candidatesFound: number;
  created: number;
  updated: number;
  queuedForReview: number;
  errors: string[];
}

const ZERO_EVENTS_MESSAGE =
  "0 events parsed from a successful fetch — likely a page structure change on the source, or (less likely) genuinely no upcoming events. Treated as a source anomaly requiring review, never as venue inactivity or a signal to cancel existing events.";

/**
 * Concurrency safety: a scheduled run, a manual re-trigger, and a retried
 * HTTP request could all reach here for the same source at once. Postgres
 * advisory locks are cluster-wide (visible to every connection, not just
 * this process) and session-scoped, so the lock must be acquired and
 * released on ONE dedicated connection checked out from the pool — routing
 * the acquire/release through drizzle's `db` would let the pool hand each
 * query to a different connection, making the "lock" a no-op. A concurrent
 * run is skipped outright (pg_try_advisory_lock, non-blocking) rather than
 * queued, since a healthy sync finishes in seconds and piling up blocked
 * runs behind a stuck one is worse than just trying again next cycle.
 */
export async function runSourceSync(
  sourceId: string,
  sourceDisplayName: string,
  adapter: SourceAdapter,
): Promise<SyncSummary> {
  const lockClient = await pool.connect();
  try {
    const {
      rows: [{ locked }],
    } = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [sourceId]);
    if (!locked) {
      console.error(`[sync] skipped: another sync for "${sourceId}" is already running`);
      return { sourceId, outcome: "skipped_concurrent", candidatesFound: 0, created: 0, updated: 0, queuedForReview: 0, errors: [] };
    }
    try {
      return await runSourceSyncLocked(sourceId, sourceDisplayName, adapter);
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [sourceId]);
    }
  } finally {
    lockClient.release();
  }
}

async function runSourceSyncLocked(
  sourceId: string,
  sourceDisplayName: string,
  adapter: SourceAdapter,
): Promise<SyncSummary> {
  let candidates: RawCandidateEvent[];
  try {
    candidates = await adapter.fetchCandidates();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync] "${sourceId}" fetch failed: ${message}`);
    await touchSourceSyncStats(sourceId, { success: false, error: message });
    return { sourceId, outcome: "failed", candidatesFound: 0, created: 0, updated: 0, queuedForReview: 0, errors: [message] };
  }

  if (candidates.length === 0) {
    console.error(`[sync] "${sourceId}" zero-event anomaly: ${ZERO_EVENTS_MESSAGE}`);
    await touchSourceSyncStats(sourceId, { success: false, error: ZERO_EVENTS_MESSAGE });
    return {
      sourceId,
      outcome: "zero_events",
      candidatesFound: 0,
      created: 0,
      updated: 0,
      queuedForReview: 0,
      errors: [ZERO_EVENTS_MESSAGE],
    };
  }

  const [venues, existingEventRows, links, pendingDiscovery] = await Promise.all([
    getVenues(),
    getAllEventsAdmin(),
    db.select().from(sourceEventLinks).where(eq(sourceEventLinks.sourceId, sourceId)),
    db.select().from(discoveryQueue).where(eq(discoveryQueue.status, "pending")),
  ]);

  const linkedByUrl = new Map(links.map((l) => [l.sourceUrl, l.eventId]));
  const pendingByUrl = new Map(pendingDiscovery.map((d) => [d.sourceUrl, d]));
  const existingForDedup: ExistingEventForDedup[] = existingEventRows.map((e) => ({
    id: e.id,
    title: e.title,
    artists: e.artists,
    venueId: e.venueId,
    startDatetime: e.startDatetime,
  }));
  const existingById = new Map(existingEventRows.map((e) => [e.id, e]));

  let created = 0;
  let updated = 0;
  let queuedForReview = 0;
  const errors: string[] = [];

  for (const raw of candidates) {
    try {
      let result = runIngestionPipeline(raw, { venues, existingEvents: existingForDedup });

      // Genre enrichment (Discogs, MVP): only runs when the deterministic
      // classifier left genre unresolved, and only ever adds medium
      // confidence at most — it can move a candidate from hold into the
      // review queue with a suggested genre, never straight to
      // auto_publish. A Discogs failure/timeout/rate-limit here is
      // swallowed by enrichEventGenre's own per-artist try/catch and simply
      // leaves `result` exactly as the deterministic classifier produced it
      // — today's existing unresolved/review behavior, unchanged.
      if (result.genre === null) {
        const enrichment = await enrichEventGenre(raw.artists);
        if (enrichment.genre && enrichment.genreConfidence) {
          result = applyEnrichedGenre(result, enrichment.genre, enrichment.genreConfidence);
        }
      }

      const linkedEventId = raw.officialEventUrl ? (linkedByUrl.get(raw.officialEventUrl) ?? null) : null;
      const match = findSyncMatch(linkedEventId, result.duplicateOfEventId, result.duplicateConfidence);

      if (match) {
        const existing = existingById.get(match.eventId);
        if (!existing) continue; // stale link/dedup pointer — skip rather than guess
        const target: SyncTargetEvent = {
          id: existing.id,
          title: existing.title,
          description: existing.description,
          artists: existing.artists,
          venueId: existing.venueId,
          startDatetime: existing.startDatetime,
          endDatetime: existing.endDatetime,
          officialEventUrl: existing.officialEventUrl,
          ticketUrl: existing.ticketUrl,
          facebookUrl: existing.facebookUrl,
          residentAdvisorUrl: existing.residentAdvisorUrl,
          imageUrl: existing.imageUrl,
          primaryGenre: existing.primaryGenre,
          overriddenFields: existing.overriddenFields,
        };
        const { patch } = buildSyncPatch(
          raw,
          {
            resolvedVenueId: result.resolvedVenueId,
            normalizedArtists: result.normalizedArtists,
            genre: result.genre,
            genreConfidence: result.genreConfidence,
          },
          target,
        );
        if (Object.keys(patch).length > 0) {
          await applySourceSyncPatch(match.eventId, sourceId, patch);
        }
        if (raw.officialEventUrl) {
          await recordSourceLink(match.eventId, sourceId, raw.officialEventUrl, "official");
        }
        updated++;
        continue;
      }

      if (result.decision === "auto_publish" && result.resolvedVenueId && raw.startDatetime) {
        const eventId = `e-${randomUUID().slice(0, 8)}`;
        const slug = `${(raw.title || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${eventId}`;
        await createEvent(
          {
            id: eventId,
            title: raw.title,
            slug,
            description: raw.description,
            artists: result.normalizedArtists,
            startDatetime: new Date(raw.startDatetime),
            endDatetime: raw.endDatetime ? new Date(raw.endDatetime) : null,
            venueId: result.resolvedVenueId,
            primaryGenre: result.genre ?? "electronic-other",
            subgenres: result.genre ? [result.genre] : [],
            genreConfidence: result.genreConfidence,
            officialEventUrl: raw.officialEventUrl,
            ticketUrl: raw.ticketUrl,
            facebookUrl: raw.facebookUrl,
            residentAdvisorUrl: raw.residentAdvisorUrl,
            imageUrl: raw.imageUrl,
            priceFrom: raw.priceFrom,
            currency: raw.priceFrom != null ? "DKK" : null,
            published: true,
            confidence: result.genreConfidence,
            canonicalSourceId: sourceId,
          },
          sourceId,
        );
        created++;
        continue;
      }

      // review_queue or hold — but don't re-queue a duplicate row on every
      // sync cycle for a candidate that's already awaiting an admin decision.
      // Instead, let the classification-only patch (never identity/status)
      // refresh the existing row if this run's genre resolution improved on
      // what's stored — see buildDiscoveryQueueClassificationPatch.
      const dedupKey = raw.officialEventUrl ?? raw.sourceUrl;
      const existingPending = pendingByUrl.get(dedupKey);
      if (existingPending) {
        const classificationPatch = buildDiscoveryQueueClassificationPatch(
          { genre: result.genre, genreConfidence: result.genreConfidence },
          {
            status: existingPending.status,
            predictedGenre: existingPending.predictedGenre as GenreSlug | null,
            overriddenFields: existingPending.overriddenFields,
          },
        );
        await applyDiscoveryClassificationUpdate(existingPending.id, classificationPatch);
        continue;
      }

      const queueId = `dq-${randomUUID().slice(0, 8)}`;
      await insertDiscoveryItem({
        id: queueId,
        probableTitle: raw.title || "(untitled)",
        probableStart: raw.startDatetime ? new Date(raw.startDatetime) : null,
        probableVenueName: raw.venueName,
        sourceName: sourceDisplayName,
        sourceUrl: dedupKey,
        sourceId,
        detectedLineup: result.normalizedArtists,
        predictedGenre: result.genre,
        genreConfidence: result.genreConfidence,
        suspectedDuplicateOfEventId: result.duplicateOfEventId,
        missingFields: result.missingFields,
        overallConfidence: result.decision === "review_queue" ? "medium" : "low",
      });
      queuedForReview++;
    } catch (err) {
      // Drizzle wraps the real driver/Postgres error in `.cause` and puts
      // only a generic "Failed query: ...\nparams: ..." in `.message` —
      // without surfacing `.cause` too, every DB-level failure here looks
      // identical regardless of actual reason (constraint violation, bad
      // value, connection issue, etc.), which makes this list undiagnosable
      // from the sync summary alone.
      const cause = err instanceof Error && err.cause instanceof Error ? ` (cause: ${err.cause.message})` : "";
      errors.push(`${raw.title || "(untitled)"}: ${err instanceof Error ? err.message : String(err)}${cause}`);
    }
  }

  await touchSourceSyncStats(sourceId, { success: true, eventsFound: candidates.length, eventsUpdated: updated });
  return { sourceId, outcome: "ok", candidatesFound: candidates.length, created, updated, queuedForReview, errors };
}
