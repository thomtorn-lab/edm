import type { ConfidenceLevel } from "../types";
import type { GenreSlug } from "../taxonomy";
import type { Venue } from "../types";
import { resolveVenue, dedupeArtistList } from "../normalize";
import { findBestDuplicateMatch, decideDuplicateAction, type DuplicateCandidate } from "../dedup";
import { findBestMovedEventMatch } from "../movedEventDetection";
import { evaluateQualityGate, genreConfidenceForEvidence, type PublishDecision } from "../classification";
import {
  assessRelevance,
  hasExplicitElectronicAssertion,
  hasExplicitNonElectronicIdentityAssertion,
  hasNonElectronicGenreSignal,
  hasNonMusicEventTypeSignal,
  GENERIC_ELECTRONIC_GENRE,
  type RelevanceLevel,
} from "../relevance";
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
  /** Source-level trusted-electronic flag (Admin/Discovery Queue quality
   *  work package, Section 6 — src/lib/data/sources.ts's
   *  `trustedElectronicSource`). Electronic RELEVANCE and exact GENRE
   *  classification confidence are deliberately different questions: a
   *  source scoped to an electronic-only venue (Hangaren, Culture Box) is
   *  itself strong relevance evidence, even on a night whose own text names
   *  no specific subgenre keyword — so genre confidence being medium/low (or
   *  genre being fully unresolved) must never alone hold/queue a candidate
   *  from a trusted-electronic source. Never set for a mixed-programme venue
   *  (ALICE, Poolen, Pumpehuset) or any aggregator (Billetto, RA) — see
   *  computeDecision below for exactly what still forces review/hold even
   *  here (missing fields, a genuine non-electronic text signal, a
   *  duplicate/canonical conflict). */
  trustedElectronicSource?: boolean;
}

/**
 * WHY a "hold" was reached (data-quality Workstream A follow-up —
 * existing-published-event safety). Only "negative_relevance" represents a
 * genuine evidence-based rejection (full data, high genre confidence, but
 * the event's own text/corroboration says this isn't really electronic) —
 * "incomplete_data" and "low_confidence" mean the pipeline simply didn't
 * have enough to go on this run (e.g. a per-event detail-page fetch failed
 * this cycle), which must never be treated as proof the event fails
 * inclusion. null when the decision isn't "hold" at all.
 */
export type HoldReason = "incomplete_data" | "low_confidence" | "negative_relevance" | null;

export interface PipelineResult {
  decision: PublishDecision;
  holdReason: HoldReason;
  missingFields: string[];
  resolvedVenueId: string | null;
  normalizedArtists: string[];
  genre: GenreSlug | null;
  genreConfidence: ConfidenceLevel;
  /** The multi-signal relevance verdict (see relevance.ts::assessRelevance)
   *  computed against whatever evidence was available this run — exposed so
   *  callers (sync.ts's weak-evidence enrichment trigger, the
   *  existing-published-event safety net) can act on it without
   *  reconstructing it from `decision` alone. */
  relevance: RelevanceLevel;
  duplicateOfEventId: string | null;
  duplicateConfidence: "high" | "medium" | "low" | "none";
}

/** The CONFIDENCE / PUBLISH-REVIEW GATE step, factored out so it can be re-run
 *  by applyEnrichedGenre below without duplicating the duplicate-downgrade rule.
 *  Takes an already-computed `relevance` verdict rather than recomputing it,
 *  so callers that only have a genre/confidence change to apply (no new
 *  relevance-text evidence) can pass the relevance they already have. */
