import { inArray, eq } from "drizzle-orm";
import { db } from "./client";
import { artistGenreCache } from "./schema";
import { drizzleCacheStore } from "./enrichment";
import * as discogsClient from "@/lib/enrichment/discogsClient";
import { getOrLookupArtistGenre } from "@/lib/enrichment/genreEnrichment";
import { assessDiscogsSoundcloud, soundcloudProfilesFromUrls } from "@/lib/soundcloudEvidence/discogsCandidate";
import { discogsCacheKey, discogsLookupName, readDiscogsSoundcloud, withDiscogsSoundcloud } from "@/lib/soundcloudEvidence/discogsSoundcloud";

/**
 * Discogs -> SoundCloud lookups, run by the existing sync after its own work
 * (src/db/sync.ts). Cache-first through the existing Discogs integration
 * (getOrLookupArtistGenre + artist_genre_cache): an artist already looked up
 * for genre costs no search, one already assessed for SoundCloud, or cached
 * as not found / ambiguous, costs nothing. At most `maxLookups` artists that
 * actually need Discogs per call; the first rate-limit error stops the rest
 * (they are tried by a later sync). Never throws.
 */
export interface DiscogsSoundcloudSummary {
  considered: number;
  lookedUp: number;
  verifiable: number;
  uncertain: number;
  missing: number;
  failed: number;
}

const OEMBED_TIMEOUT_MS = 8_000;

async function soundcloudDisplayName(profileUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(profileUrl)}`, { signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as { author_name?: unknown };
    return typeof data.author_name === "string" ? data.author_name : null;
  } catch {
    return null;
  }
}

export async function resolveDiscogsSoundcloud(performers: readonly string[], maxLookups = 2, now: Date = new Date()): Promise<DiscogsSoundcloudSummary> {
  const summary: DiscogsSoundcloudSummary = { considered: performers.length, lookedUp: 0, verifiable: 0, uncertain: 0, missing: 0, failed: 0 };
  if (performers.length === 0) return summary;
  try {
    const keys = [...new Set(performers.map(discogsCacheKey).filter(Boolean))];
    const cached = await db
      .select({ key: artistGenreCache.artistNameNormalized, lookupStatus: artistGenreCache.lookupStatus, evidence: artistGenreCache.evidence, expiresAt: artistGenreCache.expiresAt })
      .from(artistGenreCache)
      .where(inArray(artistGenreCache.artistNameNormalized, keys));
    const byKey = new Map(cached.map((r) => [r.key, r]));

    for (const performer of performers) {
      if (summary.lookedUp >= maxLookups) break;
      const key = discogsCacheKey(performer);
      const row = byKey.get(key);
      const fresh = row && row.expiresAt.getTime() > now.getTime();
      // Nothing to gain: already assessed, or Discogs has no single artist for the name.
      if (fresh && (row.lookupStatus !== "found" || readDiscogsSoundcloud(row.evidence))) continue;
      summary.lookedUp++;
      try {
        const entry = await getOrLookupArtistGenre(discogsLookupName(performer), drizzleCacheStore, discogsClient, now);
        if (entry.lookupStatus !== "found" || !entry.discogsArtistId) {
          summary.missing += entry.lookupStatus === "not_found" ? 1 : 0;
          summary.uncertain += entry.lookupStatus === "ambiguous" ? 1 : 0;
          continue;
        }
        let urls: string[] | null = null;
        let displayName: string | null = null;
        if (entry.identityConfidence === "medium") {
          urls = await discogsClient.getArtistUrls(entry.discogsArtistId);
          const profiles = soundcloudProfilesFromUrls(urls);
          if (profiles.length === 1) displayName = await soundcloudDisplayName(profiles[0]);
        }
        const assessment =
          entry.identityConfidence === "medium"
            ? assessDiscogsSoundcloud({ name: performer, lookupStatus: "found", identityConfidence: "medium", discogsUrls: urls, soundcloudDisplayName: displayName })
            : { verdict: "uncertain" as const, reason: "Discogs identity is low (short name or no confirmed electronic releases)", profileUrl: null };
        summary[assessment.verdict]++;
        await db
          .update(artistGenreCache)
          .set({ evidence: withDiscogsSoundcloud(entry.evidence, { ...assessment, soundcloudName: displayName, checkedAt: now.toISOString() }) })
          .where(eq(artistGenreCache.artistNameNormalized, entry.artistNameNormalized));
      } catch (err) {
        summary.failed++;
        console.error(`[discogs-soundcloud] lookup failed for "${performer}": ${err instanceof Error ? err.message : String(err)}`);
        if (err instanceof Error && /HTTP 429/.test(err.message)) break; // rate limited: leave the rest for a later sync
      }
    }
  } catch (err) {
    console.error(`[discogs-soundcloud] run failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return summary;
}
