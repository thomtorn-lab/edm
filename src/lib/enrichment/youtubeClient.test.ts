import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVideoDetails, parseIso8601Duration, searchVideos } from "./youtubeClient";

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
