import type { ConfidenceLevel } from "../types";
import type { GenreSlug } from "../taxonomy";
import type { Venue } from "../types";
import { resolveVenue, dedupeArtistList } from "../normalize";
import { findBestDuplicateMatch, decideDuplicateAction, type DuplicateCandidate } from "../dedup";
import { findBestMovedEventMatch } from "../movedEventDetection";
import { evaluateQualityGate, genreConfidenceForEvidence, type PublishDecision } from "../classification";
import { hasNonElectronicGenreSignal, GENERIC_ELECTRONIC_GENRE } from "../relevance";
import { deterministicGenreFromText, refineGenreFromText } from "./deterministicGenreMapping";
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
  relevanceText: string,
): PublishDecision {
  let decision = evaluateQualityGate({
    hasTitle: missingFields.every((f) => f !== "title"),
    hasDate: missingFields.every((f) => f !== "date"),
    hasVenue: resolvedVenueId != null,
    hasSourceUrl: missingFields.every((f) => f !== "source url"),
    hasCredibleElectronicRelevance: genre != null,
    genreConfidence,
  });

  // Source-aware relevance evidence (data-quality Workstream A): a broad
  // venue/platform category tag or a generic mention is real evidence the
  // SOURCE considers the night electronic, but it is never on its own
  // conclusive evidence that electronic music is CENTRAL to THIS event —
  // that must never auto-publish, no matter how "high" the claimed genre
  // confidence is (the exact gap that let Pumpehuset's blanket "Elektronisk"
  // tag alone auto-publish Dizzee Rascal/grime and MASTER BOOT RECORD+Fulci/
  // metal). Two conservative, source-agnostic downgrades, applied only when
  // the gate would otherwise auto-publish:
  if (decision === "auto_publish") {
    if (genre === GENERIC_ELECTRONIC_GENRE) {
      // The generic "electronic-other" floor exists precisely because no
      // specific subgenre evidence was found — by construction, that is
      // broad/generic evidence, never strong enough alone to auto-publish.
      decision = "review_queue";
    } else if (genre && hasNonElectronicGenreSignal(relevanceText)) {
      // A specific electronic keyword WAS matched, but the same official
      // text also centers on a recognized non-electronic genre (e.g.
      // "industrial" matched inside "industrial metal") — an isolated
      // electronic-sounding word in otherwise non-electronic copy must
      // never carry a high-confidence auto-publish on its own.
      decision = "review_queue";
    }
  }

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

  const relevanceText = `${raw.title} ${raw.description ?? ""}`;

  // GENRE CLASSIFICATION (evidence order: hint from source metadata/description first,
  // deterministic keyword mapping as fallback, otherwise unresolved).
  let genre: GenreSlug | null = raw.genreHint;
  let genreConfidence: ConfidenceLevel = raw.genreConfidenceHint ?? "low";
  if (!genre) {
    const fallback = deterministicGenreFromText(relevanceText);
    if (fallback) {
      genre = fallback;
      genreConfidence = genreConfidenceForEvidence("deterministic-mapping");
    }
  }
  // GENRE REFINEMENT (Workstream B): an official categorical source (e.g. a
  // ticketing platform's broad "trance" subcategory) is family-level
  // evidence; the event's own first-party text can sharpen it to a more
  // specific sibling (e.g. "psytrance") without changing the evidence tier.
  if (genre) {
    genre = refineGenreFromText(genre, relevanceText);
  }

  // DEDUPLICATION
  let duplicateOfEventId: string | null = null;
  let duplicateConfidence: "high" | "medium" | "low" | "none" = "none";
  if (raw.startDatetime) {
    const best = findBestDuplicateMatch(
      {
        title: raw.title,
        artists: normalizedArtists,
        venueId: resolvedVenue?.id ?? null,
        startDatetime: raw.startDatetime,
        sourceId: raw.sourceId,
        officialEventUrl: raw.officialEventUrl,
        ticketUrl: raw.ticketUrl,
        residentAdvisorUrl: raw.residentAdvisorUrl,
      },
      options.existingEvents,
    );
    if (best) {
      duplicateOfEventId = best.match.id;
      duplicateConfidence = best.assessment.confidence;
    } else if (raw.sourceId) {
      // MOVED/RESCHEDULED EVENT CHECK (Workstream C): normal dedup found
      // nothing — most commonly because the date genuinely differs, which
      // is an absolute veto there by design. Scoped to the SAME source only
      // (see movedEventDetection.ts's header comment for why), and gated on
      // strong corroborating evidence, never title/artist match alone.
      const sameSourceExisting = options.existingEvents.filter((e) => e.sourceId === raw.sourceId);
      const moved = findBestMovedEventMatch(
        {
          title: raw.title,
          artists: normalizedArtists,
          venueId: resolvedVenue?.id ?? null,
          startDatetime: raw.startDatetime,
          description: raw.description,
          officialEventUrl: raw.officialEventUrl,
          ticketUrl: raw.ticketUrl,
          residentAdvisorUrl: raw.residentAdvisorUrl,
        },
        sameSourceExisting,
      );
      if (moved) {
        duplicateOfEventId = moved.match.id;
        // "high" moved-event confidence reuses the exact same auto-attach
        // path a high-confidence duplicate already gets (src/lib/sync.ts's
        // findSyncMatch) — the candidate is treated as an update to the
        // existing event (new date/URL applied in place via buildSyncPatch)
        // rather than a second, stale-alongside-the-replacement canonical.
        // "medium" does not auto-attach; it only surfaces the suspected
        // match for admin review via the discovery queue.
        duplicateConfidence = moved.assessment.confidence === "high" ? "high" : "medium";
      }
    }
  }

  // CONFIDENCE / PUBLISH-REVIEW GATE
  const decision = computeDecision(missingFields, resolvedVenue?.id ?? null, genre, genreConfidence, duplicateConfidence, relevanceText);

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
  // Enrichment evidence is capped below "high" (enforced above), so the
  // quality gate can never return "auto_publish" here — the relevance-based
  // downgrades in computeDecision only ever act on an "auto_publish"
  // decision, so no relevance text is needed at this call site.
  const decision = computeDecision(result.missingFields, result.resolvedVenueId, genre, genreConfidence, result.duplicateConfidence, "");
  return { ...result, genre, genreConfidence, decision };
}
