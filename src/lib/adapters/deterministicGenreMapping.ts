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
  [/\btrance\b/i, "trance"],
  [/\bd\s?&\s?b\b|drum\s?(and|&)\s?bass\b|\bdnb\b/i, "drum-and-bass"],
  [/\bgarage\b/i, "garage"],
  [/\belectro\b/i, "electro"],
  [/\bdisco\b/i, "disco"],
  [/\bambient\b|\bexperimental\b/i, "ambient-experimental"],
];

/** Returns the first matching genre from title + description text, or null if nothing matches. */
export function deterministicGenreFromText(text: string): GenreSlug | null {
  for (const [pattern, genre] of KEYWORD_MAP) {
    if (pattern.test(text)) return genre;
  }
  return null;
}
