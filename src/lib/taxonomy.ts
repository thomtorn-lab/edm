/**
 * Controlled subgenre taxonomy. Editable in one place — the rest of the app
 * (filters, event rows, admin classification) reads from here rather than
 * hardcoding genre strings.
 */

export type GenreSlug =
  | "techno"
  | "hard-techno"
  | "industrial"
  | "melodic-techno"
  | "minimal-techno"
  | "house"
  | "deep-house"
  | "tech-house"
  | "progressive-house"
  | "afro-house"
  | "trance"
  | "psytrance"
  | "drum-and-bass"
  | "dubstep"
  | "garage"
  | "hardstyle"
  | "rawstyle"
  | "hardcore"
  | "electro"
  | "disco"
  | "ambient-experimental"
  | "electronic-other";

export interface GenreDef {
  slug: GenreSlug;
  label: string;
  /** Short label used in dense UI (event rows, filter chips). */
  shortLabel: string;
  group: GenreGroupSlug;
}

export type GenreGroupSlug = "techno" | "house" | "trance" | "bass" | "hard-dance" | "other";

export const GENRES: GenreDef[] = [
  { slug: "techno", label: "Techno", shortLabel: "Techno", group: "techno" },
  { slug: "hard-techno", label: "Hard Techno", shortLabel: "Hard Techno", group: "techno" },
  { slug: "industrial", label: "Industrial", shortLabel: "Industrial", group: "techno" },
  { slug: "melodic-techno", label: "Melodic Techno", shortLabel: "Melodic Techno", group: "techno" },
  { slug: "minimal-techno", label: "Minimal Techno", shortLabel: "Minimal Techno", group: "techno" },

  { slug: "house", label: "House", shortLabel: "House", group: "house" },
  { slug: "deep-house", label: "Deep House", shortLabel: "Deep House", group: "house" },
  { slug: "tech-house", label: "Tech House", shortLabel: "Tech House", group: "house" },
  { slug: "progressive-house", label: "Progressive House", shortLabel: "Progressive House", group: "house" },
  { slug: "afro-house", label: "Afro House", shortLabel: "Afro House", group: "house" },

  { slug: "trance", label: "Trance", shortLabel: "Trance", group: "trance" },
  { slug: "psytrance", label: "Psytrance", shortLabel: "Psytrance", group: "trance" },

  { slug: "drum-and-bass", label: "Drum & Bass", shortLabel: "Drum & Bass", group: "bass" },
  { slug: "dubstep", label: "Dubstep", shortLabel: "Dubstep", group: "bass" },
  { slug: "garage", label: "Garage", shortLabel: "Garage", group: "bass" },

  { slug: "hardstyle", label: "Hardstyle", shortLabel: "Hardstyle", group: "hard-dance" },
  { slug: "rawstyle", label: "Rawstyle", shortLabel: "Rawstyle", group: "hard-dance" },
  { slug: "hardcore", label: "Hardcore", shortLabel: "Hardcore", group: "hard-dance" },

  { slug: "electro", label: "Electro", shortLabel: "Electro", group: "other" },
  { slug: "disco", label: "Disco", shortLabel: "Disco", group: "other" },
  { slug: "ambient-experimental", label: "Ambient / Experimental", shortLabel: "Ambient", group: "other" },
  { slug: "electronic-other", label: "Electronic / Other", shortLabel: "Electronic", group: "other" },
];

const GENRE_BY_SLUG = new Map(GENRES.map((g) => [g.slug, g]));

export function getGenre(slug: GenreSlug): GenreDef {
  const g = GENRE_BY_SLUG.get(slug);
  if (!g) throw new Error(`Unknown genre slug: ${slug}`);
  return g;
}

/**
 * Approved public genre GROUPING taxonomy (Electronic CPH data-quality work
 * package, Workstream B): a fixed set of 13 broad categories, used for the
 * genre FILTER (EventExplorer.tsx) and for filter-inheritance — a specific
 * subgenre like "melodic-techno" is discoverable both under its own exact
 * label (search — see search.ts) and under its broader group ("Techno" in
 * the filter dropdown), via mainGenreOf/GENRE_TO_MAIN below.
 *
 * This grouping is NOT used for the public-facing genre badge (see
 * displayGenres below) — that always shows the precise admin-selected/
 * classified genre (e.g. "Melodic Techno", "Deep House", "Industrial")
 * verbatim, never its broader umbrella (genre/subgenre taxonomy + display
 * integrity audit, 2026-09-11: an earlier version of this file rolled the
 * public badge up into these 13 groups too, which silently overwrote a more
 * precise admin selection — "Deep House" displayed as "House", "Melodic
 * Techno" and "Industrial" both displayed as "Techno" — the broader group
 * must never overwrite the more specific one for DISPLAY, only inform
 * filtering).
 */
export type MainGenreSlug =
  | "techno"
  | "hard-techno"
  | "house"
  | "trance"
  | "psytrance"
  | "drum-and-bass"
  | "garage-bass"
  | "breaks"
  | "hardstyle-hardcore"
  | "disco"
  | "electro"
  | "ambient-experimental"
  | "electronic-other";

