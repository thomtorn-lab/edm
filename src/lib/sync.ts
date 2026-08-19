import type { RawCandidateEvent } from "./adapters/types";
import type { ConfidenceLevel } from "./types";
import type { GenreSlug } from "./taxonomy";
import { getCopenhagenParts } from "./datetime";
import type { DuplicateConfidence } from "./dedup";
import type { PublishDecision } from "./classification";

/**
 * Sync-time merge decisions (spec section 46 / user directive step 3, task
 * 5/6). Kept pure and DB-free like the rest of src/lib — src/db/sync.ts is
 * the orchestrator that actually reads/writes Postgres and calls into this.
 */

export interface SyncTargetEvent {
  id: string;
  title: string;
  description: string | null;
  artists: string[];
  venueId: string | null;
  startDatetime: string;
  endDatetime: string | null;
  officialEventUrl: string | null;
  ticketUrl: string | null;
  facebookUrl: string | null;
  residentAdvisorUrl: string | null;
  imageUrl: string | null;
  primaryGenre: GenreSlug | null;
  overriddenFields: string[];
}

export interface ResolvedCandidate {
  resolvedVenueId: string | null;
  normalizedArtists: string[];
  genre: GenreSlug | null;
  genreConfidence: ConfidenceLevel;
}

export interface SyncPatchResult {
  patch: Record<string, unknown>;
  dateChanged: boolean;
  timeChanged: boolean;
}

