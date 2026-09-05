import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db } from "./client";
import { discoveryQueue, sourceEventLinks, syncLocks } from "./schema";
import {
  applyDiscoveryClassificationUpdate,
  applySourceSyncPatch,
  applySyncHoldUnpublish,
  createEvent,
  insertDiscoveryItem,
  recordSourceLink,
  resolveDiscoveryItemAsPublished,
  touchSourceSyncStats,
  updateSourceLinkUrl,
} from "./writes";
import { getAllEventsAdmin, getVenues } from "@/lib/queries";
import { notifyDiscoveryQueueInsertBatch, type DiscoveryQueueNotificationItem } from "@/lib/discoveryNotification";
import { runIngestionPipeline, applyEnrichedGenre, type ExistingEventForDedup } from "@/lib/adapters/pipeline";
import { GENERIC_ELECTRONIC_GENRE } from "@/lib/relevance";
import { isTrustedElectronicSource } from "@/lib/data/sources";
import type { SourceAdapter, RawCandidateEvent } from "@/lib/adapters/types";
import {
  buildDiscoveryQueueClassificationPatch,
  buildSyncPatch,
  decidePublishedEventSyncAction,
  findPendingRowToResolve,
  findSyncMatch,
  summarizeWriteErrors,
  type SyncTargetEvent,
} from "@/lib/sync";
import { enrichEventGenre } from "./enrichment";
import type { GenreSlug } from "@/lib/taxonomy";
import type { ConfidenceLevel } from "@/lib/types";
import type { PublishDecision } from "@/lib/classification";
import type { HoldReason } from "@/lib/adapters/pipeline";

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
  outcome: "ok" | "partial_failure" | "zero_events" | "failed" | "skipped_concurrent";
  candidatesFound: number;
  created: number;
  updated: number;
  queuedForReview: number;
  /** Already-published events automatically unpublished this run because
   *  their fresh classification is now "hold" on genuine, complete-data
   *  negative-relevance evidence — see decidePublishedEventSyncAction. */
  unpublished: number;
  errors: string[];
}

const ZERO_EVENTS_MESSAGE =
  "0 events parsed from a successful fetch — likely a page structure change on the source, or (less likely) genuinely no upcoming events. Treated as a source anomaly requiring review, never as venue inactivity or a signal to cancel existing events.";

/**
 * Concurrency safety: a scheduled run, a manual re-trigger, and a retried
 * HTTP request could all reach here for the same source at once.
 *
 * This used to be a Postgres advisory lock (pg_try_advisory_lock /
 * pg_advisory_unlock) acquired and released on one dedicated connection
 * checked out from the pool. That broke in production: advisory locks are
 * session-scoped, but this app connects through Supabase's Supavisor
 * pooler, which can hand a *later, unrelated* connection the exact same
 * backend process that an earlier request's connection used — and that
 * backend still remembers whatever advisory locks it was holding. A single
 * request that acquired the lock and then never got to release it (a
 * timeout, a killed serverless invocation, anything that skips the
 * `finally`) left that backend holding the lock indefinitely; every future
 * sync for that source then failed with "skipped_concurrent" forever,
 * requiring a manual pg_terminate_backend to recover — this is exactly
 * what happened to src-culture-box in production.
 *
 * The replacement is a lease row in `sync_locks`, one per source, with an
 * expiry. Acquiring and releasing are each a single atomic SQL statement
 * against the ordinary pooled `db` — no dedicated connection, no session
 * affinity required, because the atomicity lives entirely inside one
 * INSERT ... ON CONFLICT ... WHERE ... RETURNING statement (Postgres
 * guarantees that regardless of which pooled backend runs it). Crucially,
 * neither acquireSyncLock nor releaseSyncLock is held open across
 * runSourceSyncLocked's adapter.fetchCandidates() call — that HTTP fetch
 * (up to ~17 sequential requests for Culture Box's two-stage adapter) runs
 * with no DB connection or transaction held at all, only the lease *row*
 * existing in the table. If a request dies mid-sync without ever reaching
 * the `finally`, the lease simply expires (LEASE_TTL_MS) and the next sync
 * attempt acquires it normally — no manual cleanup, no permanent lock,
 * ever. A concurrent run is skipped outright rather than queued, since a
 * healthy sync finishes in seconds and piling up blocked runs behind a
 * stuck one is worse than just trying again next cycle.
 */
const LEASE_TTL_MS = 5 * 60 * 1000;

