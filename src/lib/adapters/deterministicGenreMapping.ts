import type { GenreSlug } from "../taxonomy";

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
  [/\bpsytrance/i, "psytrance"],
  [/\bpsy\b/i, "psytrance"],
  [/\btrance\b(?!-\w)(?!\s+state\b)/i, "trance"],
  [/\bd\s?&\s?b\b|drum\s?(and|&)\s?bass\b|\bdnb\b/i, "drum-and-bass"],
  [/\bgarage\b/i, "garage"],
  [/\belectro\b/i, "electro"],
  [/\bdisco\b/i, "disco"],
  [/\bambient\b/i, "ambient-experimental"],
  [/\belectronica?\b[\s\S]{0,60}\bexperimental\b|\bexperimental\b[\s\S]{0,60}\belectronica?\b/i, "ambient-experimental"],
];

function stripQuotedSpans(text: string): string {
  return text.replace(/"[^"]*"|"[^"]*"/g, " ");
}

/**
 * Gap 4E (KultuNaut publish work package, 2026-09-05): a FORMAT/TECHNOLOGY
 * phrase that happens to contain a genre word must not be read as a genre
 * assertion — "silent disco" names an event FORMAT (wireless headphones, no
 * ambient sound), not the disco genre. Unlike the influence-qualifier/
 * historical-list spans below, this one is safe to remove BEFORE matching
 * (rather than only downweighting confidence): there is no legitimate
 * reading of "silent disco" as evidence of the disco genre, so full removal
 * carries no false-negative risk the way stripping a genuine "X-inspired"
 * mention would (see hasRichGenreEvidence's own doc comment for why that
 * case is handled differently). A plain strip-before-match table, not a
 * single hardcoded event exception: any future compound format term with
 * the same shape goes here.
 */
const FORMAT_TERM_RE: RegExp[] = [/\bsilent\s+disco\b/gi];

function stripFormatTermSpans(text: string): string {
  let stripped = text;
  for (const pattern of FORMAT_TERM_RE) stripped = stripped.replace(pattern, " ");
  return stripped;
}

/** The text deterministicGenreFromText itself matches against — quoted
 *  spans and format terms only. Kept as its own step because
 *  hasRichGenreEvidence below needs this SAME lightly-cleaned text as its
 *  baseline before applying its own additional, confidence-only stripping. */
function lightlyCleanText(text: string): string {
  return stripFormatTermSpans(stripQuotedSpans(text));
}

export function deterministicGenreFromText(text: string): GenreSlug | null {
  const cleaned = lightlyCleanText(text);
  for (const [pattern, genre] of KEYWORD_MAP) {
    if (pattern.test(cleaned)) return genre;
  }
  return null;
}

/**
 * Gaps 4A/4B (KultuNaut publish work package, 2026-09-05) — evidence-
 * STRENGTH signals for hasRichGenreEvidence below, deliberately NOT applied
 * inside deterministicGenreFromText's own matching. An earlier version of
 * this fix stripped these spans before genre resolution itself, which
 * caused a real regression against live Culture Box data: Demi Riquísimo's
 * own bio (real fixture, cultureBoxAdapter.test.ts) reads "his standout
 * acid, italo house inspired sonic palette" — the artist's ENTIRE genre
 * evidence is this one qualified phrase, and there is no competing direct
 * genre elsewhere in the text, so stripping it left genre fully unresolved
 * for a genuinely electronic, correctly-classified Production event. The
 * qualifier construction is real evidence of RELATEDNESS, just not
 * evidence strong enough to earn the top confidence tier on its own — so
 * `genre` still resolves ("house" stays "house"), and only the confidence
 * question (see hasRichGenreEvidence) is affected. Real evidence for the
 * PROBLEM this still fixes: "house-inspired pop" describes a pop track's
 * influence, not a claim that the track itself is house; "has moved between
 * synthpop, krautrock, big beat, house, reggae..." describes an artist's
 * past range, not tonight's set.
 */
