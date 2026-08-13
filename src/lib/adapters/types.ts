import type { ConfidenceLevel } from "../types";
import type { GenreSlug } from "../taxonomy";

/**
 * Common output shape every source adapter must produce (spec section 58).
 * The rest of the app — validation, normalization, dedup, classification,
 * the quality gate — only ever deals with this shape, never source-specific
 * parsing. Swapping or removing one adapter cannot break another.
 */
export interface RawCandidateEvent {
  sourceId: string;
  sourceUrl: string;
  title: string;
  description: string | null;
  artists: string[];
  startDatetime: string | null;
  endDatetime: string | null;
  venueName: string | null;
  officialEventUrl: string | null;
  ticketUrl: string | null;
  facebookUrl: string | null;
  residentAdvisorUrl: string | null;
  imageUrl: string | null;
  priceFrom: number | null;
  genreHint: GenreSlug | null;
  genreConfidenceHint: ConfidenceLevel | null;
}

export interface SourceAdapter {
  sourceId: string;
  /** Fetches raw candidate events for this source. Never throws on a single bad record — skips it and continues. */
  fetchCandidates(): Promise<RawCandidateEvent[]>;
}
