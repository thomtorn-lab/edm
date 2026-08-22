import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description: "What Electronic CPH is and what it covers.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">About</p>
      <h1 className="font-display mt-1 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        About
      </h1>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-text-secondary">
        <p>
          Electronic CPH is a fast, curated index of electronic music events and concerts in Copenhagen —
          techno, house, trance, drum &amp; bass, garage, disco and everything adjacent. Nothing else.
        </p>
        <p>
          It exists so that on a Friday afternoon you can see what&rsquo;s on tonight or this weekend in a few
          seconds, without wading through a general events marketplace. Every event links directly to the
          official event page, tickets or another relevant source — the goal is to help you find the event,
          not to keep you inside this site.
        </p>
        <p>
          Inclusion is deliberately narrow: electronic music must be central to the event itself. Dedicated
          electronic clubs qualify, as do concerts, promoter nights, warehouse events and other standalone
          events built around electronic artists or music. A DJ providing music as part of a regular bar or
          nightclub night does not.
        </p>
        <p>
          We use venue, promoter, ticketing and other trusted event sources to keep the calendar as complete
          and accurate as possible, but dates, lineups, venues and event statuses can change.
        </p>
      </div>

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Spotted something wrong?
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text-secondary">
        <p>
          Found incorrect or outdated information?{" "}
          <Link href="/contact" className="underline hover:text-text-secondary">Get in touch</Link>.
        </p>
        <p>
          Missing an event?{" "}
          <Link href="/suggest-event" className="underline hover:text-text-secondary">Suggest an event</Link>.
        </p>
        <p>
          Electronic CPH aims to provide the most useful overview possible, but it is not the official source
          for any event. Always check the linked event or ticket page for the latest information.
        </p>
      </div>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
