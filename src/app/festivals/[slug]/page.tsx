import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FESTIVALS, getFestivalBySlug } from "@/lib/data/festivals";
import { getGenre } from "@/lib/taxonomy";

export function generateStaticParams() {
  return FESTIVALS.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: PageProps<"/festivals/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const festival = getFestivalBySlug(slug);
  if (!festival) return {};
  return {
    title: festival.name,
    description: `${festival.name} — ${festival.location}, ${festival.country}. ${festival.description}`,
    alternates: { canonical: `/festivals/${festival.slug}` },
  };
}

export default async function FestivalDetailPage({ params }: PageProps<"/festivals/[slug]">) {
  const { slug } = await params;
  const festival = getFestivalBySlug(slug);
  if (!festival) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/festivals" className="text-xs font-medium uppercase tracking-wide text-text-tertiary hover:text-text-secondary">
        ← All festivals
      </Link>

      <h1 className="font-display mt-3 text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-5xl">
        {festival.name}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">{festival.location}, {festival.country}</p>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-y border-border py-6 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">When</dt>
          <dd className="mt-1 text-sm text-text-primary">{festival.currentDates ?? `Typically ${festival.typicalMonth}`}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Genres</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1.5">
            {festival.genres.map((g) => (
              <span key={g} className="rounded-[3px] border border-border-strong px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
                {getGenre(g).label}
              </span>
            ))}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-sm leading-relaxed text-text-secondary">{festival.description}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href={festival.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-accent bg-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20"
        >
          Official site ↗
        </a>
        {festival.ticketUrl && (
          <a
            href={festival.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border-strong px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:border-accent-dim hover:text-text-primary"
          >
            Tickets ↗
          </a>
        )}
      </div>

      <p className="mt-10 text-xs text-text-tertiary">
        Dates change year to year — always confirm on the official site before booking travel.
      </p>
    </div>
  );
}
