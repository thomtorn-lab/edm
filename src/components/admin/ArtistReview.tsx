"use client";

import { useState } from "react";

export interface ReviewAppearance {
  eventId: string;
  nameKey: string;
  displayName: string;
  lineupEntry: string;
  reason: string | null;
  eventTitle: string;
  eventSlug: string;
  start: string;
}

export interface RequestedArtist {
  id: string;
  displayName: string;
  profileUrl: string | null;
  followers: number;
  /** Artists already on the site with the same name — link the request to one of them if it is the same person. */
  existing: { id: string; displayName: string; profileUrl: string | null }[];
}

const BUTTON = "rounded border border-border-strong px-2 py-1 text-xs uppercase tracking-wide text-text-secondary hover:text-text-primary disabled:opacity-40";

/** Artist Alerts admin review: appearances in review, and artists subscribers asked for. Only alertable after a decision here. */
export default function ArtistReview({ appearances, requests }: { appearances: ReviewAppearance[]; requests: RequestedArtist[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [linkTo, setLinkTo] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/artist-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as { error?: string; followers?: number; emailed?: number } | null;
    if (res.ok) {
      setDone(new Set([...done, key]));
      if (typeof data?.followers === "number") setNotes({ ...notes, [key]: `Done · ${data.followers} requester(s), ${data.emailed ?? 0} emailed` });
    } else setError(data?.error ?? "Failed.");
  }

  return (
    <div className="space-y-10">
      {error && <p role="alert" className="text-sm text-status-bad">{error}</p>}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Appearances to review ({appearances.length})</h2>
        <p className="mt-1 text-xs text-text-tertiary">Confirming within 2 hours of the event being listed still alerts followers; later confirmations only make the identity reusable.</p>
        <ul className="mt-3">
          {appearances.map((a) => {
            const key = `${a.eventId}|${a.nameKey}`;
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm">
                <span>
                  <strong>{a.displayName}</strong> <span className="text-text-tertiary">— {a.reason}</span>
                  <br />
                  <a href={`/events/${a.eventSlug}`} className="text-xs text-text-tertiary underline">
                    {a.eventTitle} · {a.start.slice(0, 10)}
                  </a>
                </span>
                <span className="flex gap-2">
                  <button className={BUTTON} disabled={done.has(key)} onClick={() => act(key, { action: "confirm-appearance", eventId: a.eventId, nameKey: a.nameKey })}>Confirm</button>
                  <button className={BUTTON} disabled={done.has(key)} onClick={() => act(key, { action: "reject-appearance", eventId: a.eventId, nameKey: a.nameKey })}>Not this artist</button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Requested artists ({requests.length})</h2>
        <p className="mt-1 text-xs text-text-tertiary">
          Approve adds the artist and makes every confirmed requester follow it. Link instead if it is an artist already on the site. Each confirmed requester gets one email with the result.
        </p>
        <ul className="mt-3">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm">
              <span>
                <strong>{r.displayName}</strong> <span className="text-text-tertiary">· {r.followers} confirmed requester(s)</span>
                {notes[r.id] && <span className="ml-2 text-xs text-text-tertiary">{notes[r.id]}</span>}
                {r.profileUrl && (
                  <>
                    <br />
                    <a href={r.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-text-tertiary underline">{r.profileUrl}</a>
                  </>
                )}
                {r.existing.length > 0 && (
                  <span className="mt-1 block text-xs text-text-tertiary">
                    Same name on the site:{" "}
                    {r.existing.map((m) => (
                      <button key={m.id} className="mr-2 underline" disabled={done.has(r.id)} onClick={() => setLinkTo({ ...linkTo, [r.id]: m.id })}>
                        {m.displayName} ({m.profileUrl ?? m.id})
                      </button>
                    ))}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-2">
                <button className={BUTTON} disabled={done.has(r.id)} onClick={() => act(r.id, { action: "verify-request", artistId: r.id })}>Approve</button>
                <input aria-label="Existing artist id" placeholder="art_… to link" value={linkTo[r.id] ?? ""} onChange={(e) => setLinkTo({ ...linkTo, [r.id]: e.target.value })} className="w-40 rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs" />
                <button className={BUTTON} disabled={done.has(r.id) || !linkTo[r.id]} onClick={() => act(r.id, { action: "link-request", artistId: r.id, linkTo: linkTo[r.id] })}>Link</button>
                <button className={BUTTON} disabled={done.has(r.id)} onClick={() => act(r.id, { action: "reject-request", artistId: r.id })}>Reject</button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
