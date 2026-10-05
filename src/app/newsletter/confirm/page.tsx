import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { confirmSubscriberByToken } from "@/db/newsletter";

export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false },
};

/**
 * Server Component, not a route handler: confirming is a one-time
 * side-effecting action best performed on page load (the link a subscriber
 * actually clicks) rather than exposed as a plain API endpoint a crawler
 * or email-client link-prefetcher could trigger unintentionally the way a
 * GET API route risks. On success, redirects straight into the genre
 * preferences page (product requirement 14: "genre preferences after
 * confirmation") — there is no separate "you're confirmed!" interstitial.
 */
export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token ? await confirmSubscriberByToken(token) : null;

  if (!result) {
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

  redirect(`/newsletter/manage?token=${result.manageToken}&justConfirmed=1`);
}
