"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DiscoveryQueueItem } from "@/lib/types";
import type { Venue } from "@/lib/types";
import { getGenre, GENRES } from "@/lib/taxonomy";
import { resolveVenue } from "@/lib/normalize";
import { formatIsoDateForInput } from "@/lib/format";

interface Props {
  items: DiscoveryQueueItem[];
  venues: Venue[];
}

export default function DiscoveryQueue({ items, venues }: Props) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">Queue is empty — nothing needs manual review right now.</p>;
  }

  return (
    <ul>
      {items.map((item) => (
        <QueueRow key={item.id} item={item} venues={venues} />
      ))}
    </ul>
  );
}

function QueueRow({ item, venues }: { item: DiscoveryQueueItem; venues: Venue[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guessedVenue = item.probableVenueName ? resolveVenue(item.probableVenueName, venues) : undefined;
  const [venueId, setVenueId] = useState(guessedVenue?.id ?? "");

  const [title, setTitle] = useState(item.probableTitle);
  const [startLocal, setStartLocal] = useState(item.probableStart ? toLocalInput(item.probableStart) : "");
  const [venueNameText, setVenueNameText] = useState(item.probableVenueName ?? "");
  const [lineup, setLineup] = useState(item.detectedLineup.join(", "));
  const [genre, setGenre] = useState(item.predictedGenre ?? "");

  async function handlePublish() {
    if (!venueId) {
      setError("Pick a venue before publishing.");
      return;
    }
    await callPost(`/api/admin/discovery/${item.id}/publish`, { venueId }, router, setBusy, setError);
  }

  async function handleIgnore() {
    await callPost(`/api/admin/discovery/${item.id}/ignore`, undefined, router, setBusy, setError);
  }

  async function handleMerge() {
    if (!item.suspectedDuplicateOfEventId) return;
    await callPost(
      `/api/admin/discovery/${item.id}/merge`,
      { targetEventId: item.suspectedDuplicateOfEventId },
      router,
      setBusy,
      setError,
    );
  }

  async function handleSaveEdit() {
    const patch: Record<string, unknown> = {
      probableTitle: title,
      probableVenueName: venueNameText || null,
      detectedLineup: lineup.split(",").map((s) => s.trim()).filter(Boolean),
      predictedGenre: genre || null,
    };
    if (startLocal) patch.probableStart = new Date(startLocal).toISOString();
    const ok = await callPatch(`/api/admin/discovery/${item.id}`, patch, router, setBusy, setError);
    if (ok) setEditing(false);
  }

  return (
    <li className="border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">{item.probableTitle}</p>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
          {item.overallConfidence} confidence
        </span>
      </div>
      <p className="mt-1 text-xs text-text-secondary">
        {item.probableVenueName ?? "Venue unresolved"} · source: {item.sourceName}
      </p>
      {item.detectedLineup.length > 0 && (
        <p className="mt-1 text-xs text-text-tertiary">Lineup: {item.detectedLineup.join(", ")}</p>
      )}
      <p className="mt-1 text-xs text-text-tertiary">
        Genre: {item.predictedGenre ? `${getGenre(item.predictedGenre).label} (${item.genreConfidence})` : "unresolved"}
        {item.suspectedDuplicateOfEventId && ` · possible duplicate of ${item.suspectedDuplicateOfEventId}`}
      </p>
      {item.missingFields.length > 0 && (
        <p className="mt-1 text-xs text-status-warn">Missing: {item.missingFields.join(", ")}</p>
      )}

      {editing ? (
        <div className="mt-3 space-y-2 rounded border border-border-strong p-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Date &amp; time</label>
            <input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} className="mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Venue name (free text)</label>
            <input value={venueNameText} onChange={(e) => setVenueNameText(e.target.value)} className="mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Lineup (comma-separated)</label>
            <input value={lineup} onChange={(e) => setLineup(e.target.value)} className="mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Genre</label>
            <select value={genre} onChange={(e) => setGenre(e.target.value)} className="mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary">
              <option value="">Unresolved</option>
              {GENRES.map((g) => (
                <option key={g.slug} value={g.slug}>{g.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={busy} onClick={handleSaveEdit} className="rounded border border-accent bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-border-strong px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            className="rounded border border-border-strong bg-surface-1 px-2 py-1 text-[11px] text-text-secondary"
          >
            <option value="">Select venue to publish…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={handlePublish} className="rounded border border-accent bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50">
            Publish
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className="rounded border border-border-strong px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
            Edit
          </button>
          <button type="button" disabled={busy} onClick={handleIgnore} className="rounded border border-border-strong px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
            Ignore
          </button>
          {item.suspectedDuplicateOfEventId && (
            <button type="button" disabled={busy} onClick={handleMerge} className="rounded border border-border-strong px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
              Merge into {item.suspectedDuplicateOfEventId}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-status-bad">{error}</p>}
    </li>
  );
}

function toLocalInput(iso: string): string {
  return formatIsoDateForInput(iso) + "T" + iso.slice(11, 16);
}

async function callPost(
  path: string,
  body: unknown,
  router: ReturnType<typeof useRouter>,
  setBusy: (b: boolean) => void,
  setError: (e: string | null) => void,
) {
  setBusy(true);
  setError(null);
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Action failed.");
      setBusy(false);
      return false;
    }
    router.refresh();
    return true;
  } catch {
    setError("Network error.");
    setBusy(false);
    return false;
  }
}

async function callPatch(
  path: string,
  patch: unknown,
  router: ReturnType<typeof useRouter>,
  setBusy: (b: boolean) => void,
  setError: (e: string | null) => void,
) {
  setBusy(true);
  setError(null);
  try {
    const res = await fetch(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Action failed.");
      setBusy(false);
      return false;
    }
    router.refresh();
    return true;
  } catch {
    setError("Network error.");
    setBusy(false);
    return false;
  }
}
