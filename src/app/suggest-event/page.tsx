import type { Metadata } from "next";
import Link from "next/link";
import { mailtoHref } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Suggest an event",
  description: "Know a Copenhagen or Frederiksberg electronic music event that's missing? Suggest it for review.",
  alternates: { canonical: "/suggest-event" },
};

const SUGGEST_SUBJECT = "Event suggestion";
const SUGGEST_BODY = "Event:\nDate:\nVenue:\nLink (RA, tickets, official page, etc.):\n\nAnything else worth knowing:";

export default function SuggestEventPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Suggest an event
      </h1>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary">
        Know a night in Copenhagen or Frederiksberg that should be here? Email the essentials — event name, date,
        venue, and a link — and it goes into the review queue. Nothing gets published automatically: every
        suggestion is checked against an official or first-party source before it goes live.
      </p>

      <a
        href={mailtoHref({ subject: SUGGEST_SUBJECT, body: SUGGEST_BODY })}
        className="mt-6 inline-block rounded border border-accent bg-accent/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20"
      >
        Suggest an event ↗
      </a>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
