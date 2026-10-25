import Link from "next/link";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";

// Outline glyphs in the same 20×20 / 1.5-stroke style as the site's other
// inline icons (e.g. VenueAddressLink's MapPinIcon), so they read as quiet
// footer furniture rather than brand-coloured badges.
function InstagramIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="4" />
      <circle cx="10" cy="10" r="3.25" />
      <circle cx="14.1" cy="5.9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
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

export default function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Electronic CPH — an independent index of electronic music events in Copenhagen.</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            <Link href="/" className="hover:text-text-secondary">Events</Link>
            <Link href="/venues" className="hover:text-text-secondary">Venues</Link>
            <Link href="/festivals" className="hover:text-text-secondary">Festivals</Link>
            <Link href="/about" className="hover:text-text-secondary">About</Link>
            {/* Links back to the homepage signup section (there is no
                separate footer form — one signup surface, not two; see
                NewsletterSignupForm's own doc comment) so the feature stays
                reachable from every page, not just the homepage. */}
            {isNewsletterEnabled() && (
              <Link href="/#newsletter-email" className="hover:text-text-secondary">Newsletter</Link>
            )}
            <Link href="/suggest-event" className="hover:text-text-secondary">Suggest an event</Link>
            <Link href="/contact" className="hover:text-text-secondary">Contact</Link>
            <Link href="/privacy" className="hover:text-text-secondary">Privacy</Link>
          </nav>
          <ul aria-label="Electronic CPH on social media" className="-mx-1.5 -my-2 flex items-center gap-1">
            {SOCIAL_LINKS.map(({ name, href, Icon }) => (
              <li key={name}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Electronic CPH on ${name} (opens in a new tab)`}
                  title={name}
                  className="flex h-8 w-8 items-center justify-center rounded hover:text-text-secondary focus-visible:text-text-secondary"
                >
                  <Icon />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
