import type { Metadata } from "next";
import Link from "next/link";
import { SOURCES } from "@/lib/data/sources";

export const metadata: Metadata = {
  title: "About",
  description: "What Nattefrekvens is, what it covers, and how the listing stays up to date.",
  alternates: { canonical: "/about" },
};

const roleLabel: Record<string, string> = {
  discovery: "Discovery",
  ingestion: "Ingestion",
  verification: "Verification",
  link: "Link",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        About
      </h1>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-text-secondary">
        <p>
          Nattefrekvens is a fast, curated index of electronic music events in Copenhagen and Frederiksberg —
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
        How it stays up to date
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        Listings are built from a mix of official venue and promoter sources, ticketing platforms and
        specialist aggregators, each with a clearly defined role. Resident Advisor is treated as the primary
        benchmark for Copenhagen coverage; automated ingestion is limited to sources with a confirmed,
        permitted access method. Everything else feeds a manual or semi-automated discovery queue rather than
        publishing directly.
      </p>

      <div className="mt-4 overflow-x-auto rounded border border-border">
        <table className="w-full min-w-[560px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-text-tertiary">
              <th className="px-3 py-2 font-semibold uppercase tracking-wide">Source</th>
              <th className="px-3 py-2 font-semibold uppercase tracking-wide">Roles</th>
              <th className="px-3 py-2 font-semibold uppercase tracking-wide">Automated?</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((source) => (
              <tr key={source.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 text-text-primary">{source.sourceName}</td>
                <td className="px-3 py-2 text-text-secondary">{source.roles.map((r) => roleLabel[r]).join(", ")}</td>
                <td className="px-3 py-2 text-text-secondary">{source.adapter ? "Yes" : "No — manual/discovery only"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Spotted something wrong?
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        Dates, lineups and statuses change. If an event on this site is wrong, outdated or missing, the
        fastest fix is usually the venue or promoter&rsquo;s own page — linked from every event. This site
        aims to be a fast, honest index, not the source of truth.
      </p>

      <p className="mt-10 text-xs text-text-tertiary">
        <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
      </p>
    </div>
  );
}
