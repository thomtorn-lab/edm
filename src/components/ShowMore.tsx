"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/**
 * Discreet "Show more / Show less" for a long About text (2026-10-24). The
 * folded part is always server-rendered into the HTML (only marked
 * `hidden`), so search engines and in-page search see the whole text; this
 * component only toggles its visibility. Folding back scrolls the toggle
 * into view, so the reader isn't left far below the shortened text.
 * `inline`: preview and rest are parts of one paragraph (rendered inside
 * its <p>), so the folded part is a <span> and the paragraph stays whole.
 */
export default function ShowMore({ preview, rest, inline = false }: { preview: ReactNode; rest: ReactNode; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toggle = (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls={id}
      onClick={() => {
        setOpen((o) => !o);
        if (open) requestAnimationFrame(() => buttonRef.current?.scrollIntoView({ block: "nearest" }));
      }}
      className="mt-1 inline-flex min-h-[2.75rem] items-center text-xs font-semibold uppercase tracking-wide text-text-secondary-strong underline decoration-border-strong decoration-1 underline-offset-4 transition-colors hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
    >
      {open ? "Show less" : "Show more"}
    </button>
  );
  return (
    <>
      {preview}
      {inline ? (
        <span id={id} hidden={!open}>
          {rest}
        </span>
      ) : (
        <div id={id} hidden={!open}>
          {rest}
        </div>
      )}
      {inline ? <span className="block">{toggle}</span> : toggle}
    </>
  );
}
