import type { ConfidenceLevel, SourceType } from "./types";
import { SOURCE_TYPE_PRIORITY } from "./types";

/**
 * Genre evidence hierarchy (spec section 10). Classification never starts
 * from the event title alone — it walks this list in order and stops at the
 * first available evidence.
 */
export type GenreEvidenceSource =
  | "official-source-metadata"
  | "official-description"
  | "venue-promoter-metadata"
  | "artist-lineup-metadata"
  | "deterministic-mapping"
  | "ai-assisted"
  | "manual-review";

export const GENRE_EVIDENCE_ORDER: GenreEvidenceSource[] = [
  "official-source-metadata",
  "official-description",
  "venue-promoter-metadata",
  "artist-lineup-metadata",
  "deterministic-mapping",
  "ai-assisted",
  "manual-review",
];

export function genreConfidenceForEvidence(source: GenreEvidenceSource): ConfidenceLevel {
  switch (source) {
    case "official-source-metadata":
    case "official-description":
      return "high";
    case "venue-promoter-metadata":
    case "artist-lineup-metadata":
    case "deterministic-mapping":
      return "medium";
    case "ai-assisted":
    case "manual-review":
      return "low";
  }
}

/** Event quality gate (spec section 34): minimum bar before anything reaches the public site. */
export interface QualityGateInput {
  hasTitle: boolean;
  hasDate: boolean;
  hasVenue: boolean;
  hasSourceUrl: boolean;
  hasCredibleElectronicRelevance: boolean;
  genreConfidence: ConfidenceLevel;
}

export type PublishDecision = "auto_publish" | "review_queue" | "hold";

export function evaluateQualityGate(input: QualityGateInput): PublishDecision {
  const meetsMinimumFields = input.hasTitle && input.hasDate && input.hasVenue && input.hasSourceUrl;
  if (!meetsMinimumFields || !input.hasCredibleElectronicRelevance) return "hold";

  if (input.genreConfidence === "high") return "auto_publish";
  if (input.genreConfidence === "medium") return "review_queue";
  return "hold";
}

/**
 * Canonical source priority (spec section 32): resolves a field across
 * disagreeing sources by picking the highest-authority value. Ties keep the
 * first-seen value. Never silently prefers a lower-authority source.
 */
export interface FieldCandidate<T> {
  sourceType: SourceType;
  value: T;
}

export function resolveByCanonicalPriority<T>(candidates: FieldCandidate<T>[]): FieldCandidate<T> | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestRank = SOURCE_TYPE_PRIORITY.indexOf(best.sourceType);
  for (const candidate of candidates.slice(1)) {
    const rank = SOURCE_TYPE_PRIORITY.indexOf(candidate.sourceType);
    if (rank < bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}