function computeDecision(
  missingFields: string[],
  resolvedVenueId: string | null,
  genre: GenreSlug | null,
  genreConfidence: ConfidenceLevel,
  duplicateConfidence: "high" | "medium" | "low" | "none",
  relevance: RelevanceLevel,
  trustedElectronicSource: boolean,
  hasNonElectronicSignal: boolean,
): { decision: PublishDecision; holdReason: HoldReason } {
  const meetsMinimumFields =
    missingFields.every((f) => f !== "title") &&
    missingFields.every((f) => f !== "date") &&
    resolvedVenueId != null &&
    missingFields.every((f) => f !== "source url");
  // A trusted-electronic source (Section 6) IS itself relevance evidence —
  // no genre keyword needs to have matched at all.
  const hasCredibleElectronicRelevance = genre != null || trustedElectronicSource;

  let decision = evaluateQualityGate({
    hasTitle: missingFields.every((f) => f !== "title"),
    hasDate: missingFields.every((f) => f !== "date"),
    hasVenue: resolvedVenueId != null,
    hasSourceUrl: missingFields.every((f) => f !== "source url"),
    hasCredibleElectronicRelevance,
    genreConfidence,
  });
  let holdReason: HoldReason = null;

  if (genre == null && !trustedElectronicSource && hasNonElectronicSignal) {
    // Billetto Discovery Queue noise (data-quality Workstream, 2026-08-24):
    // no genre keyword matched AT ALL (never true for a candidate that
    // already has real positive genre evidence, so this can never discard a
    // genuinely electronic event — see relevance.ts's new signal list), and
    // the candidate's own title/description carries a strong, specific,
    // non-electronic EVENT-TYPE or genre signal (a speed-dating night, a
    // chamber-music concert, a flea market — real Production examples).
    // Genuine "genuine evidence-based rejection" (see HoldReason's own doc
    // comment) even though venue/other fields may ALSO be unresolved —
    // fixing those later would never make this event worth a human's
    // review, so it must never reach the queue at all (see db/sync.ts's
    // skip-on-negative_relevance branch for a brand-new candidate).
    holdReason = "negative_relevance";
    decision = "hold";
  } else if (!meetsMinimumFields || !hasCredibleElectronicRelevance) {
    // The gate returned "hold" purely because required fields or any genre
    // at all are missing this run — a data/parser gap, never itself
    // evidence that the event fails inclusion.
    holdReason = "incomplete_data";
  } else if (trustedElectronicSource) {
    // Source-level electronic relevance is trusted (Section 6): exact genre
    // classification confidence is never itself a reason to hold/review a
    // complete, valid candidate from Hangaren/Culture Box. Still holds on a
    // genuine non-electronic text signal (safety net) and still goes through
    // the ordinary duplicate-conflict downgrade below.
    if (hasNonElectronicSignal) {
      decision = "hold";
      holdReason = "negative_relevance";
    } else {
      decision = "auto_publish";
    }
  } else if (decision === "auto_publish") {
    // Source-aware relevance evidence (data-quality Workstream A): a broad
    // venue/platform category tag or a generic mention is real evidence the
    // SOURCE considers the night electronic, but it is never on its own
    // conclusive evidence that electronic music is CENTRAL to THIS event.
    // Scores independent signals (specific genre, an explicit first-party
    // "this artist's sound is electronic" assertion, trusted RA/ticket
    // corroboration, independent artist-genre corroboration) rather than a
    // single blunt genre-floor cap — see relevance.ts's header comment for
    // the full design. Applied only when the gate would otherwise
    // auto-publish (full data, high genre confidence already established).
    if (relevance === "weak") {
      decision = "review_queue";
    } else if (relevance === "none") {
      decision = "hold";
      holdReason = "negative_relevance";
    }
  } else if (decision === "hold") {
    // meetsMinimumFields && hasCredibleElectronicRelevance both true, so
    // this is genreConfidence being neither "high" nor "medium" — a
    // confidence gap, not a relevance judgment.
    holdReason = "low_confidence";
  }

  // A likely duplicate always needs a human merge decision before publishing,
  // even if the record would otherwise clear the quality gate on its own.
  const duplicateAction = decideDuplicateAction(duplicateConfidence);
  if (duplicateAction === "auto_merge_if_safe" && decision === "auto_publish") {
    decision = "review_queue";
  } else if (duplicateAction === "review_queue" && decision === "auto_publish") {
    decision = "review_queue";
  }
  return { decision, holdReason };
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
  const hasTrustedElectronicTicketing = raw.residentAdvisorUrl != null;
  const nonElectronicSignal =
    hasNonElectronicGenreSignal(relevanceText, normalizedArtists) || hasNonMusicEventTypeSignal(relevanceText, normalizedArtists);
  const relevance = assessRelevance({
    genre,
    hasExplicitElectronicAssertion: hasExplicitElectronicAssertion(relevanceText),
    hasTrustedElectronicTicketing,
    hasNonElectronicGenreSignal: nonElectronicSignal,
    hasExplicitNonElectronicIdentityAssertion: hasExplicitNonElectronicIdentityAssertion(relevanceText, normalizedArtists),
    hasCorroboratingArtistGenreEvidence: false, // no enrichment has run yet at this stage — see applyEnrichedGenre
  });
  const { decision, holdReason } = computeDecision(
    missingFields,
    resolvedVenue?.id ?? null,
    genre,
    genreConfidence,
    duplicateConfidence,
    relevance,
    options.trustedElectronicSource ?? false,
    nonElectronicSignal,
  );

  return {
    decision,
    holdReason,
    missingFields,
    resolvedVenueId: resolvedVenue?.id ?? null,
    normalizedArtists,
    genre,
    genreConfidence,
    relevance,
    duplicateOfEventId,
    duplicateConfidence,
  };
}

