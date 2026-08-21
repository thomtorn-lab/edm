/**
 * Source-aware electronic-relevance evidence (Electronic CPH data-quality
 * work package, Workstream A). The product rule is that electronic music
 * must be CENTRAL to an event, not merely present or adjacent — a generalist
 * venue's own broad category tag ("Elektronisk", Billetto's "edm_electronic"
 * subcategory) is real evidence the venue considers the night electronic
 * enough to tag, but it is evidence about the VENUE'S OWN TAXONOMY, not
 * about this specific show, so on its own it must never be enough to
 * auto-publish at high confidence. This module is deliberately NOT a
 * per-artist blacklist — it is two small, source-agnostic, generalizable
 * rules that apply uniformly to every adapter (present and future):
 *
 * 1. `hasNonElectronicGenreSignal` — a fixed list of GENRE words (not artist
 *    names) that indicate the event's own text is centered on a different,
 *    non-electronic genre (grime, rap/hip-hop, metal, punk, rock, jazz,
 *    folk, reggae, chiptune, comedy/bingo/quiz-night programming). Present
 *    alongside only generic/broad electronic evidence, this caps the
 *    ingestion pipeline's decision at "review_queue" (see pipeline.ts) —
 *    exactly the "isolated word in otherwise non-electronic artist copy"
 *    weak-evidence case the product brief calls out.
 * 2. The generic "electronic-other" genre (used by every adapter as its
 *    floor when only a broad category/mention is found, never a specific
 *    subgenre) can never by itself justify auto-publish — see
 *    GENERIC_ELECTRONIC_GENRE and its use in pipeline.ts. A specific
 *    subgenre keyword genuinely matched in the event's own official text
 *    remains strong evidence and is unaffected.
 */

// Deliberately excludes bare "rock", "jazz" and bare "rap" — real production
// evidence (Electronic CPH data-quality audit) showed these generate false
// positives on genuinely electronic events, whose own bios routinely
// describe an artist's INFLUENCES or make a genre-comparison in passing
// ("shaped by jazz, soul and disco roots"; "taking cues from rap culture the
// way Nu Metal once redefined rock") without the event itself being that
// genre. "rapper" (a job title, not a loose genre-adjacent word) and
// "hip-hop" are specific enough to keep. Similarly "metal" only matches
// clearly metal-identifying prefixes (death/black/thrash/doom) or the bare
// word/"metalcore" — "nu"/"speed"/"power" were dropped after "Nu Metal"
// (used only as a comparison, "the way Nu Metal once redefined rock")
// collided with a real Nu Trance event.
const NON_ELECTRONIC_GENRE_SIGNALS: RegExp[] = [
  /\bgrime\b/i,
  /\b(hip[\s-]?hop|rapper)\b/i,
  /\b(?:death|black|thrash|doom|sludge|heavy)[\s-]?metal\b/i,
  /\bmetalcore\b/i,
  /\bpunk\b/i,
  /\bfolk\b/i,
  /\breggae\b/i,
  /\bska\b/i,
  /\bchiptune\b/i,
  /\bsinger[\s-]?songwriter\b/i,
  /\bcomedy\b/i,
  /\bstand[\s-]?up\b/i,
  /\bbingo\b/i,
  /\bquiz\b/i,
];

/** True when the given text (title + description/bio) is centered on a
 *  recognized non-electronic genre — a strong negative signal against
 *  crediting an isolated electronic-sounding word found in the same text. */
export function hasNonElectronicGenreSignal(text: string): boolean {
  return NON_ELECTRONIC_GENRE_SIGNALS.some((re) => re.test(text));
}

/** The generic electronic-music fallback every adapter uses when it has only
 *  broad/categorical evidence (a venue-wide tag, a platform's catch-all
 *  subcategory) and no specific subgenre keyword match for this event. */
export const GENERIC_ELECTRONIC_GENRE = "electronic-other";
