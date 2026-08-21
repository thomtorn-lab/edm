import type { GenreSlug } from "../taxonomy";

/**
 * Deterministic keyword mapping — evidence tier 5 in the genre evidence
 * order (spec section 10). Only consulted when no official metadata,
 * official description, or venue/promoter/lineup metadata is available.
 * Intentionally narrow: it is a fallback, not a title-guessing engine.
 */
const KEYWORD_MAP: [RegExp, GenreSlug][] = [
  [/\bhard\s?techno\b/i, "hard-techno"],
  [/\bindustrial\b/i, "industrial"],
  [/\bmelodic\s?techno\b/i, "melodic-techno"],
  [/\bminimal\s?techno\b/i, "minimal-techno"],
  [/\btechno\b/i, "techno"],
  [/\bdeep\s?house\b/i, "deep-house"],
  [/\btech\s?house\b/i, "tech-house"],
  [/\bprogressive\s?house\b/i, "progressive-house"],
  [/\bafro\s?house\b/i, "afro-house"],
  [/\bhouse\b/i, "house"],
  [/\bpsytrance\b/i, "psytrance"],
  [/\bpsy\b/i, "psytrance"],
  [/\btrance\b/i, "trance"],
  [/\bd\s?&\s?b\b|drum\s?(and|&)\s?bass\b|\bdnb\b/i, "drum-and-bass"],
  [/\bgarage\b/i, "garage"],
  [/\belectro\b/i, "electro"],
  [/\bdisco\b/i, "disco"],
  // "ambient" is a specific, low-ambiguity music-genre word on its own, so it
  // still matches bare. "experimental" is not: it's heavily overloaded across
  // arts, theatre, cuisine and general writing (e.g. a bio describing a
  // "blend of trap, rock, pop and experimental elements" is a genre-crossing
  // pop/trap act, not electronic music). Electronic CPH's inclusion rule
  // requires electronic music to be CENTRAL to an event — a generic word must
  // never establish that on its own — so "experimental" only counts as
  // ambient-experimental evidence when it appears near an explicit
  // electronic-music word in the same text (e.g. "experimental electronic
  // music", "electronic, ambient and experimental soundscapes").
  [/\bambient\b/i, "ambient-experimental"],
  [/\belectronica?\b[\s\S]{0,60}\bexperimental\b|\bexperimental\b[\s\S]{0,60}\belectronica?\b/i, "ambient-experimental"],
];

/** Returns the first matching genre from title + description text, or null if nothing matches. */
export function deterministicGenreFromText(text: string): GenreSlug | null {
  for (const [pattern, genre] of KEYWORD_MAP) {
    if (pattern.test(text)) return genre;
  }
  return null;
}

/**
 * Refines an already-resolved genre to a more specific sibling within the
 * SAME family when the event's own first-party text corroborates it (genre
 * precision, Workstream B: "distinguish Trance vs Psytrance where evidence
 * supports it"). An official categorical source (a ticketing platform's
 * subcategory, a venue's broad genre tag) is real evidence of the genre
 * FAMILY, but a specific keyword in the venue/promoter's own text about THIS
 * exact event is stronger, more precise evidence — e.g. a platform tagging
 * an event generically "trance" while its own description says "psytrance"
 * should surface as Psytrance, not the broader Trance. Deliberately narrow
 * and never artist-specific: only ever moves within one declared family, to
 * one of a fixed set of siblings, driven purely by genre-keyword text
 * evidence — never crosses into an unrelated genre and never fires when the
 * genre is already maximally specific (no entry below).
 */
const GENRE_REFINEMENTS: Partial<Record<GenreSlug, [RegExp, GenreSlug][]>> = {
  trance: [
    [/\bpsytrance\b/i, "psytrance"],
    [/\bpsy\b/i, "psytrance"],
  ],
  techno: [
    [/\bhard\s?techno\b/i, "hard-techno"],
    [/\bindustrial\b/i, "industrial"],
    [/\bmelodic\s?techno\b/i, "melodic-techno"],
    [/\bminimal\s?techno\b/i, "minimal-techno"],
  ],
  house: [
    [/\bdeep\s?house\b/i, "deep-house"],
    [/\btech\s?house\b/i, "tech-house"],
    [/\bprogressive\s?house\b/i, "progressive-house"],
    [/\bafro\s?house\b/i, "afro-house"],
  ],
};

export function refineGenreFromText(genre: GenreSlug, text: string): GenreSlug {
  const refinements = GENRE_REFINEMENTS[genre];
  if (!refinements) return genre;
  for (const [pattern, refined] of refinements) {
    if (pattern.test(text)) return refined;
  }
  return genre;
}
