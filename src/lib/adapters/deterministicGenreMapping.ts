import type { GenreSlug } from "../taxonomy";

/**
 * Electronic hardcore signals (Dubstep/Hardstyle/Rawstyle/Hardcore automation,
 * 2026-09-14 — genre taxonomy audit follow-up): deliberately COMPOUND
 * phrases/unambiguous genre names only. A bare "hardcore" is never matched
 * here — the codebase already documents a real false-positive precedent
 * (billettoAdapter.ts's own doc comment: a hardcore-PUNK show, "KÆMPE
 * MOSHPIT VOL. 11", tagged Billetto's native "hardcore" subcategory) that
 * this deliberately does not reopen. "gabber" and "frenchcore" are genre
 * names with no other common meaning in event listing text; the rest pair
 * "hardcore" with an explicit electronic-context word so "hardcore punk" and
 * "hardcore metal" (real DQ/Production risk shapes) never match — see
 * deterministicGenreMapping.test.ts's own regression tests for both. Listed
 * before every other pattern so a compound match (e.g. "industrial hardcore")
 * is never swallowed by a broader bare pattern later in this array (e.g.
 * plain "industrial").
 */
const HARDCORE_KEYWORD_MAP: [RegExp, GenreSlug][] = [
  [/\bhardcore\s?techno\b/i, "hardcore"],
  [/\bindustrial\s+hardcore\b/i, "hardcore"],
  [/\belectronic\s+hardcore\b/i, "hardcore"],
  [/\buptempo\s+hardcore\b/i, "hardcore"],
  [/\bgabber\b/i, "hardcore"],
  [/\bfrenchcore\b/i, "hardcore"],
];

const KEYWORD_MAP: [RegExp, GenreSlug][] = [
  ...HARDCORE_KEYWORD_MAP,
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
  // Rawstyle before Hardstyle before Dubstep before Garage — each pair is a
  // specific-before-general precedence (Dubstep/Hardstyle/Rawstyle/Hardcore
  // automation, 2026-09-14): "rawstyle" text must resolve to rawstyle, not
  // the broader hardstyle family it belongs to (see GENRE_REFINEMENTS below
  // for the second-pass equivalent when genre came from a non-text hint);
  // "dubstep" must not be swallowed by the broader garage-bass fallback.
  [/\brawstyle\b|\braw\s+hardstyle\b/i, "rawstyle"],
  [/\bhardstyle\b/i, "hardstyle"],
  [/\bdubstep\b/i, "dubstep"],
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

// Plural-tolerant: a real regression (Teletech Copenhagen, KultuNaut publish
// work package, 2026-09-05) found "club nights"/"underground clubs" — the
// genuinely common plural phrasing of exactly this same corroboration —
// silently failing to match here because \b sits right after the singular
// noun. Every noun form below now accepts an optional trailing "s".
const DANCE_CLUB_CONTEXT_RE =
  /\b(?:dance\s?floors?|club\s?nights?|nightclubs?|raves?|clubbing|underground\s+clubs?|dansegulv(?:et)?|klubnat(?:ter)?|open[\s-]?air\s+part(?:y|ies)|soundsystems?|sound\s+systems?|dj\s+sets?)\b/i;

/**
 * Explicit DJ/rave-type evidence in an event's own title or lineup text
 * (Discovery Queue positive-signal routing, 2026-09-14 exhaustive audit
 * follow-up) — reused by adminQueue.ts's classifyAdminQueueRow to decide
 * whether an otherwise-INSUFFICIENT row has strong enough positive evidence
 * to surface in NEEDS REVIEW for a human look, without touching the row's
 * own evidence/confidence/holdReason data. Deliberately narrower in PURPOSE
 * than DANCE_CLUB_CONTEXT_RE above (that regex only ever informs a
 * confidence TIER for a genre that has already resolved; this one is asked
 * to justify surfacing a row with NO resolved genre at all) but broader in
 * MATCH than its own "dj sets?" fragment — the audit validated a bare
 * "DJ"/"DJs" mention as real evidence on its own, not only "DJ set". Word
 * boundaries throughout are what keeps this safe: \bdjs?\b does not match
 * inside "adjacent" (no boundary exists between the 'a' and 'd', or between
 * the 'j' and the following 'a' — "dj" is never flanked by a boundary on
 * both sides there), and \braves?\b does not match inside "brave"/"grave"/
 * "craving"/"gravel" for the identical reason. See this file's own test
 * suite for the exact false-positive regression cases validated against.
 */
export const DJ_OR_RAVE_SIGNAL_RE = /\bdjs?\b|\braves?\b/i;

export function hasExplicitDjOrRaveSignal(text: string): boolean {
  return DJ_OR_RAVE_SIGNAL_RE.test(text);
}

/**
 * Counts every KEYWORD_MAP match in `text` (not just distinct genre
 * families) — deliberately permissive about double-counting an overlapping
 * pair like "hard techno" also matching the bare "techno" pattern, since the
 * failure mode this guards against (Section 5: don't turn a legitimate EDM
 * event into a false negative) is far costlier than the failure mode a
 * slightly generous count risks.
 */
function countGenreMentions(text: string): number {
  let count = 0;
  for (const [pattern] of KEYWORD_MAP) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = global.exec(text))) {
      count++;
      if (match.index === global.lastIndex) global.lastIndex++; // guard against a zero-length match looping forever
    }
  }
  return count;
}

