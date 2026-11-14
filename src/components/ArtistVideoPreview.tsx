"use client";

import { useEffect, useState } from "react";
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
 * loads the embed with autoplay and then tells the player to start (see
 * useOnePressStart), so one press is enough to start the video.
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

/**
 * The embed URL loaded after the visitor presses play — autoplay, since the
 * press itself asked for the video. `enablejsapi` (+ our `origin`) lets the
 * page send the player a play command and hear back whether it is playing
 * (one-press start, 2026-11-14); `playsinline` keeps iOS from demanding a
 * fullscreen tap.
 */
export function youtubeEmbedUrl(videoId: string, origin?: string, { muted = false }: { muted?: boolean } = {}): string {
  const params = new URLSearchParams({ autoplay: "1", playsinline: "1", enablejsapi: "1" });
  if (muted) params.set("mute", "1");
  if (origin) params.set("origin", origin);
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

/**
 * iPhone/iPad (every iOS browser is WebKit; iPadOS reports itself as a Mac
 * with touch). iOS ignores both sound autoplay and scripted `playVideo` in a
 * cross-origin iframe, and a `mute` command sent after load comes too late —
 * only an embed that is muted from its URL starts by itself (2026-11-14).
 */
export function isDesktopSafari(nav: Pick<Navigator, "userAgent"> = navigator): boolean {
  const ua = nav.userAgent;
  return /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Firefox|Edg|OPR|Android/.test(ua);
}

/**
 * Browsers where the start with sound is refused anyway, so the embed is
 * muted from its URL — the one start that is proven to work there (Safari
 * on Mac, videodebug=muted recording 2026-11-14; every iOS browser).
 */
export function prefersMutedStart(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> = navigator): boolean {
  return isIOSDevice(nav) || isDesktopSafari(nav);
}

export function isIOSDevice(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

/** How long the player gets to start with sound before we fall back to a muted start. */
export const SOUND_START_GRACE_MS = 1500;

/**
 * YouTube's "playing" state. Only this counts as started: Safari's player
 * reports buffering (3) while it tries the sound autoplay and then falls back
 * to unstarted (-1) when the browser refuses it, so treating 3 as started
 * skipped the muted fallback (found with the videodebug log, 2026-11-14).
 */
const PLAYING_STATE = 1;

/** Reads the player state out of a YouTube widget-API message, if it carries one. */
export function playerStateFromMessage(data: unknown): number | null {
  let msg: unknown = data;
  if (typeof data === "string") {
    try {
      msg = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== "object") return null;
  const { event, info } = msg as { event?: unknown; info?: unknown };
  if (event === "onStateChange" && typeof info === "number") return info;
  if ((event === "infoDelivery" || event === "initialDelivery") && info && typeof info === "object") {
    const state = (info as { playerState?: unknown }).playerState;
    if (typeof state === "number") return state;
  }
  return null;
}

/** The widget-API event name of a YouTube player message, if it is one. */
export function playerEventFromMessage(data: unknown): string | null {
  let msg: unknown = data;
  if (typeof data === "string") {
    try {
      msg = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== "object") return null;
  const { event } = msg as { event?: unknown };
  return typeof event === "string" ? event : null;
}

/** How often we repeat the "listening" handshake until the player answers (YouTube's own API does the same). */
export const HANDSHAKE_INTERVAL_MS = 250;
/** If the player never answers the handshake, send the muted start blindly after this long. */
export const HANDSHAKE_GIVE_UP_MS = 4000;

/**
 * One-press start (2026-11-14). Browsers — Safari on Mac and every iOS
 * browser above all — often refuse `autoplay=1` with sound inside a
 * cross-origin iframe, leaving YouTube's own play button as a second press.
 *
 * The player inside the iframe only obeys commands once it is ready, and is
 * ready some time after the iframe's load event (longer on a cold cache), so
 * commands must wait for it (ready handshake, 2026-11-14 — a fixed delay
 * after load made the muted fallback work only sometimes):
 * 1. after load, repeat the widget API's "listening" message until the
 *    player answers;
 * 2. on its first answer, send `playVideo`;
 * 3. if it still hasn't started after a short grace period, `mute` and play —
 *    muted playback is allowed everywhere, and YouTube shows its own unmute
 *    control. Where sound is allowed it simply plays.
 * Only talks to the iframe's own window, only accepts messages from the
 * embed origin, and stores nothing.
 */
function useOnePressStart(iframe: HTMLIFrameElement | null) {
  useEffect(() => {
    if (!iframe) return;
    let lastState: number | null = null;
    let ready = false;
    let handshake: ReturnType<typeof setInterval> | undefined;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const post = (payload: Record<string, unknown>) => {
      iframe.contentWindow?.postMessage(JSON.stringify(payload), YOUTUBE_EMBED_ORIGIN);
    };
    const command = (func: string) => post({ event: "command", func, args: [] });
    const playMuted = () => {
      if (lastState === PLAYING_STATE) return;
      command("mute");
      command("playVideo");
    };

    const onReady = () => {
      if (ready) return;
      ready = true;
      clearInterval(handshake);
      command("playVideo");
      timers.push(setTimeout(playMuted, SOUND_START_GRACE_MS));
      // One more muted try in case the first came while the player was still buffering its first frame.
      timers.push(setTimeout(playMuted, SOUND_START_GRACE_MS * 2));
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YOUTUBE_EMBED_ORIGIN || e.source !== iframe.contentWindow) return;
      if (playerEventFromMessage(e.data) === null) return;
      const state = playerStateFromMessage(e.data);
      if (state !== null) lastState = state;
      onReady();
    };

    const onLoad = () => {
      const listen = () => post({ event: "listening", id: iframe.id, channel: "widget" });
      listen();
      clearInterval(handshake);
      handshake = setInterval(listen, HANDSHAKE_INTERVAL_MS);
      timers.push(
        setTimeout(() => {
          clearInterval(handshake);
          if (!ready) playMuted();
        }, HANDSHAKE_GIVE_UP_MS),
      );
    };

    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", onLoad);
    return () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      clearInterval(handshake);
      timers.forEach(clearTimeout);
    };
  }, [iframe]);
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
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  useOnePressStart(iframe);
  const playerTitle = videoPlayerTitle({ videoTitle, artistName, eventTitle });
  const noticeId = `youtube-notice-${videoId}`;

  if (embedSrc) {
    return (
      <div className="mt-3 aspect-video w-full overflow-hidden rounded border border-border-strong bg-black">
        <iframe
          ref={setIframe}
          id={`youtube-player-${videoId}`}
          className="h-full w-full"
          src={embedSrc}
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
        onClick={() => setEmbedSrc(youtubeEmbedUrl(videoId, window.location.origin, { muted: prefersMutedStart() }))}
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
