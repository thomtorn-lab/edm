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
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        About
      </h1>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-text-secondary">
        <p>
          Electronic CPH is a fast, curated index of electronic music events in Copenhagen —
          techno, house, trance, drum &amp; bass, garage, disco and everything adjacent. Nothing else.
        </p>
        <p>
          It exists so that on a Friday afternoon you can see what&rsquo;s worth going to tonight or this weekend
          in a few seconds, without wading through a general events marketplace. Every event links straight
          through to its official page, tickets, or Resident Advisor listing — the goal is to help you find
          the night out, not to keep you inside this site.
        </p>
        <p>
          Inclusion is deliberately narrow: an event is listed only when electronic music is central to its
          programming, verified against official or first-party sources. A DJ playing background music at a
          bar, or a generic &ldquo;party&rdquo; night, doesn&rsquo;t qualify.
        </p>
      </div>

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Spotted something wrong?
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        Dates, lineups and statuses change. If an event on this site is wrong or outdated, the fastest fix is
        usually the venue or promoter&rsquo;s own page — linked from every event. Missing something entirely?{" "}
        <Link href="/suggest-event" className="underline hover:text-text-secondary">Suggest an event</Link>. Anything
        else, <Link href="/contact" className="underline hover:text-text-secondary">get in touch</Link>. This site
        aims to be a fast, honest index, not the source of truth.
      </p>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