/**
 * Gap 4D: a generalized evidence-STRENGTH distinction, not a raw
 * character-count floor — a SEMANTIC evidence count instead: how many
 * genre-relevant mentions survive stripConfidenceOnlySpans (i.e. are direct
 * assertions, not merely an influence qualifier or a historical/eclectic
 * style list — gaps 4A/4B), whether that's the SAME genre repeated across
 * several real, substantive sentences (real regression guard: Teletech
 * Copenhagen's own bio says "techno" three separate times — "hardhitting
 * techno night", "a techno movement", "the international techno scene" —
 * genuinely rich, corroborated evidence despite naming only one genre
 * family) or two DIFFERENT genre families named once each. Either two such
 * mentions, or one mention plus an explicit dance/club-context phrase
 * (dancefloor, club night(s), rave(s), dansegulv, soundsystem, DJ set...),
 * counts as rich. A single, isolated genre/electronic-context keyword hit
 * with no such corroboration ("Live experimental electronics" — four words,
 * one bare mention) is NOT rich. Callers (adapters that, like
 * kultunautAdapter.ts, treat their own first-party description text as
 * "official-description"-tier evidence) use this to decide whether a
 * deterministic match earns that top tier or the ordinary
 * "deterministic-mapping" tier instead — it never changes whether a genre
 * resolves at all, only how much confidence that resolution deserves.
 */
export function hasRichGenreEvidence(text: string): boolean {
  const lightlyCleaned = lightlyCleanText(text);
  const directlyCleaned = stripConfidenceOnlySpans(lightlyCleaned);

  const directMentionCount = countGenreMentions(directlyCleaned);
  const hasGenericElectronicMention = directMentionCount === 0 && GENERIC_ELECTRONIC_MENTION_RE.test(directlyCleaned);
  const signalCount = directMentionCount > 0 ? directMentionCount : hasGenericElectronicMention ? 1 : 0;

  if (signalCount >= 2) return true;
  if (signalCount === 1 && DANCE_CLUB_CONTEXT_RE.test(directlyCleaned)) return true;
  return false;
}

const GENRE_REFINEMENTS: Partial<Record<GenreSlug, [RegExp, GenreSlug][]>> = {
  trance: [
    [/\bpsytrance/i, "psytrance"],
    [/\bpsy\b/i, "psytrance"],
  ],
  techno: [
    // "hardcore techno" first — more specific than the bare "hard techno" /
    // "industrial" patterns below, and hardcore techno is genuinely its own
    // genre despite containing the word "techno" (Dubstep/Hardstyle/
    // Rawstyle/Hardcore automation, 2026-09-14): a category-level "techno"
    // hint from a non-text source, refined against text that explicitly
    // says "hardcore techno", must promote to hardcore, not stay techno.
    [/\bhardcore\s?techno\b/i, "hardcore"],
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
  // Rawstyle-over-Hardstyle and Dubstep-over-Garage second-pass refinement
  // (Dubstep/Hardstyle/Rawstyle/Hardcore automation, 2026-09-14): mirrors
  // the same specific-before-general precedence KEYWORD_MAP already applies
  // on a single deterministicGenreFromText call, for the case where genre
  // instead came from a non-text hint (an adapter's own official-metadata
  // tag, Discogs enrichment) and only the pipeline's full relevance text
  // carries the more specific word.
  hardstyle: [[/\brawstyle\b|\braw\s+hardstyle\b/i, "rawstyle"]],
  garage: [[/\bdubstep\b/i, "dubstep"]],
};

export function refineGenreFromText(genre: GenreSlug, text: string): GenreSlug {
  const refinements = GENRE_REFINEMENTS[genre];
  if (!refinements) return genre;
  for (const [pattern, refined] of refinements) {
    if (pattern.test(text)) return refined;
  }
  return genre;
}
