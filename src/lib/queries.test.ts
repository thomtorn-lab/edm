import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused on getArtistYoutubePreviewForLineup's deploy-ordering safety
 * (2026-09-25 review): the event-detail page awaits this function with no
 * try/catch of its own (src/app/events/[slug]/page.tsx), so a query
 * failure here — most notably artist_youtube_preview_cache not existing
 * yet, if application code ever ships before its migration runs — must
 * degrade to "no preview" rather than fail the entire page render.
 */

let selectShouldThrow = false;
let selectResult: unknown[] = [];
const selectMock = vi.fn(() => ({
  from: () => ({
    where: () => {
      if (selectShouldThrow) throw new Error('relation "artist_youtube_preview_cache" does not exist');
      return Promise.resolve(selectResult);
    },
  }),
}));
vi.mock("@/db/client", () => ({
  db: { select: () => selectMock() },
}));

const { getArtistYoutubePreviewForLineup, getArtistPreviewAvailabilityForLineups } = await import("./queries");

beforeEach(() => {
  selectMock.mockClear();
  selectShouldThrow = false;
  selectResult = [];
});

describe("getArtistYoutubePreviewForLineup", () => {
  it("returns null for an empty lineup without querying the DB", async () => {
    const result = await getArtistYoutubePreviewForLineup([]);
    expect(result).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns the first accepted, non-blocked match in lineup order", async () => {
    selectResult = [
      { artistNameNormalized: "eric prydz", status: "accepted", manualBlock: false, videoId: "v1", videoTitle: "Eric Prydz Set", channelTitle: "Eric Prydz" },
    ];
    const result = await getArtistYoutubePreviewForLineup(["Eric Prydz"]);
    expect(result).toEqual({ artistName: "Eric Prydz", videoId: "v1", videoTitle: "Eric Prydz Set", channelTitle: "Eric Prydz" });
  });

  it("skips a manually-blocked match", async () => {
    selectResult = [{ artistNameNormalized: "eric prydz", status: "accepted", manualBlock: true, videoId: "v1", videoTitle: "x", channelTitle: "x" }];
    const result = await getArtistYoutubePreviewForLineup(["Eric Prydz"]);
    expect(result).toBeNull();
  });

  it("degrades to null, never throws, when the query fails (e.g. the cache table doesn't exist yet — deploy-ordering safety)", async () => {
    selectShouldThrow = true;
    await expect(getArtistYoutubePreviewForLineup(["Eric Prydz"])).resolves.toBeNull();
  });
});

/**
 * Homepage VIDEO indicator batched availability (event-detail CTA hierarchy
 * + homepage video indicator work, 2026-09-26): must reuse the EXACT same
 * acceptance predicate getArtistYoutubePreviewForLineup uses above (accepted,
 * not manually blocked, truthy videoId — no separate freshness rule), and
 * must issue exactly ONE query for however many events' lineups are passed
 * in, never one per event (no N+1).
 */
describe("getArtistPreviewAvailabilityForLineups", () => {
  it("returns all-false without querying the DB when every lineup is empty", async () => {
    const result = await getArtistPreviewAvailabilityForLineups([[], []]);
    expect(result).toEqual([false, false]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("issues exactly one query for many events' lineups combined (no N+1)", async () => {
    selectResult = [
      { artistNameNormalized: "eric prydz", status: "accepted", manualBlock: false, videoId: "v1", videoTitle: "x", channelTitle: "x" },
    ];
    await getArtistPreviewAvailabilityForLineups([["Eric Prydz"], ["Some Other Artist"], ["A Third Artist"]]);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns true only for the lineup(s) with an accepted, non-blocked, matched artist — same order as the input", async () => {
    selectResult = [
      { artistNameNormalized: "eric prydz", status: "accepted", manualBlock: false, videoId: "v1", videoTitle: "x", channelTitle: "x" },
    ];
    const result = await getArtistPreviewAvailabilityForLineups([["Some Unmatched Artist"], ["Eric Prydz"]]);
    expect(result).toEqual([false, true]);
  });

  it("treats any one accepted artist in a multi-artist lineup as enough (some, not every)", async () => {
    selectResult = [
      { artistNameNormalized: "eric prydz", status: "accepted", manualBlock: false, videoId: "v1", videoTitle: "x", channelTitle: "x" },
    ];
    const result = await getArtistPreviewAvailabilityForLineups([["Unmatched Support Act", "Eric Prydz"]]);
    expect(result).toEqual([true]);
  });

  it("treats a manually-blocked match as unavailable, same as the detail page's own predicate", async () => {
    selectResult = [
      { artistNameNormalized: "eric prydz", status: "accepted", manualBlock: true, videoId: "v1", videoTitle: "x", channelTitle: "x" },
    ];
    const result = await getArtistPreviewAvailabilityForLineups([["Eric Prydz"]]);
    expect(result).toEqual([false]);
  });

  it("treats an abstained (non-accepted) cache row as unavailable", async () => {
    selectResult = [
      { artistNameNormalized: "eric prydz", status: "abstain", manualBlock: false, videoId: null, videoTitle: null, channelTitle: null },
    ];
    const result = await getArtistPreviewAvailabilityForLineups([["Eric Prydz"]]);
    expect(result).toEqual([false]);
  });

  it("degrades to all-false, never throws, when the batched query fails", async () => {
    selectShouldThrow = true;
    await expect(getArtistPreviewAvailabilityForLineups([["Eric Prydz"], ["Someone Else"]])).resolves.toEqual([false, false]);
  });
});

/**
 * Freshness parity (final review, 2026-09-26): the event-detail page's own
 * read path (getArtistYoutubePreviewForLineup) has never checked expiresAt —
 * freshness is enforced upstream, at match/ingestion time, by
 * getOrMatchArtistYoutubePreview (src/lib/enrichment/youtubePreviewMatching.ts:
 * an expired row triggers a fresh lookup/re-verification the next time an
 * event touches that artist). These tests lock in that both read paths — the
 * existing detail-page lookup and the new homepage batched availability
 * check — agree on an "expired" row exactly the same way (by both ignoring
 * expiresAt), so the homepage indicator can never disagree with what the
 * event's own detail page would actually render.
 */
describe("freshness parity — expiresAt is read-time-irrelevant for both getArtistYoutubePreviewForLineup and getArtistPreviewAvailabilityForLineups", () => {
  const EXPIRED_ACCEPTED_ROW = {
    artistNameNormalized: "eric prydz",
    status: "accepted",
    manualBlock: false,
    videoId: "v1",
    videoTitle: "x",
    channelTitle: "x",
    expiresAt: new Date("2020-01-01T00:00:00.000Z"), // long past — never consulted at read time
  };

  it("getArtistYoutubePreviewForLineup still returns an expired-but-accepted row (freshness is a match-time concern, not a read-time filter)", async () => {
    selectResult = [EXPIRED_ACCEPTED_ROW];
    const result = await getArtistYoutubePreviewForLineup(["Eric Prydz"]);
    expect(result).toEqual({ artistName: "Eric Prydz", videoId: "v1", videoTitle: "x", channelTitle: "x" });
  });

  it("getArtistPreviewAvailabilityForLineups agrees — also returns true for the same expired-but-accepted row", async () => {
    selectResult = [EXPIRED_ACCEPTED_ROW];
    const result = await getArtistPreviewAvailabilityForLineups([["Eric Prydz"]]);
    expect(result).toEqual([true]);
  });
});
