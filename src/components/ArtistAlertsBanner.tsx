import Link from "next/link";

/**
 * Homepage-only entry point to Artist Alerts (2026-11-12; layout 2026-11-25).
 * The whole banner is one link to /artists. Two rows on every width: the
 * heading row ("ARTIST ALERTS · Find Artists" on md+, "ARTIST ALERTS" alone
 * on smaller screens) with the arrow at the far right, then the explanation.
 * The banner keeps its previous height: 50px inside on md+ (18px heading +
 * 4px + 16px explanation line + 2×6px padding), unchanged on mobile.
 */
export default function ArtistAlertsBanner() {
  return (
    <div className="px-4 pt-4 sm:px-6 md:px-0 md:pt-0">
      <Link
        href="/artists"
        className="block border border-border-strong bg-accent/10 transition-colors md:border-x-0 md:hover:bg-accent/15"
      >
        <span className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2 md:min-h-[50px] md:gap-y-1 md:px-6 md:py-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-display text-lg font-bold uppercase leading-none tracking-tight text-accent">
              Artist Alerts
            </span>
            <span aria-hidden="true" className="hidden text-sm leading-none text-text-tertiary md:inline">
              ·
            </span>
            <span className="hidden text-sm font-medium leading-none text-accent md:inline">Find Artists</span>
          </span>
          <span aria-hidden="true" className="text-xs font-semibold leading-none text-accent md:text-sm">
            →
          </span>
          <span className="col-span-2 text-[11px] leading-snug text-text-secondary sm:text-xs md:text-sm md:leading-4">
            Get email alerts for new events with artists you follow.
          </span>
        </span>
      </Link>
    </div>
  );
}
