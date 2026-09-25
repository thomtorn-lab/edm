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

const { getArtistYoutubePreviewForLineup } = await import("./queries");

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
