"use client";

import { useEffect, useState } from "react";
import type { EventSoundcloudAdminState } from "@/db/eventSoundcloudAdmin";
import { adminSoundcloudProfileUrl } from "@/lib/adminSoundcloudLinks";

/**
 * Admin-entered artist SoundCloud links for one event (2026-11-15): one
 * input per lineup artist. Talks to /api/admin/events/[id]/soundcloud only and
 * saves on its own button — the event form's "Save" never sends anything
 * here. The lineup comes from the saved event, so a lineup edit has to be
 * saved first; `reloadKey` (e.g. the saved lineup) reloads the panel when
 * it changes.
 */

const buttonCls =
  "rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary disabled:opacity-50";
const inputCls = "mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary";

const LOAD_FAILED = "Couldn't load this event's SoundCloud links.";

export default function EventSoundcloudPanel({ eventId, reloadKey = "" }: { eventId: string; reloadKey?: string }) {
  const [state, setState] = useState<EventSoundcloudAdminState | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const url = `/api/admin/events/${eventId}/soundcloud`;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok) {
          setState(json.state);
          setInputs(json.state.links);
          setError(null);
        } else {
          setError(json.error ?? LOAD_FAILED);
        }
      } catch {
        if (active) setError(LOAD_FAILED);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [url, reloadKey, reloads]);

  async function save() {
    if (!state) return;
    for (const name of state.lineup) {
      const value = (inputs[name] ?? "").trim();
      if (!value) continue;
      const parsed = adminSoundcloudProfileUrl(value);
      if ("error" in parsed) {
        setNotice(null);
        setError(`The link for ${name} ${parsed.error} — nothing was saved.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links: state.lineup.map((artistName) => ({ artistName, url: inputs[artistName] ?? "" })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Saving failed.");
        return;
      }
      setState(json.state);
      setInputs(json.state.links);
      setNotice("Saved — the event page shows these SoundCloud links.");
    } catch {
      setError("Saving failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="SoundCloud links" className="space-y-2 rounded border border-border p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">SoundCloud links</h3>

      {loading && !state && <p className="text-xs text-text-tertiary">Loading…</p>}

      {state && state.lineup.length === 0 && (
        <p className="text-xs text-text-secondary">No lineup yet — add artists and save the event first, then add their SoundCloud profiles here.</p>
      )}

      {state &&
        state.lineup.map((name, i) => {
          const inputId = `event-${eventId}-soundcloud-${i}`;
          return (
            <div key={name}>
              <label htmlFor={inputId} className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                {name}
              </label>
              <input
                id={inputId}
                value={inputs[name] ?? ""}
                onChange={(e) => setInputs((prev) => ({ ...prev, [name]: e.target.value }))}
                placeholder="https://soundcloud.com/…"
                className={inputCls}
              />
            </div>
          );
        })}

      <div className="flex flex-wrap gap-2">
        {state && state.lineup.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded border border-accent bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50"
          >
            Save SoundCloud links
          </button>
        )}
        {error && !state && (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setError(null);
              setReloads((n) => n + 1);
            }}
            className={buttonCls}
          >
            Retry
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-tertiary">
        Artist profile links only (soundcloud.com/&lt;name&gt;). Leave a field empty for no manual link. Applies to this event only, wins over a
        venue-provided link for the same artist, and is saved separately from the fields above — syncs never change it.
      </p>
      {notice && <p role="status" className="text-xs text-accent-strong">{notice}</p>}
      {error && <p role="alert" className="text-xs text-status-bad">{error}</p>}
    </section>
  );
}