/**
 * Applies genre enrichment evidence (e.g. Discogs — src/db/enrichment.ts) to
 * a PipelineResult, in one of two conservative modes (follow-up review —
 * weak-evidence enrichment). Callers are responsible for never passing
 * "high" genreConfidence here (enrichment evidence is always at most
 * medium, per policy); this is enforced as an assertion, not silently
 * downgraded, so a violation is loud rather than silently miscategorized.
 *
 * CASE A — genre was fully unresolved (`result.genre === null`): enrichment
 * supplies the only genre evidence available. Unchanged from before this
 * follow-up review: genreConfidence is capped below "high", so the quality
 * gate can never return "auto_publish" here — at most "review_queue" — so
 * the relevance check inside computeDecision is structurally unreachable;
 * "none" is passed as a placeholder relevance value, never consulted.
 *
 * CASE B — genre already resolved to the generic category floor
 * (electronic-other) and this run's relevance verdict was "weak" (a broad
 * venue/platform tag with no event-specific corroboration): Discogs
 * enrichment is used to CORROBORATE relevance rather than replace anything.
 * enrichEventGenre (src/lib/enrichment/genreEnrichment.ts) is already
 * conservative by construction — requires unanimous per-artist agreement,
 * withholds a genre on an ambiguous/conflicting lineup, and a failed/
 * not-found lookup contributes nothing rather than counting against the
 * event — so this call site only needs to decide HOW to apply a genuine
 * result:
 *   - a SPECIFIC subgenre (e.g. "house") becomes the event's own genre,
 *     confidence unchanged from the event's own already-established floor
 *     (Discogs is corroborating relevance, not being asked to establish
 *     genre confidence on its own the way CASE A needs it to) — the exact
 *     same evidence shape as a first-party specific-genre keyword match, so
 *     it naturally counts as a strong signal on recompute.
 *   - a generic-but-CONFIRMED-electronic result (Discogs' own "Electronic"
 *     genre tag matched, but no specific style) leaves `genre` as
 *     electronic-other and instead sets
 *     hasCorroboratingArtistGenreEvidence, an independent strong signal in
 *     its own right — a second, different source confirming the lineup is
 *     genuinely electronic, distinct from the venue's own broad tag.
 * Either way, this can only ever strengthen a weak verdict toward "strong"
 * (auto-publish) or leave it exactly as weak (review) — it can never turn a
 * weak verdict into "none"/hold, and a candidate already carrying a real
 * negative signal is unaffected (see assessRelevance).
 *
 * Any other combination (a genre already resolved at high confidence with
 * adequate relevance, or genre resolved to a specific subgenre already) is
 * returned unchanged — enrichment never second-guesses an existing answer.
 */
export function applyEnrichedGenre(
  result: PipelineResult,
  genre: GenreSlug,
  genreConfidence: ConfidenceLevel,
  relevanceText: string,
  hasTrustedElectronicTicketing: boolean,
): PipelineResult {
  if (genreConfidence === "high") {
    throw new Error("applyEnrichedGenre: enrichment evidence must never be 'high' confidence.");
  }

  if (result.genre === null) {
    const { decision, holdReason } = computeDecision(
      result.missingFields,
      result.resolvedVenueId,
      genre,
      genreConfidence,
      result.duplicateConfidence,
      "none",
      false, // unreachable for a trusted-electronic source — see db/sync.ts's needsEnrichment guard
      hasNonElectronicGenreSignal(relevanceText, result.normalizedArtists) ||
        hasNonMusicEventTypeSignal(relevanceText, result.normalizedArtists),
    );
    return { ...result, genre, genreConfidence, decision, holdReason };
  }

  if (result.genre === GENERIC_ELECTRONIC_GENRE && result.relevance === "weak") {
    const isSpecificSubgenre = genre !== GENERIC_ELECTRONIC_GENRE;
    const finalGenre = isSpecificSubgenre ? genre : result.genre;
    // Confidence stays tied to the event's own already-established floor
    // (the venue's own high-confidence category tag) in EITHER sub-case —
    // Discogs corroborates RELEVANCE here, it is never asked to carry
    // genre-confidence on its own the way it is in CASE A (there, Discogs
    // is the ONLY evidence for genre at all, hence capped at medium; here,
    // the high-confidence floor already exists independently of Discogs).
    const finalGenreConfidence = result.genreConfidence;
    const nonElectronicSignal =
      hasNonElectronicGenreSignal(relevanceText, result.normalizedArtists) ||
      hasNonMusicEventTypeSignal(relevanceText, result.normalizedArtists);
    const relevance = assessRelevance({
      genre: finalGenre,
      hasExplicitElectronicAssertion: hasExplicitElectronicAssertion(relevanceText),
      hasTrustedElectronicTicketing,
      hasNonElectronicGenreSignal: nonElectronicSignal,
      hasExplicitNonElectronicIdentityAssertion: hasExplicitNonElectronicIdentityAssertion(relevanceText, result.normalizedArtists),
      hasCorroboratingArtistGenreEvidence: !isSpecificSubgenre,
    });
    const { decision, holdReason } = computeDecision(
      result.missingFields,
      result.resolvedVenueId,
      finalGenre,
      finalGenreConfidence,
      result.duplicateConfidence,
      relevance,
      false, // unreachable for a trusted-electronic source — see db/sync.ts's needsEnrichment guard
      nonElectronicSignal,
    );
    return { ...result, genre: finalGenre, genreConfidence: finalGenreConfidence, decision, holdReason, relevance };
  }

  return result;
}
