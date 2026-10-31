"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Compact YouTube Artist Preview (automated Rule A V1, 2026-09-25).
 * Only ever rendered by the event-detail page when a cached, accepted,
 * non-blocked match already exists (src/lib/queries.ts::
 * getArtistYoutubePreviewForLineup) — no placeholder/"no preview available"
 * state.
 *
 * Click-to-load (GDPR review, 2026-10-30): nothing is requested from
 * YouTube or Google until the visitor presses play. Before that the
 * component renders only its own button and a short notice — no iframe, no
 * YouTube thumbnail (i.ytimg.com would also receive the visitor's IP), no
 * preconnect, no player API script. Even the privacy-enhanced embed
 * (youtube-nocookie.com) sends the visitor's IP address to Google and lets
 * the player write to the browser's storage on load, so loading it with the
 * page would share data before any choice was made. The press is the
 * visitor's informed choice for that one video: it is not remembered, so
 * every page asks again and nothing is stored on our side. Pressing play
 * loads the embed with autoplay, so one press is enough to start the video.
 *
 * Rendered inside the event page's "Get a taste" section (event-page action
 * layout, 2026-10-17), which owns the section heading and the `#video`
 * anchor — so this component has no heading of its own. No artist caption
 * under the player either (removed 2026-10-18): the YouTube player already
 * shows the video's own title/channel, and the extra line was visual noise.
 * `artistName` and `eventTitle` are used only for the accessible names
 * (see videoPlayerTitle).
 */

/** The only origin the player is ever loaded from — YouTube's privacy-enhanced embed domain. */
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * The iframe's accessible name (2026-10-24): says it is a YouTube video and
 * which one — the video's own title when there is one; otherwise the artist
 * it was matched or chosen for; otherwise the event (an admin-chosen video
 * recorded without an artist). A blank title counts as missing, so the
 * player is never left unnamed.
 */
export function videoPlayerTitle({ videoTitle, artistName, eventTitle }: { videoTitle: string | null; artistName: string | null; eventTitle: string }): string {
  const video = videoTitle?.trim();
  if (video) return `YouTube video: ${video}`;
  const artist = artistName?.trim();
  if (artist) return `YouTube video: ${artist}`;
  return `YouTube video for ${eventTitle.trim() || "this event"}`;
}

/** The embed URL loaded after the visitor presses play — autoplay, since the press itself asked for the video. */
export function youtubeEmbedUrl(videoId: string): string {
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?autoplay=1`;
}

export default function ArtistVideoPreview({
  artistName,
  eventTitle,
  videoId,
  videoTitle,
}: {
  artistName: string | null;
  eventTitle: string;
  videoId: string;
  videoTitle: string | null;
}) {
  const [loaded, setLoaded] = useState(false);
  const playerTitle = videoPlayerTitle({ videoTitle, artistName, eventTitle });
  const noticeId = `youtube-notice-${videoId}`;

  if (loaded) {
    return (
      <div className="mt-3 aspect-video w-full overflow-hidden rounded border border-border-strong bg-black">
        <iframe
          className="h-full w-full"
          src={youtubeEmbedUrl(videoId)}
          title={playerTitle}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setLoaded(true)}
        aria-label={`Play ${playerTitle}`}
        aria-describedby={noticeId}
        className="group flex aspect-video w-full flex-col items-center justify-center gap-3 rounded border border-border-strong bg-black px-4 text-center text-text-secondary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-12 w-12 fill-current text-text-primary group-hover:text-accent">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
        <span className="text-sm font-semibold text-text-primary">Play video</span>
        {videoTitle?.trim() && <span className="line-clamp-2 max-w-md text-xs">{videoTitle.trim()}</span>}
      </button>
      <p id={noticeId} className="mt-2 text-xs leading-relaxed text-text-tertiary">
        Pressing play loads the video from YouTube (Google), which receives your IP address and may store
        information on your device.{" "}
        <Link href="/privacy" className="underline hover:text-text-secondary">
          Privacy
        </Link>
      </p>
    </div>
  );
}
