import { dateKeysEqual, nightlifeDateKey } from "./datetime";
import { normalizeArtistName } from "./normalize";

/**
 * Fuzzy duplicate detection across sources (spec sections 36, 39). The same
 * event routinely appears via 2-4+ sources (RA, Facebook, Billetto,
 * promoter, venue, AllEvents) with slightly different titles or missing
 * fields; this must still collapse to one canonical record.
 */

export type DuplicateConfidence = "high" | "medium" | "low" | "none";
export type DuplicateAction = "auto_merge_if_safe" | "review_queue" | "keep_separate";

export interface DuplicateCandidate {
  title: string;
  artists: string[];
  venueId: string | null;
  startDatetime: string;
}

export interface DuplicateAssessment {
  confidence: DuplicateConfidence;
  titleSimilarity: number;
  artistOverlap: number;
  sameVenue: boolean;
  sameNight: boolean;
  reasons: string[];
}

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(" ").filter(Boolean));
}

/** Jaccard similarity over title tokens: 0 (no overlap) .. 1 (identical token sets). */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Overlap coefficient over normalized artist names: fraction of the smaller lineup matched. */
export function artistOverlap(a: string[], b: string[]): number {
  const na = new Set(a.map(normalizeArtistName));
  const nb = new Set(b.map(normalizeArtistName));
  if (na.size === 0 || nb.size === 0) return 0;
  let intersection = 0;
  for (const name of na) if (nb.has(name)) intersection++;
  return intersection / Math.min(na.size, nb.size);
}

function sameNightlifeDate(a: string, b: string): boolean {
  return dateKeysEqual(nightlifeDateKey(new Date(a)), nightlifeDateKey(new Date(b)));
}

export function assessDuplicate(a: DuplicateCandidate, b: DuplicateCandidate): DuplicateAssessment {
  const sameVenue = a.venueId !== null && a.venueId === b.venueId;
  const sameNight = sameNightlifeDate(a.startDatetime, b.startDatetime);
  const tSim = titleSimilarity(a.title, b.title);
  const aOverlap = artistOverlap(a.artists, b.artists);

  const base = { titleSimilarity: tSim, artistOverlap: aOverlap, sameVenue, sameNight };

  if (!sameNight) {
    return { ...base, confidence: "none", reasons: ["different night — not a candidate duplicate"] };
  }

  // Same venue + same night + strong title or lineup match -> very high probability.
  if (sameVenue && (tSim >= 0.5 || aOverlap >= 0.5)) {
    return { ...base, confidence: "high", reasons: ["same venue, same night, strong title/lineup match"] };
  }

  // Same night + matching lineup, even if venue/title differ across sources -> high probability.
  if (aOverlap >= 0.5) {
    return { ...base, confidence: "high", reasons: ["same night, matching lineup across sources"] };
  }

  // Same venue + same night but clearly different lineups -> keep separate, do not auto-merge.
  if (sameVenue && a.artists.length > 0 && b.artists.length > 0 && aOverlap === 0 && tSim < 0.2) {
    return { ...base, confidence: "low", reasons: ["same venue and night but clearly different lineups"] };
  }

  if (sameVenue || tSim >= 0.25 || aOverlap > 0) {
    return { ...base, confidence: "medium", reasons: ["same night with partial signal — needs review"] };
  }

  return { ...base, confidence: "low", reasons: ["same night only, no other matching signal"] };
}

export function decideDuplicateAction(confidence: DuplicateConfidence): DuplicateAction {
  if (confidence === "high") return "auto_merge_if_safe";
  if (confidence === "medium") return "review_queue";
  return "keep_separate";
}

/** Finds the strongest duplicate candidate for `candidate` among `existing`, if any. */
export function findBestDuplicateMatch<T extends DuplicateCandidate>(
  candidate: DuplicateCandidate,
  existing: T[],
): { match: T; assessment: DuplicateAssessment } | null {
  let best: { match: T; assessment: DuplicateAssessment } | null = null;
  for (const item of existing) {
    const assessment = assessDuplicate(candidate, item);
    if (assessment.confidence === "none") continue;
    if (!best || rank(assessment.confidence) > rank(best.assessment.confidence)) {
      best = { match: item, assessment };
    }
  }
  return best;
}

function rank(confidence: DuplicateConfidence): number {
  return { high: 3, medium: 2, low: 1, none: 0 }[confidence];
}
