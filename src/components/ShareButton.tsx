"use client";

import { useEffect, useId, useRef, useState } from "react";

function ShareIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <path d="M10 3v9" strokeLinecap="round" />
      <path d="M6.5 6.5 10 3l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 10v5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Share button (event detail page, 2026-09-13): native Web Share API first,
 * clipboard-copy fallback, and a manual-copy panel if clipboard access
 * itself fails. `title`/`url` are always what the server already computed
 * for this event (canonical `/events/[slug]` URL, cleaned display title) —
 * this component never reads window.location or any query/filter state
 * itself, so the shared link is always the clean canonical one regardless
 * of how the visitor arrived at the page.
 *
 * Payload is `{ title, url }` only — no `text` field. A share target that
 * unfurls the URL itself (e.g. Messages/SMS, which already renders a rich
 * preview card with the event title, electroniccph.com, and the preview
 * image) would otherwise show the same information twice; other targets
 * are left to decide how to present `title`/`url` in their own compose UI
 * (never a forced email subject, never a separate mailto flow). The
 * clipboard fallback is unaffected: it only ever copies the bare canonical
 * `url`.
 */
export default function ShareButton({ title, url, className = "" }: { title: string; url: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const dismissTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const manualInputId = useId();

  useEffect(() => {
    return () => {
      if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "manual") return;
    manualInputRef.current?.focus();
    manualInputRef.current?.select();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setStatus("idle");
    }
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setStatus("idle");
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [status]);

  async function handleClick() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch {
        // Cancelled, or the share sheet failed for any other reason: the
        // native UI already communicated whatever happened, so we show
        // nothing here. A resolved share() isn't proof the user actually
        // completed a share either, so success gets no message of its own.
      }
      return;
    }

    if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      dismissTimer.current = window.setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("manual");
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button type="button" onClick={handleClick} aria-label={`Share ${title}`} className={className}>
        <ShareIcon />
        {/* Icon-only on mobile, text label restored at sm: (mobile action-row
            polish, 2026-09-26) — this span was already aria-hidden (the
            button's own aria-label is the real accessible name), so hiding
            it visually below sm: is presentation-only and never affects
            screen-reader behavior or share functionality. */}
        <span aria-hidden="true" className="hidden sm:inline">Share</span>
      </button>

      {status === "copied" && (
        <span
          role="status"
          aria-live="polite"
          className="absolute inset-x-0 top-full mt-1 whitespace-nowrap text-center text-[11px] font-medium normal-case text-text-tertiary"
        >
          Link copied
        </span>
      )}

      {status === "manual" && (
        <div className="absolute z-10 mt-2 w-64 rounded border border-border-strong bg-surface-2 p-3 normal-case shadow-lg">
          <label htmlFor={manualInputId} className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            Copy event link
          </label>
          <input
            id={manualInputId}
            ref={manualInputRef}
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded border border-border-strong bg-surface-1 px-2 py-1.5 text-xs text-text-primary"
          />
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="mt-2 text-[11px] font-medium text-text-tertiary hover:text-text-primary"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
