import type { YoutubeSearchItem } from "./youtubeClient";
import {
  checkStructuralEligibility,
  cleanArtistDisplayName,
  MIN_DURATION_SECONDS,
  MULTI_BILLING_SEPARATORS,
  normalizeArtistName,
  TITLE_STOP_MARKERS,
  TRUSTED_CHANNEL_SAFE_CONTINUATION_WORDS,
  type ChannelMatch,
} from "./youtubePreviewMatching";

/**
 * OFFLINE replay of proposed Rule A identity checks against the evidence
 * already stored on artist_youtube_preview_cache rows (YouTube preview
 * enrichment plan, 2026-10-14). REPORT-ONLY: nothing in production calls
 * this module, it never calls YouTube, and it never decides anything on its
 * own — it only answers "if these extra checks had existed, which existing
 * accepted matches would they have touched, and how?" so a human can review
 * every affected match before any rule is ever enforced.
 *
 * Every stored match keeps the candidates its searches returned
 * (evidence.primaryAttempt / fallbackAttempt: structurallyEligible, rejected,
 * verified), so the replay needs no new API calls. Its limits are reported,
 * never guessed:
 * - a candidate that was never verified (videos.list) cannot become a new
 *   match offline — it is listed as "needs verification";
 * - when no primary-query candidate survives, the "<artist> live" fallback
 *   query would have run, but it was never run for rows that matched on the
 *   primary query — reported as "needs_fallback_query", not as a new match.
 *
 * Principle (owner decision, 2026-10-14): a current match is never replaced
 * just because another candidate would now rank higher. If the current
 * video still passes every proposed check, the outcome is "unchanged".
 */

export type ProposedRule = "trusted_channel_space_continuation" | "name_in_billing_position";

export const PROPOSED_RULES: Record<ProposedRule, string> = {
  trusted_channel_space_continuation:
    "On a trusted channel (Boiler Room, Tomorrowland, DGTL, UKF On Air), a word that follows the artist name after only a space must be a known safe word, the channel's own first word, or contain a digit — otherwise it may be part of a longer, different stage name (DASHA → \"Dasha Rush\").",
  name_in_billing_position:
    "The artist name must start one of the names billed at the start of the title (before the first |, @, at, live, dj set, festival, presents, full set marker) — not appear only in the venue/event position (Intercell → \"… at Intercell x Glitch Festival\") or after a description (ADELINA → \"AFRO DJ AUDIO SET 2026 - ADELINA.\").",
};

interface StoredCandidate {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
}

interface StoredVerified {
  videoId: string;
  durationSeconds: number;
  embeddable: boolean;
  privacyStatus: string;
}

interface StoredAttempt {
  query: string;
  candidates: StoredCandidate[];
  verified: Map<string, StoredVerified>;
  selectedVideoId: string | null;
}

export interface ParsedEvidence {
  cleanedName: string;
  normalized: string;
  primary: StoredAttempt | null;
  fallback: StoredAttempt | null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseAttempt(value: unknown): StoredAttempt | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const seen = new Set<string>();
  const candidates: StoredCandidate[] = [];
  // Search-rank order is not stored as one list: eligible and rejected
  // candidates are kept separately. Eligible ones come first here, which
  // only matters as a tie-break when publishedAt is missing or equal.
  for (const list of [raw.structurallyEligible, raw.rejected]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      const videoId = asString(c.videoId);
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      candidates.push({
        videoId,
        title: asString(c.title),
        channelId: asString(c.channelId),
        channelTitle: asString(c.channelTitle),
        publishedAt: asString(c.publishedAt),
      });
    }
  }
  const verified = new Map<string, StoredVerified>();
  if (Array.isArray(raw.verified)) {
    for (const item of raw.verified) {
      if (!item || typeof item !== "object") continue;
      const v = item as Record<string, unknown>;
      const videoId = asString(v.videoId);
      if (!videoId) continue;
      verified.set(videoId, {
        videoId,
        durationSeconds: typeof v.durationSeconds === "number" ? v.durationSeconds : 0,
        embeddable: v.embeddable === true,
        privacyStatus: asString(v.privacyStatus),
      });
    }
  }
  const selected = raw.selected && typeof raw.selected === "object" ? asString((raw.selected as Record<string, unknown>).videoId) || null : null;
  return { query: asString(raw.query), candidates, verified, selectedVideoId: selected };
}

