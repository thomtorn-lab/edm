import type { GenreSlug } from "../taxonomy";
import { mainGenreOf } from "../taxonomy";
import type { ConfidenceLevel } from "../types";
import { findAllGenreMatches } from "./deterministicGenreMapping";

/**
 * Conservative automatic secondary-genre suggestion (Discovery secondary-
 * genre V1, 2026-10-08 — see the deferred-task investigation this
 * implements). Populates ONLY `predictedSecondaryGenre` on a brand-new
 * Discovery Queue row; it never touches `genre`/`genreConfidence` and is
 * never consulted on the auto-publish-direct-to-event path or on an
 * existing row's resync (see pipeline.ts/sync.ts call sites).
 *
 * Deliberately NOT a revival of the reverted Billetto contradiction guard:
 * that approach tried to tell headliner text apart from support-act/bio
 * text and found no reliable structural signal for it. This module makes
 * no such attempt. Its only safety mechanism is structural co-mention
 * shape — two distinct, already-trusted KEYWORD_MAP matches sitting
 * directly together in one short clause, or in one dedicated genre-listing
 * field — never raw keyword frequency across a whole description, and
 * never qualifier/influence-phrase stripping (both explicitly rejected:
 * the prior investigation measured a 68% false-positive rate from the
 * naive whole-text multi-keyword count, unchanged by qualifier stripping).
 *
 * Exactly two approved evidence patterns, each its own named function below:
 *   1. matchStructuredGenreField — a dedicated genre-listing field (e.g.
 *      Gravity's "Music:" row), two distinct genres named.
 *   2. matchSameClauseCoMention — two distinct genres named directly
 *      together in one short, plain-prose clause ("house and techno",
 *      "techno, trance").
 * A clause naming three or more distinct families under either pattern is
 * ambiguous (which two actually matter?) and is never a candidate at all —
 * precision over recall, exactly as the three-and-more-genre real examples
 * in the investigation (e.g. a lineup "spanning Melodic Techno, Garage,
 * Hypnotic Techno, Trance, and Hard Techno") are meant to keep abstaining.
 */

const CLAUSE_SPLIT_RE = /[.!?;\n]+/;
const STRUCTURED_LABEL_RE = /^\s*(music|genre|genres|style|styles)\s*:/i;
/**
 * Keeps a plain-prose co-mention "adjacent" rather than scattered across an
 * unrelated compound sentence or a longer bio paragraph — every real
 * same-clause true positive found in the investigation (e.g. "A multi-room
 * journey through house and techno.", "Experience the ultimate in house,
 * techno, and everything in between.") is well under this; every real false
 * positive the naive whole-text rule caught (venue text naming a general
 * range, scattered bio mentions) either spans multiple clauses or, within
 * one clause, names more than two distinct families.
 */
const MAX_PLAIN_CLAUSE_LENGTH = 100;

type GenrePair = readonly [GenreSlug, GenreSlug];

function distinctGenresInClause(clause: string): GenreSlug[] {
  const distinct: GenreSlug[] = [];
  for (const { genre } of findAllGenreMatches(clause)) {
    if (!distinct.includes(genre)) distinct.push(genre);
  }
  return distinct;
}

/** Evidence pattern 1: a dedicated genre-listing field, e.g. Gravity's own
 *  "Music: Progressive & Melodic House, Melodic & Progressive Techno" row.
 *  The label itself is the structural signal — trusted directly, but still
 *  only when it names EXACTLY two distinct families (more is ambiguous). */
function matchStructuredGenreField(clause: string): GenrePair | null {
  if (!STRUCTURED_LABEL_RE.test(clause)) return null;
  const distinct = distinctGenresInClause(clause);
  return distinct.length === 2 ? [distinct[0], distinct[1]] : null;
}

/** Evidence pattern 2: two distinct genres named directly together in one
 *  short, plain-prose clause — not a structured field, not a long or
 *  multi-genre sentence. */
function matchSameClauseCoMention(clause: string): GenrePair | null {
  if (STRUCTURED_LABEL_RE.test(clause)) return null;
  if (clause.length > MAX_PLAIN_CLAUSE_LENGTH) return null;
  const distinct = distinctGenresInClause(clause);
  return distinct.length === 2 ? [distinct[0], distinct[1]] : null;
}

function splitIntoClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT_RE)
    .map((c) => c.trim())
    .filter(Boolean);
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
 * read alone — it only ever matters as one half of an explicit pair, and
 * only ever becomes a secondary suggestion when the OTHER half already
 * anchors to the existing primary's own family. Two pair elements that both
 * share the primary's group (e.g. "house" and "tech house" against a
 * "deep-house" primary) are a same-family pair, not a genuinely second
 * genre, and are never promoted — matching every real manually-curated
 * dual-genre event found in the investigation, every one of which pairs
 * across two DIFFERENT groups, never two siblings in the same one.
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
  // genre) — either way, this clause doesn't corroborate a secondary.
  return null;
}

/**
 * Top-level entry point. Returns a conservative secondary-genre suggestion
 * for Discovery review, or `null` to abstain. Never called at all unless a
 * primary genre already exists at least "medium" confidence (abstention
 * rule from the investigation: a primary that isn't even medium confidence
 * has no business growing a second, equally shaky genre) — enforced here so
 * every caller gets the same guarantee without repeating the check.
 *
 * Abstains (returns null) whenever:
 *   - no primary genre is resolved, or its confidence is "low";
 *   - no clause in the text yields a qualifying 2-distinct-genre pair under
 *     either evidence pattern;
 *   - a qualifying pair's two genres are both in the primary's own group
 *     (a same-family pair, not a second genre), or neither relates to the
 *     primary at all (unrelated/conflicting evidence);
 *   - different qualifying clauses disagree on what the secondary should be
 *     (a genuine conflict across the text) — this is deliberately the
 *     union of every qualifying clause's candidate, not just the first
 *     found, so a text with two DIFFERENT candidate secondaries anywhere
 *     abstains rather than guessing between them.
 */
export function suggestSecondaryGenre(
  relevanceText: string,
  primaryGenre: GenreSlug | null,
  primaryGenreConfidence: ConfidenceLevel,
): GenreSlug | null {
  if (!primaryGenre || primaryGenreConfidence === "low") return null;

  const candidates = new Set<GenreSlug>();
  for (const clause of splitIntoClauses(relevanceText)) {
    const pair = matchStructuredGenreField(clause) ?? matchSameClauseCoMention(clause);
    if (!pair) continue;
    const candidate = secondaryCandidateFromPair(pair, primaryGenre);
    if (candidate) candidates.add(candidate);
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}
