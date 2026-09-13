"use client";

import { useMemo, useState } from "react";
import type { FestivalRecord } from "@/lib/types";
import { getGenre, type GenreSlug } from "@/lib/taxonomy";
import { formatFestivalEdition } from "@/lib/festivalEdition";

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

  const filtered = festivals
    .filter((f) => {
      if (country !== "all" && f.country !== country) return false;
      if (month !== "all" && !f.typicalMonth.startsWith(month)) return false;
      if (genre !== "all" && !f.genres.includes(genre)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  const hasActiveFilters = country !== "all" || month !== "all" || genre !== "all";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {/* text-base (16px) on mobile, not text-xs (12px): iOS Safari
            auto-zooms the viewport on focus for any select below 16px. No
            sm:hidden split exists here (unlike EventExplorer's mobile/
            desktop pair), so the same element is bumped to 16px and reset
            back to text-xs at sm+ — leading-4 pins the line-height to
            text-xs's own default (1rem) so the control's height stays
            identical at every breakpoint; only the font-size crosses the
            16px threshold on mobile.
            Mobile visual-weight refinement (2026-09-13): the 16px-safe
            mobile text reads heavier than the old 12px chip, so font-
            weight/letter-spacing/horizontal padding are each nudged down
            ONE step on mobile only (font-medium, tracking-normal, px-2.5),
            restored to their original desktop values at sm+ (font-
            semibold, tracking-wide, px-3) — the exact same base+sm:
            override pattern as the font-size fix above.
            Final mobile compactness polish (2026-09-13, follow-up): still
            felt a little large/heavy at py-1.5 + border-border-strong, so
            the border switches to the dimmer --border token on mobile only,
            restored to its original desktop value at sm+
            (sm:border-border-strong) — same base+sm: pattern throughout.
            Final review adjustment (2026-09-13): vertical padding stays at
            py-1.5 on mobile (never dropped to py-1) — 26px total height was
            technically above the WCAG 2.2 AA 24px minimum but still felt
            unnecessarily cramped for a mobile select's touch target; the
            lighter visual weight comes entirely from the border, font-
            weight, tracking, and horizontal-padding levers above. Mobile
            height: 6px+6px padding + 16px line-height (leading-4) + 1px+1px
            border = 30px (still well short of any accidental shrink toward
            the 16px iOS-zoom threshold, which only concerns font-size, left
            untouched). */}
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="rounded-full border border-border bg-surface-1 px-2.5 py-1.5 sm:border-border-strong sm:px-3 sm:py-1.5 text-base leading-4 sm:text-xs font-medium sm:font-semibold uppercase tracking-normal sm:tracking-wide text-text-secondary hover:text-text-primary"
        >
          <option value="all">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-full border border-border bg-surface-1 px-2.5 py-1.5 sm:border-border-strong sm:px-3 sm:py-1.5 text-base leading-4 sm:text-xs font-medium sm:font-semibold uppercase tracking-normal sm:tracking-wide text-text-secondary hover:text-text-primary"
        >
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value as GenreSlug | "all")}
          className="rounded-full border border-border bg-surface-1 px-2.5 py-1.5 sm:border-border-strong sm:px-3 sm:py-1.5 text-base leading-4 sm:text-xs font-medium sm:font-semibold uppercase tracking-normal sm:tracking-wide text-text-secondary hover:text-text-primary"
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
            {festival.officialUrl ? (
              <a
                href={festival.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-semibold text-text-primary hover:text-accent-strong"
              >
                {festival.name} ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-lg font-semibold text-text-primary">{festival.name}</span>
            )}
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-text-tertiary">
              {festival.location}, {festival.country} · {formatFestivalEdition(festival.edition)}
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