/** Parses a cache row's evidence jsonb. Returns null when it holds no replayable search attempt (e.g. a manual-block seed row). */
export function parseEvidence(evidence: unknown, fallbackName: string): ParsedEvidence | null {
  if (!evidence || typeof evidence !== "object") return null;
  const raw = evidence as Record<string, unknown>;
  const primary = parseAttempt(raw.primaryAttempt);
  if (!primary) return null;
  const cleanedName = asString(raw.cleanedName) || cleanArtistDisplayName(asString(raw.rawArtistName) || fallbackName);
  return { cleanedName, normalized: normalizeArtistName(cleanedName), primary, fallback: parseAttempt(raw.fallbackAttempt) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namePattern(cleanedName: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(cleanedName)}([^\\p{L}\\p{N}]|$)`, "iu");
}

/** Proposed check 1 — see PROPOSED_RULES.trusted_channel_space_continuation. Only evaluated for trusted-channel matches. */
export function trustedChannelSpaceContinuationOk(title: string, cleanedName: string, channelTitle: string): boolean {
  const match = namePattern(cleanedName).exec(title);
  if (!match) return true;
  const rest = title.slice(match.index + match[1].length + cleanedName.length);
  const spaced = /^ +(\p{L}[\p{L}\p{N}]*)/u.exec(rest);
  if (!spaced) return true; // end of title, or a separator (| - – — : , @) starts a new clause
  const token = spaced[1];
  const lower = token.toLowerCase();
  const channelFirstWord = channelTitle.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return TRUSTED_CHANNEL_SAFE_CONTINUATION_WORDS.has(lower) || lower === channelFirstWord || /\p{N}/u.test(token);
}

/** Proposed check 2 — see PROPOSED_RULES.name_in_billing_position. */
export function nameInBillingPosition(title: string, cleanedName: string): boolean {
  // A leading bracketed tag ("[FULL SET] Peggy Gou | Boiler Room") is not
  // part of the billing — skip it before looking for the first stop marker.
  const untagged = title.replace(/^\s*(?:[[(【][^\])】]*[\])】]\s*)+/u, "");
  const stop = untagged.match(TITLE_STOP_MARKERS);
  const billing = stop ? untagged.slice(0, stop.index) : untagged;
  const startsWithName = new RegExp(`^${escapeRegExp(cleanedName)}([^\\p{L}\\p{N}]|$)`, "iu");
  return billing
    .split(MULTI_BILLING_SEPARATORS)
    .map((part) => part.replace(/^[^\p{L}\p{N}]+/u, ""))
    .some((part) => startsWithName.test(part));
}

export function proposedRuleFailures(title: string, cleanedName: string, channelTitle: string, channelMatch: ChannelMatch): ProposedRule[] {
  const failures: ProposedRule[] = [];
  if (channelMatch === "trusted" && !trustedChannelSpaceContinuationOk(title, cleanedName, channelTitle)) {
    failures.push("trusted_channel_space_continuation");
  }
  if (!nameInBillingPosition(title, cleanedName)) failures.push("name_in_billing_position");
  return failures;
}

function toSearchItem(c: StoredCandidate): YoutubeSearchItem {
  return { videoId: c.videoId, channelId: c.channelId, title: c.title, channelTitle: c.channelTitle, publishedAt: c.publishedAt, description: "" };
}

function technicallySafe(v: StoredVerified | undefined): boolean {
  return !!v && v.durationSeconds >= MIN_DURATION_SECONDS && v.embeddable && v.privacyStatus === "public";
}

interface ReplayedCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  /** Today's production Rule A structural check, re-run on the stored candidate. */
  currentRules: { eligible: boolean; channelMatch: ChannelMatch | null; reason: string | null };
  proposedFailures: ProposedRule[];
  /** Stored videos.list result passes duration/embeddable/public. undefined = never verified. */
  technicallySafe: boolean | undefined;
}

function replayAttempt(attempt: StoredAttempt, cleanedName: string, normalized: string): ReplayedCandidate[] {
  return attempt.candidates.map((c) => {
    const check = checkStructuralEligibility(cleanedName, normalized, toSearchItem(c));
    const proposedFailures = check.eligible && check.channelMatch ? proposedRuleFailures(c.title, cleanedName, c.channelTitle, check.channelMatch) : [];
    const v = attempt.verified.get(c.videoId);
    return {
      videoId: c.videoId,
      title: c.title,
      channelTitle: c.channelTitle,
      publishedAt: c.publishedAt,
      currentRules: { eligible: check.eligible, channelMatch: check.channelMatch, reason: check.reason },
      proposedFailures,
      technicallySafe: v ? technicallySafe(v) : undefined,
    };
  });
}

/** Same newest-first preference as production's selectNewestSafeCandidate; ties and unparseable dates keep list order. */
function newest(candidates: ReplayedCandidate[]): ReplayedCandidate | null {
  let best: ReplayedCandidate | null = null;
  let bestTime = Number.NaN;
  for (const c of candidates) {
    const time = Date.parse(c.publishedAt);
    if (!best) {
      best = c;
      bestTime = time;
      continue;
    }
    if (Number.isNaN(time)) continue;
    if (Number.isNaN(bestTime) || time > bestTime) {
      best = c;
      bestTime = time;
    }
  }
  return best;
}

export type ReplayOutcome =
  /** The current video passes today's rules and every proposed check — nothing would change. */
  | "unchanged"
  /** The current video fails a check; another stored, already-verified candidate from the same query passes everything. Shown for review only — never applied automatically. */
  | "other_candidate_available"
  /** The current video fails a check; no stored candidate passes, and the primary query would fall through to the "live" fallback, which was never run for this row. */
  | "needs_fallback_query"
  /** The current video fails a check; no stored candidate passes and no further query exists — this row would have abstained. */
  | "would_abstain"
  /** The evidence has no replayable search attempt (e.g. a manual-block seed row or a pre-evidence row). */
  | "not_replayable";

export interface AcceptedRowInput {
  artistNameNormalized: string;
  videoId: string | null;
  videoTitle: string | null;
  channelTitle: string | null;
  manualBlock: boolean;
  evidence: unknown;
}

export interface AcceptedReplay {
  artist: string;
  videoId: string | null;
  videoTitle: string | null;
  channelTitle: string | null;
  manualBlock: boolean;
  outcome: ReplayOutcome;
  /** Which attempt produced the current match. */
  matchedOn: "primary" | "fallback" | "unknown";
  channelMatch: ChannelMatch | null;
  /** Today's production rules no longer accept the current video (e.g. a match made before the 2026-09-29 short-suffix guard). */
  failsCurrentRules: boolean;
  currentRulesReason: string | null;
  proposedFailures: ProposedRule[];
  alternative: { videoId: string; title: string; channelTitle: string } | null;
  /** Stored candidates that would pass every rule but were never verified — they could only become a match after a new videos.list call. */
  unverifiedPassingCandidates: number;
}

export function replayAcceptedRow(row: AcceptedRowInput): AcceptedReplay {
  const base = {
    artist: row.artistNameNormalized,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    channelTitle: row.channelTitle,
    manualBlock: row.manualBlock,
  };
  const parsed = parseEvidence(row.evidence, row.artistNameNormalized);
  const empty = {
    matchedOn: "unknown" as const,
    channelMatch: null,
    failsCurrentRules: false,
    currentRulesReason: null,
    proposedFailures: [],
    alternative: null,
    unverifiedPassingCandidates: 0,
  };
  if (!parsed || !row.videoId) return { ...base, ...empty, outcome: "not_replayable" };

  const attempts: { kind: "primary" | "fallback"; attempt: StoredAttempt }[] = [];
  if (parsed.primary) attempts.push({ kind: "primary", attempt: parsed.primary });
  if (parsed.fallback) attempts.push({ kind: "fallback", attempt: parsed.fallback });
  const owning = attempts.find((a) => a.attempt.candidates.some((c) => c.videoId === row.videoId));
  if (!owning) return { ...base, ...empty, outcome: "not_replayable" };

  const replayed = replayAttempt(owning.attempt, parsed.cleanedName, parsed.normalized);
  const current = replayed.find((c) => c.videoId === row.videoId)!;
  const failsCurrentRules = !current.currentRules.eligible;
  const common = {
    matchedOn: owning.kind,
    channelMatch: current.currentRules.channelMatch,
    failsCurrentRules,
    currentRulesReason: current.currentRules.reason,
    proposedFailures: current.proposedFailures,
  };

  const passesAll = (c: ReplayedCandidate) => c.currentRules.eligible && c.proposedFailures.length === 0;
  const unverifiedPassingCandidates = replayed.filter((c) => c.videoId !== row.videoId && passesAll(c) && c.technicallySafe === undefined).length;

  if (passesAll(current)) {
    return { ...base, ...common, outcome: "unchanged", alternative: null, unverifiedPassingCandidates };
  }

  const alternative = newest(replayed.filter((c) => c.videoId !== row.videoId && passesAll(c) && c.technicallySafe === true));
  if (alternative) {
    return {
      ...base,
      ...common,
      outcome: "other_candidate_available",
      alternative: { videoId: alternative.videoId, title: alternative.title, channelTitle: alternative.channelTitle },
      unverifiedPassingCandidates,
    };
  }
  const outcome: ReplayOutcome = owning.kind === "primary" && !parsed.fallback ? "needs_fallback_query" : "would_abstain";
  return { ...base, ...common, outcome, alternative: null, unverifiedPassingCandidates };
}
