import type { GenreSlug } from "../taxonomy";
import { mainGenreOf } from "../taxonomy";
import type { ConfidenceLevel } from "../types";
import { findAllGenreMatches } from "./deterministicGenreMapping";

/**
 * Conservative automatic secondary-genre suggestion (Discovery secondary-
 * genre V1, 2026-10-08; revised 2026-10-08 after a review of the first
 * version found a real false-positive gap). Populates ONLY
 * `predictedSecondaryGenre` on a brand-new Discovery Queue row; it never
 * touches `genre`/`genreConfidence` and is never consulted on the
 * auto-publish-direct-to-event path or on an existing row's resync (see
 * pipeline.ts/sync.ts call sites).
 *
 * REVISION HISTORY — why free-text inference is gone entirely:
 * The first version of this module accepted two evidence patterns: a
 * dedicated genre-listing field matched by scanning free text for a
 * "Music:"/"Genre:" label, and two distinct genres named directly together
 * in one short plain-prose clause. A follow-up safety review found both
 * unsafe in practice: a support-act or artist biography sentence ("Support
 * act Y is known for blending techno and trance influences in her sets")
 * and compact venue-boilerplate text ("This club regularly hosts a mix of
 * house and techno") both produced confident, wrong secondary-genre
 * suggestions under the plain-prose rule, and nothing stops the SAME kind
 * of adversarial/coincidental text from containing a string that merely
 * starts with "Music:"/"Genre:" without describing this event at all —
 * restricting matching to the first clause does not fix either case, since
 * venue boilerplate and biographies can just as easily open a description.
 *
 * This version removes both free-text patterns. The only evidence it
 * consumes is `RawCandidateEvent.structuredGenreField` — text an adapter
 * populates ONLY when its own extraction code can point at a genuine,
 * source-specific structural signal tying a genre-listing value to THIS
 * event (e.g. Gravity's "Music:" info-row, parsed out of a specific
 * `<strong>Music:</strong><span>...</span>` HTML shape unique to its
 * detail-page template — never a same-named field assumed trustworthy on
 * another source without its own verification). No clause-splitting, no
 * label-regex matching against general prose: by the time this module sees
 * the text, the adapter itself has already established that it describes
 * this event's own genre, not a bio or a venue's generic blurb.
 *
 * Deliberately NOT a revival of the reverted Billetto contradiction guard:
 * that approach tried to tell headliner text apart from support-act/bio
 * text within free prose and found no reliable structural signal for it.
 * This module makes no such attempt — it never looks at free prose at all.
 *
 * Still never raw keyword frequency, never qualifier/influence-phrase
 * stripping: a structured field naming three or more distinct genre
 * families is ambiguous (which two actually matter?) and is never a
 * candidate — precision over recall, exactly as the three-and-more-genre
 * real examples in the original investigation (e.g. a lineup "spanning
 * Melodic Techno, Garage, Hypnotic Techno, Trance, and Hard Techno") are
 * meant to keep abstaining.
 */

type GenrePair = readonly [GenreSlug, GenreSlug];

function distinctGenresIn(text: string): GenreSlug[] {
  const distinct: GenreSlug[] = [];
  for (const { genre } of findAllGenreMatches(text)) {
    if (!distinct.includes(genre)) distinct.push(genre);
  }
  return distinct;
}

/**
 * Given a qualifying pair and the already-resolved primary genre, decides
 * whether the pair corroborates that primary (one element shares its exact
 * slug or its broader genre GROUP — see taxonomy.ts's mainGenreOf) and, if
 * so, returns the OTHER element as the secondary candidate — but only when
 * that other element is in a genuinely DIFFERENT group than the primary.
 *
 * This is what makes a bare "house"/"garage" mention safe here even though
 * neither may independently trigger classification elsewhere: it is never
 * read alone — it only ever matters as one half of an explicit pair drawn
 * from a verified structured field, and only ever becomes a secondary
 * suggestion when the OTHER half already anchors to the existing primary's
 * own family. Two pair elements that both share the primary's group (e.g.
 * "house" and "tech house" against a "deep-house" primary) are a
 * same-family pair, not a genuinely second genre, and are never promoted —
 * matching every real manually-curated dual-genre event found in the
 * original investigation, every one of which pairs across two DIFFERENT
 * groups, never two siblings in the same one.
 */
function secondaryCandidateFromPair(pair: GenrePair, primaryGenre: GenreSlug): GenreSlug | null {
  const primaryGroup = mainGenreOf(primaryGenre);
  const [a, b] = pair;
  const aAnchorsPrimary = a === primaryGenre || mainGenreOf(a) === primaryGroup;
  const bAnchorsPrimary = b === primaryGenre || mainGenreOf(b) === primaryGroup;

  if (aAnchorsPrimary && !bAnchorsPrimary) return b;
  if (bAnchorsPrimary && !aAnchorsPrimary) return a;
  // Neither element relates to the already-established primary (unrelated/
  // conflicting evidence), or both do (a same-family pair, not a second
  // genre) — either way, this field doesn't corroborate a secondary.
  return null;
}

/**
 * Top-level entry point. Returns a conservative secondary-genre suggestion
 * for Discovery review, or `null` to abstain. Never called at all unless a
 * primary genre already exists at least "medium" confidence (abstention
 * rule from the original investigation: a primary that isn't even medium
 * confidence has no business growing a second, equally shaky genre) —
 * enforced here so every caller gets the same guarantee without repeating
 * the check.
 *
 * `structuredGenreField` is the ONLY evidence considered — see this file's
 * header comment for why free-text scanning was removed entirely. Abstains
 * (returns null) whenever:
 *   - no primary genre is resolved, or its confidence is "low";
 *   - the adapter supplied no structured genre field at all (by far the
 *     most common case — most sources have no such verified field);
 *   - the field doesn't name EXACTLY two distinct genre families (zero or
 *     one is insufficient evidence of a SECOND genre; three or more is
 *     ambiguous — which two actually matter?);
 *   - the qualifying pair's two genres are both in the primary's own group
 *     (a same-family pair, not a second genre), or neither relates to the
 *     primary at all (unrelated/conflicting evidence).
 */
export function suggestSecondaryGenre(
  structuredGenreField: string | null | undefined,
  primaryGenre: GenreSlug | null,
  primaryGenreConfidence: ConfidenceLevel,
): GenreSlug | null {
  if (!primaryGenre || primaryGenreConfidence === "low") return null;
  if (!structuredGenreField) return null;

  const distinct = distinctGenresIn(structuredGenreField);
  if (distinct.length !== 2) return null;

  return secondaryCandidateFromPair([distinct[0], distinct[1]], primaryGenre);
}
