"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type MouseEvent } from "react";

/** How long the underline stays visible after a click, even when the page swaps instantly. */
const CLICK_FEEDBACK_MS = 400;

/**
 * Click feedback for header links (2026-11-15). Rendered *inside* a
 * next/link <Link>: a thin accent underline, visible while `active` (set on
 * click by NavLink below) or while that link's navigation is pending, so
 * every header link confirms a click — fast (prefetched/static) and slow
 * (per-request) pages alike. Shows instantly, no pulse; absolutely
 * positioned so it never shifts layout.
 */
export default function NavPendingHint({ active = false }: { active?: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={active || pending ? "true" : undefined}
      className="nav-pending-hint pointer-events-none absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-accent"
    />
  );
}

/**
 * Header <Link> with click feedback: a plain left-click shows the underline
 * immediately for CLICK_FEEDBACK_MS (and longer while the navigation is still
 * pending). Modified clicks (new tab/window) get no feedback, since the
 * current page doesn't navigate. Navigation itself is untouched — this only
 * observes the click.
 */
export function NavLink({ children, onClick, ...props }: ComponentProps<typeof Link>) {
  const [clicked, setClicked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    clearTimeout(timer.current);
    setClicked(true);
    timer.current = setTimeout(() => setClicked(false), CLICK_FEEDBACK_MS);
  }

  return (
    <Link {...props} onClick={handleClick}>
      {children}
      <NavPendingHint active={clicked} />
    </Link>
  );
}
