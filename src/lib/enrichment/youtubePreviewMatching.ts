import { cleanArtistDisplayName, normalizeArtistName } from "./genreEnrichment";

export { cleanArtistDisplayName, normalizeArtistName };
import type { YoutubeSearchItem, YoutubeVideoDetails } from "./youtubeClient";

/**
 * Pure(-ish) YouTube Artist Preview matching orchestration — Rule A only
 * (feasibility audit 2026-09-25, approved for implementation the same day:
 * 100% precision, 0 wrong matches, 53.3% usable-preview coverage on a
 * 30-artist benchmark). The actual YouTube HTTP calls and the Postgres
 * cache are both passed in as small interfaces, exactly mirroring
 * genreEnrichment.ts's own pure/I-O split — this whole module is
 * unit-testable with in-memory fakes, no live DB or network required. Real
 * wiring lives in src/db/youtubePreview.ts.
 *
 * Query strategy departs from the audit's own manual per-artist
 * categorization in one deliberate way: the audit hand-labeled 4 of its 30
 * artists as "live acts" (queried "<artist> live") and the rest "<artist>
 * dj set" — a classification that isn't available for an arbitrary
 * production artist name, since events.artists carries no act-type
 * metadata (see src/db/schema.ts) and adding one would be exactly the kind
 * of broader artist-platform architecture V1 is scoped to avoid. Instead,
 * every artist is queried "<artist> dj set" first; "<artist> live" is
 * tried ONLY when that query yields zero structurally-eligible candidates
 * — a fallback, not a second broad variant issued unconditionally, so a
 * genuine live act (a marching band, a live-PA duo) that "dj set" doesn't
 * surface still gets a fair shot without doubling API usage for every
 * artist.
 */

export type PreviewStatus = "accepted" | "abstain";

export interface ArtistPreviewCacheEntry {
  artistNameNormalized: string;
  provider: "youtube";
  status: PreviewStatus;
  matchRule: "A" | null;
  query: string;
  videoId: string | null;
  videoTitle: string | null;
  channelId: string | null;
  channelTitle: string | null;
  evidence: unknown;
  manualBlock: boolean;
  matchedAt: Date;
  lastVerifiedAt: Date | null;
  expiresAt: Date;
}

export interface ArtistPreviewCacheStore {
  get(artistNameNormalized: string): Promise<ArtistPreviewCacheEntry | null>;
  set(entry: ArtistPreviewCacheEntry): Promise<void>;
}

export interface YoutubePreviewClient {
  searchVideos(query: string, maxResults: number): Promise<YoutubeSearchItem[]>;
  getVideoDetails(videoIds: string[]): Promise<YoutubeVideoDetails[]>;
}

