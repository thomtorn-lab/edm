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
  // No trailing \b: a real published event ("Origin Of Trance - 30 Years of
  // ETNICA") described itself as "psytrancefest"/"psytrancescene" — compound
  // forms with no space, which \bpsytrance\b previously missed (no word
  // boundary between "trance" and "fest"/"scene"), silently falling through
  // to the broader bare-"trance" match instead (QA audit, 2026-08-29). The
  // leading \b alone is still enough to avoid matching "psytrance" as a
  // substring of an unrelated longer word — there is no real such word.
  [/\bpsytrance/i, "psytrance"],
  [/\bpsy\b/i, "psytrance"],
  // Excludes "trance-inducing"/"trance-like"/"trance-inspired" and similar
  // hyphenated adjectival uses, and "trance state"/"trance-like state" —
  // real evidence found live in ALICE's own copy: "trance-inducing
  // rhythms" describing a Moroccan blues act's hypnotic quality, and
  // separately "a captivating trance state that awakens the senses"
  // describing an ambient-electronica/electroacoustic artist (Laryssa
  // Kim) — neither is the electronic genre Trance. Bare "trance" and
  // "trance music"/"a night of trance" still match unconditionally.
  [/\btrance\b(?!-\w)(?!\s+state\b)/i, "trance"],
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

/**
 * Quoted spans ("Dirtee Disco", "The Magick", 'I Only Smoke When I Drink')
 * are almost always a song/album/single title in this kind of promotional
 * copy, never a genre description — real evidence found live: Pumpehuset's
 * own Dizzee Rascal write-up lists his hit "Dirtee Disco" by name, whose
 * title coincidentally contains the word "Disco", which must never be
 * credited as real genre evidence for what is a grime/rap show. Genre
 * descriptions in this kind of copy are essentially always unquoted prose
 * ("a night of techno", "elektronisk musik") — stripping quoted spans
 * before matching is safe and removes this whole class of false positive
 * without needing a title/song blacklist.
 */
function stripQuotedSpans(text: string): string {
  return text.replace(/"[^"]*"|“[^”]*”/g, " ");
}

/** Returns the first matching genre from title + description text, or null if nothing matches. */
export function deterministicGenreFromText(text: string): GenreSlug | null {
  const unquoted = stripQuotedSpans(text);
  for (const [pattern, genre] of KEYWORD_MAP) {
    if (pattern.test(unquoted)) return genre;
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
    // No trailing \b: see the matching comment on this same pattern in
    // KEYWORD_MAP above (compound forms like "psytrancefest").
    [/\bpsytrance/i, "psytrance"],
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
