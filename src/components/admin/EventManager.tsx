"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventWithVenue } from "@/lib/queries";
import type { AdminUnpublishReason, Venue } from "@/lib/types";
import { formatRowDateLabel, formatTimeLabel, formatIsoDateForInput } from "@/lib/format";
import { isValidHttpUrl } from "@/lib/urlValidation";
import { EventFieldEditorTop, EventFieldEditorBottom } from "./EventFieldEditor";

/** UNPUBLISH reasons offered in the admin UI (admin unpublish/cancellation
 *  safety, 2026-09-06) — must stay in sync with AdminUnpublishReason. */
const UNPUBLISH_REASONS: { value: AdminUnpublishReason; label: string }[] = [
  { value: "cancelled", label: "Cancelled" },
  { value: "irrelevant", label: "Irrelevant" },
  { value: "duplicate", label: "Duplicate" },
  { value: "incorrect_data", label: "Incorrect data" },
  { value: "other", label: "Other" },
];

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
  const [subVenue, setSubVenue] = useState(event.subVenue ?? "");
  const [primaryGenre, setPrimaryGenre] = useState(event.primaryGenre);
  const [artists, setArtists] = useState(event.artists.join(", "));
  const [description, setDescription] = useState(event.description ?? "");
  const [officialEventUrl, setOfficialEventUrl] = useState(event.officialEventUrl ?? "");
  const [ticketUrl, setTicketUrl] = useState(event.ticketUrl ?? "");
  const [facebookUrl, setFacebookUrl] = useState(event.facebookUrl ?? "");
  const [residentAdvisorUrl, setResidentAdvisorUrl] = useState(event.residentAdvisorUrl ?? "");
  const [startLocal, setStartLocal] = useState(toLocalInput(event.startDatetime));
  const [startTouched, setStartTouched] = useState(false);
  const [endLocal, setEndLocal] = useState(event.endDatetime ? toLocalInput(event.endDatetime) : "");
  const [endTouched, setEndTouched] = useState(false);
  const [free, setFree] = useState(event.priceFrom === 0);
  const [soldOut, setSoldOut] = useState(event.soldOut);
  const [cancelled, setCancelled] = useState(event.cancelled);
  const [postponed, setPostponed] = useState(event.postponed);

  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [unpublishReason, setUnpublishReason] = useState<AdminUnpublishReason>("cancelled");
  const [unpublishNote, setUnpublishNote] = useState("");

  async function confirmUnpublish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${event.id}/unpublish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: unpublishReason, note: unpublishNote.trim() || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Unpublish failed.");
        return;
      }
      setConfirmingUnpublish(false);
      setUnpublishNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function publishAgain() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${event.id}/publish`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Publish failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Source-driven cancellation safety (2026-09-07): distinct from
  // publishAgain (adminRepublishEvent), which only reverses an admin's own
  // unpublish decision — it never clears sourceCancelledAt/
  // sourceCancelledBySourceId, so calling it on a source-cancelled event
  // would leave the source's signal in place for the very next sync to
  // re-unpublish right out from under the admin. This calls the dedicated
  // override route instead (adminOverrideSourceCancellation), which also
  // protects the decision against that same re-firing.
  async function overrideCancellation() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${event.id}/override-cancellation`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Override failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    // Same native-datetime-local caveat as the discovery-queue date field
    // (see DiscoveryQueue.tsx): an incomplete typed entry reports value=""
    // with no error, so a touched-but-empty start/end time must block save
    // rather than silently clearing a real value or looking like a no-op
    // success. A start date is required (unlike end), so a touched-but-empty
    // start is always an error, never an implicit clear.
    if (startTouched && !startLocal) {
      setError("Date & time isn't a complete, valid date — use the picker or finish typing it before saving.");
      return;
    }
    if (endTouched && !endLocal && event.endDatetime) {
      setError("End time isn't a complete, valid date — use the picker, finish typing it, or clear it explicitly.");
      return;
    }
    const officialEventUrlTrimmed = officialEventUrl.trim();
    if (officialEventUrlTrimmed && !isValidHttpUrl(officialEventUrlTrimmed)) {
      setError("Official event URL isn't a valid http(s) link — fix it or clear the field.");
      return;
    }
    const ticketUrlTrimmed = ticketUrl.trim();
    if (ticketUrlTrimmed && !isValidHttpUrl(ticketUrlTrimmed)) {
      setError("Ticket URL isn't a valid http(s) link — fix it or clear the field.");
      return;
    }
    const residentAdvisorUrlTrimmed = residentAdvisorUrl.trim();
    if (residentAdvisorUrlTrimmed && !isValidHttpUrl(residentAdvisorUrlTrimmed)) {
      setError("Resident Advisor URL isn't a valid http(s) link — fix it or clear the field.");
      return;
    }
    const facebookUrlTrimmed = facebookUrl.trim();
    if (facebookUrlTrimmed && !isValidHttpUrl(facebookUrlTrimmed)) {
      setError("Facebook URL isn't a valid http(s) link — fix it or clear the field.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (title !== event.title) patch.title = title;
      if (venueId !== event.venueId) patch.venueId = venueId;
      const subVenueTrimmed = subVenue.trim();
      if (subVenueTrimmed !== (event.subVenue ?? "")) patch.subVenue = subVenueTrimmed || null;
      if (primaryGenre !== event.primaryGenre) {
        patch.primaryGenre = primaryGenre;
        patch.subgenres = [primaryGenre];
      }
      const newArtists = artists.split(",").map((s) => s.trim()).filter(Boolean);
      if (newArtists.join(",") !== event.artists.join(",")) patch.artists = newArtists;
      if (description !== (event.description ?? "")) patch.description = description || null;
      if (officialEventUrlTrimmed !== (event.officialEventUrl ?? "")) patch.officialEventUrl = officialEventUrlTrimmed || null;
      if (ticketUrlTrimmed !== (event.ticketUrl ?? "")) patch.ticketUrl = ticketUrlTrimmed || null;
      if (facebookUrlTrimmed !== (event.facebookUrl ?? "")) patch.facebookUrl = facebookUrlTrimmed || null;
      if (residentAdvisorUrlTrimmed !== (event.residentAdvisorUrl ?? "")) patch.residentAdvisorUrl = residentAdvisorUrlTrimmed || null;
      // Gated on startTouched (not a value comparison, unlike most other
      // fields here): a datetime-local round trip through toLocalInput and
      // back via `new Date(...).toISOString()` isn't guaranteed byte-
      // identical to the originally stored ISO string, so comparing values
      // alone could send an unwanted no-op patch on every save even when
      // the admin never touched this field.
      if (startTouched && startLocal) patch.startDatetime = new Date(startLocal).toISOString();
      const newEndIso = endLocal ? new Date(endLocal).toISOString() : null;
      if (newEndIso !== event.endDatetime) patch.endDatetime = newEndIso;
      const newPriceFrom = free ? 0 : event.priceFrom === 0 ? null : undefined;
      if (newPriceFrom !== undefined && newPriceFrom !== event.priceFrom) patch.priceFrom = newPriceFrom;
      if (soldOut !== event.soldOut) patch.soldOut = soldOut;
      if (cancelled !== event.cancelled) patch.cancelled = cancelled;
      if (postponed !== event.postponed) patch.postponed = postponed;

      if (Object.keys(patch).length === 0) {
        setEditing(false);
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
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li id={`event-${event.id}`} className="scroll-mt-4 border-b border-border py-3 last:border-b-0 target:ring-2 target:ring-status-warn">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {!event.published && !event.adminUnpublishReason && <span className="mr-1.5 text-status-warn">[hidden]</span>}
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
          {event.adminUnpublishReason && (
            <>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-status-bad">
                Unpublished by admin — reason: {UNPUBLISH_REASONS.find((r) => r.value === event.adminUnpublishReason)?.label ?? event.adminUnpublishReason}
              </p>
              {event.adminUnpublishNote && <p className="mt-0.5 text-xs text-text-secondary">{event.adminUnpublishNote}</p>}
            </>
          )}
          {/* Source-driven cancellation safety (2026-09-07): shown only when
              the SYSTEM (not an admin) unpublished this event because a
              trusted source explicitly reported it cancelled — mutually
              exclusive with the admin-unpublish panel above (adminUnpublishReason
              always takes precedence for the button choice below). */}
          {event.sourceCancelledAt && !event.adminUnpublishReason && (
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-status-bad">
              Cancelled by source ({event.sourceCancellationEvidence ?? "no evidence recorded"}) — {formatRowDateLabel(event.sourceCancelledAt)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={busy} onClick={() => setEditing((v) => !v)} className="rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
            {editing ? "Close" : "Edit"}
          </button>
          {event.published ? (
            <button type="button" disabled={busy} onClick={() => setConfirmingUnpublish(true)} className="rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
              Unpublish
            </button>
          ) : event.sourceCancelledAt && !event.adminUnpublishReason ? (
            <button type="button" disabled={busy} onClick={overrideCancellation} className="rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
              Override &amp; publish
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={publishAgain} className="rounded border border-border-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
              Publish again
            </button>
          )}
        </div>
      </div>

      {confirmingUnpublish && (
        <div className="mt-3 space-y-2 rounded border border-status-bad/40 p-3">
          <Field id={`event-unpublish-reason-${event.id}`} label="Reason">
            <select
              id={`event-unpublish-reason-${event.id}`}
              value={unpublishReason}
              onChange={(e) => setUnpublishReason(e.target.value as AdminUnpublishReason)}
              className={inputCls}
            >
              {UNPUBLISH_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
          <Field id={`event-unpublish-note-${event.id}`} label="Note (optional)">
            <textarea
              id={`event-unpublish-note-${event.id}`}
              value={unpublishNote}
              onChange={(e) => setUnpublishNote(e.target.value)}
              rows={2}
              placeholder="Internal detail, e.g. promoter confirmed by email — never shown publicly."
              className={inputCls}
            />
          </Field>
          <p className="text-xs text-text-tertiary">
            This removes the event from the public site immediately. It stays in admin and can be published again later.
          </p>
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={busy} onClick={confirmUnpublish} className="rounded border border-status-bad/40 bg-status-bad/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-status-bad hover:bg-status-bad/20 disabled:opacity-50">
              Confirm unpublish
            </button>
            <button type="button" disabled={busy} onClick={() => { setConfirmingUnpublish(false); setUnpublishNote(""); }} className="rounded border border-border-strong px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2 rounded border border-border-strong p-3">
          <EventFieldEditorTop
            idPrefix={`event-${event.id}`}
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            startLocal={startLocal}
            onStartLocalChange={(v) => {
              setStartLocal(v);
              setStartTouched(true);
            }}
            endLocal={endLocal}
            onEndLocalChange={(v) => {
              setEndLocal(v);
              setEndTouched(true);
            }}
          />
          <Field id={`event-venue-${event.id}`} label="Venue">
            <select id={`event-venue-${event.id}`} value={venueId} onChange={(e) => setVenueId(e.target.value)} className={inputCls}>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field id={`event-sub-venue-${event.id}`} label="Room / sub-venue (optional)">
            <input id={`event-sub-venue-${event.id}`} value={subVenue} onChange={(e) => setSubVenue(e.target.value)} className={inputCls} />
          </Field>
          <EventFieldEditorBottom
            idPrefix={`event-${event.id}`}
            mode="published"
            genre={primaryGenre}
            onGenreChange={(v) => setPrimaryGenre(v as typeof primaryGenre)}
            artists={artists}
            onArtistsChange={setArtists}
            officialEventUrl={officialEventUrl}
            onOfficialEventUrlChange={setOfficialEventUrl}
            ticketUrl={ticketUrl}
            onTicketUrlChange={setTicketUrl}
            residentAdvisorUrl={residentAdvisorUrl}
            onResidentAdvisorUrlChange={setResidentAdvisorUrl}
            free={free}
            onFreeChange={setFree}
            soldOut={soldOut}
            onSoldOutChange={setSoldOut}
            cancelled={cancelled}
            onCancelledChange={setCancelled}
            postponed={postponed}
            onPostponedChange={setPostponed}
            facebookUrl={facebookUrl}
            onFacebookUrlChange={setFacebookUrl}
          />
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

function toLocalInput(iso: string): string {
  return formatIsoDateForInput(iso) + "T" + formatTimeLabel(iso);
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</label>
      {children}
    </div>
  );
}
