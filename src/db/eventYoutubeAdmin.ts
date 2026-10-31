import { clearEventOverride, findEvent, getOverride, hideEventVideo, setEventVideo, type OverrideRow } from "./eventYoutubeOverrides";
import { getVideoSnippet, type YoutubeVideoSnippet } from "@/lib/enrichment/youtubeClient";
import { isVideoPlayable, parseYoutubeVideoId, resolveEventOverride } from "@/lib/eventYoutubeOverride";
import { getArtistYoutubePreviewForLineup } from "@/lib/queries";

/**
 * Admin-UI side of per-event YouTube videos (2026-10-24): the same
 * event_youtube_preview_overrides rows, writes (src/db/eventYoutubeOverrides.ts)
 * and rules (src/lib/eventYoutubeOverride.ts) as the event-youtube-override
 * workflow, called from /api/admin/events/[id]/youtube instead of a GitHub
 * Actions run. Each write touches this one event's override row only, and
 * only when an admin presses its button — the generic event edit form never
 * reaches here.
 */

export type EventYoutubeStatus = "auto" | "manual-video" | "manual-unavailable" | "manual-hidden";

export interface EventYoutubeAdminVideo {
  videoId: string;
  videoTitle: string | null;
  channelTitle: string | null;
}

export interface EventYoutubeAdminState {
  eventId: string;
  /**
   * auto: no override, the automated artist match decides.
   * manual-video: the chosen video shows.
   * manual-unavailable: a video was chosen but no longer verifies (private/deleted/unembeddable) — no video shows.
   * manual-hidden: hidden by an admin (or a malformed row) — no video shows.
   */
  status: EventYoutubeStatus;
  /** What the public event page shows right now, or null for no video. */
  shown: EventYoutubeAdminVideo | null;
  /** The stored override row as it is, or null when there is none. */
  override: {
    mode: string;
    videoId: string | null;
    videoTitle: string | null;
    channelTitle: string | null;
    available: boolean;
    unavailableSince: string | null;
    updatedAt: string;
  } | null;
  /** What the automated match finds for the lineup — shown on the page only when status is "auto". */
  autoMatch: (EventYoutubeAdminVideo & { artistName: string }) | null;
}

/** A refusal with the HTTP status the route should answer with. Nothing has been written when one is thrown. */
export class EventYoutubeAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "EventYoutubeAdminError";
  }
}

function statusOf(row: OverrideRow | null): EventYoutubeStatus {
  if (!row) return "auto";
  if (row.mode === "video" && row.videoId) return row.available ? "manual-video" : "manual-unavailable";
  return "manual-hidden";
}

async function requireEvent(eventId: string) {
  const event = await findEvent({ id: eventId });
  if (!event) throw new EventYoutubeAdminError(`No event with id ${eventId}.`, 404);
  return event;
}

export async function getEventYoutubeAdminState(eventId: string): Promise<EventYoutubeAdminState> {
  const event = await requireEvent(eventId);
  const [row, autoMatch] = await Promise.all([getOverride(event.id), getArtistYoutubePreviewForLineup(event.artists)]);
  const decision = resolveEventOverride(row);
  const shown =
    decision.kind === "video"
      ? { videoId: decision.videoId, videoTitle: decision.videoTitle, channelTitle: decision.channelTitle }
      : decision.kind === "auto" && autoMatch
        ? { videoId: autoMatch.videoId, videoTitle: autoMatch.videoTitle, channelTitle: autoMatch.channelTitle }
        : null;
  return {
    eventId: event.id,
    status: statusOf(row),
    shown,
    override: row
      ? {
          mode: row.mode,
          videoId: row.videoId,
          videoTitle: row.videoTitle,
          channelTitle: row.channelTitle,
          available: row.available,
          unavailableSince: row.unavailableSince?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        }
      : null,
    autoMatch,
  };
}

/**
 * Validates the typed link/id and the video itself with the same rules as the
 * workflow's set mode (parseYoutubeVideoId + isVideoPlayable: public and
 * embeddable), then saves it as this event's override. An invalid link, an
 * unknown/private/unembeddable video, or a failed YouTube lookup saves nothing.
 */
export async function setEventYoutubeVideo(eventId: string, input: unknown): Promise<EventYoutubeAdminState> {
  if (typeof input !== "string" || !input.trim()) throw new EventYoutubeAdminError("Enter a YouTube link or video id.", 400);
  const videoId = parseYoutubeVideoId(input);
  if (!videoId) throw new EventYoutubeAdminError("That isn't a YouTube video link or 11-character video id — nothing was saved.", 400);
  const event = await requireEvent(eventId);

  let video: YoutubeVideoSnippet | null;
  try {
    video = await getVideoSnippet(videoId);
  } catch (err) {
    console.error(`[youtube-override] video lookup failed for ${videoId}: ${err instanceof Error ? err.message : String(err)}`);
    throw new EventYoutubeAdminError("Couldn't check the video with YouTube right now — nothing was saved. Try again shortly.", 502);
  }
  if (!video) throw new EventYoutubeAdminError(`YouTube has no video with id ${videoId} — nothing was saved.`, 400);
  if (!isVideoPlayable(video)) {
    throw new EventYoutubeAdminError(
      `Video ${videoId} can't be shown on the site (it must be public and allow embedding; it is ${video.privacyStatus}${video.embeddable ? "" : ", embedding disabled"}) — nothing was saved.`,
      400,
    );
  }

  await setEventVideo(event.id, video, null);
  return getEventYoutubeAdminState(event.id);
}

/** No video on this event, whatever the automated match finds. A previously chosen video's details stay on the row. */
export async function hideEventYoutubeVideo(eventId: string): Promise<EventYoutubeAdminState> {
  const event = await requireEvent(eventId);
  await hideEventVideo(event.id);
  return getEventYoutubeAdminState(event.id);
}

/** Removes the override: the event goes back to the automated artist match. */
export async function resetEventYoutubeToAuto(eventId: string): Promise<EventYoutubeAdminState> {
  const event = await requireEvent(eventId);
  await clearEventOverride(event.id);
  return getEventYoutubeAdminState(event.id);
}
