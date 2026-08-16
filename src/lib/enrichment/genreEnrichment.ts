import type { GenreSlug } from "../taxonomy";
import type { ConfidenceLevel } from "../types";
import { genreConfidenceForEvidence } from "../classification";
import { mapDiscogsEvidenceToGenre } from "./discogsGenreMapping";
import type { DiscogsArtistSearchResult, DiscogsReleaseGenreData } from "./discogsClient";

/**
 * Pure(-ish) genre enrichment orchestration — the actual Discogs HTTP calls
 * and the Postgres cache are both passed in as small interfaces so this
 * whole module (cache-hit/miss, disambiguation, aggregation, TTL policy) is
 * unit-testable with in-memory fakes, no live DB or network required. The
 * real wiring (Discogs client + Drizzle-backed cache) lives in
 * src/db/enrichment.ts, mirroring how src/lib/adapters/pipeline.ts stays
 * pure while src/db/sync.ts does the I/O around it.
 */

export type LookupStatus = "found" | "not_found" | "ambiguous";
export type IdentityConfidence = "medium" | "low";

export interface ArtistCacheEntry {
  artistNameNormalized: string;
  lookupStatus: LookupStatus;
  proposedGenre: GenreSlug | null;
  genreConfidence: ConfidenceLevel | null; // never "high" for this source
  identityConfidence: IdentityConfidence | null;
  discogsArtistId: number | null;
  evidence: unknown;
  classificationMethod: string;
  lookedUpAt: Date;
  expiresAt: Date;
}

export interface ArtistGenreCacheStore {
  get(artistNameNormalized: string): Promise<ArtistCacheEntry | null>;
  set(entry: ArtistCacheEntry): Promise<void>;
}

export interface DiscogsLookupClient {
  searchArtist(name: string): Promise<DiscogsArtistSearchResult[]>;
  getArtistReleaseIds(artistId: number, limit: number): Promise<number[]>;
  getReleaseGenres(releaseId: number): Promise<DiscogsReleaseGenreData>;
}

export const CLASSIFICATION_METHOD = "discogs-artist-releases@v1";
const MAX_RELEASES_EXAMINED = 3;
const FOUND_TTL_DAYS = 90;
const UNRESOLVED_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripDiscogsDisambiguationSuffix(title: string): string {
  return title.replace(/\s*\(\d+\)\s*$/, "").trim();
}

function computeExpiry(status: LookupStatus, now: Date): Date {
  const days = status === "found" ? FOUND_TTL_DAYS : UNRESOLVED_TTL_DAYS;
  return new Date(now.getTime() + days * DAY_MS);
}

/**
 * Looks up one artist against Discogs (no cache involved — callers go
 * through getOrLookupArtistGenre for that). Disambiguation: only an EXACT
 * (case-insensitive, Discogs "(2)"-suffix-stripped) name match counts as a
 * candidate at all. Zero candidates -> not_found. More than one distinct
 * candidate -> ambiguous (Discogs itself has multiple different real people
 * under this exact name) and genre is never guessed between them. Exactly
 * one candidate is still only ever "medium" identity confidence — a bare
 * name match is never treated as high identity confidence, by design.
 */
