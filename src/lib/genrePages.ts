import { getGenre, subgenresOf, type IndexableGenre } from "./taxonomy";

/**
 * Editorial copy for the allowlisted genre landing pages (taxonomy.ts
 * INDEXABLE_GENRE_PAGES). Keyed by the existing genre ids — not a separate
 * SEO taxonomy: which events a page lists always comes from the shared
 * genre hierarchy (matchesGenreSelection), and the "includes …" sentence is
 * generated from it (genrePageIncludedLabels), so the copy can't drift from
 * the filter. The Record type makes a missing entry for an allowlisted
 * genre a type error.
 */
export interface GenrePageContent {
  /** Visible page heading. */
  h1: string;
  /** Full <title>, brand included (rendered as an absolute title). */
  seoTitle: string;
  /** Meta description — ≤160 characters. */
  description: string;
  /** Short editorial introduction, one entry per paragraph. */
  intro: string[];
  /** Lower-case noun phrase used in the list heading and empty state ("techno events"). */
  eventsNoun: string;
}

export const GENRE_PAGE_CONTENT: Record<IndexableGenre, GenrePageContent> = {
  techno: {
    h1: "Techno Events in Copenhagen",
    seoTitle: "Techno Events in Copenhagen | Electronic CPH",
    description:
      "Upcoming techno events in Copenhagen: club nights and concerts tagged techno or a techno subgenre, listed by date.",
    intro: [
      "Copenhagen's techno nights in one list, from long hypnotic sets and minimal grooves to hard and industrial techno, at clubs, warehouses and concert venues across the city.",
    ],
    eventsNoun: "techno events",
  },
  house: {
    h1: "House Music Events in Copenhagen",
    seoTitle: "House Music Events in Copenhagen | Electronic CPH",
    description:
      "Upcoming house music events in Copenhagen: club nights and parties tagged house, deep house, tech house, progressive house or afro house, by date.",
    intro: [
      "House music in Copenhagen, from deep and soulful sets to tech house and afro house, at clubs, bars and open-air parties across the city.",
    ],
    eventsNoun: "house events",
  },
  trance: {
    h1: "Trance Events in Copenhagen",
    seoTitle: "Trance & Psytrance Events in Copenhagen | Electronic CPH",
    description:
      "Upcoming trance and psytrance events in Copenhagen: club nights, raves and parties for melodic, uplifting and psychedelic trance, listed by date.",
    intro: [
      "Trance and psytrance events in Copenhagen, from melodic club nights to driving, psychedelic dancefloors.",
    ],
    eventsNoun: "trance events",
  },
};

/** "Techno, Hard Techno, …, or Minimal Techno" — the genre and its subgenres, straight from the taxonomy. */
export function genrePageIncludedLabels(genre: IndexableGenre): string {
  const labels = [genre, ...subgenresOf(genre)].map((slug) => getGenre(slug).label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : labels[0];
}
