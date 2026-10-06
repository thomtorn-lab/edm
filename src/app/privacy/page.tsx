import type { Metadata } from "next";
import Link from "next/link";
import { isNewsletterEnabled } from "@/lib/newsletter/featureFlag";

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
          Electronic CPH is the data controller for the personal data described on this page. For any
          privacy question or to exercise any of the rights below, use{" "}
          <Link href="/contact" className="underline hover:text-text-primary">Contact</Link>.
        </p>
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
        {isNewsletterEnabled() && (
          <p>
            If you sign up for the weekly newsletter, we store your email address and, if you choose, your genre
            preferences — nothing else, and we don&rsquo;t collect your IP address or any other identifier for this
            purpose. The legal basis for this is your consent, given by confirming via a link we email you (so
            nobody can sign up an address that isn&rsquo;t theirs) — you can withdraw it at any time via the
            one-click unsubscribe link in every newsletter. Unsubscribing deletes your email address and
            preferences immediately; we don&rsquo;t keep a copy. We don&rsquo;t use open or click tracking in
            newsletter emails. Sending is handled by Resend (resend.com), acting as our processor for this purpose
            only. We keep a short record of each week&rsquo;s send (which address, which content) for up to 30
            days to debug delivery problems, then delete it automatically; an unconfirmed signup that&rsquo;s
            never clicked its confirmation link is also deleted automatically after 30 days.
          </p>
        )}
        <p>
          If that ever changes — if we add any other non-essential tracking that requires consent — this
          page gets updated first, and we&rsquo;ll ask for your consent before it&rsquo;s activated.
        </p>
      </div>

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Where data is processed
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          This site, and any data described above, is hosted and processed by Vercel (hosting) and our
          database provider, and — for the newsletter only — Resend. If any of these process data outside
          the EU/EEA, we rely on their own standard safeguards for that transfer (such as the EU Standard
          Contractual Clauses); we haven&rsquo;t independently verified each provider&rsquo;s current region
          or transfer mechanism beyond what they publish.
        </p>
      </div>

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Your rights
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          You have the right to access, correct, or erase your personal data, to restrict or object to its
          processing, and — where processing is based on consent — to withdraw that consent at any time
          (the newsletter&rsquo;s unsubscribe link does this immediately for that data). Use{" "}
          <Link href="/contact" className="underline hover:text-text-primary">Contact</Link> for any of these
          requests. You also have the right to lodge a complaint with the Danish Data Protection Agency
          (Datatilsynet).
        </p>
      </div>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
