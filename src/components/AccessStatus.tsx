"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * The one access status an event row shows instead of Tickets: SOLD OUT,
 * FREE or FREE BEFORE (see EventRow for the priority). All three share the
 * SOLD OUT badge's look. FREE BEFORE is a button whose time ("Free entry
 * before 23:00") shows on hover and keyboard focus, and on tap. It is
 * information, never a link.
 */
export type AccessStatusValue = { kind: "sold-out" } | { kind: "free" } | { kind: "free-before"; time: string };

const LABEL = { "sold-out": "Sold out", free: "Free", "free-before": "Free before" } as const;

export default function AccessStatus({ status, badgeClassName }: { status: AccessStatusValue; badgeClassName: string }) {
  if (status.kind !== "free-before") return <span className={badgeClassName}>{LABEL[status.kind]}</span>;
  return <FreeBeforeStatus time={status.time} badgeClassName={badgeClassName} />;
}

function FreeBeforeStatus({ time, badgeClassName }: { time: string; badgeClassName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={ref} className="group/free relative inline-flex">
      <button
        type="button"
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${badgeClassName} cursor-help`}
      >
        {LABEL["free-before"]}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={
          "absolute left-0 top-full z-20 mt-1.5 whitespace-nowrap rounded border border-border-strong bg-surface-2 px-2 py-1 text-xs font-medium normal-case tracking-normal text-text-primary shadow-lg " +
          (open ? "block" : "hidden group-hover/free:block group-focus-within/free:block")
        }
      >
        Free entry before {time}
      </span>
    </span>
  );
}
