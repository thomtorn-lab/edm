import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrMatchArtistYoutubePreview, type ArtistPreviewCacheEntry, type ArtistPreviewCacheStore } from "./youtubePreviewMatching";
import * as youtubeClient from "./youtubeClient";
import { __resetYoutubeDailyQuotaCircuitBreakerForTests } from "./youtubeClient";

/**
 * Integration coverage for the process-local daily-quota circuit breaker
 * (quota-safety review, 2026-09-26), deliberately exercised through the
 * REAL getOrMatchArtistYoutubePreview (Rule A, unchanged) plus the REAL
 * youtubeClient.ts module (only `fetch` itself is stubbed) — every other
 * test file injects a fake YoutubePreviewClient, which would never reach
 * the breaker at all (it's an implementation detail of the concrete
 * client, invisible to the dependency-injected matching logic). This file
 * is the one place that proves the breaker and the matcher actually work
 * together correctly: a fresh cache hit resolves without ever touching the
 * client, and a real failed lookup never caches a false result.
 */

const DAILY_QUOTA_EXHAUSTED_BODY = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "RATE_LIMIT_EXCEEDED",
        metadata: { quota_unit: "1/d/{project}", quota_limit: "defaultSearchListPerDayPerProject" },
      },
    ],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function inMemoryCacheStore(seed: ArtistPreviewCacheEntry[] = []): ArtistPreviewCacheStore {
  const rows = new Map(seed.map((e) => [e.artistNameNormalized, e]));
  return {
    async get(name) {
      return rows.get(name) ?? null;
    },
    async set(entry) {
      rows.set(entry.artistNameNormalized, entry);
    },
  };
}

const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = "test-key";
  __resetYoutubeDailyQuotaCircuitBreakerForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YOUTUBE_API_KEY;
  __resetYoutubeDailyQuotaCircuitBreakerForTests();
});

