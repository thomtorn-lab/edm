import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeDailyQuotaExhaustedError } from "@/lib/enrichment/youtubeClient";

/**
 * Daily-quota immediate-abort safety fix (2026-09-26, confirmed live: a
 * resumed batch re-hit YouTube's daily search-quota 429 on its very first
 * lookup, twice, and the old 5-consecutive-failure guard let it burn
 * through several more guaranteed-to-fail lookups before stopping).
 * shouldAbortImmediately is tested directly (pure, no mocking needed);
 * runApply's loop is tested with the DB and matcher mocked — never a live
 * YouTube call, per the product decision that this fix must be validated
 * with unit tests/mocks only.
 */

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

interface EventsRow {
  artists: string[];
  startDatetime: Date;
  endDatetime: Date | null;
}

let eventsRows: EventsRow[] = [];
const cacheRows: { n: string }[] = [];

vi.mock("@/db/client", () => ({
  db: {
    select: (sel: Record<string, unknown>) => ({
      from: () => ({
        where: () => Promise.resolve("artists" in sel ? eventsRows : cacheRows),
      }),
    }),
  },
}));

const getOrMatchMock = vi.fn();
vi.mock("@/lib/enrichment/youtubePreviewMatching", () => ({
  getOrMatchArtistYoutubePreview: (...args: unknown[]) => getOrMatchMock(...args),
}));

const { runApply, shouldAbortImmediately } = await import("./youtubePreviewBackfill");

describe("shouldAbortImmediately", () => {
  it("is true for YoutubeDailyQuotaExhaustedError", () => {
    expect(shouldAbortImmediately(new YoutubeDailyQuotaExhaustedError("daily quota exhausted"))).toBe(true);
  });

  it("is false for an ordinary Error", () => {
    expect(shouldAbortImmediately(new Error("network blip"))).toBe(false);
  });

  it("is false for a non-Error thrown value", () => {
    expect(shouldAbortImmediately("some string")).toBe(false);
  });
});

describe("runApply — daily-quota vs. ordinary failure abort behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getOrMatchMock.mockReset();
    eventsRows = [
      { artists: ["Artist A", "Artist B", "Artist C", "Artist D", "Artist E", "Artist F"], startDatetime: FUTURE, endDatetime: null },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts after exactly 1 attempt on a confirmed daily-quota error — never waits for 5 consecutive failures", async () => {
    getOrMatchMock.mockRejectedValue(new YoutubeDailyQuotaExhaustedError("YouTube daily search quota exhausted (HTTP 429) for /search"));

    const promise = runApply(20, 6);
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(getOrMatchMock).toHaveBeenCalledTimes(1);
  });

  it("still requires 5 consecutive ordinary failures before aborting (existing guard unchanged)", async () => {
    getOrMatchMock.mockRejectedValue(new Error("YouTube API request failed: HTTP 500 for /search"));

    const promise = runApply(20, 6);
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(getOrMatchMock).toHaveBeenCalledTimes(5);
  });

  it("never counts a daily-quota failure as accepted or abstained (no false abstain)", async () => {
    getOrMatchMock.mockRejectedValue(new YoutubeDailyQuotaExhaustedError("daily quota exhausted"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const promise = runApply(20, 6);
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    // getOrMatchArtistYoutubePreview is the ONLY thing that ever writes to the
    // cache (via its own internal cache.set) — it rejected here, so it never
    // reached the point of returning (and therefore never cached) an
    // accepted or abstained result.
    const summaryLine = logSpy.mock.calls.map((c) => String(c[0])).find((line) => line.includes("Summary before abort"));
    logSpy.mockRestore();
    expect(summaryLine).toMatch(/accepted=0 abstained=0 failed=1/);
  });
});

describe("runApply — --artist single-name scoping (2026-09-26 smoke-test addition)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getOrMatchMock.mockReset();
    eventsRows = [
      { artists: ["Artist A", "Artist B", "Eric Prydz", "Artist D"], startDatetime: FUTURE, endDatetime: null },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes only the named artist, ignoring --limit and every other uncached name", async () => {
    getOrMatchMock.mockResolvedValue({ status: "accepted", videoId: "abc123" });

    const promise = runApply(20, 50, "Eric Prydz");
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(getOrMatchMock).toHaveBeenCalledTimes(1);
    expect(getOrMatchMock).toHaveBeenCalledWith("Eric Prydz", expect.anything(), expect.anything());
  });

  it("matches case/whitespace-insensitively via the same normalization the worklist uses", async () => {
    getOrMatchMock.mockResolvedValue({ status: "accepted", videoId: "abc123" });

    const promise = runApply(20, 50, "  eric   prydz  ");
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(getOrMatchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing (and never calls the matcher) when the named artist isn't an uncached visible-event entry", async () => {
    const promise = runApply(20, 50, "Nonexistent Artist");
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(getOrMatchMock).not.toHaveBeenCalled();
  });
});
