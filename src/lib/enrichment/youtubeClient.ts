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
 * actually is.
 */
async function youtubeGet(path: string, params: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
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
