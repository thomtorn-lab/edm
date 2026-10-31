"use client";

import { useEffect, useState } from "react";
import type { EventYoutubeAdminState, EventYoutubeAdminVideo, EventYoutubeStatus } from "@/db/eventYoutubeAdmin";
import { parseYoutubeVideoId } from "@/lib/eventYoutubeOverride";

/**
 * Per-event YouTube video inside the published-event edit view (2026-10-24).
 * Talks to /api/admin/events/[id]/youtube only and saves on its own buttons —
 * the event form's "Save" never sends anything here, so an ordinary field
 * edit can't change the video choice.
 */

const STATUS_LABEL: Record<EventYoutubeStatus, string> = {
  auto: "Automatic",
  "manual-video": "Manually chosen",
  "manual-unavailable": "Manually chosen — unavailable",
  "manual-hidden": "Hidden by admin",
};

const STATUS_CLS: Record<EventYoutubeStatus, string> = {
  auto: "border-border-strong text-text-secondary",
  "manual-video": "border-accent text-accent-strong",
  "manual-unavailable": "border-status-warn/60 text-status-warn",
  "manual-hidden": "border-status-bad/40 text-status-bad",
};

const buttonCls =
  "rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary disabled:opacity-50";
const inputCls = "mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary";

function VideoLink({ video }: { video: EventYoutubeAdminVideo }) {
  return (
    <>
      <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noopener noreferrer" className="text-accent-strong underline break-words">
        {video.videoTitle || video.videoId}
      </a>
      {video.channelTitle && <span className="text-text-tertiary"> · {video.channelTitle}</span>}
    </>
  );
}

const LOAD_FAILED = "Couldn't load this event's YouTube video.";

async function readState(url: string): Promise<{ state: EventYoutubeAdminState } | { error: string }> {
  try {
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    return res.ok ? { state: json.state } : { error: json.error ?? LOAD_FAILED };
  } catch {
    return { error: LOAD_FAILED };
  }
}

export default function EventYoutubePanel({ eventId }: { eventId: string }) {
  const [state, setState] = useState<EventYoutubeAdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const url = `/api/admin/events/${eventId}/youtube`;

  // Bumped by Retry to re-run the load effect.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let active = true;
    readState(url).then((result) => {
      if (!active) return;
      if ("state" in result) setState(result.state);
      setError("error" in result ? result.error : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [url, reloads]);

  function retry() {
    setLoading(true);
    setError(null);
    setReloads((n) => n + 1);
  }

  async function send(init: RequestInit, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Saving failed.");
        return false;
      }
      setState(json.state);
      setNotice(done);
      return true;
    } catch {
      setError("Saving failed — check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveVideo() {
    const value = input.trim();
    if (!parseYoutubeVideoId(value)) {
      setNotice(null);
      setError("That isn't a YouTube video link or 11-character video id — nothing was saved.");
      return;
    }
    const ok = await send(
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "video", video: value }) },
      "Saved — this event now shows the chosen video.",
    );
    if (ok) setInput("");
  }

  const hide = () =>
    send({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "hidden" }) }, "Saved — this event shows no video.");
  const reset = () => send({ method: "DELETE" }, "Saved — this event uses automatic matching again.");

  const inputId = `event-${eventId}-youtube-video`;
  const previous = state?.override?.videoId
    ? { videoId: state.override.videoId, videoTitle: state.override.videoTitle, channelTitle: state.override.channelTitle }
    : null;

  return (
    <section aria-label="YouTube video" className="space-y-2 rounded border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">YouTube video</h3>
        {state && (
          <span data-testid="youtube-status" className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLS[state.status]}`}>
            {STATUS_LABEL[state.status]}
          </span>
        )}
      </div>

      {loading && !state && <p className="text-xs text-text-tertiary">Loading…</p>}

      {state && (
        <div className="space-y-1 text-xs text-text-primary">
          <p>
            <span className="text-text-tertiary">Event page shows: </span>
            {state.shown ? <VideoLink video={state.shown} /> : <span className="text-text-secondary">no video</span>}
          </p>
          {state.status === "manual-unavailable" && previous && (
            <p className="text-status-warn">
              The chosen video is no longer public/embeddable on YouTube, so no video is shown. Chosen: <VideoLink video={previous} />
            </p>
          )}
          {state.status === "manual-hidden" && previous && (
            <p className="text-text-secondary">
              Previously chosen: <VideoLink video={previous} />
            </p>
          )}
          {state.status !== "auto" && (
            <p className="text-text-secondary">
              <span className="text-text-tertiary">Automatic match would be: </span>
              {state.autoMatch ? (
                <>
                  <VideoLink video={state.autoMatch} /> <span className="text-text-tertiary">({state.autoMatch.artistName})</span>
                </>
              ) : (
                "none"
              )}
            </p>
          )}
          {state.status === "auto" && state.autoMatch && <p className="text-text-tertiary">Matched automatically for {state.autoMatch.artistName}.</p>}
        </div>
      )}

      <div>
        <label htmlFor={inputId} className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
          {state?.status === "manual-video" ? "Replace with YouTube link or video id" : "YouTube link or video id"}
        </label>
        <input
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className={inputCls}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !state || !input.trim()} onClick={saveVideo} className="rounded border border-accent bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50">
          Save video
        </button>
        <button type="button" disabled={busy || !state || state.status === "manual-hidden"} onClick={hide} className={buttonCls}>
          Hide video
        </button>
        <button type="button" disabled={busy || !state || state.status === "auto"} onClick={reset} className={buttonCls}>
          Use automatic
        </button>
        {error && !state && (
          <button type="button" disabled={loading} onClick={retry} className={buttonCls}>
            Retry
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-tertiary">Applies to this event only, and is saved separately from the fields above. Syncs and automatic matching never change it.</p>
      {notice && <p role="status" className="text-xs text-accent-strong">{notice}</p>}
      {error && <p role="alert" className="text-xs text-status-bad">{error}</p>}
    </section>
  );
}
