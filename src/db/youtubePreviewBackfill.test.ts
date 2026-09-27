import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeDailyQuotaExhaustedError } from "@/lib/enrichment/youtubeClient";
import { cleanArtistDisplayName, normalizeArtistName } from "@/lib/enrichment/genreEnrichment";

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
const PAST = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const SEEN_AT = new Date("2026-09-26T10:00:00.000Z");

interface EventsRow {
  artists: string[];
  startDatetime: Date;
  endDatetime: Date | null;
}

interface DiscoveryRow {
  probableTitle: string;
  probableStart: Date | null;
  probableEnd: Date | null;
  missingFields: string[];
  overallConfidence: "low" | "medium" | "high";
  holdReason: string | null;
  venueResolvedDecision: string | null;
  lastSeenAt: Date | null;
  sourceId: string | null;
  predictedGenre: string | null;
  detectedLineup: string[];
}

interface SourceRow {
  id: string;
  lastCompleteSyncAt: Date | null;
}

let eventsRows: EventsRow[] = [];
let discoveryRows: DiscoveryRow[] = [];
let sourceRows: SourceRow[] = [];
let cacheRows: { n: string }[] = [];

/**
 * Distinguishes buildWorklist's four distinct queries (events / pending
 * discovery_queue / sources / artist_youtube_preview_cache) by the shape of
 * the field-selection object each one passes to db.select(...) — the same
 * shape-based branching this file's mock already used for events vs. cache,
 * extended for the scope fix (2026-09-27) that added the discovery_queue and
 * sources queries.
 */
vi.mock("@/db/client", () => ({
  db: {
    select: (sel: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          if ("artists" in sel) return Promise.resolve(eventsRows);
          if ("detectedLineup" in sel) return Promise.resolve(discoveryRows);
          if ("lastCompleteSyncAt" in sel) return Promise.resolve(sourceRows);
          return Promise.resolve(cacheRows);
        },
      }),
    }),
  },
}));

const getOrMatchMock = vi.fn();
vi.mock("@/lib/enrichment/youtubePreviewMatching", () => ({
  getOrMatchArtistYoutubePreview: (...args: unknown[]) => getOrMatchMock(...args),
}));

const { runApply, shouldAbortImmediately } = await import("./youtubePreviewBackfill");

function baseDiscoveryRow(overrides: Partial<DiscoveryRow> = {}): DiscoveryRow {
  return {
    probableTitle: "Test Night",
    probableStart: null,
    probableEnd: null,
    missingFields: [],
    overallConfidence: "low",
    holdReason: null,
    venueResolvedDecision: null,
    lastSeenAt: null,
    sourceId: null,
    predictedGenre: null,
    detectedLineup: [],
    ...overrides,
  };
}

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

/**
 * Scope fix, 2026-09-27: buildWorklist previously read ONLY current/future-
 * visible published events, so an uncached artist that only ever appeared on
 * a pending Discovery row (Needs Review or Venue Blocked) could never be
 * selected by a scheduled/manual batch, even though the same population is
 * already the approved "relevant" backlog everywhere else (the automatic
 * Discovery-stage enrichment hook, and the read-only backlog-projection
 * diagnostic). buildWorklist itself isn't exported — every case below is
 * observed the same way the rest of this file already observes it: through
 * runApply's real effect (which normalized name it does or doesn't pass to
 * the mocked matcher), never a live YouTube call.
 */
describe("buildWorklist (via runApply) — combined published + Discovery relevant population", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getOrMatchMock.mockReset();
    getOrMatchMock.mockResolvedValue({ status: "accepted", videoId: "vid" });
    eventsRows = [];
    discoveryRows = [];
    sourceRows = [];
    cacheRows = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runAndCollectNames(): Promise<string[]> {
    const promise = runApply(20, 50);
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;
    return getOrMatchMock.mock.calls.map((c) => c[0] as string);
  }

  it("a published-only artist (current/future-visible event) enters the worklist", async () => {
    eventsRows = [{ artists: ["Published Artist"], startDatetime: FUTURE, endDatetime: null }];

    expect(await runAndCollectNames()).toEqual(["Published Artist"]);
  });

  it("a Needs Review Discovery-only artist (admin-originated, no past date) enters the worklist", async () => {
    discoveryRows = [baseDiscoveryRow({ sourceId: null, probableStart: null, detectedLineup: ["NR Artist"] })];

    expect(await runAndCollectNames()).toEqual(["NR Artist"]);
  });

  it("a Venue Blocked Discovery-only artist (registered source, current, venue-unresolved-only) enters the worklist", async () => {
    discoveryRows = [
      baseDiscoveryRow({
        sourceId: "src-test",
        lastSeenAt: SEEN_AT,
        probableStart: FUTURE,
        venueResolvedDecision: "review_queue",
        overallConfidence: "medium",
        detectedLineup: ["VB Artist"],
      }),
    ];
    sourceRows = [{ id: "src-test", lastCompleteSyncAt: SEEN_AT }];

    expect(await runAndCollectNames()).toEqual(["VB Artist"]);
  });

  it("a Rejected (negative_relevance) Discovery row does not enter the worklist", async () => {
    discoveryRows = [
      baseDiscoveryRow({
        sourceId: "src-test",
        lastSeenAt: SEEN_AT,
        probableStart: FUTURE,
        venueResolvedDecision: null,
        holdReason: "negative_relevance",
        detectedLineup: ["Rejected Artist"],
      }),
    ];
    sourceRows = [{ id: "src-test", lastCompleteSyncAt: SEEN_AT }];

    expect(await runAndCollectNames()).toEqual([]);
  });

  it("a Past/Stale Discovery row (admin-originated, resolved past date) does not enter the worklist", async () => {
    discoveryRows = [baseDiscoveryRow({ sourceId: null, probableStart: PAST, detectedLineup: ["PastStale Artist"] })];

    expect(await runAndCollectNames()).toEqual([]);
  });

  it("an Insufficient Evidence Discovery row does not enter the worklist", async () => {
    discoveryRows = [
      baseDiscoveryRow({
        sourceId: "src-test",
        lastSeenAt: SEEN_AT,
        probableStart: FUTURE,
        venueResolvedDecision: null,
        holdReason: "low_confidence",
        overallConfidence: "low",
        detectedLineup: ["Insufficient Artist"],
      }),
    ];
    sourceRows = [{ id: "src-test", lastCompleteSyncAt: SEEN_AT }];

    expect(await runAndCollectNames()).toEqual([]);
  });

  it("the same normalized artist appearing in BOTH a published event and a Discovery row is deduplicated — matched exactly once", async () => {
    eventsRows = [{ artists: ["Shared Artist"], startDatetime: FUTURE, endDatetime: null }];
    discoveryRows = [baseDiscoveryRow({ sourceId: null, probableStart: null, detectedLineup: ["  shared   artist  "] })];

    const names = await runAndCollectNames();
    expect(names).toHaveLength(1);
  });

  it("an already-fresh-cached artist is skipped even though it's a Needs Review Discovery-only entry", async () => {
    discoveryRows = [baseDiscoveryRow({ sourceId: null, probableStart: null, detectedLineup: ["Cached Artist"] })];
    cacheRows = [{ n: normalizeArtistName(cleanArtistDisplayName("Cached Artist")) }];

    expect(await runAndCollectNames()).toEqual([]);
  });

  it("zero combined backlog (no visible events, no Needs Review/Venue Blocked Discovery rows) never calls the matcher", async () => {
    eventsRows = [];
    discoveryRows = [];

    expect(await runAndCollectNames()).toEqual([]);
    expect(getOrMatchMock).not.toHaveBeenCalled();
  });
});
