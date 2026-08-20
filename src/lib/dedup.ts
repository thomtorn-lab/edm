import { dateKeysEqual, nightlifeDateKey } from "./datetime";
import { normalizeArtistName } from "./normalize";

/**
 * Evidence-based fuzzy duplicate detection across sources (spec sections 36,
 * 39; strengthened per the Electronic CPH cross-source dedup investigation).
 * The same event routinely appears via 2-4+ sources (RA, ticket platforms,
 * Billetto, promoter, venue) with slightly different titles or missing
 * fields; this must still collapse to one canonical record — but same
 * date/time, or same venue, is never on its own meaningful evidence that two
 * candidates are the same real-world event. A room-partitioned first-party
 * source (Culture Box: Black Box / Red Box) publishes one set of door hours
 * and one Resident Advisor/Facebook link per NIGHT, shared across multiple
 * genuinely distinct room events — so a shared RA/ticket URL is deliberately
 * NOT trusted when the two candidates' own official event URLs disagree on
 * room identity (same base path, different #fragment).
 */

export type DuplicateConfidence = "high" | "medium" | "low" | "none";
export type DuplicateAction = "auto_merge_if_safe" | "review_queue" | "keep_separate";

export interface DuplicateCandidate {
  title: string;
  artists: string[];
  venueId: string | null;
  startDatetime: string;
  /** Registered source id (e.g. "src-hangaren"), when known. Absent for legacy/admin-pasted candidates. */
  sourceId?: string | null;
  officialEventUrl?: string | null;
  ticketUrl?: string | null;
  residentAdvisorUrl?: string | null;
}

export interface DuplicateAssessment {
  confidence: DuplicateConfidence;
  titleSimilarity: number;
  artistOverlap: number;
  sameVenue: boolean;
  sameNight: boolean;
  reasons: string[];
}

// ---- Title normalization ----

/** Generic tokens (room names, genre words, promoter boilerplate) that carry
 *  little or no identity evidence on their own — "Black Box: X" and "Red
 *  Box: Y" must never look similar just because they share "Box". */
const GENERIC_TITLE_TOKENS = new Set([
  "black", "red", "box", "boxes", "room", "stage", "hall", "floor",
  "techno", "house", "electronic", "electro", "melodic", "hard", "deep",
  "party", "showcase", "club", "rave", "raves", "festival", "gig",
  "night", "nights", "session", "sessions", "edition", "vol", "volume",
  "presents", "present", "live", "dj", "djs", "afterparty", "after",
  "special", "guest", "guests", "selects", "selecta", "collective",
  "the", "and", "w", "x", "b2b", "ft", "feat", "featuring",
]);

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

