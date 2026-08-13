"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FestivalRecord } from "@/lib/types";
import { getGenre, type GenreSlug } from "@/lib/taxonomy";

export default function FestivalExplorer({ festivals }: { festivals: FestivalRecord[] }) {
  const [country, setCountry] = useState<string>("all");
  const [month, setMonth] = useState<string>("all");
  const [genre, setGenre] = useState<GenreSlug | "all">("all");

  const countries = useMemo(
    () => Array.from(new Set(festivals.map((f) => f.country))).sort(),
    [festivals],
  );
  const months = useMemo(
    () => Array.from(new Set(festivals.map((f) => f.typicalMonth.split(" ")[0]))).sort(),
    [festivals],
  );
  const genres = useMemo(
    () => Array.from(new Set(festivals.flatMap((f) => f.genres))),
    [festivals],
  );

  const filtered = festivals.filter((f) => {
    if (country !== "all" && f.country !== country) return false;
    if (month !== "all" && !f.typicalMonth.startsWith(month)) return false;
    if (genre !== "all" && !f.genres.includes(genre)) return false;
    return true;
  });

  const hasActiveFilters = country !== "all" || month !== "all" || genre !== "all";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="rounded-full border border-border-strong bg-surface-1 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
        >
          <option value="all">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-full border border-border-strong bg-surface-1 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
        >
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value as GenreSlug | "all")}
          className="rounded-full border border-border-strong bg-surface-1 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
        >
          <option value="all">All genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>{getGenre(g).label}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => { setCountry("all"); setMonth("all"); setGenre("all"); }}
            className="text-[11px] font-medium uppercase tracking-wide text-accent hover:text-accent-strong"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-[11px] text-text-tertiary">{filtered.length} festivals</span>
      </div>

      <ul className="mt-6">
        {filtered.map((festival) => (
          <li key={festival.id} className="border-b border-border py-5">
            <Link href={`/festivals/${festival.slug}`} className="text-lg font-semibold text-text-primary hover:text-accent-strong">
              {festival.name}
            </Link>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-text-tertiary">
              {festival.location}, {festival.country} · {festival.currentDates ?? festival.typicalMonth}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{festival.description}</p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              {festival.genres.map((g) => (
                <span key={g} className="rounded-[3px] border border-border-strong px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  {getGenre(g).shortLabel}
                </span>
              ))}
            </p>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="py-12 text-sm text-text-secondary">No festivals match those filters.</li>
        )}
      </ul>
    </div>
  );
}
