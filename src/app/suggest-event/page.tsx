import type { Metadata } from "next";
import Link from "next/link";
import SuggestEventForm from "./SuggestEventForm";

export const metadata: Metadata = {
  title: "Suggest an event",
  description: "Know a Copenhagen electronic music event that's missing? Suggest it for review.",
  alternates: { canonical: "/suggest-event" },
};

export default function SuggestEventPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Suggest an event
      </h1>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary">
        Know a night in Copenhagen that should be here? Send the essentials
        below and it goes into the review queue. Nothing gets published automatically: every
        suggestion is checked against an official or first-party source before it goes live.
      </p>

      <SuggestEventForm />

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
