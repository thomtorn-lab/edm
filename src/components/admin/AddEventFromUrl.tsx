"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RawCandidateEvent } from "@/lib/adapters/types";
import type { PipelineResult } from "@/lib/adapters/pipeline";
import type { AdminQueueCategory } from "@/lib/adminQueue";
import { ADMIN_QUEUE_CATEGORY_LABELS } from "@/lib/adminQueue";
import { isValidHttpUrl } from "@/lib/urlValidation";
import { EventFieldEditorTop, EventFieldEditorBottom } from "./EventFieldEditor";

interface ExtractResponse {
  raw: RawCandidateEvent;
  result: PipelineResult;
  persisted: { kind: "event" | "discovery"; id: string };
  /** Only present for persisted.kind === "discovery" — see extract/route.ts. */
  category?: AdminQueueCategory;
  duplicateDiscoveryQueueId: string | null;
}

function CheckRow({ label, ok, note }: { label: string; ok: boolean | "unknown"; note?: string }) {
  const icon = ok === "unknown" ? "?" : ok ? "✓" : "✕";
  const color = ok === "unknown" ? "text-status-warn" : ok ? "text-accent-strong" : "text-status-bad";
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className={`w-4 font-bold ${color}`}>{icon}</span>
      <span className="text-text-primary">{label}</span>
      {note && <span className="text-text-tertiary">— {note}</span>}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Analyze/"Add event from URL" (unified event create/edit model, 2026-09-08).
 * Analyze already persists immediately (existing, correct architecture —
 * a page refresh must not lose the analysis). "Editable draft" here means
 * opening the SAME shared field editor DiscoveryQueue.tsx/EventManager.tsx
 * use, pre-filled from what Analyze found, and saving corrections through
 * the EXISTING PATCH endpoints — no new persistence path. Root cause this
 * replaces (confirmed via code read): the previous version was a read-only
 * checklist with no inputs at all, and silently discarded the very
 * officialEventUrl it had just extracted before the row ever reached
 * Discovery Queue.
 */
export default function AddEventFromUrl() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractResponse | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [venueNameText, setVenueNameText] = useState("");
  const [genre, setGenre] = useState("");
  const [artists, setArtists] = useState("");
  const [officialEventUrl, setOfficialEventUrl] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");
  const [residentAdvisorUrl, setResidentAdvisorUrl] = useState("");
  const [free, setFree] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
      } else {
        setData(json);
        const { raw, result } = json as ExtractResponse;
        setTitle(raw.title);
        setDescription(raw.description ?? "");
        setStartLocal(raw.startDatetime ? toLocalInput(raw.startDatetime) : "");
        setEndLocal(raw.endDatetime ? toLocalInput(raw.endDatetime) : "");
        setVenueNameText(raw.venueName ?? "");
        setGenre(result.genre ?? "");
        setArtists(result.normalizedArtists.join(", "));
        setOfficialEventUrl(raw.officialEventUrl ?? "");
        setTicketUrl(raw.ticketUrl ?? "");
        setResidentAdvisorUrl(raw.residentAdvisorUrl ?? "");
        setFree(raw.priceFrom === 0);
        router.refresh(); // the discovery queue / event list below now includes this row
      }
    } catch {
      setError("Could not reach the extraction service.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCorrections() {
    if (!data) return;
    const officialEventUrlTrimmed = officialEventUrl.trim();
    if (officialEventUrlTrimmed && !isValidHttpUrl(officialEventUrlTrimmed)) {
      setSaveError("Official event URL isn't a valid http(s) link — fix it or clear the field.");
      return;
    }
    const ticketUrlTrimmed = ticketUrl.trim();
    if (ticketUrlTrimmed && !isValidHttpUrl(ticketUrlTrimmed)) {
      setSaveError("Ticket URL isn't a valid http(s) link — fix it or clear the field.");
      return;
    }
    const residentAdvisorUrlTrimmed = residentAdvisorUrl.trim();
    if (residentAdvisorUrlTrimmed && !isValidHttpUrl(residentAdvisorUrlTrimmed)) {
      setSaveError("Resident Advisor URL isn't a valid http(s) link — fix it or clear the field.");
      return;
    }

    setSaveBusy(true);
    setSaveError(null);
    try {
      const isEvent = data.persisted.kind === "event";
      const path = isEvent ? `/api/admin/events/${data.persisted.id}` : `/api/admin/discovery/${data.persisted.id}`;
      const patch: Record<string, unknown> = isEvent
        ? {
            title,
            description: description || null,
            artists: artists.split(",").map((s) => s.trim()).filter(Boolean),
            primaryGenre: genre || undefined,
            officialEventUrl: officialEventUrlTrimmed || null,
            ticketUrl: ticketUrlTrimmed || null,
            residentAdvisorUrl: residentAdvisorUrlTrimmed || null,
          }
        : {
            probableTitle: title,
            description: description || null,
            probableVenueName: venueNameText || null,
            detectedLineup: artists.split(",").map((s) => s.trim()).filter(Boolean),
            predictedGenre: genre || null,
            probableOfficialEventUrl: officialEventUrlTrimmed || null,
            probableTicketUrl: ticketUrlTrimmed || null,
            probableResidentAdvisorUrl: residentAdvisorUrlTrimmed || null,
            probableFree: free,
          };
      if (startLocal) patch[isEvent ? "startDatetime" : "probableStart"] = isEvent ? new Date(startLocal).toISOString() : new Date(startLocal).toISOString();
      if (endLocal) patch[isEvent ? "endDatetime" : "probableEnd"] = new Date(endLocal).toISOString();
      if (!isEvent) patch.probableFree = free;

      const res = await fetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(json.error ?? "Save failed.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setSaveError("Network error.");
    } finally {
      setSaveBusy(false);
    }
  }

  const category = data?.category;
  const handoffHref = data && data.persisted.kind === "discovery" && category ? `/admin?tab=${category}#dq-${data.persisted.id}` : null;

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a venue, promoter, RA or Facebook event URL…"
          className="min-w-[18rem] flex-1 rounded border border-border-strong bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded border border-accent bg-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50"
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-status-bad">{error}</p>}

      {data && (
        <div className="mt-4 rounded border border-border-strong bg-surface-1 p-4">
          <p className="text-sm font-semibold text-text-primary">{data.raw.title || "(no title found)"}</p>
          <div className="mt-2 border-t border-border pt-2">
            <CheckRow label="Title" ok={!!data.raw.title} />
            <CheckRow label="Date" ok={!!data.raw.startDatetime} note={!data.raw.startDatetime ? "not found in page metadata — fill in below" : undefined} />
            <CheckRow label="Venue" ok={data.result.resolvedVenueId ? true : "unknown"} note={!data.result.resolvedVenueId ? "not detected — enter it below" : undefined} />
            <CheckRow label="Lineup" ok={data.result.normalizedArtists.length > 0 ? true : "unknown"} note={data.result.normalizedArtists.length === 0 ? "none detected" : data.result.normalizedArtists.join(", ")} />
            <CheckRow label="Genre" ok={data.result.genre ? true : "unknown"} note={data.result.genre ? `${data.result.genre} (${data.result.genreConfidence} confidence)` : "not determined"} />
            <CheckRow
              label="Duplicate check (canonical events)"
              ok={true}
              note={data.result.duplicateOfEventId ? `possible match: ${data.result.duplicateOfEventId} (${data.result.duplicateConfidence})` : "no likely duplicate found"}
            />
          </div>

          {data.duplicateDiscoveryQueueId && (
            <p className="mt-2 rounded border border-status-warn/50 bg-status-warn/10 px-2 py-1 text-xs font-semibold text-status-warn">
              ⚠ This looks like it may already be a pending Discovery Queue candidate (
              <a href={`/admin#dq-${data.duplicateDiscoveryQueueId}`} className="underline decoration-dotted underline-offset-2">
                {data.duplicateDiscoveryQueueId}
              </a>
              ) — check it before publishing this one as a separate event. Not auto-merged; review both and decide.
            </p>
          )}

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Gate decision: <span className="text-text-secondary">{data.result.decision.replace("_", " ")}</span>
          </p>

          {data.persisted.kind === "event" ? (
            <p className="mt-3 text-xs text-accent-strong">
              Published directly (high confidence, complete record) —{" "}
              <Link href={`/events/${data.persisted.id}`} className="underline">view on the site</Link>.
            </p>
          ) : (
            <p className="mt-3 text-xs text-text-secondary">
              Saved to:{" "}
              <span className="font-semibold text-text-primary">{category ? ADMIN_QUEUE_CATEGORY_LABELS[category] : "Discovery Queue"}</span>
              {" — "}
              this is a real database row (item <code className="text-text-tertiary">{data.persisted.id}</code>); reloading the page will not lose it.
              {handoffHref && (
                <>
                  {" "}
                  <a href={handoffHref} className="font-semibold text-accent-strong underline decoration-dotted underline-offset-2">
                    Open in {category ? ADMIN_QUEUE_CATEGORY_LABELS[category] : "Discovery Queue"} →
                  </a>
                </>
              )}
            </p>
          )}

          {/* Editable draft (unified event create/edit model, 2026-09-08,
              Section 4): the admin corrects/completes fields right here,
              against the exact row Analyze just persisted — never a
              separate "go find it and edit it elsewhere" step. */}
          <div className="mt-4 space-y-2 rounded border border-border-strong p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Review &amp; correct before publishing</p>
            <EventFieldEditorTop
              idPrefix="analyze"
              title={title}
              onTitleChange={setTitle}
              description={description}
              onDescriptionChange={setDescription}
              startLocal={startLocal}
              onStartLocalChange={setStartLocal}
              endLocal={endLocal}
              onEndLocalChange={setEndLocal}
            />
            <div>
              <label htmlFor="analyze-venue-name" className="block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Venue name (free text)</label>
              <input
                id="analyze-venue-name"
                value={venueNameText}
                onChange={(e) => setVenueNameText(e.target.value)}
                disabled={data.persisted.kind === "event"}
                className="mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary disabled:opacity-50"
              />
              {data.persisted.kind === "event" && (
                <p className="mt-1 text-[11px] text-text-tertiary">Already published with a resolved venue — correct the venue via &ldquo;All events&rdquo; below if needed.</p>
              )}
            </div>
            <EventFieldEditorBottom
              idPrefix="analyze"
              mode="draft"
              genre={genre}
              onGenreChange={setGenre}
              allowUnresolvedGenre
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
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={saveBusy}
                onClick={handleSaveCorrections}
                className="rounded border border-accent bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50"
              >
                Save corrections
              </button>
              {saved && <span className="text-[11px] text-accent-strong">Saved.</span>}
            </div>
            {saveError && <p className="text-xs text-status-bad">{saveError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
