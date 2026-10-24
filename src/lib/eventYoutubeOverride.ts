/**
 * Pure rules for admin-chosen per-event YouTube videos (2026-10-23) — the
 * event_youtube_preview_overrides table (src/db/schema.ts). No DB or network
 * here: the render-time reads (src/lib/queries.ts), the admin CLI
 * (src/db/eventYoutubeOverride.ts) and the weekly verify run all share these
 * functions, so the event page, the homepage VIDEO indicator and the verify
 * job can never disagree about what an override means.
 */

export type EventOverrideMode = "video" | "hidden";

export interface EventOverrideRow {
  eventId: string;
  mode: string;
  videoId: string | null;
  videoTitle: string | null;
  channelTitle: string | null;
  artistName: string | null;
  available: boolean;
}

/**
 * What an event's override (or lack of one) means for display:
 *   - "auto": no override — use the normal automated artist match.
 *   - "none": show no video at all, and do NOT fall back to an artist video
 *     (hidden by an admin, or the chosen video is currently unavailable).
 *   - "video": show exactly this video.
 * An unknown mode or a "video" row without a video id resolves to "none":
 * a malformed override must never re-enable the automated match it was
 * presumably set to replace.
 */
export type EventOverrideDecision =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "video"; videoId: string; videoTitle: string | null; channelTitle: string | null; artistName: string | null };

export function resolveEventOverride(row: EventOverrideRow | null | undefined): EventOverrideDecision {
  if (!row) return { kind: "auto" };
  if (row.mode === "video" && row.videoId && row.available) {
    return { kind: "video", videoId: row.videoId, videoTitle: row.videoTitle, channelTitle: row.channelTitle, artistName: row.artistName };
  }
  return { kind: "none" };
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Video id from a bare id or a youtu.be / youtube.com watch, embed, shorts or live URL; null if none. */
export function parseYoutubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (VIDEO_ID.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    id = first === "watch" ? url.searchParams.get("v") : ["embed", "shorts", "live", "v"].includes(first) ? (second ?? null) : null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Same shape the event ids are minted with (src/db/writes.ts, src/db/sync.ts: `e-` + 8 hex). */
const EVENT_ID = /^e-[0-9a-f]{8}$/;
/** Slugs are lowercase a-z/0-9 words joined by single dashes (src/db/sync.ts, src/db/writes.ts, src/lib/slug.ts). */
const EVENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Classifies an admin-typed --event value — an event id, a slug, or the
 * event page's own URL (".../events/<slug>") — or rejects it. The result is
 * only ever used as a bound query parameter.
 */
export function parseEventRef(input: string): { id: string } | { slug: string } | null {
  let raw = input.trim();
  const fromUrl = /^https?:\/\/[^/]+\/events\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(raw);
  if (fromUrl) raw = fromUrl[1];
  if (EVENT_ID.test(raw)) return { id: raw };
  if (raw.length <= 300 && EVENT_SLUG.test(raw)) return { slug: raw };
  return null;
}

export interface VideoStatus {
  videoId: string;
  embeddable: boolean;
  privacyStatus: string;
}

/** The one availability rule for a chosen video, used both when setting it and by the weekly verify run. */
export function isVideoPlayable(status: VideoStatus | null | undefined): boolean {
  return Boolean(status && status.embeddable && status.privacyStatus === "public");
}

export interface VerifyUpdate {
  eventId: string;
  videoId: string;
  available: boolean;
  /** Set only on a flip to unavailable; null on a flip back; undefined = leave as is. */
  unavailableSince: Date | null | undefined;
  changed: boolean;
}

/**
 * Weekly verify run: given the "video"-mode overrides and what videos.list
 * returned, the new availability for each. A video YouTube no longer returns
 * (deleted, or made private for everyone) counts as unavailable. A flip back
 * to available clears unavailableSince, so the video shows again; staying
 * unavailable keeps the original timestamp.
 */
export function planVerification(
  rows: { eventId: string; videoId: string; available: boolean }[],
  statuses: VideoStatus[],
  now: Date,
): VerifyUpdate[] {
  const byId = new Map(statuses.map((s) => [s.videoId, s]));
  return rows.map((row) => {
    const available = isVideoPlayable(byId.get(row.videoId));
    const changed = available !== row.available;
    return {
      eventId: row.eventId,
      videoId: row.videoId,
      available,
      unavailableSince: !changed ? undefined : available ? null : now,
      changed,
    };
  });
}
