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
 * Approved public genre taxonomy (Electronic CPH data-quality work package,
 * Workstream B): a fixed set of 13 categories, used for BOTH the genre
 * filter AND the single public-facing genre badge shown on every event card
 * and detail page (see displayGenres below). The finer-grained GenreSlug
 * values above still exist as classification metadata — an event's stored
 * `subgenres` can be as specific as "melodic-techno" or "progressive-house"
 * — but every public-facing primary genre always rolls up into exactly one
 * of these 13. A niche internal slug is never shown to the public under its
 * own specific label (e.g. "Industrial") when it has a more meaningful
 * approved umbrella (e.g. "Techno") — see mainGenreOf/GENRE_TO_MAIN.
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
 * MainGenreSlug — this is the single source of truth for both genre
 * filtering (EventExplorer.tsx) and the public genre badge (displayGenres
 * below), so the two can never disagree about which approved category an
 * event belongs to.
 *
 * `industrial` rolls up to "techno", not "hard-techno" (data-quality fix,
 * Workstream B): Techno is the meaningful public umbrella for
 * industrial-techno-leaning events (e.g. Intercell) — Industrial is not
 * itself one of the 13 approved public categories, and defaulting it to the
 * narrower "Hard Techno" bucket overstated a harder/harsher sound than the
 * event's own evidence supports. Hard Techno remains its own bucket for
 * events explicitly classified "hard-techno".
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
 * Public-facing genre badge(s) for an event (Electronic CPH data-quality
 * work package, Workstream B). Every badge shown to the public is one of the
 * 13 approved MainGenreSlug categories — an internal niche slug (e.g.
 * "melodic-techno", "progressive-house", "industrial") is never rendered
 * under its own specific label; it always rolls up through mainGenreOf/
 * GENRE_TO_MAIN to its approved umbrella ("Techno", "House", "Techno"
 * respectively). Internal `subgenres` metadata stays as rich as
 * classification evidence supports (still visible to admins via
 * getGenre/GENRES directly) — this function is only the public rollup.
 * Deduplicates by approved category so two internal subgenres that share an
 * umbrella (e.g. ["industrial", "melodic-techno"], both -> Techno) are never
 * shown twice.
 */
export function displayGenres(subgenres: GenreSlug[], max = 2): MainGenreDef[] {
  const seen = new Set<MainGenreSlug>();
  const result: MainGenreDef[] = [];

  for (const slug of subgenres) {
    if (result.length >= max) break;
    const mainSlug = mainGenreOf(slug);
    if (seen.has(mainSlug)) continue;
    seen.add(mainSlug);
    result.push(getMainGenre(mainSlug));
  }

  return result;
}
