import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YoutubeDailyQuotaExhaustedError,
  __resetYoutubeDailyQuotaCircuitBreakerForTests,
  getVideoDetails,
  parseIso8601Duration,
  searchVideos,
} from "./youtubeClient";

// The daily-quota circuit breaker (quota-safety review, 2026-09-26) is
// process-local module state shared across every test in this file (all
// import the same module instance) — reset before/after every test so the
// "daily quota exhaustion" describe block below can trip it without
// bleeding into every other describe block's own fetch-mock assertions.
beforeEach(() => {
  __resetYoutubeDailyQuotaCircuitBreakerForTests();
});
afterEach(() => {
  __resetYoutubeDailyQuotaCircuitBreakerForTests();
});

/** The exact error shape confirmed live against Production, 2026-09-25/26. */
const DAILY_QUOTA_EXHAUSTED_BODY = {
  error: {
    code: 429,
    message: "Quota exceeded for quota metric 'Search Queries' and limit 'Search Queries per day' of service 'youtube.googleapis.com' for consumer 'project_number:994147049083'.",
    errors: [{ message: "Quota exceeded...", domain: "global", reason: "rateLimitExceeded" }],
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "RATE_LIMIT_EXCEEDED",
        domain: "googleapis.com",
        metadata: {
          quota_location: "global",
          window_start_time: "1790319600",
          quota_limit: "defaultSearchListPerDayPerProject",
          consumer: "projects/994147049083",
          quota_unit: "1/d/{project}",
          service: "youtube.googleapis.com",
          quota_metric: "youtube.googleapis.com/search_list",
          quota_limit_value: "100",
        },
      },
    ],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("youtubeClient — rate-limit retry (confirmed live, 30-artist benchmark re-validation, 2026-09-25)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.YOUTUBE_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
  });

  it("retries once on HTTP 429 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = searchVideos("Eric Prydz dj set", 5);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting the retry budget and throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, {}));
    vi.stubGlobal("fetch", fetchMock);

    const promise = searchVideos("Eric Prydz dj set", 5).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("never retries a non-429 error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("Eric Prydz dj set", 5)).rejects.toThrow(/HTTP 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("youtubeClient — daily quota exhaustion (backfill safety fix, 2026-09-26)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.YOUTUBE_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
  });

  it("throws YoutubeDailyQuotaExhaustedError immediately, without retrying, when the 429 body names a per-day quota limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("Eric Prydz dj set", 5)).rejects.toBeInstanceOf(YoutubeDailyQuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry budget spent on a daily-quota 429
  });

  it("still retries an ordinary 429 with no quota-limit body (short-window burst, not daily)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = searchVideos("Eric Prydz dj set", 5);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies a 429 on getVideoDetails the same way", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY)));
    await expect(getVideoDetails(["v1"])).rejects.toBeInstanceOf(YoutubeDailyQuotaExhaustedError);
  });
});

describe("youtubeClient — process-local daily-quota circuit breaker (quota-safety review, 2026-09-26)", () => {
  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
  });

  it("trips on the first confirmed daily-quota error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("Eric Prydz dj set", 5)).rejects.toBeInstanceOf(YoutubeDailyQuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a second, different, uncached artist's search.list call does NOT call fetch again once tripped", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("Eric Prydz dj set", 5)).rejects.toBeInstanceOf(YoutubeDailyQuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A completely different query, after the trip: the breaker short-
    // circuits before requireApiKey()/fetch are ever reached.
    await expect(searchVideos("Charlotte de Witte dj set", 5)).rejects.toBeInstanceOf(YoutubeDailyQuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — the second call never touched the network
  });

  it("scoped to search.list only (2026-09-26 follow-up): getVideoDetails (videos.list) still reaches the real network while the search breaker is tripped", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(429, DAILY_QUOTA_EXHAUSTED_BODY)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("Eric Prydz dj set", 5)).rejects.toBeInstanceOf(YoutubeDailyQuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // videos.list is a distinct, much cheaper quota (1 unit vs. 100) — a
    // confirmed search.list exhaustion says nothing about it, so this call
    // goes through the exact same youtubeGet choke point but is NOT
    // short-circuited: it reaches the network for real (and, since the
    // mocked response here also happens to be quota-shaped, correctly
    // still throws YoutubeDailyQuotaExhaustedError from ITS OWN response —
    // the point being fetch was actually called for it).
    await expect(getVideoDetails(["v1"])).rejects.toBeInstanceOf(YoutubeDailyQuotaExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the videos.list call actually hit the network
  });

  it("an ordinary (non-daily-quota) error does NOT trip the breaker — the next call still reaches the network", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("Eric Prydz dj set", 5)).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A later, unrelated call still goes out for real — proves the breaker
    // was never armed by the ordinary failure above.
    const result = await searchVideos("Charlotte de Witte dj set", 5);
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an ordinary HTTP 403 (e.g. missing/invalid key) does NOT trip the breaker either", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, {}))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("Eric Prydz dj set", 5)).rejects.toThrow(/HTTP 403/);
    const result = await searchVideos("Charlotte de Witte dj set", 5);
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("searchVideos", () => {
  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
  });

  it("filters out non-video-kind results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          items: [
            { id: { kind: "youtube#channel", channelId: "c1" }, snippet: { title: "A Channel" } },
            {
              id: { kind: "youtube#video", videoId: "v1" },
              snippet: { title: "A Video", channelId: "c1", channelTitle: "Ch", publishedAt: "2026-01-01", description: "d" },
            },
          ],
        }),
      ),
    );

    const result = await searchVideos("query", 5);
    expect(result).toEqual([{ videoId: "v1", channelId: "c1", title: "A Video", channelTitle: "Ch", publishedAt: "2026-01-01", description: "d" }]);
  });
});

describe("getVideoDetails", () => {
  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
  });

  it("returns [] for an empty id list without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getVideoDetails([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses duration/embeddable/privacyStatus for a batched id list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          items: [{ id: "v1", contentDetails: { duration: "PT1H2M3S" }, status: { embeddable: true, privacyStatus: "public" } }],
        }),
      ),
    );

    const result = await getVideoDetails(["v1", "v2"]);
    expect(result).toEqual([{ videoId: "v1", durationSeconds: 3723, embeddable: true, privacyStatus: "public" }]);
  });
});

describe("parseIso8601Duration", () => {
  it("parses hours/minutes/seconds", () => {
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
  });
});
