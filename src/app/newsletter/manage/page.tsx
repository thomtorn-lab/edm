import type { Metadata } from "next";
import Link from "next/link";
import { getSubscriberByManageToken } from "@/db/newsletter";
import NewsletterPreferencesForm from "@/components/NewsletterPreferencesForm";

export const metadata: Metadata = {
  title: "Newsletter preferences",
  robots: { index: false },
};

export const revalidate = 0;

export default async function NewsletterManagePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; justConfirmed?: string }>;
}) {
  const { token, justConfirmed } = await searchParams;
  const subscriber = token ? await getSubscriberByManageToken(token) : null;

  if (!subscriber) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6 text-center">
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">
          Link not valid
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          This preferences link is invalid. If you&rsquo;re subscribed, use the manage-preferences link in the most
          recent newsletter email.
        </p>
        <p className="mt-6 text-xs text-text-tertiary">
          <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">
        {justConfirmed === "1" ? "Subscribed" : "Newsletter preferences"}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        {justConfirmed === "1"
          ? "You're confirmed. Choose which genres to hear about below, or leave everything unchecked for all events."
          : "Choose which genres to hear about, or leave everything unchecked for all events."}
      </p>
      <NewsletterPreferencesForm token={token as string} initialGenres={subscriber.genres} />
    </div>
  );
}
