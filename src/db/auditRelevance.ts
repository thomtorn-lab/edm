/**
 * Read-only relevance recheck for the events-window audit (editorial
 * screening, 2026-10-17).
 *
 * `genre_confidence` is NOT a measure of electronic relevance: it records how
 * strong the genre evidence was at ingestion and gates publishing, and it is
 * not updated by admin genre edits. This module instead recomputes the
 * pipeline's own multi-signal verdict (relevance.ts::assessRelevance) for a
 * stored, published event under the CURRENT rules, and says why.
 *
 * It is a current recomputation, never the historical publish decision: the
 * source data, the rules and the Discogs cache may all have changed since the
 * event was published. It changes nothing: no genre, relevance or publish
 * status is written anywhere.
 *
 * Inputs, deliberately:
 *   - the event's FULL stored description, not the audit's shortened one;
 *   - no stored genre: genreHint is null, so a stored (possibly wrong) genre
 *     is never its own relevance evidence. A specific genre only counts when
 *     the event's own text yields it again under today's rules;
 *   - existing Discogs data only: artist_genre_cache rows read in the audit's
 *     read-only transaction. Nothing is ever looked up or written, and
 *     expired rows are used as they are;
 *   - the stored RA link (hasTrustedElectronicTicketing) and the source's
 *     static trusted-electronic declaration, exactly as the sync passes them.
 */
import { runIngestionPipeline, type PipelineResult } from "@/lib/adapters/pipeline";
import { hasRichGenreEvidence } from "@/lib/adapters/deterministicGenreMapping";
import type { RawCandidateEvent } from "@/lib/adapters/types";
import { VENUES } from "@/lib/data/venues";
import { isTrustedElectronicSource } from "@/lib/data/sources";
import {
  enrichEventGenre,
  cleanArtistDisplayName,
  normalizeArtistName,
  type ArtistCacheEntry,
  type DiscogsLookupClient,
} from "@/lib/enrichment/genreEnrichment";
import {
  assessRelevance,
  countNonElectronicGenreFamilies,
  GENERIC_ELECTRONIC_GENRE,
  hasElectronicsAsInstrumentationOnly,
  hasExplicitElectronicAssertion,
  hasExplicitNonElectronicIdentityAssertion,
  hasNonElectronicCategorySignal,
  hasNonElectronicGenreSignal,
  hasPopOrRnbSignal,
  type RelevanceEvidenceInput,
  type RelevanceLevel,
} from "@/lib/relevance";
import type { GenreSlug } from "@/lib/taxonomy";
import type { ConfidenceLevel } from "@/lib/types";

/** Shown with every result so it is never read as the publish decision. */
export const RELEVANCE_RECHECK_BASIS =
  "Current recomputation under today's rules (assessRelevance); NOT the historical publish decision. Nothing was changed.";

/** The stored event fields the recheck needs (a subset of the audit row). */
export interface RelevanceRecheckInput {
  title: string;
  description: string | null;
  artists: string[] | null;
  venue_name: string | null;
  start_datetime: Date | string;
  end_datetime: Date | string | null;
  canonical_source_id: string | null;
  official_event_url: string | null;
  ticket_url: string | null;
  resident_advisor_url: string | null;
}

export interface RelevanceRecheck {
  basis: typeof RELEVANCE_RECHECK_BASIS;
  relevance: RelevanceLevel;
  /** Human-readable signals behind the verdict, positive first. */
  reasons: string[];
  /** The genre today's text rules derive (never the stored genre). Null when none. */
  textGenre: GenreSlug | null;
  /** Unanimous genre from cached Discogs lineup data, when consulted. */
  discogsGenre: GenreSlug | null;
  trustedElectronicSource: boolean;
}

/** Read-only lookup of cached artist rows; the only extra query the recheck adds. */
export const ARTIST_CACHE_SQL = `SELECT artist_name_normalized, lookup_status, proposed_genre, genre_confidence,
       identity_confidence, discogs_artist_id, classification_method, looked_up_at, expires_at
FROM artist_genre_cache
WHERE artist_name_normalized = ANY($1)`;

export interface ArtistCacheRow {
  artist_name_normalized: string;
  lookup_status: string;
  proposed_genre: string | null;
  genre_confidence: string | null;
  identity_confidence: string | null;
  discogs_artist_id: number | null;
  classification_method: string;
  looked_up_at: Date | string;
  expires_at: Date | string;
}

