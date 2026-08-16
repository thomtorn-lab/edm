import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Electronic CPH doesn't use cookies, analytics, or tracking of any kind.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Privacy
      </h1>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-text-secondary">
        <p>
          Electronic CPH doesn&rsquo;t use cookies, analytics, tracking pixels, or any comparable
          technology. Nothing about your visit is collected, stored, or shared — not with us, not
          with anyone else.
        </p>
        <p>
          The one exception: if you use{" "}
          <Link href="/contact" className="underline hover:text-text-primary">Contact</Link> or{" "}
          <Link href="/suggest-event" className="underline hover:text-text-primary">Suggest an event</Link>,
          what you type is sent by email for a person to read. It isn&rsquo;t stored in a database and isn&rsquo;t
          used for anything beyond replying to you or reviewing the suggestion.
        </p>
        <p>
          If that ever changes — if we add analytics or any other non-essential tracking — this page
          gets updated first, and we&rsquo;ll ask before anything runs.
        </p>
      </div>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
