/**
 * Minimal YouTube Data API v3 client for the automated Artist Preview
 * matcher (Rule A only — feasibility audit 2026-09-25, approved for
 * implementation the same day: 100% precision, 0 wrong matches, 53.3%
 * usable-preview coverage on a 30-artist benchmark). Every useful endpoint
 * requires a key as a `key=` query parameter (confirmed live during the
 * audit: unauthenticated search.list returns HTTP 403 PERMISSION_DENIED) —
 * unlike src/lib/enrichment/discogsClient.ts's Discogs token, there is no
 * unauthenticated fallback. See src/lib/enrichment/youtubePreviewMatching.ts
 * for the matching logic this feeds, and src/db/inspectSource.ts's
 * `--with-credentials --source=src-youtube` branch for the diagnostic
 * sibling of this same key-in-URL-never-logged discipline.
 */

const YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3";
const USER_AGENT = "ElectronicCPHArtistPreview/1.0 (+https://electroniccph.com/about; artist-preview)";
const DEFAULT_TIMEOUT_MS = 8_000;

export interface YoutubeSearchItem {
  videoId: string;
  channelId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  description: string;
}

export interface YoutubeVideoDetails {
  videoId: string;
  durationSeconds: number;
  embeddable: boolean;
  privacyStatus: string;
}

/** Video length, e.g. "PT1H2M3S" -> 3723. Malformed/missing input -> 0 (never a valid "set"). */
export function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function requireApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  return key;
}

const RATE_LIMIT_RETRY_DELAYS_MS = [1000, 2000]; // confirmed live, 30-artist benchmark re-validation (2026-09-25): a burst of ~30 rapid sequential lookups can trip YouTube's short-window rate limit (HTTP 429) well before the daily quota is anywhere near exhausted

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thrown when a YouTube API 429 response's own error body explicitly
 * identifies DAILY search-quota exhaustion (backfill safety fix,
 * 2026-09-26 — confirmed live: Google's error response names the limit
 * `defaultSearchListPerDayPerProject` / `quota_unit: "1/d/{project}"`).
 * Distinguished from a plain rate-limit Error specifically so a batch
 * runner (src/db/youtubePreviewBackfill.ts) can abort immediately rather
 * than waiting for several ordinary/transient failures in a row — more of
 * the same daily-quota error will not resolve by retrying or continuing.
 */
export class YoutubeDailyQuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubeDailyQuotaExhaustedError";
  }
}

/**
 * Process-local daily-quota circuit breaker (quota-safety review,
 * 2026-09-26) — automatic Discovery-stage enrichment (src/db/writes.ts::
 * triggerDiscoveryEnrichment) can run this client many times across many
 * rows within one process lifetime, unlike the one-shot manual backfill
 * script (src/db/youtubePreviewBackfill.ts), which has its own, separate,
 * more aggressive whole-run abort (shouldAbortImmediately) and never
 * reaches this flag at all — it calls getOrMatchArtistYoutubePreview
 * directly, bypassing nothing here, so this is purely additive for it.
 * Once a real 429 response has been confirmed (structurally, not merely
 * HTTP-429-shaped — see isDailyQuotaExhaustedBody) to be DAILY quota
 * exhaustion, every subsequent real request this same process would
 * otherwise make is guaranteed-futile until the quota resets — tomorrow, a
 * boundary this process has no reliable way to compute (timezone/exact
 * reset instant are Google-internal), so V1 deliberately never tries: the
 * flag simply never clears itself. A fresh serverless instance/process
 * gets a fresh flag and is free to try again — this is intentionally NOT
 * cross-process/cross-request coordination (no DB row, no cache entry, no
 * scheduler), just the smallest guard that stops a single already-running
 * process from repeating known-futile requests. Lives here (the one real
 * network boundary — youtubeGet, below) rather than in
 * youtubePreviewMatching.ts or db/youtubePreview.ts, so it protects every
 * caller uniformly without touching the matching heuristic (Rule A) or
 * either orchestration layer at all: a fresh cache hit inside
 * getOrMatchArtistYoutubePreview already returns before ever reaching this
 * client, so cached previews keep resolving completely normally while this
 * is tripped.
 */
let dailyQuotaExhausted = false;

/** Test-only reset — never used by product code. Keeps this module's tests independent despite the shared process-local flag above. */
export function __resetYoutubeDailyQuotaCircuitBreakerForTests(): void {
  dailyQuotaExhausted = false;
}

/**
 * True only when the parsed error body's `error.details[]` carries a
 * per-day quota signal (Google's own ErrorInfo `metadata.quota_unit`
 * matching "1/d/..." or `metadata.quota_limit` naming a "PerDay" limit) —
 * a structural check against the documented shape of this specific error,
 * never inferred from the HTTP 429 status alone (a 429 can just as well be
 * a short-window burst limit, which this must NOT match).
 */
function isDailyQuotaExhaustedBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const details = (body as { error?: { details?: unknown } }).error?.details;
  if (!Array.isArray(details)) return false;
  return details.some((detail) => {
    if (!detail || typeof detail !== "object") return false;
    const metadata = (detail as { metadata?: { quota_unit?: unknown; quota_limit?: unknown } }).metadata;
    const quotaUnit = typeof metadata?.quota_unit === "string" ? metadata.quota_unit : "";
    const quotaLimit = typeof metadata?.quota_limit === "string" ? metadata.quota_limit : "";
    return /^1\/d\//.test(quotaUnit) || /PerDay/i.test(quotaLimit);
  });
}

/**
 * The composed URL (key included) lives only in this function's local
 * `url` variable, passed straight to fetch() — never assigned anywhere a
 * caller could log or an error message could echo (errors below reference
 * `path`, never `url`), mirroring inspectSource.ts's own with-credentials
 * discipline for this exact API.
 *
 * Retries a 429 (rate limit) with a short backoff, up to
 * RATE_LIMIT_RETRY_DELAYS_MS.length times — never any other status, and
 * never a second retry beyond that fixed, small budget. Without this, a
 * transient rate-limit during ingestion would silently degrade a real
 * artist match to "no preview" rather than the temporary condition it
 * actually is. A 429 whose body explicitly names daily-quota exhaustion
 * skips the retry budget entirely and throws immediately (2026-09-26) —
 * retrying within the same second cannot help a quota that resets once a
 * day, so there's nothing to wait out here.
 */
async function youtubeGet(path: string, params: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  // Circuit breaker (see dailyQuotaExhausted's own doc comment above) —
  // checked first, before even reading the API key, so a tripped process
  // never issues another real request no matter which endpoint called us.
  if (dailyQuotaExhausted) {
    throw new YoutubeDailyQuotaExhaustedError(`YouTube daily search quota already confirmed exhausted this process — skipping ${path}`);
  }
  const key = requireApiKey();
  const url = new URL(`${YOUTUBE_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);

  let lastStatus = 0;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (res.status === 429) {
      const body = await res.json().catch(() => null);
      if (isDailyQuotaExhaustedBody(body)) {
        dailyQuotaExhausted = true;
        throw new YoutubeDailyQuotaExhaustedError(`YouTube daily search quota exhausted (HTTP 429) for ${path}`);
      }
    }
    if (res.status !== 429 || attempt === RATE_LIMIT_RETRY_DELAYS_MS.length) break;
    await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
  }
  throw new Error(`YouTube API request failed: HTTP ${lastStatus} for ${path}`);
}

/**
 * search.list, video-kind results only (channel-kind results occasionally
 * appear even with type=video — a documented live anomaly from the
 * feasibility audit — and are never useful for a video preview, so they're
 * filtered out here rather than leaking a partial/ambiguous shape
 * downstream). 100 quota units per call.
 */
export async function searchVideos(query: string, maxResults: number): Promise<YoutubeSearchItem[]> {
  const data = (await youtubeGet("/search", {
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(maxResults),
  })) as {
    items?: {
      id?: { kind?: string; videoId?: string };
      snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; description?: string };
    }[];
  };
  return (data.items ?? [])
    .filter((item) => item.id?.kind === "youtube#video" && item.id.videoId)
    .map((item) => ({
      videoId: item.id!.videoId!,
      channelId: item.snippet?.channelId ?? "",
      title: item.snippet?.title ?? "",
      channelTitle: item.snippet?.channelTitle ?? "",
      publishedAt: item.snippet?.publishedAt ?? "",
      description: item.snippet?.description ?? "",
    }));
}

/**
 * videos.list, batched — YouTube accepts a comma-separated `id` list in ONE
 * call (1 quota unit total, regardless of how many ids), so every
 * structurally-eligible candidate for an artist can be enriched together
 * instead of one call per candidate. See youtubePreviewMatching.ts's
 * matchArtistYoutubePreview for how this keeps API usage bounded while
 * still letting a lower-ranked candidate beat an invalid rank-1 result.
 */
export async function getVideoDetails(videoIds: string[]): Promise<YoutubeVideoDetails[]> {
  if (videoIds.length === 0) return [];
  const data = (await youtubeGet("/videos", {
    part: "contentDetails,status",
    id: videoIds.join(","),
  })) as {
    items?: {
      id?: string;
      contentDetails?: { duration?: string };
      status?: { embeddable?: boolean; privacyStatus?: string };
    }[];
  };
  return (data.items ?? []).map((item) => ({
    videoId: item.id ?? "",
    durationSeconds: parseIso8601Duration(item.contentDetails?.duration ?? ""),
    embeddable: item.status?.embeddable ?? false,
    privacyStatus: item.status?.privacyStatus ?? "unknown",
  }));
}