const INFLUENCE_QUALIFIER_RE: RegExp[] = [
  /\b(?:[\p{L}&]+[\s-]){1,3}inspire(?:d|ret)\b/giu,
  /\binfluenced\s+by\s+(?:[\p{L}&]+[\s,-]*){1,3}/giu,
  /\binspiration\s+from\s+(?:[\p{L}&]+[\s,-]*){1,3}/giu,
  /\belements?\s+of\s+(?:[\p{L}&]+[\s,-]*){1,3}/giu,
];

const HISTORICAL_GENRE_LIST_CUE_RE =
  /\b(?:has|have)\s+(?:moved|shifted|swung|explored|spanned|ranged|drifted|worked)\s+(?:between|through|across|among)\b[^.;!?\n]*/giu;

/** Additional stripping applied ONLY for the hasRichGenreEvidence confidence
 *  check below — never for genre resolution itself (see the doc comment on
 *  INFLUENCE_QUALIFIER_RE for why). */
function stripConfidenceOnlySpans(text: string): string {
  let stripped = text;
  for (const pattern of INFLUENCE_QUALIFIER_RE) stripped = stripped.replace(pattern, " ");
  stripped = stripped.replace(HISTORICAL_GENRE_LIST_CUE_RE, " ");
  return stripped;
}

/** Mirrors the generic "electronic"-floor check every adapter's own
 *  genericElectronic fallback runs (e.g. kultunautAdapter.ts) — used only as
 *  one possible signal inside hasRichGenreEvidence below, never on its own
 *  to resolve a genre (that stays each adapter's own decision). */
const GENERIC_ELECTRONIC_MENTION_RE = /\belectronic(s|a)?\b/i;

const DANCE_CLUB_CONTEXT_RE =
  /\b(?:dance\s?floor|club\s?night|nightclub|rave|clubbing|dansegulv(?:et)?|klubnat|open[\s-]?air\s+party|soundsystem|sound\s+system|dj\s+set)\b/i;

/**
 * Gap 4D: a generalized evidence-STRENGTH distinction, not a raw
 * character-count floor. A genre signal counts as "rich" only when it
 * SURVIVES stripConfidenceOnlySpans (i.e. it is a direct assertion, not
 * merely an influence qualifier or a historical/eclectic style list — gaps
 * 4A/4B) AND is either corroborated by a SECOND, distinct direct genre-family
 * hit or an explicit dance/club-context phrase (dancefloor, club night,
 * rave, dansegulv, soundsystem, DJ set...). A single, isolated genre/
 * electronic-context keyword hit with no such corroboration ("Live
 * experimental electronics" — four words, one bare mention) is NOT rich,
 * the same as a long description whose only genre mention is exactly as
 * isolated. Callers (adapters that, like kultunautAdapter.ts, treat their
 * own first-party description text as "official-description"-tier
 * evidence) use this to decide whether a deterministic match earns that top
 * tier or the ordinary "deterministic-mapping" tier instead — it never
 * changes whether a genre resolves at all, only how much confidence that
 * resolution deserves.
 */
export function hasRichGenreEvidence(text: string): boolean {
  const lightlyCleaned = lightlyCleanText(text);
  const directlyCleaned = stripConfidenceOnlySpans(lightlyCleaned);

  const lightGenres = new Set<GenreSlug>();
  for (const [pattern, genre] of KEYWORD_MAP) {
    if (pattern.test(lightlyCleaned)) lightGenres.add(genre);
  }
  const directGenres = new Set<GenreSlug>();
  for (const [pattern, genre] of KEYWORD_MAP) {
    if (pattern.test(directlyCleaned)) directGenres.add(genre);
  }
  const hasGenericElectronicMention = lightGenres.size === 0 && GENERIC_ELECTRONIC_MENTION_RE.test(directlyCleaned);
  const directSignalCount = directGenres.size > 0 ? directGenres.size : hasGenericElectronicMention ? 1 : 0;

  if (directSignalCount >= 2) return true;
  if (directSignalCount === 1 && DANCE_CLUB_CONTEXT_RE.test(directlyCleaned)) return true;
  return false;
}

const GENRE_REFINEMENTS: Partial<Record<GenreSlug, [RegExp, GenreSlug][]>> = {
  trance: [
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
