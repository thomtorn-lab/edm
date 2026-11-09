"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

/**
 * Compact YouTube Artist Preview (automated Rule A V1, 2026-09-25).
 * Only ever rendered by the event-detail page when a cached, accepted,
 * non-blocked match already exists (src/lib/queries.ts::
 * getArtistYoutubePreviewForLineup) — no placeholder/"no preview available"
 * state.
 *
 * Click-to-load (GDPR review, 2026-10-30): nothing is requested from
 * YouTube or Google BY THE VISITOR'S BROWSER until they press play. Before
 * that the component renders only its own button, the video's thumbnail and
 * a short notice — no iframe, no preconnect, no player API script. The
 * thumbnail (2026-11-06) goes through Next.js image optimization
 * (/_next/image on our own domain): our host fetches it from i.ytimg.com and
 * serves it, so the visitor's browser never contacts YouTube for it
 * (next.config.ts allows exactly that one image path). Even the privacy-enhanced embed
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

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video's 480x360 "hqdefault" thumbnail, which YouTube always serves.
 * It is 4:3 with black bars above and below a 16:9 picture; shown with
 * object-cover in a 16:9 box those bars are exactly what gets cropped away.
 * null for anything that is not a real video id, so no other URL can be built.
 */
export function youtubeThumbnailUrl(videoId: string): string | null {
  return VIDEO_ID.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

/**
 * The embed URL loaded after the visitor presses play. The press already
 * asked for the video, so it starts at once: autoplay=1, muted (mute=1) and
 * inline (playsinline=1) — browsers (Safari on macOS/iOS, often Firefox) do
 * not let a cross-origin player start WITH sound on its own even right after
 * a click on the page, which left the visitor pressing play a second time
 * (2026-11-09). The player's own controls unmute it.
 */
export function youtubeEmbedUrl(videoId: string): string {
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&playsinline=1`;
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
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnail = thumbnailFailed ? null : youtubeThumbnailUrl(videoId);
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
        className="group relative flex aspect-video w-full flex-col items-center justify-center gap-3 overflow-hidden rounded border border-border-strong bg-black px-4 text-center text-text-secondary transition-colors hover:border-accent-dim hover:text-text-primary focus-visible:border-accent-dim focus-visible:text-text-primary"
      >
        {thumbnail && (
          <>
            <Image
              src={thumbnail}
              alt=""
              fill
              sizes="(min-width: 768px) 720px, 100vw"
              className="object-cover"
              onError={() => setThumbnailFailed(true)}
            />
            {/* Keeps the play button and title readable on any picture. */}
            <span aria-hidden="true" className="absolute inset-0 bg-black/45 transition-colors group-hover:bg-black/30" />
          </>
        )}
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-black/70 ring-1 ring-white/30 transition-transform group-hover:scale-105 group-focus-visible:scale-105">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-1 h-8 w-8 fill-current text-text-primary group-hover:text-accent">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
        <span className="relative text-sm font-semibold text-text-primary">Play video</span>
        {videoTitle?.trim() && <span className="relative line-clamp-2 max-w-md text-xs text-text-primary/90">{videoTitle.trim()}</span>}
      </button>
      <p id={noticeId} className="mt-1.5 text-[11px] leading-snug text-text-tertiary">
        Playing loads YouTube (Google), which receives your IP address and may store data on your device.{" "}
        <Link href="/privacy" className="underline hover:text-text-secondary">
          Privacy
        </Link>
      </p>
    </div>
  );
}
