import type { RawCandidateEvent } from "./adapters/types";
import type { ConfidenceLevel } from "./types";
import type { GenreSlug } from "./taxonomy";
import { getCopenhagenParts } from "./datetime";
import type { DuplicateConfidence } from "./dedup";

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
