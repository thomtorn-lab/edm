import { eq } from "drizzle-orm";
import { db } from "./client";
import { artistGenreCache } from "./schema";
import * as discogsClient from "@/lib/enrichment/discogsClient";
import {
  enrichEventGenre as pureEnrichEventGenre,
  type ArtistCacheEntry,
  type ArtistGenreCacheStore,
  type EventGenreEnrichmentResult,
} from "@/lib/enrichment/genreEnrichment";
import type { GenreSlug } from "@/lib/taxonomy";
import type { ConfidenceLevel } from "@/lib/types";

/**
 * Postgres-backed cache store for src/lib/enrichment/genreEnrichment.ts's
 * pure orchestration logic. This file is the only place that touches
 * `db`/Discogs directly for genre enrichment — mirrors the
 * pure-lib/I-O-db split used everywhere else in this codebase.
 */
const drizzleCacheStore: ArtistGenreCacheStore = {
  async get(artistNameNormalized) {
    const [row] = await db
      .select()
      .from(artistGenreCache)
      .where(eq(artistGenreCache.artistNameNormalized, artistNameNormalized))
      .limit(1);
    if (!row) return null;
    return {
      artistNameNormalized: row.artistNameNormalized,
      lookupStatus: row.lookupStatus as ArtistCacheEntry["lookupStatus"],
      proposedGenre: row.proposedGenre as GenreSlug | null,
      genreConfidence: row.genreConfidence as ConfidenceLevel | null,
      identityConfidence: row.identityConfidence as ArtistCacheEntry["identityConfidence"],
      discogsArtistId: row.discogsArtistId,
      evidence: row.evidence,
      classificationMethod: row.classificationMethod,
      lookedUpAt: row.lookedUpAt,
      expiresAt: row.expiresAt,
    };
  },
  async set(entry) {
    const row = {
      artistNameNormalized: entry.artistNameNormalized,
      lookupStatus: entry.lookupStatus,
      proposedGenre: entry.proposedGenre,
      genreConfidence: entry.genreConfidence,
      identityConfidence: entry.identityConfidence,
      discogsArtistId: entry.discogsArtistId,
      evidence: entry.evidence,
      classificationMethod: entry.classificationMethod,
      lookedUpAt: entry.lookedUpAt,
      expiresAt: entry.expiresAt,
    };
    await db
      .insert(artistGenreCache)
      .values(row)
      .onConflictDoUpdate({ target: artistGenreCache.artistNameNormalized, set: row });
  },
};

/**
 * Discogs genre enrichment for one event's lineup, cache-first. Never
 * throws — a Discogs outage/timeout/rate-limit falls back to today's
 * existing unresolved/review behavior (see genreEnrichment.ts's per-artist
 * try/catch), never blocks ingestion and never affects an event's
 * published/cancelled state.
 */
export async function enrichEventGenre(artistNames: string[]): Promise<EventGenreEnrichmentResult> {
  return pureEnrichEventGenre(artistNames, drizzleCacheStore, discogsClient);
}