export function cacheKeyForArtist(name: string): string {
  return normalizeArtistName(cleanArtistDisplayName(name));
}

export function toCacheEntry(row: ArtistCacheRow): ArtistCacheEntry {
  return {
    artistNameNormalized: row.artist_name_normalized,
    lookupStatus: row.lookup_status as ArtistCacheEntry["lookupStatus"],
    proposedGenre: row.proposed_genre as GenreSlug | null,
    genreConfidence: row.genre_confidence as ConfidenceLevel | null,
    identityConfidence: row.identity_confidence as ArtistCacheEntry["identityConfidence"],
    discogsArtistId: row.discogs_artist_id,
    evidence: [],
    classificationMethod: row.classification_method,
    lookedUpAt: new Date(row.looked_up_at),
    expiresAt: new Date(row.expires_at),
  };
}

/** A Discogs client that refuses every call: the recheck never reaches the network. */
const NO_NETWORK: DiscogsLookupClient = {
  searchArtist: () => Promise.reject(new Error("relevance recheck is cache-only")),
  getArtistReleaseIds: () => Promise.reject(new Error("relevance recheck is cache-only")),
  getReleaseGenres: () => Promise.reject(new Error("relevance recheck is cache-only")),
};

/**
 * The lineup genre the sync's enrichment would derive from the cache alone,
 * using the same unanimous-agreement rule (enrichEventGenre). Only artists
 * with a cached row are passed in, so no lookup is ever attempted (an
 * uncached artist is "no evidence" in enrichEventGenre either way), and
 * NO_NETWORK / the throwing set() are only guards. Every cached row counts
 * regardless of expiry (`now` = epoch).
 */
async function cachedLineupGenre(artists: string[], cache: ReadonlyMap<string, ArtistCacheEntry>): Promise<GenreSlug | null> {
  const cached = artists.filter((a) => cache.has(cacheKeyForArtist(a)));
  if (cached.length === 0) return null;
  const store = {
    get: async (key: string) => cache.get(key) ?? null,
    set: async () => {
      throw new Error("relevance recheck never writes the cache");
    },
  };
  const result = await enrichEventGenre(cached, store, NO_NETWORK, new Date(0));
  return result.genre;
}

/** Mirrors runIngestionPipeline's own assessRelevance input (see pipeline.ts). */
function evidenceFor(
  relevanceText: string,
  normalizedArtists: string[],
  genre: GenreSlug | null,
  hasTrustedElectronicTicketing: boolean,
  hasCorroboratingArtistGenreEvidence: boolean,
): RelevanceEvidenceInput {
  return {
    genre,
    hasExplicitElectronicAssertion: hasExplicitElectronicAssertion(relevanceText),
    hasTrustedElectronicTicketing,
    hasNonElectronicGenreSignal:
      hasNonElectronicGenreSignal(relevanceText, normalizedArtists) || hasNonElectronicCategorySignal(relevanceText, normalizedArtists),
    hasExplicitNonElectronicIdentityAssertion: hasExplicitNonElectronicIdentityAssertion(relevanceText, normalizedArtists),
    hasCorroboratingArtistGenreEvidence,
    hasPopOrRnbSignal: hasPopOrRnbSignal(relevanceText, normalizedArtists),
    hasBroadNonElectronicGenreMix: countNonElectronicGenreFamilies(relevanceText, normalizedArtists) >= 3,
    hasElectronicsAsInstrumentationOnly: hasElectronicsAsInstrumentationOnly(relevanceText, normalizedArtists),
    hasRichSpecificGenreEvidence: hasRichGenreEvidence(relevanceText),
  };
}