export interface MainGenreDef {
  slug: MainGenreSlug;
  label: string;
  /** Short label used in dense UI (event rows, filter chips). */
  shortLabel: string;
}

export const MAIN_GENRES: MainGenreDef[] = [
  { slug: "techno", label: "Techno", shortLabel: "Techno" },
  { slug: "hard-techno", label: "Hard Techno", shortLabel: "Hard Techno" },
  { slug: "house", label: "House", shortLabel: "House" },
  { slug: "trance", label: "Trance", shortLabel: "Trance" },
  { slug: "psytrance", label: "Psytrance", shortLabel: "Psytrance" },
  { slug: "drum-and-bass", label: "Drum & Bass", shortLabel: "Drum & Bass" },
  { slug: "garage-bass", label: "UK Garage / Bass Music", shortLabel: "Garage / Bass" },
  { slug: "breaks", label: "Breaks", shortLabel: "Breaks" },
  { slug: "hardstyle-hardcore", label: "Hardstyle / Hardcore", shortLabel: "Hardstyle / Hardcore" },
  { slug: "disco", label: "Disco", shortLabel: "Disco" },
  { slug: "electro", label: "Electro", shortLabel: "Electro" },
  { slug: "ambient-experimental", label: "Ambient / Experimental", shortLabel: "Ambient" },
  { slug: "electronic-other", label: "Other", shortLabel: "Other" },
];

const MAIN_GENRE_BY_SLUG = new Map(MAIN_GENRES.map((g) => [g.slug, g]));

export function getMainGenre(slug: MainGenreSlug): MainGenreDef {
  const g = MAIN_GENRE_BY_SLUG.get(slug);
  if (!g) throw new Error(`Unknown main genre slug: ${slug}`);
  return g;
}

/**
 * Every classification-level GenreSlug rolls up into exactly one
 * MainGenreSlug — the single source of truth for the genre FILTER's parent
 * grouping (EventExplorer.tsx: selecting "Techno" also matches events tagged
 * "melodic-techno", "industrial", etc). This mapping no longer feeds the
 * public genre badge — see displayGenres below, which shows the precise
 * slug's own label instead.
 *
 * `industrial` groups under "techno", not "hard-techno" (data-quality fix,
 * Workstream B): Techno is the meaningful FILTER umbrella for
 * industrial-techno-leaning events (e.g. Intercell) — Industrial is not
 * itself one of the 13 approved filter groups, and grouping it under the
 * narrower "Hard Techno" bucket overstated a harder/harsher sound than the
 * event's own evidence supports. Hard Techno remains its own bucket for
 * events explicitly classified "hard-techno". (This only affects which
 * broad filter an Industrial event surfaces under — its own display badge
 * always reads "Industrial", never "Techno" or "Hard Techno".)
 */
const GENRE_TO_MAIN: Record<GenreSlug, MainGenreSlug> = {
  techno: "techno",
  "melodic-techno": "techno",
  "minimal-techno": "techno",
  "hard-techno": "hard-techno",
  industrial: "techno",
  house: "house",
  "deep-house": "house",
  "tech-house": "house",
  "progressive-house": "house",
  "afro-house": "house",
  trance: "trance",
  psytrance: "psytrance",
  "drum-and-bass": "drum-and-bass",
  dubstep: "garage-bass",
  garage: "garage-bass",
  hardstyle: "hardstyle-hardcore",
  rawstyle: "hardstyle-hardcore",
  hardcore: "hardstyle-hardcore",
  disco: "disco",
  electro: "electro",
  "ambient-experimental": "ambient-experimental",
  "electronic-other": "electronic-other",
};

export function mainGenreOf(slug: GenreSlug): MainGenreSlug {
  return GENRE_TO_MAIN[slug];
}

/**
 * Public-facing genre badge(s) for an event (genre/subgenre taxonomy +
 * display integrity audit, 2026-09-11). Shows the exact genre(s) an admin
 * selected or the classification pipeline resolved, verbatim — "Deep
 * House" displays as "Deep House", "Melodic Techno" as "Melodic Techno",
 * "Industrial" as "Industrial". The broader filter grouping (mainGenreOf/
 * GENRE_TO_MAIN/MAIN_GENRES) is deliberately NOT applied here; that mapping
 * exists only so the genre FILTER can match a specific subgenre under its
 * broader category (see EventExplorer.tsx) — it must never overwrite the
 * more precise genre for display. (This function previously rolled every
 * subgenre up to one of 13 approved umbrella categories for display —
 * "Workstream B" — which silently discarded a more specific admin
 * selection; that rollup now happens only for the filter, not the badge.)
 * Deduplicates by the underlying slug, so a `subgenres` array containing
 * the same slug twice is never shown twice; caps at `max` entries.
 */
export function displayGenres(subgenres: GenreSlug[], max = 2): GenreDef[] {
  const seen = new Set<GenreSlug>();
  const result: GenreDef[] = [];

  for (const slug of subgenres) {
    if (result.length >= max) break;
    if (seen.has(slug)) continue;
    seen.add(slug);
    result.push(getGenre(slug));
  }

  return result;
}