export const MATCH_RULE = "A" as const;
const MAX_SEARCH_RESULTS = 5;
const MIN_DURATION_SECONDS = 20 * 60;
const ACCEPTED_TTL_DAYS = 90;
const ABSTAIN_TTL_DAYS = 30;
export const VERIFY_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Globally-recognized third-party channels validated in the feasibility
 * audit — exact list from the approved decision, never extended here
 * without a fresh audit finding ("only additional channels if they were
 * already proven in the audit and are structurally equivalent"). Exact
 * (normalized) match only — no substring/fuzzy containment, so "Not
 * Tomorrowland Fanpage" never qualifies.
 */
const TRUSTED_CHANNELS = new Set(["boiler room", "tomorrowland", "dgtl", "ukf on air"]);

/**
 * The three generic/common-word collisions the audit actually surfaced
 * (Nat -> HÖR Berlin's own "NAT" resident, unconfirmed; Jersey -> "jersey
 * club" the genre, not an artist; Utopia -> a same-named "UTOPIA" brand
 * channel, unconfirmed identity) — a small, evidence-grounded denylist in
 * the same spirit as PLACEHOLDER_ARTIST_NAMES in genreEnrichment.ts, not a
 * general dictionary lookup (V1 has no corroboration signal — locale/bio
 * text — to distinguish a real generic-name collision from a genuine own
 * channel, so for these specific proven-risky names, own-channel matching
 * is deliberately not trusted at all; only a fully trusted third-party
 * channel can still accept them). Extend this set only when a new
 * production collision is actually confirmed, exactly like this one was.
 */
const AUDIT_CONFIRMED_GENERIC_COLLISION_NAMES = new Set(["nat", "jersey", "utopia"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "warm up set for MEUTE" / "opening for MEUTE" / "support for MEUTE" —
 * confirmed live during 30-artist benchmark validation (2026-09-25):
 * Meute's own channel had uploaded another DJ's warm-up set, titled with
 * "for MEUTE" at the end, which otherwise cleanly passed own-channel +
 * exact-name-in-title. The artist named is the OBJECT of someone else's
 * set in this phrasing, never its subject — a targeted, deterministic
 * exclusion (not fuzzy matching), checked only against the text
 * immediately preceding the matched name.
 */
const SUPPORTING_ACT_CUE = /\b(?:warm(?:ing)?[\s-]?up(?:\s+set)?|opening|support(?:ing)?)\s+for\s*$/i;

/** Exact normalized artist name as a distinct phrase in the title — word-boundary aware over Unicode letters, so "Nat" never matches inside "Nathalie" — and never when the name is the OBJECT of someone else's set (see SUPPORTING_ACT_CUE). */
export function titleContainsExactName(title: string, cleanedName: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(cleanedName)}([^\\p{L}\\p{N}]|$)`, "iu");
  const match = pattern.exec(title);
  if (!match) return false;
  const precedingText = title.slice(0, match.index + match[1].length);
  if (SUPPORTING_ACT_CUE.test(precedingText)) return false;
  return true;
}

const MULTI_BILLING_SEPARATORS = /,|&|(?:\bx\b)|(?:\bvs\.?\b)|(?:\bb2b\b)/gi;
const TITLE_STOP_MARKERS = /\||@|\bat\b|\blive\b|\bdj set\b|\bfestival\b|\bpresents\b|\bfull set\b/i;

/**
 * How many distinct names the title bills before the first
 * venue/event-descriptor marker (e.g. "Sub Focus, Dimension, Culture Shock
 * & 1991: LA Livestream | ..." -> 4; "Kasper Bjørke & Sexy Lazer ... at
 * STRØM" -> 2, tolerated as a two-person B2B). Deterministic string
 * splitting only — never fuzzy similarity.
 */
export function countBilledNames(title: string): number {
  const stop = title.match(TITLE_STOP_MARKERS);
  const relevant = stop ? title.slice(0, stop.index) : title;
  return relevant
    .split(MULTI_BILLING_SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

type ChannelMatch = "own" | "trusted";

interface StructuralCheck {
  eligible: boolean;
  channelMatch: ChannelMatch | null;
  reason: string | null;
}

function checkStructuralEligibility(cleanedName: string, normalized: string, item: YoutubeSearchItem): StructuralCheck {
  if (!titleContainsExactName(item.title, cleanedName)) {
    return { eligible: false, channelMatch: null, reason: "title does not contain the exact artist name" };
  }
  const billed = countBilledNames(item.title);
  if (billed >= 3) {
    return { eligible: false, channelMatch: null, reason: `title bills ${billed} artists (3+ excluded — diluted lineup stream)` };
  }
  const channelNormalized = item.channelTitle.trim().toLowerCase();
  const ownChannel = channelNormalized === normalized;
  const trustedChannel = TRUSTED_CHANNELS.has(channelNormalized);

  if (AUDIT_CONFIRMED_GENERIC_COLLISION_NAMES.has(normalized)) {
    if (trustedChannel) return { eligible: true, channelMatch: "trusted", reason: null };
    return { eligible: false, channelMatch: null, reason: "generic/common-word name — own-channel match alone is not sufficient in Rule A" };
  }
  if (ownChannel) return { eligible: true, channelMatch: "own", reason: null };
  if (trustedChannel) return { eligible: true, channelMatch: "trusted", reason: null };
  return { eligible: false, channelMatch: null, reason: "channel is neither the artist's own nor an allow-listed trusted channel" };
}

interface EligibleCandidate {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  channelMatch: ChannelMatch;
}

interface MatchAttempt {
  query: string;
  candidatesReturned: number;
  structurallyEligible: (EligibleCandidate & { reason?: string })[];
  rejected: { videoId: string; title: string; channelTitle: string; reason: string }[];
  verified: YoutubeVideoDetails[];
  selected: EligibleCandidate | null;
  rejectedAfterVerification: { videoId: string; reason: string }[];
}

/**
 * One query -> structural filter (no API cost) -> a SINGLE batched
 * videos.list call for every structurally-eligible candidate (1 quota unit
 * total, regardless of count) -> pick the first, in original search-rank
 * order, that also clears duration/embeddable/public. This is what lets a
 * lower-ranked candidate beat an invalid rank-1 result without costing
 * more than one search + one enrichment call.
 */
async function attemptMatch(
  cleanedName: string,
  normalized: string,
  query: string,
  client: YoutubePreviewClient,
): Promise<MatchAttempt> {
  const results = await client.searchVideos(query, MAX_SEARCH_RESULTS);
  const structurallyEligible: EligibleCandidate[] = [];
  const rejected: MatchAttempt["rejected"] = [];
  for (const item of results) {
    const check = checkStructuralEligibility(cleanedName, normalized, item);
    if (check.eligible && check.channelMatch) {
      structurallyEligible.push({
        videoId: item.videoId,
        title: item.title,
        channelId: item.channelId,
        channelTitle: item.channelTitle,
        channelMatch: check.channelMatch,
      });
    } else {
      rejected.push({ videoId: item.videoId, title: item.title, channelTitle: item.channelTitle, reason: check.reason ?? "ineligible" });
    }
  }

  if (structurallyEligible.length === 0) {
    return { query, candidatesReturned: results.length, structurallyEligible, rejected, verified: [], selected: null, rejectedAfterVerification: [] };
  }

  const verified = await client.getVideoDetails(structurallyEligible.map((c) => c.videoId));
  const byId = new Map(verified.map((d) => [d.videoId, d]));
  const rejectedAfterVerification: { videoId: string; reason: string }[] = [];
  let selected: EligibleCandidate | null = null;
  for (const candidate of structurallyEligible) {
    const detail = byId.get(candidate.videoId);
    if (!detail) {
      rejectedAfterVerification.push({ videoId: candidate.videoId, reason: "no videos.list result returned" });
      continue;
    }
    if (detail.durationSeconds < MIN_DURATION_SECONDS) {
      rejectedAfterVerification.push({ videoId: candidate.videoId, reason: `duration ${detail.durationSeconds}s below the 20-minute floor` });
      continue;
    }
    if (!detail.embeddable) {
      rejectedAfterVerification.push({ videoId: candidate.videoId, reason: "not embeddable" });
      continue;
    }
    if (detail.privacyStatus !== "public") {
      rejectedAfterVerification.push({ videoId: candidate.videoId, reason: `privacyStatus is "${detail.privacyStatus}", not public` });
      continue;
    }
    selected = candidate;
    break;
  }

  return { query, candidatesReturned: results.length, structurallyEligible, rejected, verified, selected, rejectedAfterVerification };
}

function computeExpiry(status: PreviewStatus, now: Date): Date {
  const days = status === "accepted" ? ACCEPTED_TTL_DAYS : ABSTAIN_TTL_DAYS;
  return new Date(now.getTime() + days * DAY_MS);
}

/**
 * Runs the full Rule A matching flow for one artist name — no cache
 * involved (callers go through getOrMatchArtistYoutubePreview for that).
 * Never throws for "no match found"; only for a genuine API failure
 * (network error, non-2xx, missing key), which the caller (db/
 * youtubePreview.ts, mirroring enrichEventGenre's own per-artist try/catch)
 * treats as "no preview" rather than letting it propagate.
 */
export async function matchArtistYoutubePreview(
  artistNameRaw: string,
  client: YoutubePreviewClient,
): Promise<Omit<ArtistPreviewCacheEntry, "provider" | "manualBlock" | "lastVerifiedAt" | "expiresAt" | "matchedAt">> {
  const cleaned = cleanArtistDisplayName(artistNameRaw);
  const normalized = normalizeArtistName(cleaned);

  const primaryQuery = `${cleaned} dj set`;
  const primaryAttempt = await attemptMatch(cleaned, normalized, primaryQuery, client);

  let finalAttempt = primaryAttempt;
  let fallbackAttempt: MatchAttempt | null = null;
  if (!primaryAttempt.selected) {
    const fallbackQuery = `${cleaned} live`;
    fallbackAttempt = await attemptMatch(cleaned, normalized, fallbackQuery, client);
    if (fallbackAttempt.selected) finalAttempt = fallbackAttempt;
  }

  const evidence = { rawArtistName: artistNameRaw, cleanedName: cleaned, primaryAttempt, fallbackAttempt };

  if (!finalAttempt.selected) {
    return {
      artistNameNormalized: normalized,
      status: "abstain",
      matchRule: null,
      query: fallbackAttempt ? `${primaryQuery} | ${fallbackAttempt.query}` : primaryQuery,
      videoId: null,
      videoTitle: null,
      channelId: null,
      channelTitle: null,
      evidence,
    };
  }

  return {
    artistNameNormalized: normalized,
    status: "accepted",
    matchRule: MATCH_RULE,
    query: finalAttempt.query,
    videoId: finalAttempt.selected.videoId,
    videoTitle: finalAttempt.selected.title,
    channelId: finalAttempt.selected.channelId,
    channelTitle: finalAttempt.selected.channelTitle,
    evidence,
  };
}

/**
 * Cache-first single-artist lookup, mirroring
 * genreEnrichment.ts::getOrLookupArtistGenre exactly. A fresh (unexpired)
 * cache entry is returned as-is UNLESS it's an accepted match whose
 * embeddable/public status hasn't been re-checked in VERIFY_STALE_DAYS —
 * then a single cheap videos.list call (never a new search) re-verifies it
 * and flips it to "abstain" if the video is no longer public/embeddable
 * (item 9: re-verify before serving, degrade safely, never re-search
 * unnecessarily).
 */
export async function getOrMatchArtistYoutubePreview(
  artistNameRaw: string,
  cache: ArtistPreviewCacheStore,
  client: YoutubePreviewClient,
  now: Date = new Date(),
): Promise<ArtistPreviewCacheEntry> {
  const normalized = normalizeArtistName(cleanArtistDisplayName(artistNameRaw));
  const cached = await cache.get(normalized);

  if (cached && cached.expiresAt.getTime() > now.getTime()) {
    if (cached.status !== "accepted" || !cached.videoId) return cached;
    const verifiedAt = cached.lastVerifiedAt ?? cached.matchedAt;
    const staleSince = now.getTime() - verifiedAt.getTime();
    if (staleSince < VERIFY_STALE_DAYS * DAY_MS) return cached;

    const [detail] = await client.getVideoDetails([cached.videoId]);
    const stillGood = detail && detail.embeddable && detail.privacyStatus === "public";
    const reverified: ArtistPreviewCacheEntry = stillGood
      ? { ...cached, lastVerifiedAt: now }
      : {
          ...cached,
          status: "abstain",
          matchRule: null,
          videoId: null,
          videoTitle: null,
          channelId: null,
          channelTitle: null,
          evidence: { ...(typeof cached.evidence === "object" && cached.evidence ? cached.evidence : {}), reverificationFailedAt: now.toISOString(), lastKnownVideoId: cached.videoId },
          lastVerifiedAt: now,
          expiresAt: computeExpiry("abstain", now),
        };
    await cache.set(reverified);
    return reverified;
  }

  const result = await matchArtistYoutubePreview(artistNameRaw, client);
  const entry: ArtistPreviewCacheEntry = {
    ...result,
    provider: "youtube",
    manualBlock: cached?.manualBlock ?? false,
    matchedAt: now,
    lastVerifiedAt: result.status === "accepted" ? now : null,
    expiresAt: computeExpiry(result.status, now),
  };
  await cache.set(entry);
  return entry;
}
