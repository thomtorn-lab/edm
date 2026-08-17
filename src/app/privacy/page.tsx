import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Electronic CPH uses privacy-friendly, cookieless analytics and no other tracking.",
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
          Electronic CPH uses Vercel Web Analytics to see how many people visit and which pages are popular.
          It&rsquo;s privacy-friendly and cookieless — it doesn&rsquo;t set cookies, doesn&rsquo;t use any
          persistent identifier, and doesn&rsquo;t track you across sites or build a profile of you. Beyond
          this, we don&rsquo;t use any other analytics, tracking pixels, or comparable tracking technology.
        </p>
        <p>
          We may also use technically necessary technologies where required for the site to run or to keep
          it secure — for example, if a hosting or security provider needs something in place to serve the
          page reliably or block abuse. These aren&rsquo;t used to track you, build a profile, or serve ads,
          and don&rsquo;t require consent under applicable law.
        </p>
        <p>
          The one exception on the content side: if you use{" "}
          <Link href="/contact" className="underline hover:text-text-primary">Contact</Link> or{" "}
          <Link href="/suggest-event" className="underline hover:text-text-primary">Suggest an event</Link>,
          what you type is sent by email for a person to read. It isn&rsquo;t stored in a database and isn&rsquo;t
          used for anything beyond replying to you or reviewing the suggestion.
        </p>
        <p>
          If that ever changes — if we add any other non-essential tracking that requires consent — this
          page gets updated first, and we&rsquo;ll ask for your consent before it&rsquo;s activated.
        </p>
      </div>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
