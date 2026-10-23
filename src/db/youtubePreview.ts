import { eq } from "drizzle-orm";
import { db } from "./client";
import { artistYoutubePreviewCache } from "./schema";
import * as youtubeClient from "@/lib/enrichment/youtubeClient";
import {
  getOrMatchArtistYoutubePreview,
  normalizeArtistName,
  cleanArtistDisplayName,
  type ArtistPreviewCacheEntry,
  type ArtistPreviewCacheStore,
  type PreviewStatus,
} from "@/lib/enrichment/youtubePreviewMatching";
import { isPlaceholderArtistName } from "@/lib/enrichment/genreEnrichment";

/**
 * Postgres-backed cache store for
 * src/lib/enrichment/youtubePreviewMatching.ts's pure orchestration logic —
 * mirrors src/db/enrichment.ts exactly (same pure-lib/I-O-db split used
 * everywhere in this codebase). This file is the only place that touches
 * `db`/YouTube directly for Artist Preview matching.
 */
export const drizzleCacheStore: ArtistPreviewCacheStore = {
  async get(artistNameNormalized) {
    const [row] = await db
      .select()
      .from(artistYoutubePreviewCache)
      .where(eq(artistYoutubePreviewCache.artistNameNormalized, artistNameNormalized))
      .limit(1);
    if (!row) return null;
    return {
      artistNameNormalized: row.artistNameNormalized,
      provider: "youtube",
      status: row.status as PreviewStatus,
      matchRule: row.matchRule as "A" | "manual" | null,
      query: row.query,
      videoId: row.videoId,
      videoTitle: row.videoTitle,
      channelId: row.channelId,
      channelTitle: row.channelTitle,
      evidence: row.evidence,
      manualBlock: row.manualBlock,
      matchedAt: row.matchedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      expiresAt: row.expiresAt,
    };
  },
  async set(entry) {
    const row = {
      artistNameNormalized: entry.artistNameNormalized,
      provider: entry.provider,
      status: entry.status,
      matchRule: entry.matchRule,
      query: entry.query,
      videoId: entry.videoId,
      videoTitle: entry.videoTitle,
      channelId: entry.channelId,
      channelTitle: entry.channelTitle,
      evidence: entry.evidence,
      manualBlock: entry.manualBlock,
      matchedAt: entry.matchedAt,
      lastVerifiedAt: entry.lastVerifiedAt,
      expiresAt: entry.expiresAt,
    };
    await db
      .insert(artistYoutubePreviewCache)
      .values(row)
      .onConflictDoUpdate({ target: artistYoutubePreviewCache.artistNameNormalized, set: row });
  },
};

/**
 * Cache-warms the YouTube Artist Preview match for every artist in a
 * lineup — called once per newly-ingested/approved event (see
 * src/db/writes.ts::createEvent), never on page render. Cache-first per
 * artist (see getOrMatchArtistYoutubePreview), so a recurring artist name
 * across many events only ever costs a real YouTube lookup once per TTL
 * window. Never throws — a YouTube outage/timeout/missing-key/rate-limit
 * falls back to "no preview" for whatever artist failed and never blocks
 * event ingestion, exactly like enrichEventGenre's own per-artist
 * try/catch (src/lib/enrichment/genreEnrichment.ts).
 */
export async function enrichArtistYoutubePreviews(artistNames: string[]): Promise<void> {
  for (const name of artistNames) {
    if (isPlaceholderArtistName(name)) continue; // never looked up, never cached
    try {
      await getOrMatchArtistYoutubePreview(name, drizzleCacheStore, youtubeClient);
    } catch (err) {
      console.error(`[youtube-preview] match failed for "${name}": ${err instanceof Error ? err.message : String(err)}`);
      // No preview for this artist this run — never blocks the rest of the lineup or the event write itself.
    }
  }
}

/**
 * Cheap admin override (public UI, 2026-09-25) — sets/clears manualBlock
 * directly, no dedicated admin screen in V1 (per the "without broad admin
 * work" scoping). blockArtistYoutubePreview is safe to call even for an
 * artist with no existing cache row yet: it seeds a minimal abstain-shaped
 * row so the block takes effect the moment a match would otherwise be
 * attempted, rather than requiring the artist to already have been
 * ingested once.
 */
export async function blockArtistYoutubePreview(artistNameRaw: string): Promise<void> {
  const normalized = normalizeArtistName(cleanArtistDisplayName(artistNameRaw));
  const existing = await drizzleCacheStore.get(normalized);
  const now = new Date();
  await drizzleCacheStore.set(
    existing
      ? { ...existing, manualBlock: true }
      : {
          artistNameNormalized: normalized,
          provider: "youtube",
          status: "abstain",
          matchRule: null,
          query: "",
          videoId: null,
          videoTitle: null,
          channelId: null,
          channelTitle: null,
          evidence: { manuallyBlockedBeforeAnyLookup: true },
          manualBlock: true,
          matchedAt: now,
          lastVerifiedAt: null,
          expiresAt: now, // expired immediately — a real lookup still runs once the block is lifted
        },
  );
}

export async function unblockArtistYoutubePreview(artistNameRaw: string): Promise<void> {
  const normalized = normalizeArtistName(cleanArtistDisplayName(artistNameRaw));
  const existing = await drizzleCacheStore.get(normalized);
  if (!existing) return;
  await drizzleCacheStore.set({ ...existing, manualBlock: false });
}

/** Far enough out that the automated matcher never re-searches over a pin. */
const PINNED_EXPIRES_AT = new Date("2100-01-01T00:00:00.000Z");

/**
 * Admin pin override (2026-10-23) — replaces an artist's preview with a
 * hand-picked video, for when the automated match is wrong (e.g. "LMN"
 * matched Lifetime Movie Network's channel) or missing. Writes an accepted
 * row with matchRule "manual", clears manualBlock, and keeps the previous
 * match in `evidence` so the pin is auditable. The expiry is pushed out to
 * PINNED_EXPIRES_AT, so getOrMatchArtistYoutubePreview never re-searches
 * over it; its periodic re-verification still runs, so a pinned video that
 * later goes private/unembeddable degrades to "no preview" like any other.
 * Undo with blockArtistYoutubePreview (hide) or a new pin.
 */
export async function pinArtistYoutubePreview(
  artistNameRaw: string,
  video: { videoId: string; title: string; channelId: string; channelTitle: string },
  now: Date = new Date(),
): Promise<void> {
  const normalized = normalizeArtistName(cleanArtistDisplayName(artistNameRaw));
  const existing = await drizzleCacheStore.get(normalized);
  await drizzleCacheStore.set({
    artistNameNormalized: normalized,
    provider: "youtube",
    status: "accepted",
    matchRule: "manual",
    query: "",
    videoId: video.videoId,
    videoTitle: video.title,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    evidence: {
      manualPin: { pinnedAt: now.toISOString(), rawArtistName: artistNameRaw },
      previous: existing
        ? { status: existing.status, matchRule: existing.matchRule, videoId: existing.videoId, videoTitle: existing.videoTitle, channelTitle: existing.channelTitle, manualBlock: existing.manualBlock }
        : null,
    },
    manualBlock: false,
    matchedAt: now,
    lastVerifiedAt: now,
    expiresAt: PINNED_EXPIRES_AT,
  });
}

export type { ArtistPreviewCacheEntry };
