import Link from "next/link";

/**
 * Homepage-only entry point to Artist Alerts (2026-11-12). The whole banner
 * is one link to /artists; "Find artists →" is part of it, not a button.
 * Desktop (md+): one line, full-width band with the content on the page's
 * max-w-6xl column. Mobile: inset to the hero's margins, two rows (label +
 * CTA, then the explanation); on very narrow screens the CTA may wrap.
 */
export default function ArtistAlertsBanner() {
  return (
    <div className="px-4 pt-4 sm:px-6 md:px-0 md:pt-0">
      <Link
        href="/artists"
        className="block border border-border-strong bg-accent/10 transition-colors md:border-x-0 md:hover:bg-accent/15"
      >
        <span className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2 md:min-h-[50px] md:flex-nowrap md:items-center md:gap-x-6 md:px-6 md:py-0">
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
