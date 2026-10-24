import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "./client";
import { artistYoutubePreviewCache, eventYoutubePreviewOverrides, events } from "./schema";
import type { VerifyUpdate } from "@/lib/eventYoutubeOverride";

/**
 * Postgres side of admin per-event YouTube videos (2026-10-23). Every write
 * here touches event_youtube_preview_overrides only, with ONE exception:
 * unpinArtistPreviewRow, used once by the artist-pin migration
 * (src/db/eventYoutubeOverride.ts --mode=migrate-artist-pin) to hand an
 * artist that an earlier, artist-level pin had locked back to automated
 * matching. Rules for what a row means live in src/lib/eventYoutubeOverride.ts.
 */

export type OverrideRow = typeof eventYoutubePreviewOverrides.$inferSelect;
export type ArtistCacheRow = typeof artistYoutubePreviewCache.$inferSelect;

export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  artists: string[];
  startDatetime: Date;
  published: boolean;
}

const eventSummaryColumns = {
  id: events.id,
  slug: events.slug,
  title: events.title,
  artists: events.artists,
  startDatetime: events.startDatetime,
  published: events.published,
};

export async function findEvent(ref: { id: string } | { slug: string }): Promise<EventSummary | null> {
  const [row] = await db
    .select(eventSummaryColumns)
    .from(events)
    .where("id" in ref ? eq(events.id, ref.id) : eq(events.slug, ref.slug))
    .limit(1);
  return row ?? null;
}

export async function getOverride(eventId: string): Promise<OverrideRow | null> {
  const [row] = await db.select().from(eventYoutubePreviewOverrides).where(eq(eventYoutubePreviewOverrides.eventId, eventId)).limit(1);
  return row ?? null;
}

export async function getArtistCacheRows(normalizedNames: string[]): Promise<ArtistCacheRow[]> {
  if (normalizedNames.length === 0) return [];
  return db.select().from(artistYoutubePreviewCache).where(inArray(artistYoutubePreviewCache.artistNameNormalized, normalizedNames));
}

export interface ChosenVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
}

/** Sets (or replaces) this event's chosen video. The caller has already verified it is public and embeddable. */
export async function setEventVideo(eventId: string, video: ChosenVideo, artistName: string | null, now: Date = new Date()): Promise<void> {
  const values = {
    mode: "video",
    videoId: video.videoId,
    videoTitle: video.title,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    artistName,
    available: true,
    lastVerifiedAt: now,
    unavailableSince: null,
    updatedAt: now,
  };
  await db
    .insert(eventYoutubePreviewOverrides)
    .values({ eventId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: eventYoutubePreviewOverrides.eventId, set: values });
}

/** Shows no video on this event. A previously chosen video's details are kept on the row for reference. */
export async function hideEventVideo(eventId: string, now: Date = new Date()): Promise<void> {
  await db
    .insert(eventYoutubePreviewOverrides)
    .values({ eventId, mode: "hidden", createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: eventYoutubePreviewOverrides.eventId, set: { mode: "hidden", updatedAt: now } });
}

/** Removes the override entirely: the event goes back to normal automated artist matching. */
export async function clearEventOverride(eventId: string): Promise<void> {
  await db.delete(eventYoutubePreviewOverrides).where(eq(eventYoutubePreviewOverrides.eventId, eventId));
}

/** Every "video"-mode override, for the weekly verify run. Hidden rows are never checked: nothing shows for them either way. */
export async function listVideoOverrides(): Promise<{ eventId: string; videoId: string; available: boolean }[]> {
  const rows = await db
    .select({ eventId: eventYoutubePreviewOverrides.eventId, videoId: eventYoutubePreviewOverrides.videoId, available: eventYoutubePreviewOverrides.available })
    .from(eventYoutubePreviewOverrides)
    .where(eq(eventYoutubePreviewOverrides.mode, "video"));
  return rows.flatMap((r) => (r.videoId ? [{ eventId: r.eventId, videoId: r.videoId, available: r.available }] : []));
}

export async function applyVerification(updates: VerifyUpdate[], now: Date = new Date()): Promise<void> {
  for (const u of updates) {
    await db
      .update(eventYoutubePreviewOverrides)
      .set({
        available: u.available,
        lastVerifiedAt: now,
        ...(u.unavailableSince !== undefined ? { unavailableSince: u.unavailableSince } : {}),
        ...(u.changed ? { updatedAt: now } : {}),
      })
      .where(eq(eventYoutubePreviewOverrides.eventId, u.eventId));
  }
}

export async function getArtistCacheRow(normalized: string): Promise<ArtistCacheRow | null> {
  const [row] = await getArtistCacheRows([normalized]);
  return row ?? null;
}

/**
 * Returns an artist-level manual pin (matchRule "manual") to automated
 * matching: an abstain row that is already expired, so the very next lookup
 * for this name (ingestion or backfill) searches afresh. manualBlock is kept
 * as it is. The pinned video and the pin's own audit trail are preserved in
 * evidence.unpinned. Never called for any other row shape — the caller checks.
 */
export async function unpinArtistPreviewRow(row: ArtistCacheRow, now: Date = new Date()): Promise<void> {
  await db
    .update(artistYoutubePreviewCache)
    .set({
      status: "abstain",
      matchRule: null,
      query: "",
      videoId: null,
      videoTitle: null,
      channelId: null,
      channelTitle: null,
      evidence: {
        unpinned: {
          at: now.toISOString(),
          reason: "artist-level pin moved to a per-event override",
          pinnedVideoId: row.videoId,
          pinnedVideoTitle: row.videoTitle,
          pinnedChannelTitle: row.channelTitle,
          pinEvidence: row.evidence,
        },
      },
      matchedAt: now,
      lastVerifiedAt: null,
      expiresAt: now,
    })
    .where(eq(artistYoutubePreviewCache.artistNameNormalized, row.artistNameNormalized));
}

/** Upcoming published events (by start time) — for the read-only "which other events share this artist" listing. */
export async function listUpcomingPublishedEvents(now: Date = new Date()): Promise<EventSummary[]> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return db
    .select(eventSummaryColumns)
    .from(events)
    .where(and(eq(events.published, true), gte(events.startDatetime, cutoff)))
    .orderBy(asc(events.startDatetime));
}
