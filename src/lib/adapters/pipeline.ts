import type { ConfidenceLevel } from "../types";
import type { GenreSlug } from "../taxonomy";
import type { Venue } from "../types";
import { resolveVenue, dedupeArtistList } from "../normalize";
import { findBestDuplicateMatch, decideDuplicateAction, type DuplicateCandidate } from "../dedup";
import { evaluateQualityGate, genreConfidenceForEvidence, type PublishDecision } from "../classification";
import { deterministicGenreFromText } from "./deterministicGenreMapping";
import type { RawCandidateEvent } from "./types";

/**
 * The EXTRACTION -> VALIDATION -> NORMALIZATION -> DEDUPLICATION ->
 * GENRE CLASSIFICATION -> CONFIDENCE -> PUBLISH/REVIEW pipeline (spec
 * section 24), as pure, independently testable functions. Adapters only
 * produce RawCandidateEvent — everything else runs through here regardless
 * of source.
 */

export interface ExistingEventForDedup extends DuplicateCandidate {
  id: string;
}

export interface PipelineOptions {
  venues: Venue[];
  existingEvents: ExistingEventForDedup[];
}

export interface PipelineResult {
  decision: PublishDecision;
  missingFields: string[];
  resolvedVenueId: string | null;
  normalizedArtists: string[];
  genre: GenreSlug | null;
  genreConfidence: ConfidenceLevel;
  duplicateOfEventId: string | null;
  duplicateConfidence: "high" | "medium" | "low" | "none";
}

/** The CONFIDENCE / PUBLISH-REVIEW GATE step, factored out so it can be re-run
 *  by applyEnrichedGenre below without duplicating the duplicate-downgrade rule. */
function computeDecision(
  missingFields: string[],
  resolvedVenueId: string | null,
  genre: GenreSlug | null,
  genreConfidence: ConfidenceLevel,
  duplicateConfidence: "high" | "medium" | "low" | "none",
): PublishDecision {
  let decision = evaluateQualityGate({
    hasTitle: missingFields.every((f) => f !== "title"),
    hasDate: missingFields.every((f) => f !== "date"),
    hasVenue: resolvedVenueId != null,
    hasSourceUrl: missingFields.every((f) => f !== "source url"),
    hasCredibleElectronicRelevance: genre != null,
    genreConfidence,
  });

  // A likely duplicate always needs a human merge decision before publishing,
  // even if the record would otherwise clear the quality gate on its own.
  const duplicateAction = decideDuplicateAction(duplicateConfidence);
  if (duplicateAction === "auto_merge_if_safe" && decision === "auto_publish") {
    decision = "review_queue";
  } else if (duplicateAction === "review_queue" && decision === "auto_publish") {
    decision = "review_queue";
  }
  return decision;
}

export function runIngestionPipeline(raw: RawCandidateEvent, options: PipelineOptions): PipelineResult {
  // VALIDATION
  const missingFields: string[] = [];
  if (!raw.title?.trim()) missingFields.push("title");
  if (!raw.startDatetime) missingFields.push("date");
  if (!raw.venueName) missingFields.push("venue");
  if (!raw.officialEventUrl && !raw.ticketUrl && !raw.sourceUrl) missingFields.push("source url");

  // NORMALIZATION
  const resolvedVenue = raw.venueName ? resolveVenue(raw.venueName, options.venues) : undefined;
  if (raw.venueName && !resolvedVenue) missingFields.push("venue (unresolved against registry)");
  const normalizedArtists = dedupeArtistList(raw.artists);

  // GENRE CLASSIFICATION (evidence order: hint from source metadata/description first,
  // deterministic keyword mapping as fallback, otherwise unresolved).
  let genre: GenreSlug | null = raw.genreHint;
  let genreConfidence: ConfidenceLevel = raw.genreConfidenceHint ?? "low";
  if (!genre) {
    const fallback = deterministicGenreFromText(`${raw.title} ${raw.description ?? ""}`);
    if (fallback) {
      genre = fallback;
      genreConfidence = genreConfidenceForEvidence("deterministic-mapping");
    }
  }

  // DEDUPLICATION
  let duplicateOfEventId: string | null = null;
  let duplicateConfidence: "high" | "medium" | "low" | "none" = "none";
  if (raw.startDatetime) {
    const best = findBestDuplicateMatch(
      { title: raw.title, artists: normalizedArtists, venueId: resolvedVenue?.id ?? null, startDatetime: raw.startDatetime },
      options.existingEvents,
    );
    if (best) {
      duplicateOfEventId = best.match.id;
      duplicateConfidence = best.assessment.confidence;
    }
  }

  // CONFIDENCE / PUBLISH-REVIEW GATE
  const decision = computeDecision(missingFields, resolvedVenue?.id ?? null, genre, genreConfidence, duplicateConfidence);

  return {
    decision,
    missingFields,
    resolvedVenueId: resolvedVenue?.id ?? null,
    normalizedArtists,
    genre,
    genreConfidence,
    duplicateOfEventId,
    duplicateConfidence,
  };
}

/**
 * Applies genre enrichment evidence (e.g. Discogs — src/db/enrichment.ts) to
 * a PipelineResult whose deterministic classification left genre
 * unresolved, and recomputes the decision the same way the main pipeline
 * would have. Never overrides evidence the deterministic classifier already
 * found — enrichment only fills a genuine gap, it never second-guesses an
 * existing answer. Callers are responsible for never passing "high"
 * genreConfidence here (enrichment evidence is always at most medium, per
 * policy); this is enforced as an assertion, not silently downgraded, so a
 * violation is loud rather than silently miscategorized.
 */
export function applyEnrichedGenre(
  result: PipelineResult,
  genre: GenreSlug,
  genreConfidence: ConfidenceLevel,
): PipelineResult {
  if (result.genre != null) return result;
  if (genreConfidence === "high") {
    throw new Error("applyEnrichedGenre: enrichment evidence must never be 'high' confidence.");
  }
  const decision = computeDecision(result.missingFields, result.resolvedVenueId, genre, genreConfidence, result.duplicateConfidence);
  return { ...result, genre, genreConfidence, decision };
}