describe("daily-quota circuit breaker + getOrMatchArtistYoutubePreview integration", () => {
  it("a cached, fresh, accepted artist resolves normally with NO fetch call, even while the breaker is tripped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY)));

    // Trip the breaker first via a real (failing) lookup for an uncached artist.
    const cache = inMemoryCacheStore();
    await expect(getOrMatchArtistYoutubePreview("Some Uncached Artist", cache, youtubeClient)).rejects.toBeInstanceOf(
      youtubeClient.YoutubeDailyQuotaExhaustedError,
    );

    const fetchMock = vi.mocked(fetch);
    const callsAfterTrip = fetchMock.mock.calls.length;
    expect(callsAfterTrip).toBeGreaterThan(0);

    // Now resolve a DIFFERENT, already-cached, fresh, accepted artist — the
    // breaker must never even be consulted for this path, because a fresh
    // cache hit returns before getOrMatchArtistYoutubePreview ever reaches
    // the client.
    const cachedEntry: ArtistPreviewCacheEntry = {
      artistNameNormalized: "eric prydz",
      provider: "youtube",
      status: "accepted",
      matchRule: "A",
      query: "Eric Prydz",
      videoId: "abc123",
      videoTitle: "Eric Prydz Live Set",
      channelId: "c1",
      channelTitle: "Eric Prydz",
      evidence: {},
      manualBlock: false,
      matchedAt: new Date(),
      lastVerifiedAt: new Date(),
      expiresAt: FAR_FUTURE,
    };
    const cacheWithHit = inMemoryCacheStore([cachedEntry]);
    const result = await getOrMatchArtistYoutubePreview("Eric Prydz", cacheWithHit, youtubeClient);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("abc123");
    expect(fetchMock.mock.calls.length).toBe(callsAfterTrip); // no new fetch call
  });

  it("a second, different, uncached artist in the same process fails immediately via the breaker, with no additional fetch call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY)));
    const cache = inMemoryCacheStore();

    await expect(getOrMatchArtistYoutubePreview("Artist One", cache, youtubeClient)).rejects.toBeInstanceOf(
      youtubeClient.YoutubeDailyQuotaExhaustedError,
    );
    const fetchMock = vi.mocked(fetch);
    const callsAfterFirst = fetchMock.mock.calls.length;

    await expect(getOrMatchArtistYoutubePreview("Artist Two", cache, youtubeClient)).rejects.toBeInstanceOf(
      youtubeClient.YoutubeDailyQuotaExhaustedError,
    );
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // second attempt never touched the network
  });

  it("no false abstain is ever cached for an artist whose lookup failed due to daily-quota exhaustion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY)));
    const cache = inMemoryCacheStore();

    await expect(getOrMatchArtistYoutubePreview("Some Uncached Artist", cache, youtubeClient)).rejects.toBeInstanceOf(
      youtubeClient.YoutubeDailyQuotaExhaustedError,
    );

    expect(await cache.get("some uncached artist")).toBeNull();
  });

  it("an ordinary (non-daily-quota) failure does not trip the breaker — a later artist's real lookup still succeeds", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount++;
      // First call: an ordinary 500. Every call after that: a fresh empty
      // 200 response each time (Artist Two may issue more than one search
      // — e.g. a live-fallback query — a Response body can only be read
      // once, so each call needs its own instance).
      return Promise.resolve(callCount === 1 ? jsonResponse(500, {}) : jsonResponse(200, { items: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const cache = inMemoryCacheStore();

    await expect(getOrMatchArtistYoutubePreview("Artist One", cache, youtubeClient)).rejects.toThrow(/HTTP 500/);
    const callsAfterFirst = fetchMock.mock.calls.length;

    // A second artist's lookup still reaches the real network (empty
    // search result(s) -> abstain) — proves the breaker was never armed by
    // the ordinary 500 above.
    const result = await getOrMatchArtistYoutubePreview("Artist Two", cache, youtubeClient);
    expect(result.status).toBe("abstain");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("scoped to search.list only (2026-09-26 follow-up): a stale-but-previously-accepted artist can still be re-verified via videos.list while the search breaker is tripped", async () => {
    // A single global fetch mock has to serve both endpoints here, so it
    // branches on the URL: /search always returns the confirmed
    // daily-quota body (tripping the search-only breaker), while /videos
    // always returns a normal, still-embeddable/public result — proving
    // the two endpoints are independent once the breaker is armed.
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/search")) return Promise.resolve(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY));
      return Promise.resolve(
        jsonResponse(200, {
          items: [{ id: "stale-video-id", contentDetails: { duration: "PT5M0S" }, status: { embeddable: true, privacyStatus: "public" } }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // Trip the search breaker first via a real (failing) search lookup for
    // an unrelated, uncached artist.
    const cache = inMemoryCacheStore();
    await expect(getOrMatchArtistYoutubePreview("Some Uncached Artist", cache, youtubeClient)).rejects.toBeInstanceOf(
      youtubeClient.YoutubeDailyQuotaExhaustedError,
    );
    const callsAfterTrip = fetchMock.mock.calls.length;
    expect(callsAfterTrip).toBeGreaterThan(0);

    // A different, previously-accepted artist whose cache entry is fresh
    // (expiresAt still in the future) but stale for re-verification
    // purposes (lastVerifiedAt well past VERIFY_STALE_DAYS) must still be
    // re-verified via getVideoDetails (videos.list) — never blocked by the
    // search-only breaker, and never re-searched.
    const staleAcceptedEntry: ArtistPreviewCacheEntry = {
      artistNameNormalized: "stale artist",
      provider: "youtube",
      status: "accepted",
      matchRule: "A",
      query: "Stale Artist",
      videoId: "stale-video-id",
      videoTitle: "Stale Artist Live Set",
      channelId: "c2",
      channelTitle: "Stale Artist",
      evidence: {},
      manualBlock: false,
      matchedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      lastVerifiedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      expiresAt: FAR_FUTURE,
    };
    const cacheWithStale = inMemoryCacheStore([staleAcceptedEntry]);
    const result = await getOrMatchArtistYoutubePreview("Stale Artist", cacheWithStale, youtubeClient);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("stale-video-id");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterTrip); // the videos.list re-verification actually hit the network
  });
});
