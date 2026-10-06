import type { Metadata } from "next";
import Link from "next/link";
import { NEWSLETTER_CONSENT_PURPOSE } from "@/lib/newsletter/consent";

export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false },
};

/** Token-bearing page — never statically rendered/cached (GDPR final hardening round, 2026-10-06; mirrors newsletter/manage/page.tsx's identical setting). */
export const revalidate = 0;

function InvalidLinkView() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">
        Link not valid
      </h1>
      <p className="mt-3 text-sm text-text-secondary">
        This confirmation link is invalid or has already been used. If you still want to subscribe, you can sign up
        again from the homepage.
      </p>
      <p className="mt-6 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}

/**
 * GET-safe by design (GDPR consent-evidence integrity fix, 2026-10-06):
 * loading this page performs no write. Confirming only happens on an
 * explicit button submit, which POSTs to /api/newsletter/confirm — see that
 * route's own doc comment for why a write on plain GET is unsafe (automated
 * email-security-gateway link scanning/prefetching would otherwise confirm
 * subscriptions nobody actually clicked).
 */
export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; invalid?: string }>;
}) {
  const { token, invalid } = await searchParams;

  if (!token || invalid) {
    return <InvalidLinkView />;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">
        Confirm your subscription
      </h1>
      <p className="mt-3 text-sm text-text-secondary">{NEWSLETTER_CONSENT_PURPOSE}</p>
      <form method="POST" action="/api/newsletter/confirm" className="mt-6">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="rounded border border-accent bg-accent/10 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20"
        >
          Confirm subscription
        </button>
      </form>
    </div>
  );
}