function reasonsFor(ev: RelevanceEvidenceInput, trusted: boolean, discogsGenre: GenreSlug | null): string[] {
  const positive: string[] = [];
  const negative: string[] = [];
  if (trusted) positive.push("trusted electronic source (published regardless of text relevance)");
  if (ev.genre && ev.genre !== GENERIC_ELECTRONIC_GENRE) positive.push(`specific genre in the event's own text: ${ev.genre}`);
  else if (ev.genre === GENERIC_ELECTRONIC_GENRE) positive.push("only a generic electronic mention in the event's own text");
  if (ev.hasExplicitElectronicAssertion) positive.push("explicit electronic-music assertion in the text");
  if (ev.hasTrustedElectronicTicketing) positive.push("Resident Advisor link stored");
  if (discogsGenre) positive.push(`cached Discogs lineup data: ${discogsGenre}`);
  if (ev.hasRichSpecificGenreEvidence) positive.push("rich genre evidence (more than a passing mention)");
  if (ev.hasNonElectronicGenreSignal) negative.push("non-electronic genre/category signal in the text");
  if (ev.hasBroadNonElectronicGenreMix) negative.push("broad mix of 3+ non-electronic genre families");
  if (ev.hasExplicitNonElectronicIdentityAssertion) negative.push("text presents the act as non-electronic");
  if (ev.hasPopOrRnbSignal) negative.push("pop/R&B signal");
  if (ev.hasElectronicsAsInstrumentationOnly) negative.push("'electronics' only as an instrument");
  if (positive.length === 0 && negative.length === 0) negative.push("no electronic evidence found in the stored text");
  return [...positive, ...negative.map((n) => `against: ${n}`)];
}

export async function recheckRelevance(
  row: RelevanceRecheckInput,
  artistCache: ReadonlyMap<string, ArtistCacheEntry>,
): Promise<RelevanceRecheck> {
  const sourceId = row.canonical_source_id ?? "admin";
  const trusted = row.canonical_source_id ? isTrustedElectronicSource(row.canonical_source_id) : false;
  const raw: RawCandidateEvent = {
    sourceId,
    sourceUrl: row.official_event_url ?? "",
    title: row.title,
    description: row.description,
    relevanceText: row.description, // full stored text, never the audit's shortened copy
    artists: row.artists ?? [],
    startDatetime: new Date(row.start_datetime).toISOString(),
    endDatetime: row.end_datetime ? new Date(row.end_datetime).toISOString() : null,
    venueName: row.venue_name,
    officialEventUrl: row.official_event_url,
    ticketUrl: row.ticket_url,
    facebookUrl: null,
    residentAdvisorUrl: row.resident_advisor_url,
    imageUrl: null,
    priceFrom: null,
    genreHint: null, // the stored genre is never its own relevance evidence
    genreConfidenceHint: null,
  };
  const result: PipelineResult = runIngestionPipeline(raw, { venues: VENUES, existingEvents: [], trustedElectronicSource: trusted });
  const relevanceText = `${raw.title} ${raw.relevanceText ?? ""}`;
  const hasRa = raw.residentAdvisorUrl != null;

  // Same trigger as src/db/sync.ts's needsEnrichment: lineup data only when
  // the text left the genre open or generic-and-weak.
  const needsLineup =
    result.decision !== "auto_publish" &&
    result.holdReason !== "negative_relevance" &&
    (result.genre === null || (result.genre === GENERIC_ELECTRONIC_GENRE && result.relevance === "weak"));
  const discogsGenre = needsLineup ? await cachedLineupGenre(raw.artists, artistCache) : null;

  // Same evidence applyEnrichedGenre assembles: CASE A (no text genre) uses
  // the Discogs genre; CASE B (generic + weak) keeps the generic genre unless
  // Discogs names a specific subgenre, and counts generic agreement as
  // corroboration.
  let genreForRelevance = result.genre;
  let corroborating = false;
  if (discogsGenre && result.genre === null) {
    genreForRelevance = discogsGenre;
    corroborating = discogsGenre === GENERIC_ELECTRONIC_GENRE;
  } else if (discogsGenre && result.genre === GENERIC_ELECTRONIC_GENRE) {
    genreForRelevance = discogsGenre !== GENERIC_ELECTRONIC_GENRE ? discogsGenre : result.genre;
    corroborating = discogsGenre === GENERIC_ELECTRONIC_GENRE;
  }
  const evidence = evidenceFor(relevanceText, result.normalizedArtists, genreForRelevance, hasRa, corroborating);
  return {
    basis: RELEVANCE_RECHECK_BASIS,
    relevance: assessRelevance(evidence),
    reasons: reasonsFor(evidence, trusted, discogsGenre),
    textGenre: result.genre,
    discogsGenre,
    trustedElectronicSource: trusted,
  };
}
