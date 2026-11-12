"use client";

import { useEffect, useState } from "react";

// Site-wide floating "Back to top" control, mounted once in the root layout so
// it appears on every page (restored as a floating button, 2026-11-12, after
// the 2026-11-03 footer redesign had moved it into the footer, where it was
// only reachable at the very end of a page).
//
// Shown once the page has scrolled past roughly the header + H1 block
// (~160-190px across widths), so it appears right when the top of the page
// has gone out of view (calibration from the 2026-09-12 Production fix).
export const BACK_TO_TOP_THRESHOLD = 240;

export default function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > BACK_TO_TOP_THRESHOLD);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function handleClick() {
    // Smooth scroll to the top, also dropping any #hash so the URL doesn't
    // keep pointing at a section the reader just left.
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  if (!visible) return null;

  // Mobile bottom offset ~5rem: iOS Safari reserves a strip along the bottom
  // of the viewport to reveal its auto-hidden toolbar, and a fixed control
  // inside that strip can have its first tap stolen by the browser chrome.
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Back to top"
      title="Back to top"
      className="fixed bottom-[max(5rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-accent-dim/60 bg-surface-accent/95 text-text-primary shadow-lg backdrop-blur transition-colors hover:text-accent-strong focus-visible:text-accent-strong sm:bottom-6 sm:right-6"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M8 12.5V3.5M4 7.5 8 3.5l4 4" />
      </svg>
    </button>
  );
}
