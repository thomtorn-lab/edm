"use client";

import { useEffect, useState } from "react";
import type { EventSoundcloudAdminState, EventSoundcloudArtistState } from "@/db/eventSoundcloudAdmin";

/**
 * Manual SoundCloud profile link per lineup artist, inside the event's admin
 * edit view (2026-11-16). Talks to /api/admin/events/[id]/soundcloud only
 * and saves on its own buttons, like EventYoutubePanel. A manual link
 * applies to this event only, wins over the source's link, and no sync
 * changes it.
 */

const buttonCls =
  "rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary disabled:opacity-50";
const inputCls = "w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary";
const LOAD_FAILED = "Couldn't load this event's SoundCloud links.";
/** The public page shows the automatic link when there is no manual one. */
const AUTOMATIC_LABEL: Record<"event-source" | "reused", string> = {
  "event-source": "Automatic (from this event's source)",
  reused: "Automatic (reused from another event or Discogs)",
};

function ProfileLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent-strong underline break-words">
      {url.replace(/^https:\/\//, "")}
    </a>
  );
}

function ArtistRow({
  eventId,
  artist,
  index,
  busy,
  onSave,
  onRemove,
}: {
  eventId: string;
  artist: EventSoundcloudArtistState;
  index: number;
  busy: boolean;
  onSave: (name: string, url: string) => Promise<boolean>;
  onRemove: (name: string) => void;
}) {
  const [input, setInput] = useState("");
  const inputId = `event-${eventId}-soundcloud-${index}`;
  return (
    <li className="space-y-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold text-text-primary">{artist.name}</p>
      <p className="text-[11px] text-text-secondary">
        {artist.manualUrl ? (
          <>
            Manual: <ProfileLink url={artist.manualUrl} />
            {artist.manualBlocked && <span className="text-status-bad"> — on the block list, not shown</span>}
          </>
        ) : artist.automaticUrl ? (
          <>
            {AUTOMATIC_LABEL[artist.automaticFrom ?? "event-source"]}: <ProfileLink url={artist.automaticUrl} />
          </>
        ) : (
          "No link"
        )}
        {artist.manualUrl && artist.automaticUrl && (
          <span className="text-text-tertiary">
            {" "}
            (replaces automatic <ProfileLink url={artist.automaticUrl} />)
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          SoundCloud profile link for {artist.name}
        </label>
        <input
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://soundcloud.com/…"
          className={`${inputCls} max-w-xs`}
        />
        <button
          type="button"
          disabled={busy || !input.trim()}
          onClick={async () => {
            if (await onSave(artist.name, input.trim())) setInput("");
          }}
          className={buttonCls}
        >
          {artist.manualUrl ? `Change link for ${artist.name}` : `Add link for ${artist.name}`}
        </button>
        {artist.manualUrl && (
          <button type="button" disabled={busy} onClick={() => onRemove(artist.name)} className={buttonCls}>
            {`Remove link for ${artist.name}`}
          </button>
        )}
      </div>
    </li>
  );
}

export default function EventSoundcloudPanel({ eventId }: { eventId: string }) {
  const [state, setState] = useState<EventSoundcloudAdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const url = `/api/admin/events/${eventId}/soundcloud`;
  // Bumped by Reload to re-read the links (e.g. once automatic matching has finished after publishing).
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(url)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok) setState(json.state);
        else setError(json.error ?? LOAD_FAILED);
      })
      .catch(() => active && setError(LOAD_FAILED))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [url, reloads]);

  function reload() {
    setLoading(true);
    setError(null);
    setNotice(null);
    setReloads((n) => n + 1);
  }

  async function send(method: "PUT" | "DELETE", body: unknown, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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

  return (
    <section aria-label="SoundCloud links" className="space-y-2 rounded border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">SoundCloud links</h3>
        <button type="button" disabled={busy || loading} onClick={reload} className={buttonCls}>
          Reload SoundCloud links
        </button>
      </div>
      <p className="text-[11px] text-text-tertiary">A manual link applies to this event only, replaces the automatic one, and is never changed by sync.</p>
      {loading && <p className="text-xs text-text-secondary">Loading…</p>}
      {state && state.artists.length === 0 && <p className="text-xs text-text-secondary">This event has no lineup.</p>}
      {state && state.artists.length > 0 && (
        <ul className="space-y-2">
          {state.artists.map((artist, i) => (
            <ArtistRow
              key={artist.name}
              eventId={eventId}
              artist={artist}
              index={i}
              busy={busy}
              onSave={(artistName, link) => send("PUT", { artistName, url: link }, `Saved — ${artistName} now links to this profile on this event.`)}
              onRemove={(artistName) => void send("DELETE", { artistName }, `Removed — ${artistName} uses the automatic link again, if there is one.`)}
            />
          ))}
        </ul>
      )}
      {notice && <p className="text-xs text-accent-strong">{notice}</p>}
      {error && (
        <p role="alert" className="text-xs text-status-bad">
          {error}
        </p>
      )}
    </section>
  );
}
