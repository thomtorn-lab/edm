"use client";

import { useEffect, useRef, useState } from "react";
import { googleCalendarUrl, icsDataUrl, outlookCalendarUrl, type CalendarEventInput } from "@/lib/ics";

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M6.5 2.5v3M13.5 2.5v3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Compact "Add to calendar" action reused on every listing row and the
 * event detail page. One responsive DOM structure: the options panel is a
 * full-width bottom sheet below `sm`, and a small anchored dropdown at
 * `sm` and up — no separate mobile/desktop components to keep in sync.
 */
export default function AddToCalendar({
  event,
  filename,
  label = "Add to calendar",
  compact = false,
}: {
  event: CalendarEventInput;
  filename: string;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
        className="inline-flex min-h-[2rem] items-center gap-1.5 rounded border border-border-strong px-2 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:border-accent-dim hover:text-text-primary"
      >
        <CalendarIcon />
        <span className={compact ? "hidden" : "hidden sm:inline"}>{label}</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-bg/60 sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            aria-label={label}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl border-t border-border bg-surface-2 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg sm:absolute sm:inset-auto sm:bottom-auto sm:end-0 sm:top-full sm:mt-1 sm:w-52 sm:rounded sm:border sm:p-1.5 sm:pb-1.5 sm:shadow-xl"
          >
            <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary sm:hidden">
              {label}
            </p>
            <a
              role="menuitem"
              href={googleCalendarUrl(event)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2.5 text-sm text-text-primary hover:bg-surface-3"
            >
              Google Calendar
            </a>
            <a
              role="menuitem"
              href={outlookCalendarUrl(event)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2.5 text-sm text-text-primary hover:bg-surface-3"
            >
              Outlook
            </a>
            <a
              role="menuitem"
              href={icsDataUrl(event)}
              download={filename}
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2.5 text-sm text-text-primary hover:bg-surface-3"
            >
              Apple Calendar / ICS
            </a>
          </div>
        </>
      )}
    </div>
  );
}
