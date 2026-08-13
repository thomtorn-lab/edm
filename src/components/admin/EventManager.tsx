"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventWithVenue } from "@/lib/queries";
import type { Venue } from "@/lib/types";
import { GENRES } from "@/lib/taxonomy";
import { formatRowDateLabel, formatTimeLabel } from "@/lib/format";

export default function EventManager({ events, venues }: { events: EventWithVenue[]; venues: Venue[] }) {
  return (
    <ul>
      {events.map((event) => (
        <EventRow key={event.id} event={event} venues={venues} />
      ))}
    </ul>
  );
}

function EventRow({ event, venues }: { event: EventWithVenue; venues: Venue[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(event.title);
  const [venueId, setVenueId] = useState(event.venueId);
  const [primaryGenre, setPrimaryGenre] = useState(event.primaryGenre);
  const [description, setDescription] = useState(event.description ?? "");
  const [officialEventUrl, setOfficialEventUrl] = useState(event.officialEventUrl ?? "");
  const [ticketUrl, setTicketUrl] = useState(event.ticketUrl ?? "");
  const [facebookUrl, setFacebookUrl] = useState(event.facebookUrl ?? "");
  const [residentAdvisorUrl, setResidentAdvisorUrl] = useState(event.residentAdvisorUrl ?? "");

  async function toggleHidden() {
    setBusy(true);
    setError(null);
    const path = event.published ? `/api/admin/events/${event.id}/hide` : `/api/admin/events/${event.id}/unhide`;
    const res = await fetch(path, { method: "POST" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Action failed.");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  async function saveEdit() {
    setBusy(true);
    setError(null);
    const patch: Record<string, unknown> = {};
    if (title !== event.title) patch.title = title;
    if (venueId !== event.venueId) patch.venueId = venueId;
    if (primaryGenre !== event.primaryGenre) {
      patch.primaryGenre = primaryGenre;
      patch.subgenres = [primaryGenre];
    }
    if (description !== (event.description ?? "")) patch.description = description || null;
    if (officialEventUrl !== (event.officialEventUrl ?? "")) patch.officialEventUrl = officialEventUrl || null;
    if (ticketUrl !== (event.ticketUrl ?? "")) patch.ticketUrl = ticketUrl || null;
    if (facebookUrl !== (event.facebookUrl ?? "")) patch.facebookUrl = facebookUrl || null;
    if (residentAdvisorUrl !== (event.residentAdvisorUrl ?? "")) patch.residentAdvisorUrl = residentAdvisorUrl || null;

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Save failed.");
      setBusy(false);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <li className="border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {!event.published && <span className="mr-1.5 text-status-warn">[hidden]</span>}
            {event.title}
          </p>
          <p className="text-xs text-text-tertiary">
            {formatRowDateLabel(event.startDatetime)} {formatTimeLabel(event.startDatetime)} · {event.venue.name}
            {event.overriddenFields.length > 0 && (
              <span className="ml-2 text-accent">
                manually corrected: {event.overriddenFields.join(", ")}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={busy} onClick={() => setEditing((v) => !v)} className="rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
            {editing ? "Close" : "Edit"}
          </button>
          <button type="button" disabled={busy} onClick={toggleHidden} className="rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
            {event.published ? "Hide" : "Unhide"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 rounded border border-border-strong p-3">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
          <Field label="Venue">
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={inputCls}>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Genre">
            <select value={primaryGenre} onChange={(e) => setPrimaryGenre(e.target.value as typeof primaryGenre)} className={inputCls}>
              {GENRES.map((g) => <option key={g.slug} value={g.slug}>{g.label}</option>)}
            </select>
          </Field>
          <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} /></Field>
          <Field label="Official event URL"><input value={officialEventUrl} onChange={(e) => setOfficialEventUrl(e.target.value)} className={inputCls} /></Field>
          <Field label="Ticket URL"><input value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} className={inputCls} /></Field>
          <Field label="Facebook URL"><input value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} className={inputCls} /></Field>
          <Field label="Resident Advisor URL"><input value={residentAdvisorUrl} onChange={(e) => setResidentAdvisorUrl(e.target.value)} className={inputCls} /></Field>
          <div className="pt-1">
            <button type="button" disabled={busy} onClick={saveEdit} className="rounded border border-accent bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50">
              Save (marks edited fields as manually overridden)
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-status-bad">{error}</p>}
    </li>
  );
}

const inputCls = "mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</label>
      {children}
    </div>
  );
}
