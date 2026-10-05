import Link from "next/link";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";

export default function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Electronic CPH — an independent index of electronic music events in Copenhagen.</p>
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
      </div>
    </footer>
  );
}