function distinctiveTitleTokens(title: string): Set<string> {
  return new Set([...titleTokens(title)].filter((t) => t.length > 1 && !GENERIC_TITLE_TOKENS.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Jaccard similarity over DISTINCTIVE title tokens only (generic room/genre/promoter
 *  boilerplate excluded) — 0 (no overlap) .. 1 (identical distinctive token sets). */
export function titleSimilarity(a: string, b: string): number {
  return jaccard(distinctiveTitleTokens(a), distinctiveTitleTokens(b));
}

/** Overlap coefficient over normalized artist names: fraction of the smaller lineup matched. */
export function artistOverlap(a: string[], b: string[]): number {
  const na = new Set(a.map(normalizeArtistName).filter((n) => n && n !== "tba"));
  const nb = new Set(b.map(normalizeArtistName).filter((n) => n && n !== "tba"));
  if (na.size === 0 || nb.size === 0) return 0;
  let intersection = 0;
  for (const name of na) if (nb.has(name)) intersection++;
  return intersection / Math.min(na.size, nb.size);
}

function sameNightlifeDate(a: string, b: string): boolean {
  return dateKeysEqual(nightlifeDateKey(new Date(a)), nightlifeDateKey(new Date(b)));
}

// ---- URL normalization ----

const TRACKING_PARAM_NAMES = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "affiliate", "igshid"]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAM_NAMES.has(k);
}

function splitFragment(url: string): { base: string; fragment: string | null } {
  const i = url.indexOf("#");
  return i === -1 ? { base: url, fragment: null } : { base: url.slice(0, i), fragment: url.slice(i + 1) || null };
}

/**
 * Normalizes a URL for identity comparison: forces https, strips a leading
 * "www.", drops tracking params (utm_*, fbclid, gclid, ...), sorts the
 * remaining query params, and strips a trailing slash from the path. The
 * fragment is preserved verbatim (never stripped) — for a room-partitioned
 * source it's the ONLY thing that distinguishes two otherwise-identical
 * per-night URLs, so losing it here would silently defeat the room-identity
 * guard in `roomIdentityConflict`. Falls back to a trimmed original string
 * for anything that isn't a parseable absolute URL, so a malformed value
 * still compares consistently rather than throwing.
 */
export function normalizeUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  const trimmed = rawUrl.trim();
  const { base, fragment } = splitFragment(trimmed);
  try {
    const u = new URL(base);
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const kept = [...u.searchParams.entries()].filter(([key]) => !isTrackingParam(key));
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const search = new URLSearchParams(kept).toString();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const normalizedBase = `${u.protocol}//${u.hostname}${path}${search ? `?${search}` : ""}`;
    return fragment ? `${normalizedBase}#${fragment}` : normalizedBase;
  } catch {
    return trimmed;
  }
}

function candidateUrls(c: DuplicateCandidate): string[] {
  return [c.officialEventUrl, c.ticketUrl, c.residentAdvisorUrl]
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => u !== null);
}

/**
 * True when both candidates' own official event URL shares the same base
 * path but a DIFFERENT, non-null #fragment — the exact pattern a
 * room-partitioned first-party source (Culture Box: .../fri-28-august/
 * #red-box vs. #black-box) uses to distinguish genuinely different shows
 * that otherwise share one night's door hours, Facebook link, and even RA
 * link. This is a hard veto: it overrides an otherwise-strong shared-URL
 * signal from a DIFFERENT field (ticket/RA), because that shared link
 * represents the whole night, not the specific room/event.
 */
function roomIdentityConflict(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  const an = normalizeUrl(a.officialEventUrl);
  const bn = normalizeUrl(b.officialEventUrl);
  if (!an || !bn) return false;
  const { base: aBase, fragment: aFrag } = splitFragment(an);
  const { base: bBase, fragment: bFrag } = splitFragment(bn);
  return aBase === bBase && aFrag !== null && bFrag !== null && aFrag !== bFrag;
}

/**
 * A shared, essentially-unique identifier: any of the three URL fields on
 * one side exactly equals (after normalization) any of the three URL fields
 * on the other — deliberately cross-field, since a future aggregator's own
 * officialEventUrl (its listing page) is exactly the URL a first-party
 * source already stores as its ticketUrl or residentAdvisorUrl. Doesn't
 * matter which two fields matched; the identity evidence is the same either way.
 */
function sharedUniqueUrl(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  const aUrls = candidateUrls(a);
  const bUrls = candidateUrls(b);
  if (aUrls.length === 0 || bUrls.length === 0) return false;
  const bSet = new Set(bUrls);
  return aUrls.some((u) => bSet.has(u));
}

// ---- Decision model ----

const STRONG_ARTIST_OVERLAP = 0.5;
const STRONG_TITLE_OVERLAP = 0.4;
const REVIEW_ARTIST_OVERLAP = 0; // "any" overlap at all
const REVIEW_TITLE_OVERLAP = 0.25;
const CROSS_VENUE_REVIEW_ARTIST_OVERLAP = 0.5;
const CROSS_VENUE_REVIEW_TITLE_OVERLAP = 0.3;