function sameArtists(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Builds the sync-proposed patch for an already-known event — only fields
 * whose value actually differs from what's currently stored, so a routine
 * re-sync that finds nothing new doesn't touch updatedAt/the audit log.
 * Field-level override protection is enforced downstream
 * (src/lib/override.ts via src/db/writes.ts::applySourceSyncPatch); this
 * only decides what the source currently says each field should be.
 */
export function buildSyncPatch(
  raw: RawCandidateEvent,
  resolved: ResolvedCandidate,
  existing: SyncTargetEvent,
): SyncPatchResult {
  const patch: Record<string, unknown> = {};

  if (raw.title.trim() && raw.title !== existing.title) patch.title = raw.title;
  if (raw.description && raw.description !== existing.description) patch.description = raw.description;
  if (resolved.normalizedArtists.length > 0 && !sameArtists(resolved.normalizedArtists, existing.artists)) {
    patch.artists = resolved.normalizedArtists;
  }
  if (resolved.resolvedVenueId && resolved.resolvedVenueId !== existing.venueId) {
    patch.venueId = resolved.resolvedVenueId;
  }
  if (raw.officialEventUrl && raw.officialEventUrl !== existing.officialEventUrl) {
    patch.officialEventUrl = raw.officialEventUrl;
  }
  if (raw.ticketUrl && raw.ticketUrl !== existing.ticketUrl) patch.ticketUrl = raw.ticketUrl;
  if (raw.facebookUrl && raw.facebookUrl !== existing.facebookUrl) patch.facebookUrl = raw.facebookUrl;
  if (raw.residentAdvisorUrl && raw.residentAdvisorUrl !== existing.residentAdvisorUrl) {
    patch.residentAdvisorUrl = raw.residentAdvisorUrl;
  }
  if (raw.imageUrl && raw.imageUrl !== existing.imageUrl) patch.imageUrl = raw.imageUrl;
  if (resolved.genre && resolved.genre !== existing.primaryGenre) {
    patch.primaryGenre = resolved.genre;
    patch.subgenres = [resolved.genre];
  }

  let dateChanged = false;
  let timeChanged = false;
  if (raw.startDatetime) {
    const newIso = new Date(raw.startDatetime).toISOString();
    const oldIso = new Date(existing.startDatetime).toISOString();
    if (newIso !== oldIso) {
      patch.startDatetime = new Date(raw.startDatetime);
      const newParts = getCopenhagenParts(new Date(newIso));
      const oldParts = getCopenhagenParts(new Date(oldIso));
      const sameDate =
        newParts.year === oldParts.year && newParts.month === oldParts.month && newParts.day === oldParts.day;
      if (!sameDate) dateChanged = true;
      else if (newParts.hour !== oldParts.hour || newParts.minute !== oldParts.minute) timeChanged = true;
    }
  }
  if (raw.endDatetime) {
    const newEndIso = new Date(raw.endDatetime).toISOString();
    const oldEndIso = existing.endDatetime ? new Date(existing.endDatetime).toISOString() : null;
    if (newEndIso !== oldEndIso) patch.endDatetime = new Date(raw.endDatetime);
  }
  if (dateChanged) patch.dateChanged = true;
  if (timeChanged) patch.timeChanged = true;

  return { patch, dateChanged, timeChanged };
}

export type SyncMatchKind = "linked" | "high-confidence-duplicate";

export interface SyncMatch {
  kind: SyncMatchKind;
  eventId: string;
}

/**
 * Decides which existing event (if any) a candidate corresponds to. A
 * direct provenance match — this exact source+URL has been synced to this
 * event before — always wins. A fuzzy high-confidence duplicate match is
 * the fallback for the first sync ever, or if the source changed its own
 * URL for an event we already track (e.g. manually created earlier).
 * Medium/low-confidence matches are deliberately NOT auto-attached — they
 * fall through to the normal review queue instead, since a first-party sync
 * silently attaching to the wrong event would be worse than a few minutes
 * of admin review (see the brief's "few minutes of exception handling").
 */
export function findSyncMatch(
  linkedEventId: string | null,
  duplicateOfEventId: string | null,
  duplicateConfidence: DuplicateConfidence,
): SyncMatch | null {
  if (linkedEventId) return { kind: "linked", eventId: linkedEventId };
  if (duplicateOfEventId && duplicateConfidence === "high") {
    return { kind: "high-confidence-duplicate", eventId: duplicateOfEventId };
  }
  return null;
}

/**
 * Decides which pending discovery_queue row (if any) must be resolved as
 * "published" once a sync has confirmed this exact candidate's event
 * already exists — whether that event was just created this run
 * (auto_publish) or already existed and was matched-and-updated this run.
 * Both call sites in src/db/sync.ts share this because a pending row can
 * outlive the sync that first creates its event in either shape: a
 * candidate can reach auto_publish on a LATER sync than the one that first
 * queued it at medium/low confidence (e.g. Culture Box's own detail-page
 * evidence arriving after an earlier sync only had the listing page to go
 * on), and a row already orphaned that way keeps matching via the existing
 * sourceEventLinks/dedup path on every subsequent sync rather than ever
 * routing through auto_publish again. Left unresolved either way, that
 * pending row would sit in the review queue forever, showing "needs
 * review" for a night that's already live. Kept as its own pure function
 * (mirrors findSyncMatch's shape) purely so this exact decision — which
 * row, if any, keyed by exactly this candidate's own dedupKey — is
 * independently testable without touching Postgres; the actual write
 * (src/db/writes.ts::resolveDiscoveryItemAsPublished) is separate I/O the
 * caller performs only when this returns non-null.
 */
export function findPendingRowToResolve(
  dedupKey: string,
  pendingByUrl: Map<string, { id: string }>,
): string | null {
  return pendingByUrl.get(dedupKey)?.id ?? null;
}

export interface DiscoveryQueueTarget {
  /** Only ever proposes a patch for "pending" — a resolved item (published/ignored/merged) is frozen. */
  status: string;
  predictedGenre: GenreSlug | null;
  overriddenFields: string[];
  /** Currently stored overall_confidence, so a refreshed classification can
   *  detect staleness (see buildDiscoveryQueueClassificationPatch) instead of
   *  assuming it's already correct. */
  overallConfidence: ConfidenceLevel;
}

export interface DiscoveryQueueClassification {
  genre: GenreSlug | null;
  genreConfidence: ConfidenceLevel;
  /**
   * The full pipeline's decision for this fresh classification. At the one
   * call site (src/db/sync.ts's existingPending branch) this is always
   * "review_queue" or "hold" — an "auto_publish" candidate is handled by a
   * different branch entirely and never reaches this function. Used only to
   * keep overallConfidence in sync with genreConfidence below; never widens
   * what this function is allowed to change (see the function's own doc).
   */
  decision: PublishDecision;
}

export interface DiscoveryQueueClassificationPatch {
  predictedGenre?: GenreSlug;
  genreConfidence?: ConfidenceLevel;
  overallConfidence?: ConfidenceLevel;
}

/**
 * Builds the classification-only patch for an already-pending discovery_queue
 * item when a later sync's genre resolution differs from what's currently
 * stored (e.g. a deterministic keyword fix or Discogs enrichment now resolves
 * a lineup that previously didn't). Deliberately narrow: this is the ONLY
 * thing a re-sync may ever update on an existing item — identity
 * (title/lineup/venue/date), status, and review state are untouched here, so
 * a later sync can improve a suggestion without ever silently publishing or
 * renaming anything. A missing/unresolved fresh genre never clears a
 * previously-resolved one (no flicker from a transient lookup failure), a
 * non-pending item is never touched, and an admin's own correction (tracked
 * in overriddenFields by updateDiscoveryItem) is never clobbered.
 *
 * Bug fix (Culture Box publishing diagnosis, Phase 2 Part A): overallConfidence
 * used to only ever be set once, at insert time (src/db/sync.ts's
 * insertDiscoveryItem call) — a candidate first queued with no genre evidence
 * ("low") that later resolved to a medium-confidence genre via Discogs
 * enrichment kept showing "low" overall confidence forever, even once its own
 * genreConfidence field correctly said "medium" (confirmed against 6 live
 * Culture Box rows). overallConfidence is now recomputed alongside the genre
 * patch using the exact same rule the original insert used (decision
 * "review_queue" -> "medium", "hold" -> "low"), and only included when it
 * actually differs from what's stored — the same idempotency guarantee every
 * other field here already has. Does not touch the auto-publish threshold,
 * the genre evidence hierarchy, or dedup, and — since "auto_publish" never
 * reaches this function — can never move a candidate to auto_publish.
 *
 * overallConfidence is checked independently of whether predictedGenre
 * itself changed (second bug fix, same diagnosis): a row whose genre was
 * already correct from an earlier sync — including one resolved before the
 * first overallConfidence-recompute fix shipped — but whose
 * overallConfidence was never itself recomputed must still self-heal on a
 * plain re-sync, not only when the genre value also happens to move on that
 * same run. Both checks share the same top guards (non-pending, admin
 * override, and — critically — a transient lookup failure this run,
 * `!fresh.genre`, which must freeze the ENTIRE row, overallConfidence
 * included, exactly as before: a blip must never make an already-correct
 * row look stale).
 */
export function buildDiscoveryQueueClassificationPatch(
  fresh: DiscoveryQueueClassification,
  existing: DiscoveryQueueTarget,
): DiscoveryQueueClassificationPatch {
  if (existing.status !== "pending") return {};
  if (existing.overriddenFields.includes("predictedGenre")) return {};
  if (!fresh.genre) return {};

  const patch: DiscoveryQueueClassificationPatch = {};
  if (fresh.genre !== existing.predictedGenre) {
    patch.predictedGenre = fresh.genre;
    patch.genreConfidence = fresh.genreConfidence;
  }

  const freshOverallConfidence: ConfidenceLevel = fresh.decision === "review_queue" ? "medium" : "low";
  if (freshOverallConfidence !== existing.overallConfidence) {
    patch.overallConfidence = freshOverallConfidence;
  }

  return patch;
}

export interface WriteFailureSummary {
  outcome: "ok" | "partial_failure";
  lastErrorMessage: string | null;
}

/**
 * Source-health monitoring (task: automated source-health monitoring):
 * per-candidate matching/write failures inside runSourceSyncLocked's loop
 * were previously only returned in the HTTP response body — the overall
 * summary still reported outcome "ok" and touchSourceSyncStats cleared
 * lastError to null, so a DB write failure was invisible to anything that
 * doesn't inspect that one response (a scheduled GitHub Actions run, the
 * admin source-health panel, this task's health monitor). Any per-candidate
 * error now degrades the whole run to "partial_failure" so it surfaces the
 * same way a fetch failure does — never silently swallowed.
 */
export function summarizeWriteErrors(errors: string[], candidatesFound: number): WriteFailureSummary {
  if (errors.length === 0) return { outcome: "ok", lastErrorMessage: null };
  return {
    outcome: "partial_failure",
    lastErrorMessage: `${errors.length}/${candidatesFound} candidate(s) failed during matching/write: ${errors.join("; ")}`,
  };
}
