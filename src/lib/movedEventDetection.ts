import { normalizeUrl, titleSimilarity, artistOverlap } from "./dedup";

/**
 * Moved/rescheduled first-party event detection (Electronic CPH
 * data-quality work package, Workstream C). The tonser/Pumpehuset case
 * proved that when a first-party source republishes a show under a new
 * date/URL (a genuine reschedule, not a new event), the normal dedup model
 * (src/lib/dedup.ts) correctly does NOT merge it — different night is an
 * absolute veto there, by design, because same date/time is required
 * evidence for two candidates from possibly-different sources to be the
 * same real-world event. That's the right rule for cross-source dedup, but
 * it leaves a genuinely moved single-night show with two canonical rows:
 * the stale original (never revisited once the source stops returning it)
 * and a brand-new candidate for the new date.
 *
 * This module is a second, SEPARATE, deliberately conservative check —
 * scoped to candidates from the SAME registered source as an existing
 * event (never cross-source; that risk is exactly why dedup.ts's veto
 * exists) — that is allowed to match across a date difference, but only on
 * strong corroborating evidence, never on title/artist match alone (per
 * explicit product direction: never merge/hide events solely because
 * artist/title happens to match).
 */

export interface MovedEventCandidate {
  title: string;
  artists: string[];
  venueId: string | null;
  startDatetime: string;
  description?: string | null;
  officialEventUrl?: string | null;
  ticketUrl?: string | null;
  residentAdvisorUrl?: string | null;
}

export interface ExistingSameSourceEvent {
  title: string;
  artists: string[];
  venueId: string | null;
  startDatetime: string;
  officialEventUrl?: string | null;
  ticketUrl?: string | null;
  residentAdvisorUrl?: string | null;
}

export type MovedEventConfidence = "high" | "medium" | "none";

export interface MovedEventAssessment {
  confidence: MovedEventConfidence;
  reasons: string[];
}

/** English + Danish reschedule/moved wording a first-party source routinely
 *  uses on its own event/detail page when a show has been moved. */
const RESCHEDULE_TEXT =
  /\b(?:resched(?:uled|uling)|new date|date change(?:d)?|has (?:been )?moved|postponed|udskudt|flyttet|ny dato)\b/i;

const STRONG_TITLE_SIMILARITY = 0.6;
const STRONG_ARTIST_OVERLAP = 0.8;

function sharesUniqueUrl(a: MovedEventCandidate, b: ExistingSameSourceEvent): boolean {
  const aUrls = [a.officialEventUrl, a.ticketUrl, a.residentAdvisorUrl]
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => u !== null);
  const bUrls = [b.officialEventUrl, b.ticketUrl, b.residentAdvisorUrl]
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => u !== null);
  if (aUrls.length === 0 || bUrls.length === 0) return false;
  const bSet = new Set(bUrls);
  return aUrls.some((u) => bSet.has(u));
}

/**
 * Assesses whether `candidate` is likely a moved/rescheduled version of
 * `existing` (same source, different date). Confidence:
 *
 * - "high": a shared official/ticket/RA URL (the strongest possible
 *   provenance signal for a first-party source republishing its own show)
 *   plus a strong title/lineup identity match.
 * - "medium": explicit first-party reschedule/moved wording plus a strong
 *   title/lineup match, but no shared URL — real corroborating evidence,
 *   but short of the URL-level certainty, so it is routed to human review
 *   rather than auto-merged (see pipeline.ts).
 * - "none": anything short of that — most importantly, a strong title/
 *   lineup match with NEITHER a shared URL NOR explicit moved wording is
 *   still "none": identity match alone is never sufficient.
 */
export function assessMovedEvent(candidate: MovedEventCandidate, existing: ExistingSameSourceEvent): MovedEventAssessment {
  if (new Date(candidate.startDatetime).getTime() === new Date(existing.startDatetime).getTime()) {
    return { confidence: "none", reasons: ["same start time — not a moved-event candidate, this is normal dedup's job"] };
  }
  if (candidate.venueId && existing.venueId && candidate.venueId !== existing.venueId) {
    return { confidence: "none", reasons: ["different venue — a moved/rescheduled show stays at the same venue"] };
  }

  const tSim = titleSimilarity(candidate.title, existing.title);
  const aOverlap = artistOverlap(candidate.artists, existing.artists);
  const strongIdentityMatch = tSim >= STRONG_TITLE_SIMILARITY || aOverlap >= STRONG_ARTIST_OVERLAP;

  // Never merge/hide solely because artist/title happens to match — this is
  // an absolute floor, checked before any other evidence is even weighed.
  if (!strongIdentityMatch) {
    return { confidence: "none", reasons: ["no strong title/lineup identity match with the existing event"] };
  }

  if (sharesUniqueUrl(candidate, existing)) {
    return {
      confidence: "high",
      reasons: ["same official/ticket/Resident Advisor URL as an existing published event from this source, different date, strong title/lineup match — likely the same event moved"],
    };
  }

  const text = `${candidate.title} ${candidate.description ?? ""}`;
  if (RESCHEDULE_TEXT.test(text)) {
    return {
      confidence: "medium",
      reasons: ["explicit reschedule/moved wording plus a strong title/lineup match, but no shared URL — needs review before merging"],
    };
  }

  return { confidence: "none", reasons: ["strong title/lineup match alone is not sufficient evidence of a moved event"] };
}

/** Finds the strongest moved-event match for `candidate` among `existing` (same-source events only), if any. */
export function findBestMovedEventMatch<T extends ExistingSameSourceEvent>(
  candidate: MovedEventCandidate,
  existing: T[],
): { match: T; assessment: MovedEventAssessment } | null {
  let best: { match: T; assessment: MovedEventAssessment } | null = null;
  for (const item of existing) {
    const assessment = assessMovedEvent(candidate, item);
    if (assessment.confidence === "none") continue;
    if (!best || rank(assessment.confidence) > rank(best.assessment.confidence)) {
      best = { match: item, assessment };
    }
  }
  return best;
}

function rank(confidence: MovedEventConfidence): number {
  return { high: 2, medium: 1, none: 0 }[confidence];
}
