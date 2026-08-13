"use client";

import { useState } from "react";
import type { RawCandidateEvent } from "@/lib/adapters/types";
import type { PipelineResult } from "@/lib/adapters/pipeline";

interface ExtractResponse {
  raw: RawCandidateEvent;
  result: PipelineResult;
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

export default function AddEventFromUrl() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractResponse | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    setActionMessage(null);
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
      }
    } catch {
      setError("Could not reach the extraction service.");
    } finally {
      setLoading(false);
    }
  }

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
            <CheckRow label="Date" ok={!!data.raw.startDatetime} note={!data.raw.startDatetime ? "not found in page metadata — needs manual entry" : undefined} />
            <CheckRow label="Venue" ok={data.result.resolvedVenueId ? true : "unknown"} note={!data.result.resolvedVenueId ? "not detected — needs manual entry" : undefined} />
            <CheckRow label="Lineup" ok={data.result.normalizedArtists.length > 0 ? true : "unknown"} note={data.result.normalizedArtists.length === 0 ? "none detected" : data.result.normalizedArtists.join(", ")} />
            <CheckRow label="Genre" ok={data.result.genre ? true : "unknown"} note={data.result.genre ? `${data.result.genre} (${data.result.genreConfidence} confidence)` : "not determined"} />
            <CheckRow
              label="Duplicate check"
              ok={true}
              note={data.result.duplicateOfEventId ? `possible match: ${data.result.duplicateOfEventId} (${data.result.duplicateConfidence})` : "no likely duplicate found"}
            />
          </div>

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Gate decision: <span className="text-text-secondary">{data.result.decision.replace("_", " ")}</span>
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {(["Publish", "Edit", "Ignore", "Merge"] as const).map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => setActionMessage(`${action} recorded (preview build — not wired to a live database).`)}
                className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary"
              >
                {action}
              </button>
            ))}
          </div>
          {actionMessage && <p className="mt-2 text-xs text-text-tertiary">{actionMessage}</p>}
        </div>
      )}
    </div>
  );
}
