"use client";

// The footer's own "Back to top" control (footer redesign, 2026-11-03). It
// mirrors the floating button on the homepage (EventExplorer's
// handleBackToTop): a smooth scroll to the top that also drops any #hash, so
// the URL doesn't keep pointing at a section the reader just left. Unlike that
// floating button it sits in the footer's normal layout, so it is always
// available at the end of every page and never floats over content.
export default function FooterBackToTopButton({ className = "" }: { className?: string }) {
  function handleClick() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Back to top"
      title="Back to top"
      className={`flex h-12 w-12 items-center justify-center rounded-full border border-accent-dim/60 bg-surface-accent text-text-primary transition-colors hover:text-accent-strong focus-visible:text-accent-strong ${className}`}
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
