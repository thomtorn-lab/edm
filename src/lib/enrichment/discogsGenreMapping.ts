import type { GenreSlug } from "../taxonomy";
import type { DiscogsReleaseGenreData } from "./discogsClient";

/**
 * Discogs `style` values come from Discogs' own controlled vocabulary (not
 * free text), so exact (normalized) string matching is the right tool here
 * — unlike deterministicGenreMapping.ts's word-boundary regex over prose
 * bios, which is a different problem. Deliberately conservative: only
 * styles this list is confident correspond 1:1 to one of our GenreSlugs are
 * included. An unrecognized style contributes nothing rather than a guess.
 */
function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Deliberately NOT mapped: "Hard House" -> "house". A real Discogs result
// (Kyle Starkey, "Electronic / Hard House") currently falls through to
// electronic-other instead of a specific house subgenre, which was reviewed
// and is the correct, taxonomy-consistent behavior, not a gap: this same
// taxonomy already keeps "hard-techno" as its own GenreSlug distinct from
// plain "techno" (see taxonomy.ts and deterministicGenreMapping.ts), so a
// "hard" variant is established precedent as NOT folded into its base
// genre here. Folding "Hard House" into "house" would break that
// consistency, and no "hard-house" slug exists in the taxonomy — adding one
// is out of scope for this MVP. electronic-other (confirmed electronic, no
// specific matching subgenre) is the correct fallback.
const STYLE_TO_GENRE_SLUG_RAW: Record<string, GenreSlug> = {
  techno: "techno",
  "hard techno": "hard-techno",
  industrial: "industrial",
  "melodic techno": "melodic-techno",
  minimal: "minimal-techno",
  "minimal techno": "minimal-techno",
  house: "house",
  "deep house": "deep-house",
  "tech house": "tech-house",
  "progressive house": "progressive-house",
  "afro house": "afro-house",
  trance: "trance",
  "psy-trance": "psytrance",
  psytrance: "psytrance",
  "psychedelic trance": "psytrance",
  "drum n bass": "drum-and-bass",
  "drum & bass": "drum-and-bass",
  "drum and bass": "drum-and-bass",
  dnb: "drum-and-bass",
  garage: "garage",
  "uk garage": "garage",
  electro: "electro",
  disco: "disco",
  ambient: "ambient-experimental",
  experimental: "ambient-experimental",
};

const STYLE_TO_GENRE_SLUG: Record<string, GenreSlug> = Object.fromEntries(
  Object.entries(STYLE_TO_GENRE_SLUG_RAW).map(([k, v]) => [normalizeToken(k), v]),
);

export interface DiscogsGenreAggregation {
  /** Resolved genre, or null if no confident single answer (see below). */
  genre: GenreSlug | null;
  /** Whether at least one examined release confirms this is Electronic music at all. */
  confirmedElectronic: boolean;
  /** The raw Discogs style strings that contributed to `genre` (evidence, for persistence). */
  matchedStyles: string[];
  /** True when releases mapped to more than one distinct GenreSlug — genre withheld on purpose. */
  conflicting: boolean;
}

/**
 * Aggregates genre evidence across a handful of an artist's Discogs
 * releases (task 9 requirement: "if evidence is ambiguous or multi-genre,
 * do not force a single genre"). Resolution order:
 *   1. every mapped style agrees on one GenreSlug -> that genre
 *   2. mapped styles disagree -> null, conflicting: true (never guess)
 *   3. no style mapped, but a release's genre field includes "Electronic"
 *      -> electronic-other (confirmed relevant, no specific subgenre — the
 *      "clearly justified" case for that fallback)
 *   4. nothing confirms this is even electronic music -> null
 */
export function mapDiscogsEvidenceToGenre(releases: DiscogsReleaseGenreData[]): DiscogsGenreAggregation {
  const confirmedElectronic = releases.some((r) => r.genres.some((g) => normalizeToken(g) === "electronic"));

  const matchedSlugs = new Set<GenreSlug>();
  const matchedStyles: string[] = [];
  for (const release of releases) {
    for (const style of release.styles) {
      const slug = STYLE_TO_GENRE_SLUG[normalizeToken(style)];
      if (slug) {
        matchedSlugs.add(slug);
        matchedStyles.push(style);
      }
    }
  }

  if (matchedSlugs.size > 1) {
    return { genre: null, confirmedElectronic, matchedStyles, conflicting: true };
  }
  if (matchedSlugs.size === 1) {
    return { genre: [...matchedSlugs][0], confirmedElectronic, matchedStyles, conflicting: false };
  }
  if (confirmedElectronic) {
    return { genre: "electronic-other", confirmedElectronic, matchedStyles, conflicting: false };
  }
  return { genre: null, confirmedElectronic, matchedStyles, conflicting: false };
}
