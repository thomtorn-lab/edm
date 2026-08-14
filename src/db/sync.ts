import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { discoveryQueue, sourceEventLinks } from "./schema";
import {
  applySourceSyncPatch,
  createEvent,
  insertDiscoveryItem,
  recordSourceLink,
  touchSourceSyncStats,
} from "./writes";
import { getAllEventsAdmin, getVenues } from "@/lib/queries";
import { runIngestionPipeline, type ExistingEventForDedup } from "@/lib/adapters/pipeline";
import type { SourceAdapter, RawCandidateEvent } from "@/lib/adapters/types";
import { buildSyncPatch, findSyncMatch, type SyncTargetEvent } from "@/lib/sync";

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
  outcome: "ok" | "zero_events" | "failed";
  candidatesFound: number;
  created: number;
  updated: number;
  queuedForReview: number;
  errors: string[];
}

const ZERO_EVENTS_MESSAGE =
  "0 events parsed from a successful fetch — likely a page structure change on the source, or (less likely) genuinely no upcoming events. Treated as a source anomaly requiring review, never as venue inactivity or a signal to cancel existing events.";

export async function runSourceSync(
  sourceId: string,
  sourceDisplayName: string,
  adapter: SourceAdapter,
): Promise<SyncSummary> {
  let candidates: RawCandidateEvent[];
  try {
    candidates = await adapter.fetchCandidates();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await touchSourceSyncStats(sourceId, { success: false, error: message });
    return { sourceId, outcome: "failed", candidatesFound: 0, created: 0, updated: 0, queuedForReview: 0, errors: [message] };
  }

  if (candidates.length === 0) {
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
  const pendingByUrl = new Set(pendingDiscovery.map((d) => d.sourceUrl));
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
      const result = runIngestionPipeline(raw, { venues, existingEvents: existingForDedup });
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
      const dedupKey = raw.officialEventUrl ?? raw.sourceUrl;
      if (pendingByUrl.has(dedupKey)) continue;

      const queueId = `dq-${randomUUID().slice(0, 8)}`;
      await insertDiscoveryItem({
        id: queueId,
        probableTitle: raw.title || "(untitled)",
        probableStart: raw.startDatetime ? new Date(raw.startDatetime) : null,
        probableVenueName: raw.venueName,
        sourceName: sourceDisplayName,
        sourceUrl: dedupKey,
        detectedLineup: result.normalizedArtists,
        predictedGenre: result.genre,
        genreConfidence: result.genreConfidence,
        suspectedDuplicateOfEventId: result.duplicateOfEventId,
        missingFields: result.missingFields,
        overallConfidence: result.decision === "review_queue" ? "medium" : "low",
      });
      queuedForReview++;
    } catch (err) {
      errors.push(`${raw.title || "(untitled)"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await touchSourceSyncStats(sourceId, { success: true, eventsFound: candidates.length, eventsUpdated: updated });
  return { sourceId, outcome: "ok", candidatesFound: candidates.length, created, updated, queuedForReview, errors };
}
