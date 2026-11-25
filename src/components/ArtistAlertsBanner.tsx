import Link from "next/link";

/**
 * Homepage-only entry point to Artist Alerts (2026-11-12). The whole banner
 * is one link to /artists; "Find artists" is part of it, not a button.
 *
 * Mobile (below md, 2026-11-25): "ARTIST ALERTS" above "Find artists to
 * follow and get event alerts.", with the arrow at the far right, centred on
 * both rows; same height as before (57.13px).
 *
 * Desktop (md+): unchanged since 2026-11-12 — one line, full-width band with
 * the content on the page's max-w-6xl column: label, explanation, "Find
 * artists →" at the right.
 */
export default function ArtistAlertsBanner() {
  return (
    <div className="px-4 pt-4 sm:px-6 md:px-0 md:pt-0">
      <Link
        href="/artists"
        className="block border border-border-strong bg-accent/10 transition-colors md:border-x-0 md:hover:bg-accent/15"
      >
        {/* Mobile layout (below md): heading, then the call to action as the
            explanation; the arrow sits at the far right, centred on both rows. */}
        <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2 md:hidden">
          <span className="font-display text-lg font-bold uppercase leading-none tracking-tight text-accent">Artist Alerts</span>
          <span aria-hidden="true" className="row-span-2 self-center text-base font-semibold leading-none text-accent">
            →
          </span>
          <span className="text-[11px] leading-snug text-text-secondary sm:text-xs">Find artists to follow and get event alerts.</span>
        </span>
        {/* Desktop layout (md+), exactly as before. */}
        <span className="mx-auto hidden max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 md:flex md:min-h-[50px] md:flex-nowrap md:gap-x-6 md:px-6 md:py-0">
          <span className="order-1 shrink-0 font-display text-lg font-bold uppercase leading-none tracking-tight text-accent">
            Artist Alerts
          </span>
          <span className="order-2 ml-auto shrink-0 text-xs font-semibold uppercase tracking-wide text-accent md:order-3">
            Find artists <span aria-hidden="true">→</span>
          </span>
          <span className="order-3 basis-full text-[11px] leading-snug text-text-secondary sm:text-xs md:text-sm md:order-2 md:flex-1 md:basis-auto">
            Get email alerts for new events with artists you follow.
          </span>
        </span>
      </Link>
    </div>
  );
}
