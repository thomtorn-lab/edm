"use client";

import { useState } from "react";
import { MAIN_GENRES, type MainGenreSlug } from "@/lib/taxonomy";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type UnsubscribeStatus = "idle" | "unsubscribing" | "done" | "error";

const checkboxLabelClasses = "flex items-center gap-2 text-sm text-text-primary";
const errorClasses = "mt-2 text-xs text-status-bad";

export default function NewsletterPreferencesForm({
  token,
  initialGenres,
}: {
  token: string;
  initialGenres: MainGenreSlug[];
}) {
  const [selected, setSelected] = useState<Set<MainGenreSlug>>(new Set(initialGenres));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [unsubscribeStatus, setUnsubscribeStatus] = useState<UnsubscribeStatus>("idle");

  function toggleGenre(slug: MainGenreSlug) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setSaveStatus("idle");
  }

  async function handleSave() {
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/newsletter/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, genres: Array.from(selected) }),
      });
      const data: unknown = await res.json().catch(() => null);
      const ok = res.ok && !!data && typeof data === "object" && (data as { ok?: unknown }).ok === true;
      setSaveStatus(ok ? "saved" : "error");
    } catch {
      setSaveStatus("error");
    }
  }

  async function handleUnsubscribe() {
    if (unsubscribeStatus === "unsubscribing") return;
    setUnsubscribeStatus("unsubscribing");
    try {
      const res = await fetch(`/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
      setUnsubscribeStatus(res.ok ? "done" : "error");
    } catch {
      setUnsubscribeStatus("error");
    }
  }

  if (unsubscribeStatus === "done") {
    return (
      <div role="status" className="mt-6 rounded border border-border-strong px-4 py-3 text-sm text-text-primary">
        You&rsquo;ve been unsubscribed. You won&rsquo;t receive any more newsletter emails.
      </div>
    );
  }

  return (
    <div className="mt-6">
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Genres</legend>
        {MAIN_GENRES.map((genre) => (
          <label key={genre.slug} className={checkboxLabelClasses}>
            <input
              type="checkbox"
              checked={selected.has(genre.slug)}
              onChange={() => toggleGenre(genre.slug)}
              className="h-4 w-4 accent-accent"
            />
            {genre.label}
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        onClick={handleSave}
        disabled={saveStatus === "saving"}
        className="mt-5 rounded border border-accent bg-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50"
      >
        {saveStatus === "saving" ? "Saving…" : "Save preferences"}
      </button>
      {saveStatus === "saved" && (
        <p role="status" className="mt-2 text-xs text-text-secondary">Saved.</p>
      )}
      {saveStatus === "error" && <p role="alert" className={errorClasses}>Couldn&rsquo;t save. Please try again.</p>}

      <div className="mt-8 border-t border-border pt-5">
        <button
          type="button"
          onClick={handleUnsubscribe}
          disabled={unsubscribeStatus === "unsubscribing"}
          className="text-xs font-semibold uppercase tracking-wide text-text-tertiary underline hover:text-text-secondary disabled:opacity-50"
        >
          {unsubscribeStatus === "unsubscribing" ? "Unsubscribing…" : "Unsubscribe"}
        </button>
        {unsubscribeStatus === "error" && <p role="alert" className={errorClasses}>Couldn&rsquo;t unsubscribe. Please try again.</p>}
      </div>
    </div>
  );
}