export function assessDuplicate(a: DuplicateCandidate, b: DuplicateCandidate): DuplicateAssessment {
  const sameVenue = a.venueId !== null && a.venueId === b.venueId;
  const sameNight = sameNightlifeDate(a.startDatetime, b.startDatetime);
  const tSim = titleSimilarity(a.title, b.title);
  const aOverlap = artistOverlap(a.artists, b.artists);
  const base = { titleSimilarity: tSim, artistOverlap: aOverlap, sameVenue, sameNight };

  // Different night is an absolute veto — same date/time is required
  // evidence, never sufficient evidence, so the inverse (different date)
  // stays an absolute disqualifier regardless of every other signal.
  if (!sameNight) {
    return { ...base, confidence: "none", reasons: ["different night — not a candidate duplicate"] };
  }

  // Room-identity conflict is a hard veto that outranks every positive
  // signal, including a shared RA/ticket URL: a room-partitioned venue
  // reuses one such link across genuinely different shows on the same
  // night, so that link is evidence about the NIGHT, not the EVENT.
  const roomConflict = roomIdentityConflict(a, b);
  if (roomConflict) {
    return {
      ...base,
      confidence: "none",
      reasons: ["same base event URL but different room anchor (e.g. #black-box vs #red-box) — different events sharing a night"],
    };
  }

  // Explicitly, cleanly different headliners (both sides declare a lineup,
  // zero names in common) is its own blocking signal — URL equality is
  // strong evidence, but not absolute if there's an explicit event-identity
  // contradiction, so a lineup conflict tempers even a shared URL down to
  // review rather than trusting the URL blindly. Titles close enough to be
  // near-identical (>= 0.6) are treated as the same event under-reporting
  // its lineup on one side, not a real conflict.
  const conflictingHeadliners = a.artists.length > 0 && b.artists.length > 0 && aOverlap === 0 && tSim < 0.6;

  // A shared, essentially-unique URL identifier is the strongest evidence
  // available — but only once the room-identity veto above has cleared.
  if (sharedUniqueUrl(a, b)) {
    if (conflictingHeadliners) {
      return { ...base, confidence: "medium", reasons: ["shared URL, but declared lineups conflict — needs review, not blind trust"] };
    }
    if (sameVenue || a.venueId === null || b.venueId === null) {
      return { ...base, confidence: "high", reasons: ["shared official/ticket/Resident Advisor URL, no venue contradiction"] };
    }
    // The URL evidence is real, but a resolved-venue contradiction is
    // unusual enough (data error, or a genuinely wrong match) to warrant a
    // human before merging rather than trusting the URL blindly.
    return { ...base, confidence: "medium", reasons: ["shared URL across sources, but resolved venues disagree — needs review"] };
  }

  if (conflictingHeadliners) {
    return { ...base, confidence: "none", reasons: ["clearly different headliners, no URL evidence to override that"] };
  }

  // From here on, no unique-identifier URL evidence exists — same night
  // alone, or same night + same venue alone, must never be enough.
  if (!sameVenue) {
    if (aOverlap >= CROSS_VENUE_REVIEW_ARTIST_OVERLAP && tSim >= CROSS_VENUE_REVIEW_TITLE_OVERLAP) {
      return {
        ...base,
        confidence: "medium",
        reasons: ["different venues but strong lineup + title match — possible venue-resolution issue, needs review"],
      };
    }
    return { ...base, confidence: "none", reasons: ["different venue, no unique-identifier URL match — same night alone is not evidence"] };
  }

  // Same venue + same night from here on.
  if (aOverlap >= STRONG_ARTIST_OVERLAP && tSim >= STRONG_TITLE_OVERLAP) {
    return { ...base, confidence: "high", reasons: ["same venue, same night, strong lineup + distinctive-title match"] };
  }
  if (aOverlap > REVIEW_ARTIST_OVERLAP || tSim >= REVIEW_TITLE_OVERLAP) {
    return { ...base, confidence: "medium", reasons: ["same venue, same night, partial lineup/title signal — needs review"] };
  }
  return {
    ...base,
    confidence: "none",
    reasons: ["same venue and night only, no distinctive lineup/title evidence — coincidence, not a candidate duplicate"],
  };
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