async function lookupArtistViaDiscogs(
  artistNameRaw: string,
  client: DiscogsLookupClient,
): Promise<Omit<ArtistCacheEntry, "classificationMethod" | "lookedUpAt" | "expiresAt">> {
  const normalized = normalizeArtistName(artistNameRaw);
  const target = normalized;
  const matches = await client.searchArtist(artistNameRaw);
  const exact = matches.filter((m) => stripDiscogsDisambiguationSuffix(m.title).toLowerCase() === target);

  if (exact.length === 0) {
    return {
      artistNameNormalized: normalized,
      lookupStatus: "not_found",
      proposedGenre: null,
      genreConfidence: null,
      identityConfidence: null,
      discogsArtistId: null,
      evidence: { searchResults: matches.map((m) => ({ id: m.id, title: m.title })) },
    };
  }
  if (exact.length > 1) {
    return {
      artistNameNormalized: normalized,
      lookupStatus: "ambiguous",
      proposedGenre: null,
      genreConfidence: null,
      identityConfidence: "low",
      discogsArtistId: null,
      evidence: { candidates: exact.map((m) => ({ id: m.id, title: m.title })) },
    };
  }

  const artist = exact[0];
  const releaseIds = await client.getArtistReleaseIds(artist.id, MAX_RELEASES_EXAMINED);
  const releases = await Promise.all(
    releaseIds.map((id) =>
      client.getReleaseGenres(id).catch((err) => {
        console.error(`[genre-enrichment] Discogs release lookup failed for release ${id}: ${err instanceof Error ? err.message : String(err)}`);
        return { genres: [], styles: [] } satisfies DiscogsReleaseGenreData;
      }),
    ),
  );
  const aggregation = mapDiscogsEvidenceToGenre(releases);

  return {
    artistNameNormalized: normalized,
    lookupStatus: "found",
    proposedGenre: aggregation.genre,
    genreConfidence: aggregation.genre ? genreConfidenceForEvidence("artist-lineup-metadata") : null,
    // A same-name match with no confirmed electronic release is treated as
    // likely the WRONG person, not just "no genre found" — see the
    // approved design's worked example of a real artist-name collision.
    identityConfidence: aggregation.confirmedElectronic ? "medium" : "low",
    discogsArtistId: artist.id,
    evidence: {
      discogsArtistId: artist.id,
      discogsArtistTitle: artist.title,
      releasesExamined: releases,
      matchedStyles: aggregation.matchedStyles,
      confirmedElectronic: aggregation.confirmedElectronic,
      conflicting: aggregation.conflicting,
    },
  };
}

/** Cache-first single-artist lookup. Never throws — a Discogs failure propagates to the caller to decide (enrichEventGenre catches it per-artist). */
export async function getOrLookupArtistGenre(
  artistNameRaw: string,
  cache: ArtistGenreCacheStore,
  client: DiscogsLookupClient,
  now: Date = new Date(),
): Promise<ArtistCacheEntry> {
  const normalized = normalizeArtistName(artistNameRaw);
  const cached = await cache.get(normalized);
  if (cached && cached.expiresAt.getTime() > now.getTime()) {
    return cached;
  }

  const result = await lookupArtistViaDiscogs(artistNameRaw, client);
  const entry: ArtistCacheEntry = {
    ...result,
    classificationMethod: CLASSIFICATION_METHOD,
    lookedUpAt: now,
    expiresAt: computeExpiry(result.lookupStatus, now),
  };
  await cache.set(entry);
  return entry;
}

export interface EventGenreEnrichmentResult {
  genre: GenreSlug | null;
  genreConfidence: ConfidenceLevel | null;
  perArtist: ArtistCacheEntry[];
}

/**
 * Event-level aggregation across a lineup (task 9 MVP scope: simple
 * unanimous-agreement rule, not the full headliner-weighting design from
 * the approved architecture doc — deferred as a documented follow-up).
 * Every artist that DID resolve to a genre must agree; an artist with no
 * result (not_found/ambiguous/lookup error) is skipped, never treated as
 * contradicting evidence.
 */
export async function enrichEventGenre(
  artistNames: string[],
  cache: ArtistGenreCacheStore,
  client: DiscogsLookupClient,
  now: Date = new Date(),
): Promise<EventGenreEnrichmentResult> {
  const perArtist: ArtistCacheEntry[] = [];
  for (const name of artistNames) {
    try {
      perArtist.push(await getOrLookupArtistGenre(name, cache, client, now));
    } catch (err) {
      console.error(`[genre-enrichment] Discogs lookup failed for "${name}": ${err instanceof Error ? err.message : String(err)}`);
      // A failed lookup contributes no evidence — never blocks the rest of the event.
    }
  }

  const resolved = perArtist.filter((e) => e.proposedGenre != null);
  if (resolved.length === 0) return { genre: null, genreConfidence: null, perArtist };

  const distinctGenres = new Set(resolved.map((e) => e.proposedGenre));
  if (distinctGenres.size > 1) return { genre: null, genreConfidence: null, perArtist }; // conflicting lineup — don't force it

  return { genre: resolved[0].proposedGenre, genreConfidence: genreConfidenceForEvidence("artist-lineup-metadata"), perArtist };
}
