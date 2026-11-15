"use client";

import { useLinkStatus } from "next/link";

/**
 * Click feedback for header links (2026-11-15). Rendered *inside* a
 * next/link <Link>; while that link's navigation is pending it shows a thin
 * pulsing accent underline, so a click on a route that takes a moment to
 * render (the per-request homepage in particular) visibly registers.
 *
 * The underline only fades in after a short delay (see .nav-pending-hint in
 * globals.css), so instant navigations (prefetched/static pages) never
 * flicker.
 */
export default function NavPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending ? "true" : undefined}
      className="nav-pending-hint pointer-events-none absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-accent"
    />
  );
}
