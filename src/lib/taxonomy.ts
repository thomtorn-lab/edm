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

export interface GenreGroupDef {
  slug: GenreGroupSlug;
  label: string;
}

export const GENRE_GROUPS: GenreGroupDef[] = [
  { slug: "techno", label: "Techno" },
  { slug: "house", label: "House" },
  { slug: "trance", label: "Trance" },
  { slug: "bass", label: "Bass" },
  { slug: "hard-dance", label: "Hard Dance" },
  { slug: "other", label: "Other" },
];

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
 * User-facing filter taxonomy: a fixed, deliberately small set of 12
 * categories so the genre filter never fragments into dozens of options.
 * The finer-grained GenreSlug values above still exist as classification
 * metadata (and still drive the specific labels shown on event rows/cards)
 * but always roll up into exactly one of these for filtering purposes.
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
}

export const MAIN_GENRES: MainGenreDef[] = [
  { slug: "techno", label: "Techno" },
  { slug: "hard-techno", label: "Hard Techno" },
  { slug: "house", label: "House" },
  { slug: "trance", label: "Trance" },
  { slug: "psytrance", label: "Psytrance" },
  { slug: "drum-and-bass", label: "Drum & Bass" },
  { slug: "garage-bass", label: "UK Garage / Bass Music" },
  { slug: "breaks", label: "Breaks" },
  { slug: "hardstyle-hardcore", label: "Hardstyle / Hardcore" },
  { slug: "disco", label: "Disco" },
  { slug: "electro", label: "Electro" },
  { slug: "ambient-experimental", label: "Ambient / Experimental" },
  { slug: "electronic-other", label: "Other" },
];

/** Every classification-level GenreSlug rolls up into exactly one MainGenreSlug. */
const GENRE_TO_MAIN: Record<GenreSlug, MainGenreSlug> = {
  techno: "techno",
  "melodic-techno": "techno",
  "minimal-techno": "techno",
  "hard-techno": "hard-techno",
  industrial: "hard-techno",
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
 * An event may carry several internal classifications, but the homepage only
 * ever shows the 1-2 most informative labels (spec section 9). The first
 * subgenre is treated as most specific/informative; a generic top-level tag
 * (e.g. "techno") is dropped if a more specific sibling from the same group
 * is already shown, to avoid "Electronic · Techno · Hard Techno" redundancy.
 */
export function displayGenres(subgenres: GenreSlug[], max = 2): GenreDef[] {
  const defs = subgenres.map(getGenre);
  const groupsShown = new Set<GenreGroupSlug>();
  const result: GenreDef[] = [];

  for (const def of defs) {
    if (result.length >= max) break;
    // Skip a bare group-level genre (e.g. "techno") once a more specific
    // sibling from the same group is already queued or present.
    const hasMoreSpecificSibling = defs.some(
      (d) => d !== def && d.group === def.group && d.slug !== def.slug,
    );
    if (isGroupHeadGenre(def.slug) && hasMoreSpecificSibling) continue;
    if (groupsShown.has(def.group) && !isCrossGroupWorthShowing(result)) continue;
    result.push(def);
    groupsShown.add(def.group);
  }

  if (result.length === 0 && defs.length > 0) return [defs[0]];
  return result;
}

function isGroupHeadGenre(slug: GenreSlug): boolean {
  return slug === "techno" || slug === "house" || slug === "trance";
}

function isCrossGroupWorthShowing(existing: GenreDef[]): boolean {
  // Allow a second label from the same group only if nothing has been shown yet.
  return existing.length === 0;
}
