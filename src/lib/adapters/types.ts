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
  /**
   * Event-specific editorial context, or null when the source gives none
   * worth storing. Rendered verbatim in the event-detail page's About
   * section (never on the listing) — see src/lib/eventPresentation.ts and
   * each adapter's own extraction code for the actual cleanup, but every
   * new source's description extraction should clear this checklist before
   * being trusted (editorial-description quality model, kept intentionally
   * small — not a scoring system):
   *   1. Adds something beyond title/date/venue/genre/ticket link/artists —
   *      don't manufacture prose when the source has nothing more to say.
   *   2. Event-specific, not a generic/encyclopedic artist bio or venue-wide
   *      marketing copy repeated on every listing.
   *   3. Current — no stale availability/date wording the UI already states
   *      canonically elsewhere.
   *   4. Free of scraper artifacts: no raw URLs, "read more", nav/footer/
   *      cookie fragments, or truncation landing mid-word/mid-sentence.
   *   5. Preserves any room/lineup structure the source encodes (never
   *      collapsed into prose — see cultureBoxAdapter.ts).
   *   6. Every factual claim traces to the source's own text — never
   *      invented, never generated at runtime.
   *   7. Concise — summarized/paraphrased, not reproduced wholesale from a
   *      long copyrighted source write-up.
   */
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
  /**
   * Explicit sold-out/cancelled signal from the source's OWN structured data
   * (event lifecycle/status handling, 2026-08-28) — null means the source
   * provides no reliable signal at all, never a guess/inference from prose
   * or from disappearance. A non-null value can go either direction (a
   * previous true can flip back to false), so a source correctly reversing
   * itself — tickets back on sale, a cancellation retracted — is honored.
   * See each adapter's own doc comment for exactly what it supports; most
   * adapters set both to null.
   */
  soldOutHint: boolean | null;
  cancelledHint: boolean | null;
}

export interface SourceAdapter {
  sourceId: string;
  /** Fetches raw candidate events for this source. Never throws on a single bad record — skips it and continues. */
  fetchCandidates(): Promise<RawCandidateEvent[]>;
}
