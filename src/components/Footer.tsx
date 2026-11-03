import Link from "next/link";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";
import { INDEXABLE_GENRE_PAGES, genrePagePath, getGenre } from "@/lib/taxonomy";
import FooterBackToTopButton from "./FooterBackToTopButton";

// Outline glyphs in the same 20×20 / 1.5-stroke style as the site's other
// inline icons (e.g. VenueAddressLink's MapPinIcon), so they read as quiet
// footer furniture rather than brand-coloured badges.
function InstagramIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="4" />
      <circle cx="10" cy="10" r="3.25" />
      <circle cx="14.1" cy="5.9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M12.5 6.75h-1a1.75 1.75 0 0 0-1.75 1.75v8.75M7.75 10.75h4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Electronic CPH's official social profiles, as provided by the site owner
// (2026-10-25). Permanent profile URLs without tracking parameters — the
// Facebook page has no vanity username, so its numeric profile.php URL is used.
export const SOCIAL_LINKS = [
  { name: "Instagram", href: "https://www.instagram.com/electronic_cph/", Icon: InstagramIcon },
  { name: "Facebook", href: "https://www.facebook.com/profile.php?id=61593650797017", Icon: FacebookIcon },
] as const;

const LINK = "inline-block py-1 hover:text-text-primary";

// Footer redesign (2026-11-03): three columns on desktop (identity · primary
// links · information links + social), stacked on mobile with both link groups
// in fixed two-column grids. The back-to-top button is absolutely placed in the
// top-right corner, and the content next to it reserves room for it (pr-16 on
// the identity block, lg:pr-20 on the desktop grid), so it never overlaps text.
export default function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="relative mx-auto max-w-6xl px-4 py-10 text-sm text-text-secondary sm:px-6 lg:py-14">
        <FooterBackToTopButton className="absolute right-4 top-10 sm:right-6 lg:top-14" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-0 lg:pr-20">
          <div className="min-h-12 pr-16 lg:pr-10">
            <p className="text-base font-semibold text-text-primary lg:text-lg">Electronic CPH</p>
            <p className="mt-2 max-w-xs text-text-tertiary">
              An independent index of electronic music events in Copenhagen.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="border-b border-border-strong pb-6 lg:border-b-0 lg:border-l lg:px-10 lg:pb-0"
          >
            {/* Column-major 2×3 grid: the three site sections down the first
                column, the approved genre landing pages (taxonomy.ts
                allowlist) down the second; no other genre gets a link here. */}
            <ul className="grid grid-flow-col grid-cols-2 grid-rows-3 gap-x-6 gap-y-2">
              <li><Link href="/" className={LINK}>Events</Link></li>
              <li><Link href="/venues" className={LINK}>Venues</Link></li>
              <li><Link href="/festivals" className={LINK}>Festivals</Link></li>
              {INDEXABLE_GENRE_PAGES.map((slug) => (
                <li key={slug}>
                  <Link href={genrePagePath(slug)!} className={LINK}>
                    {getGenre(slug).label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-col gap-8 lg:gap-5 lg:border-l lg:border-border-strong lg:pl-10">
            <nav aria-label="Footer information">
              <ul className="grid grid-cols-2 gap-x-6 gap-y-2 lg:grid-cols-1 lg:gap-y-1">
                <li><Link href="/about" className={LINK}>About</Link></li>
                {/* Links back to the homepage signup section (there is no
                    separate footer form — one signup surface, not two; see
                    NewsletterSignupForm's own doc comment) so the feature
                    stays reachable from every page, not just the homepage. */}
                {isNewsletterEnabled() && (
                  <li><Link href="/#newsletter-email" className={LINK}>Newsletter</Link></li>
                )}
                <li><Link href="/suggest-event" className={LINK}>Suggest an event</Link></li>
                <li><Link href="/contact" className={LINK}>Contact</Link></li>
                <li><Link href="/privacy" className={LINK}>Privacy</Link></li>
              </ul>
            </nav>
            <ul aria-label="Electronic CPH on social media" className="-mx-2 flex items-center gap-2">
              {SOCIAL_LINKS.map(({ name, href, Icon }) => (
                <li key={name}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Electronic CPH on ${name} (opens in a new tab)`}
                    title={name}
                    className="flex h-10 w-10 items-center justify-center rounded hover:text-text-primary"
                  >
                    <Icon />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
