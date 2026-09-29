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
 *
 * Candidate selection (recency preference, 2026-09-27): within ONE query's
 * results, once every Rule A safety check has run (exact name, billed-names
 * limit, own/trusted channel, duration floor, embeddable, public), the
 * NEWEST of the resulting safe candidates is selected — see
 * selectNewestSafeCandidate below. This is a ranking improvement only, never
 * a matching-policy change: it chooses among an already-safe set, never
 * widens which candidates count as safe, and never imposes a maximum video
 * age (a lone safe 3-year-old candidate is still accepted). The
 * primary-vs-fallback relationship is untouched — a safe candidate from the
 * primary "<artist> dj set" query always wins over anything from the
 * "<artist> live" fallback, which only ever runs when the primary query
 * produced zero safe candidates; recency is never compared ACROSS the two
 * queries; only within whichever one is used.
 *
 * Trusted-channel short-suffix guard (2026-09-29): a confirmed false
 * positive ("Benji" matching inside the unrelated "Benji B | Boiler Room
 * London") showed that an exact-name match on a trusted third-party channel
 * is weaker evidence than on an artist's own channel, since a trusted
 * channel hosts many different artists. checkTrustedChannelSuffix (below)
 * narrows trusted-channel eligibility only — own-channel matching is
 * completely unaffected — see its own doc comment for the exact rule.
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

/**
 * Trusted-channel-only short-suffix guard (2026-09-29, confirmed Rule A false
 * positive: "Benji" matched inside "Benji B | Boiler Room London", a
 * different, unrelated artist — see this repo's own investigation notes).
 * A trusted third-party channel (Boiler Room, Tomorrowland, DGTL, UKF on
 * air) hosts sets from many different artists, so an exact-name match there
 * is weaker evidence than an own-channel match: the title can continue past
 * the matched name with ANOTHER short stage name/initial that
 * titleContainsExactName's word-boundary check cannot distinguish from a
 * harmless continuation, since "Benji" is a valid strict prefix of "Benji
 * B" under that check alone. Never applied to own-channel matches (see the
 * two call sites below) — an artist's own channel naming a set after
 * themselves is not ambiguous in the same way.
 *
 * Deliberately narrow, NOT a general allow-list (2026-09-29 review): only a
 * small, curated set of continuations is treated as safe — the existing
 * TITLE_STOP_MARKERS vocabulary, a short explicit collaboration-connector
 * list (b2b/x/vs/ft/feat/w — already tolerated as legitimate multi-billing
 * separators by countBilledNames), and the first word of the channel's own
 * name (e.g. "Boiler" in "Stenny Boiler Room Munich DJ Set"). Anything else
 * that reads as a short (<=2 letter/digit) token immediately after the
 * match — introduced by a space, hyphen, or colon, glued or spaced — is
 * treated as AMBIGUOUS and rejected, forcing abstention rather than a
 * possibly-wrong preview, even if it later turns out to be a harmless
 * version tag (e.g. "V2"): this check has no way to tell a real distinct
 * artist from a coincidental short tag, so it deliberately declines rather
 * than guesses. A glued apostrophe/typographic-quote continuation (e.g.
 * "Sama' Abdulhadi") is the one unconditional exception, because it
 * continues the same name grammatically rather than introducing a new one —
 * unlike a hyphen or colon, which conventionally separate clauses/titles.
 */
const TRUSTED_CHANNEL_SAFE_CONTINUATION_WORDS = new Set([
  "b2b",
  "x",
  "vs",
  "ft",
  "feat",
  "w",
  "live",
  "at",
  "dj",
  "set",
  "festival",
  "presents",
  "full",
]);

function checkTrustedChannelSuffix(title: string, cleanedName: string, channelTitle: string): { safe: boolean; reason: string | null } {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(cleanedName)}([^\\p{L}\\p{N}]|$)`, "iu");
  const match = pattern.exec(title);
  if (!match) return { safe: true, reason: null }; // caller already confirmed a match exists

  const rest = title.slice(match.index + match[1].length + cleanedName.length);
  if (rest.length === 0) return { safe: true, reason: null };
  if (/^['’]/.test(rest)) return { safe: true, reason: null }; // glued apostrophe — same name, not a separator

  const afterSeparators = rest.replace(/^[\s\-:|,@]+/u, "");
  const tokenMatch = /^\p{L}[\p{L}\p{N}]*/u.exec(afterSeparators);
  if (!tokenMatch) return { safe: true, reason: null }; // nothing name-like follows

  const token = tokenMatch[0];
  const tokenLower = token.toLowerCase();
  const channelFirstWord = channelTitle.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (TRUSTED_CHANNEL_SAFE_CONTINUATION_WORDS.has(tokenLower) || tokenLower === channelFirstWord || token.length >= 3) {
    return { safe: true, reason: null };
  }
  return {
    safe: false,
    reason: `possible distinct stage name — trusted-channel match with a short, unrecognized continuation ("${token}")`,
  };
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

  const acceptTrusted = (): StructuralCheck => {
    const suffixCheck = checkTrustedChannelSuffix(item.title, cleanedName, item.channelTitle);
    if (!suffixCheck.safe) return { eligible: false, channelMatch: null, reason: suffixCheck.reason };
    return { eligible: true, channelMatch: "trusted", reason: null };
  };

  if (AUDIT_CONFIRMED_GENERIC_COLLISION_NAMES.has(normalized)) {
    if (trustedChannel) return acceptTrusted();
    return { eligible: false, channelMatch: null, reason: "generic/common-word name — own-channel match alone is not sufficient in Rule A" };
  }
  if (ownChannel) return { eligible: true, channelMatch: "own", reason: null };
  if (trustedChannel) return acceptTrusted();
  return { eligible: false, channelMatch: null, reason: "channel is neither the artist's own nor an allow-listed trusted channel" };
}

interface EligibleCandidate {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  channelMatch: ChannelMatch;
  publishedAt: string;
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
 * total, regardless of count) -> collect every candidate that also clears
 * duration/embeddable/public, then select the NEWEST of those (recency
 * preference, 2026-09-27 — see selectNewestSafeCandidate; search rank never
 * matters for the final pick, only for which candidates get a videos.list
 * call in the first place). This is what lets a lower-ranked candidate beat
 * an invalid rank-1 result, and a newer safe candidate beat an older safe
 * one, without costing more than one search + one batched enrichment call.
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
        publishedAt: item.publishedAt,
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
  const safeCandidates: EligibleCandidate[] = [];
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
    safeCandidates.push(candidate);
  }
  const selected = selectNewestSafeCandidate(safeCandidates);

  return { query, candidatesReturned: results.length, structurallyEligible, rejected, verified, selected, rejectedAfterVerification };
}

/**
 * Recency preference among already-safe candidates (2026-09-27 — a ranking
 * change only, never a matching-policy change): `safeCandidates` has
 * already cleared every Rule A check this module enforces (exact name,
 * channel, billed-names, duration floor, embeddable, public) — this
 * function only decides WHICH of those already-safe candidates to prefer,
 * never whether one is safe. Picks the newest by `publishedAt`; a safe
 * 3-year-old candidate still wins over no candidate at all when it's the
 * only safe one — there is no maximum-age cutoff, only a preference for
 * newer among an already-safe set. Ties or an unparseable publishedAt fall
 * back to original search-rank order (the earlier candidate in the array)
 * so selection stays fully deterministic.
 */
function selectNewestSafeCandidate(safeCandidates: EligibleCandidate[]): EligibleCandidate | null {
  if (safeCandidates.length === 0) return null;
  let best = safeCandidates[0];
  let bestTime = Date.parse(best.publishedAt);
  for (let i = 1; i < safeCandidates.length; i++) {
    const candidate = safeCandidates[i];
    const time = Date.parse(candidate.publishedAt);
    if (Number.isNaN(time)) continue;
    if (Number.isNaN(bestTime) || time > bestTime) {
      best = candidate;
      bestTime = time;
    }
  }
  return best;
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