export async function acquireSyncLock(sourceId: string): Promise<string | null> {
  const lockToken = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
  const rows = await db
    .insert(syncLocks)
    .values({ sourceId, lockToken, lockedAt: now, expiresAt })
    .onConflictDoUpdate({
      target: syncLocks.sourceId,
      set: { lockToken, lockedAt: now, expiresAt },
      where: lte(syncLocks.expiresAt, now),
    })
    .returning({ lockToken: syncLocks.lockToken });
  return rows[0]?.lockToken === lockToken ? lockToken : null;
}

export async function releaseSyncLock(sourceId: string, lockToken: string): Promise<void> {
  await db.delete(syncLocks).where(and(eq(syncLocks.sourceId, sourceId), eq(syncLocks.lockToken, lockToken)));
}

export async function runSourceSync(
  sourceId: string,
  sourceDisplayName: string,
  adapter: SourceAdapter,
): Promise<SyncSummary> {
  const lockToken = await acquireSyncLock(sourceId);
  if (!lockToken) {
    console.error(`[sync] skipped: another sync for "${sourceId}" is already running`);
    return { sourceId, outcome: "skipped_concurrent", candidatesFound: 0, created: 0, updated: 0, queuedForReview: 0, unpublished: 0, errors: [] };
  }
  try {
    return await runSourceSyncLocked(sourceId, sourceDisplayName, adapter);
  } finally {
    await releaseSyncLock(sourceId, lockToken);
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
    return { sourceId, outcome: "failed", candidatesFound: 0, created: 0, updated: 0, queuedForReview: 0, unpublished: 0, errors: [message] };
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
      unpublished: 0,
      errors: [ZERO_EVENTS_MESSAGE],
    };
  }

  // Source-freshness bookkeeping (unknown-venue visibility work package,
  // 2026-08-31) — see sources.lastCompleteSyncAt's own doc comment. Adapters
  // without partial-fetch semantics (everything except Billetto today) omit
  // lastFetchWasComplete entirely, so this is true for them whenever they
  // succeed at all, exactly like every existing sync outcome already treats
  // them. seenAt is one timestamp for this whole sync run, not one per
  // candidate — freshness only needs to know "was this row touched by THIS
  // sync", not sub-second ordering within it.
  const fetchComplete = adapter.lastFetchWasComplete?.() ?? true;
  const seenAt = new Date();

  const [venues, existingEventRows, links, pendingDiscovery] = await Promise.all([
    getVenues(),
    getAllEventsAdmin(),
    db.select().from(sourceEventLinks).where(eq(sourceEventLinks.sourceId, sourceId)),
    db.select().from(discoveryQueue).where(eq(discoveryQueue.status, "pending")),
  ]);
  // Static, code-level declaration (src/lib/data/sources.ts) — a
  // product-routing property, not a DB read (see isTrustedElectronicSource's
  // own doc comment for why this is deliberately not a Production column).
  const trustedElectronicSource = isTrustedElectronicSource(sourceId);

  const linkedByUrl = new Map(links.map((l) => [l.sourceUrl, l.eventId]));
  const pendingByUrl = new Map(pendingDiscovery.map((d) => [d.sourceUrl, d]));
  const existingForDedup: ExistingEventForDedup[] = existingEventRows.map((e) => ({
    id: e.id,
    title: e.title,
    artists: e.artists,
    venueId: e.venueId,
    startDatetime: e.startDatetime,
    sourceId: e.canonicalSourceId,
    officialEventUrl: e.officialEventUrl,
    ticketUrl: e.ticketUrl,
    residentAdvisorUrl: e.residentAdvisorUrl,
  }));
  const existingById = new Map(existingEventRows.map((e) => [e.id, e]));

  let created = 0;
  let updated = 0;
  let queuedForReview = 0;
  let unpublished = 0;
  const errors: string[] = [];
  // Collected as rows are inserted, then notified in one bounded-concurrency
  // batch after the loop finishes — never awaited per-candidate, so N new
  // pending rows never become N sequential email round-trips inside the
  // per-candidate DB write path (see notifyDiscoveryQueueInsertBatch).
  const newlyQueuedItems: DiscoveryQueueNotificationItem[] = [];

  for (const raw of candidates) {
    try {
      let result = runIngestionPipeline(raw, { venues, existingEvents: existingForDedup, trustedElectronicSource });

      // Genre enrichment (Discogs; follow-up review — weak-evidence
      // enrichment). Runs when EITHER: (a) the deterministic classifier
      // left genre fully unresolved, or (b) genre only resolved to the
      // generic category floor (electronic-other) and this run's
      // event-specific relevance is "weak" — a broad venue/platform tag
      // with no corroboration. Never runs when relevance is already
      // "strong"/"none" or genre is already a specific subgenre — nothing
      // for Discogs to usefully corroborate there. See
      // pipeline.ts::applyEnrichedGenre for exactly how each case is
      // applied (conservatively — Discogs can only strengthen a weak
      // verdict toward auto-publish, never weaken one, and a failed/
      // not-found/ambiguous lookup contributes nothing rather than being
      // used against the event — see genreEnrichment.ts). A Discogs
      // failure/timeout/rate-limit here is swallowed by enrichEventGenre's
      // own per-artist try/catch and simply leaves `result` exactly as the
      // deterministic classifier produced it.
      // Mirrors pipeline.ts's own relevanceText construction — see
      // RawCandidateEvent.relevanceText's doc comment for why this must
      // never fall back to raw.description alone.
      const relevanceText = `${raw.title} ${raw.relevanceText ?? raw.description ?? ""}`;
      // Never spend a Discogs lookup on a candidate the pipeline already
      // settled: "auto_publish" (including via a trusted-electronic
      // source's own relevance, which enrichment must never second-guess
      // back down) has nothing left to strengthen, and "negative_relevance"
      // is already a genuine evidence-based rejection (data-quality
      // Workstream, Billetto queue audit) — resurrecting it via enrichment
      // would waste a call on something already correctly discarded.
      const needsEnrichment =
        result.decision !== "auto_publish" &&
        result.holdReason !== "negative_relevance" &&
        (result.genre === null || (result.genre === GENERIC_ELECTRONIC_GENRE && result.relevance === "weak"));
      if (needsEnrichment) {
        const enrichment = await enrichEventGenre(raw.artists);
        if (enrichment.genre && enrichment.genreConfidence) {
          result = applyEnrichedGenre(
            result,
            enrichment.genre,
            enrichment.genreConfidence,
            relevanceText,
            raw.residentAdvisorUrl != null,
          );
        }
      }

      const linkedEventId = raw.officialEventUrl ? (linkedByUrl.get(raw.officialEventUrl) ?? null) : null;
      const match = findSyncMatch(linkedEventId, result.duplicateOfEventId, result.duplicateConfidence);
      const dedupKey = raw.officialEventUrl ?? raw.sourceUrl;

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
          canonicalSourceId: existing.canonicalSourceId,
          overriddenFields: existing.overriddenFields,
          soldOut: existing.soldOut,
          cancelled: existing.cancelled,
          postponed: existing.postponed,
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

        // Existing-published-event safety (data-quality Workstream A
        // follow-up — existing published events that now resolve to HOLD):
        // this run's fresh classification is the only thing computed from
        // this exact sync's actual fetch of this source, for this exact
        // candidate, after parsing/classification completed successfully
        // (a fetch failure or zero-events anomaly already returned above,
        // before this loop) — so decidePublishedEventSyncAction's
        // preconditions ("fresh candidate from its registered source",
        // "after successful classification") hold structurally here.
        const syncAction = decidePublishedEventSyncAction(
          { published: existing.published, manualOverride: existing.manualOverride },
          { decision: result.decision, holdReason: result.holdReason },
        );
        if (syncAction === "unpublish") {
          await applySyncHoldUnpublish(
            match.eventId,
            sourceId,
            "Automated sync: fresh classification is HOLD on negative-relevance evidence (data-quality Workstream A — existing-published-event safety net). Row preserved, not deleted; provenance untouched.",
          );
          unpublished++;
        }

        if (raw.officialEventUrl) {
          // A high-confidence-duplicate/moved-event match (findSyncMatch's
          // "high-confidence-duplicate" kind — including the moved-event
          // check in src/lib/adapters/pipeline.ts, Workstream C) can attach
          // an event whose STORED official link is a different URL than the
          // one this candidate carries (e.g. a first-party source
          // republished a moved show under a new URL). recordSourceLink is
          // insert-only (onConflictDoNothing on the (event, source, role)
          // key), so it would silently leave the stale URL in place once a
          // row already exists — the next sync would then fail to find this
          // event via linkedByUrl and redo the same match every cycle
          // instead of converging. Update the existing row's URL in place
          // when one already exists for this (event, source, role); only
          // insert when this source has genuinely never linked this event
          // before.
          const existingOfficialLink = links.find((l) => l.eventId === match.eventId && l.role === "official");
          if (existingOfficialLink) {
            if (existingOfficialLink.sourceUrl !== raw.officialEventUrl) {
              await updateSourceLinkUrl(match.eventId, sourceId, "official", raw.officialEventUrl);
            }
          } else {
            await recordSourceLink(match.eventId, sourceId, raw.officialEventUrl, "official");
          }
        }
        // A pending discovery_queue row for this exact candidate can outlive
        // the sync that first created its matching event — e.g. it was
        // orphaned by an auto_publish that predates the fix below, or (in
        // principle) any other path that created the event without going
        // through this loop. Any time a sync confirms the event for this
        // dedupKey already exists, a still-pending row for that same
        // dedupKey is stale by definition and must be resolved, not just at
        // the moment of creation — reusing the exact same resolution the
        // auto_publish branch below already performs.
        const matchedPendingRowId = findPendingRowToResolve(dedupKey, pendingByUrl);
        if (matchedPendingRowId) {
          await resolveDiscoveryItemAsPublished(matchedPendingRowId);
        }
        updated++;
        continue;
      }

      // A candidate the source already reports as cancelled must never be
      // auto-published as a brand-new event (event lifecycle/status
      // handling, 2026-08-28, Section 2) — cancelledHint plays no part in
      // `result.decision` above (genre/venue/date completeness alone decide
      // that, exactly as before), so this is a deliberate, explicit guard,
      // not a cancellation-driven bypass: it only ever routes a candidate
      // AWAY from auto-publish, never toward it. Falls through to the same
      // review_queue/hold handling below as any other non-auto-publish
      // candidate — never a cancellation-specific path. An EXISTING
      // canonical event this candidate matches (the `if (match)` branch
      // above) is unaffected and still correctly updates to cancelled via
      // buildSyncPatch.
      if (result.decision === "auto_publish" && result.resolvedVenueId && raw.startDatetime && raw.cancelledHint !== true) {
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
            // Must stay in lockstep with primaryGenre's own fallback —
            // displayGenres() (the only thing the public page renders) reads
            // subgenres, never primaryGenre directly, so an empty array here
            // for a genuinely-unresolved genre made the "Other" badge vanish
            // entirely instead of showing (QA audit, 2026-08-29).
            subgenres: result.genre ? [result.genre] : ["electronic-other"],
            genreConfidence: result.genreConfidence,
            officialEventUrl: raw.officialEventUrl,
            ticketUrl: raw.ticketUrl,
            facebookUrl: raw.facebookUrl,
            residentAdvisorUrl: raw.residentAdvisorUrl,
            imageUrl: raw.imageUrl,
            priceFrom: raw.priceFrom,
            currency: raw.priceFrom != null ? "DKK" : null,
            soldOut: raw.soldOutHint ?? false,
            cancelled: raw.cancelledHint ?? false,
            published: true,
            confidence: result.genreConfidence,
            canonicalSourceId: sourceId,
          },
          sourceId,
        );
        created++;

        // A candidate that already had a pending discovery_queue row from an
        // earlier, lower-confidence sync (see src/lib/sync.ts's
        // buildDiscoveryQueueClassificationPatch doc) must never be left
        // behind once this sync's evidence clears the auto-publish bar —
        // an admin reviewing the queue must never see a "needs review" row
        // for a night that's already live. Resolved the same way an
        // admin-initiated publish already does (status "published"), never
        // deleted (preserves the audit trail), and only ever the one row
        // keyed to this exact candidate's own dedupKey.
        const pendingRowId = findPendingRowToResolve(dedupKey, pendingByUrl);
        if (pendingRowId) {
          await resolveDiscoveryItemAsPublished(pendingRowId);
        }
        continue;
      }

      // review_queue or hold — but don't re-queue a duplicate row on every
      // sync cycle for a candidate that's already awaiting an admin decision.
      // Instead, let the classification-only patch (never identity/status)
      // refresh the existing row if this run's genre resolution improved on
      // what's stored — see buildDiscoveryQueueClassificationPatch.
      const existingPending = pendingByUrl.get(dedupKey);
      if (existingPending) {
        const classificationPatch = buildDiscoveryQueueClassificationPatch(
          {
            genre: result.genre,
            genreConfidence: result.genreConfidence,
            decision: result.decision,
            resolvedVenueId: result.resolvedVenueId,
            duplicateOfEventId: result.duplicateOfEventId,
            duplicateConfidence: result.duplicateConfidence,
            venueResolvedDecision: result.venueResolvedCounterfactual?.decision ?? null,
            venueResolvedHoldReason: result.venueResolvedCounterfactual?.holdReason ?? null,
          },
          {
            status: existingPending.status,
            predictedGenre: existingPending.predictedGenre as GenreSlug | null,
            genreConfidence: existingPending.genreConfidence as ConfidenceLevel,
            overriddenFields: existingPending.overriddenFields,
            overallConfidence: existingPending.overallConfidence as ConfidenceLevel,
            missingFields: existingPending.missingFields,
            suspectedDuplicateOfEventId: existingPending.suspectedDuplicateOfEventId,
            venueResolvedDecision: existingPending.venueResolvedDecision as PublishDecision | null,
            venueResolvedHoldReason: existingPending.venueResolvedHoldReason as HoldReason,
          },
        );
        // lastSeenAt is unconditional — this candidate's own sourceUrl was
        // matched in THIS sync's fetch, independent of whether its
        // classification also changed (unknown-venue visibility work
        // package, 2026-08-31). This is what lets a still-blocked candidate
        // be told apart from one the source has since stopped returning.
        await applyDiscoveryClassificationUpdate(existingPending.id, { ...classificationPatch, lastSeenAt: seenAt });
        continue;
      }

      // Billetto Discovery Queue noise (data-quality Workstream, 2026-08-24):
      // a genuine evidence-based rejection (see pipeline.ts's computeDecision
      // and HoldReason's own doc comment) for a candidate that has never been
      // queued before — never create a row for it at all. Deliberately only
      // reachable here, AFTER the existingPending check above: a row already
      // sitting in the queue from before this fix existed is left exactly as
      // it is (its classification may still refresh via the branch above,
      // but its status/existence is never touched) — this only changes
      // routing for brand-new candidates on the next sync, never a bulk
      // cleanup of history.
      if (result.decision === "hold" && result.holdReason === "negative_relevance") {
        continue;
      }

      const queueId = `dq-${randomUUID().slice(0, 8)}`;
      const inserted = await insertDiscoveryItem({
        id: queueId,
        probableTitle: raw.title || "(untitled)",
        probableStart: raw.startDatetime ? new Date(raw.startDatetime) : null,
        // Carried straight from the adapter's own extraction — real data
        // honestly found this run must never be silently dropped just
        // because the candidate landed in review instead of auto-publish
        // (admin/manual-event work package, 2026-08-24).
        probableEnd: raw.endDatetime ? new Date(raw.endDatetime) : null,
        probableTicketUrl: raw.ticketUrl,
        probableFree: raw.priceFrom === 0,
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
        lastSeenAt: seenAt,
        venueResolvedDecision: result.venueResolvedCounterfactual?.decision ?? null,
        venueResolvedHoldReason: result.venueResolvedCounterfactual?.holdReason ?? null,
      });
      newlyQueuedItems.push(inserted);
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

  // Fires only after every DB write above has finished — bounded-concurrency
  // batch, not per-candidate — and is wrapped defensively so an unexpected
  // failure here can never turn a successful sync into a failed one; the
  // notification layer's own internals already never throw (see
  // notifyDiscoveryQueueInsertBatch), this is belt-and-suspenders.
  try {
    await notifyDiscoveryQueueInsertBatch(newlyQueuedItems);
  } catch (err) {
    console.error(`[sync] "${sourceId}" discovery queue notification batch failed`, err instanceof Error ? err.message : err);
  }

  const writeSummary = summarizeWriteErrors(errors, candidates.length);
  if (writeSummary.outcome === "partial_failure") {
    console.error(`[sync] "${sourceId}" partial write failure: ${writeSummary.lastErrorMessage}`);
    await touchSourceSyncStats(sourceId, {
      success: true,
      eventsFound: candidates.length,
      eventsUpdated: updated,
      error: writeSummary.lastErrorMessage,
      complete: fetchComplete,
      completeSyncAt: seenAt,
    });
    return { sourceId, outcome: "partial_failure", candidatesFound: candidates.length, created, updated, queuedForReview, unpublished, errors };
  }

  await touchSourceSyncStats(sourceId, { success: true, eventsFound: candidates.length, eventsUpdated: updated, complete: fetchComplete, completeSyncAt: seenAt });
  return { sourceId, outcome: "ok", candidatesFound: candidates.length, created, updated, queuedForReview, unpublished, errors };
}
