"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * The one access status an event row shows: SOLD OUT, FREE or FREE BEFORE
 * (see EventRow for the priority). All three share SOLD OUT's badge. FREE
 * BEFORE is a button whose time ("Free entry before 23:00") shows on hover
 * and keyboard focus, and on tap. It is information, never a link.
 */
export type AccessStatusValue = { kind: "sold-out" } | { kind: "free" } | { kind: "free-before"; time: string };

const LABEL = { "sold-out": "Sold out", free: "Free", "free-before": "Free before" } as const;

export default function AccessStatus({
  status,
  badgeClassName,
  align = "left",
}: {
  status: AccessStatusValue;
  badgeClassName: string;
  /** Which edge the time tooltip lines up with (right for a badge at the right edge of the screen). */
  align?: "left" | "right";
}) {
  if (status.kind !== "free-before") return <span className={badgeClassName}>{LABEL[status.kind]}</span>;
  return (
    <Tooltip tip={`Free entry before ${status.time}`} buttonClassName={`${badgeClassName} cursor-help`} align={align}>
      {LABEL["free-before"]}
    </Tooltip>
  );
}

/**
 * A button with a small tooltip: shown on hover and keyboard focus, toggled
 * by tap/click, closed by a tap outside or Escape. No dependencies.
 * `anchored="parent"` positions the tooltip against the nearest positioned
 * ancestor instead of the button (e.g. a whole heading), so a long tip
 * lines up with it and stays inside its panel.
 */
export function Tooltip({
  children,
  tip,
  buttonClassName,
  ariaLabel,
  align = "left",
  anchored = "self",
  tipClassName = "whitespace-nowrap",
}: {
  children: ReactNode;
  tip: string;
  buttonClassName: string;
  ariaLabel?: string;
  align?: "left" | "right";
  anchored?: "self" | "parent";
  tipClassName?: string;
}) {
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
    <span ref={ref} className={`group/tip inline-flex ${anchored === "self" ? "relative" : ""}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
      >
        {children}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={
          `absolute top-full z-30 mt-1.5 rounded border border-border-strong bg-surface-2 px-2 py-1 text-left font-sans text-xs font-medium normal-case leading-snug tracking-normal text-text-primary shadow-lg ${align === "right" ? "right-0" : "left-0"} ${tipClassName} ` +
          (open ? "block" : "hidden group-hover/tip:block group-focus-within/tip:block")
        }
      >
        {tip}
      </span>
    </span>
  );
}
