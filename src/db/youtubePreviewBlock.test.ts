import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ArtistPreviewCacheEntry } from "@/lib/enrichment/youtubePreviewMatching";
import { normalizeArtistName, cleanArtistDisplayName } from "@/lib/enrichment/genreEnrichment";

/**
 * Admin manual-block wiring (2026-09-29) — thin CLI wrapper around the
 * existing blockArtistYoutubePreview/unblockArtistYoutubePreview
 * (src/db/youtubePreview.ts), which were never previously reachable from
 * any route, script, or workflow. Tests exercise run() directly (never
 * main()/process.exit) with the cache store and block/unblock functions
 * mocked — never a live DB or YouTube call.
 */

function cacheRow(overrides: Partial<ArtistPreviewCacheEntry> = {}): ArtistPreviewCacheEntry {
  return {
    artistNameNormalized: "benji",
    provider: "youtube",
    status: "accepted",
    matchRule: "A",
    query: "Benji dj set",
    videoId: "GsleNHtYFGU",
    videoTitle: "Benji B | Boiler Room London",
    channelId: "UCGBpxWJr9FNOcFYA5GkKrMg",
    channelTitle: "Boiler Room",
    evidence: {},
    manualBlock: false,
    matchedAt: new Date("2026-09-29T07:26:39.573Z"),
    lastVerifiedAt: new Date("2026-09-29T07:26:39.573Z"),
    expiresAt: new Date("2026-12-28T07:26:39.573Z"),
    ...overrides,
  };
}

let currentRow: ArtistPreviewCacheEntry | null = null;
const getMock = vi.fn(async (_name: string) => currentRow);
const blockMock = vi.fn(async (_artist: string) => {
  if (currentRow) currentRow = { ...currentRow, manualBlock: true };
});
const unblockMock = vi.fn(async (_artist: string) => {
  if (currentRow) currentRow = { ...currentRow, manualBlock: false };
});

const pinMock = vi.fn(async (_artist: string, video: { videoId: string; title: string }) => {
  currentRow = cacheRow({ matchRule: "manual", videoId: video.videoId, videoTitle: video.title, manualBlock: false });
});
const publicVideo = { videoId: "Pbb0KmuwYSA", title: "Kardinal Bertram @ Culture Box", channelId: "UCx", channelTitle: "Some Channel", embeddable: true, privacyStatus: "public" };
const snippetMock = vi.fn(async (_id: string): Promise<typeof publicVideo | null> => publicVideo);

vi.mock("./youtubePreview", () => ({
  drizzleCacheStore: { get: (name: string) => getMock(name) },
  blockArtistYoutubePreview: (artist: string) => blockMock(artist),
  unblockArtistYoutubePreview: (artist: string) => unblockMock(artist),
  pinArtistYoutubePreview: (artist: string, video: { videoId: string; title: string }) => pinMock(artist, video),
}));
vi.mock("@/lib/enrichment/youtubeClient", () => ({ getVideoSnippet: (id: string) => snippetMock(id) }));

const { run, parseArgs, parseYoutubeVideoId } = await import("./youtubePreviewBlock");

beforeEach(() => {
  getMock.mockClear();
  blockMock.mockClear();
  unblockMock.mockClear();
  pinMock.mockClear();
  snippetMock.mockReset();
  snippetMock.mockResolvedValue(publicVideo);
  currentRow = cacheRow();
});

describe("parseArgs", () => {
  it("parses --key=value and bare --flag pairs", () => {
    expect(parseArgs(["--mode=block", "--artist=Benji", "--confirm=BLOCK-YOUTUBE-PREVIEW"])).toEqual({
      mode: "block",
      artist: "Benji",
      confirm: "BLOCK-YOUTUBE-PREVIEW",
    });
    expect(parseArgs(["--verbose", "ignored"])).toEqual({ verbose: "true" });
  });
});

describe("run — --artist is required", () => {
  it("throws for every mode when --artist is missing", async () => {
    await expect(run({ mode: "plan" })).rejects.toThrow(/--artist/);
    await expect(run({ mode: "block", confirm: "BLOCK-YOUTUBE-PREVIEW" })).rejects.toThrow(/--artist/);
  });
});

describe("run — --mode=plan", () => {
  it("is read-only: never calls block/unblock, only reads the cache row", async () => {
    await run({ mode: "plan", artist: "Benji" });

    expect(getMock).toHaveBeenCalledWith(normalizeArtistName(cleanArtistDisplayName("Benji")));
    expect(blockMock).not.toHaveBeenCalled();
    expect(unblockMock).not.toHaveBeenCalled();
  });

  it("does not throw when no cache row exists for the artist", async () => {
    currentRow = null;
    await expect(run({ mode: "plan", artist: "Nonexistent Artist" })).resolves.toBeUndefined();
  });
});

describe("run — --mode=block", () => {
  it("requires the exact BLOCK-YOUTUBE-PREVIEW confirm token", async () => {
    await expect(run({ mode: "block", artist: "Benji" })).rejects.toThrow(/--confirm=BLOCK-YOUTUBE-PREVIEW/);
    await expect(run({ mode: "block", artist: "Benji", confirm: "wrong-token" })).rejects.toThrow(/--confirm=BLOCK-YOUTUBE-PREVIEW/);
    expect(blockMock).not.toHaveBeenCalled();
  });

  it("calls blockArtistYoutubePreview with the raw artist name once confirmed, and never calls unblock", async () => {
    await run({ mode: "block", artist: "Benji", confirm: "BLOCK-YOUTUBE-PREVIEW" });

    expect(blockMock).toHaveBeenCalledTimes(1);
    expect(blockMock).toHaveBeenCalledWith("Benji");
    expect(unblockMock).not.toHaveBeenCalled();
  });

  it("reads the row both before and after the write (visible effect in the same run)", async () => {
    await run({ mode: "block", artist: "Benji", confirm: "BLOCK-YOUTUBE-PREVIEW" });
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});

describe("run — --mode=unblock", () => {
  it("requires the exact UNBLOCK-YOUTUBE-PREVIEW confirm token — BLOCK's token is not accepted", async () => {
    await expect(run({ mode: "unblock", artist: "Benji", confirm: "BLOCK-YOUTUBE-PREVIEW" })).rejects.toThrow(/--confirm=UNBLOCK-YOUTUBE-PREVIEW/);
    expect(unblockMock).not.toHaveBeenCalled();
  });

  it("calls unblockArtistYoutubePreview with the raw artist name once confirmed, and never calls block", async () => {
    currentRow = cacheRow({ manualBlock: true });
    await run({ mode: "unblock", artist: "Benji", confirm: "UNBLOCK-YOUTUBE-PREVIEW" });

    expect(unblockMock).toHaveBeenCalledTimes(1);
    expect(unblockMock).toHaveBeenCalledWith("Benji");
    expect(blockMock).not.toHaveBeenCalled();
  });
});

describe("run — unknown/missing mode", () => {
  it("throws rather than silently doing nothing", async () => {
    await expect(run({ artist: "Benji" })).rejects.toThrow(/--mode=<plan\|block\|unblock\|pin>/);
    await expect(run({ mode: "delete", artist: "Benji" })).rejects.toThrow(/--mode=<plan\|block\|unblock\|pin>/);
  });
});

describe("parseYoutubeVideoId", () => {
  it.each([
    ["Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://youtu.be/Pbb0KmuwYSA?si=DGtesIfBBSpPnOoQ", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/watch?v=Pbb0KmuwYSA&t=60", "Pbb0KmuwYSA"],
    ["https://m.youtube.com/watch?v=Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/embed/Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube-nocookie.com/embed/Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/shorts/Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/live/Pbb0KmuwYSA?feature=share", "Pbb0KmuwYSA"],
  ])("%s -> %s", (input, expected) => {
    expect(parseYoutubeVideoId(input)).toBe(expected);
  });

  it.each(["", "not a url", "https://vimeo.com/Pbb0KmuwYSA", "https://www.youtube.com/channel/UCx", "https://youtu.be/short"])("rejects %s", (input) => {
    expect(parseYoutubeVideoId(input)).toBeNull();
  });
});

describe("run — --mode=plan with --video", () => {
  it("looks the video up but writes nothing", async () => {
    await run({ mode: "plan", artist: "Kardinal Bertram", video: "https://youtu.be/Pbb0KmuwYSA" });
    expect(snippetMock).toHaveBeenCalledWith("Pbb0KmuwYSA");
    expect(pinMock).not.toHaveBeenCalled();
    expect(blockMock).not.toHaveBeenCalled();
  });
});

describe("run — --mode=pin", () => {
  it("requires the exact PIN-YOUTUBE-PREVIEW confirm token and a --video", async () => {
    await expect(run({ mode: "pin", artist: "Kardinal Bertram", video: "Pbb0KmuwYSA" })).rejects.toThrow(/--confirm=PIN-YOUTUBE-PREVIEW/);
    await expect(run({ mode: "pin", artist: "Kardinal Bertram", video: "Pbb0KmuwYSA", confirm: "BLOCK-YOUTUBE-PREVIEW" })).rejects.toThrow(/--confirm=PIN-YOUTUBE-PREVIEW/);
    await expect(run({ mode: "pin", artist: "Kardinal Bertram", confirm: "PIN-YOUTUBE-PREVIEW" })).rejects.toThrow(/--video/);
    expect(pinMock).not.toHaveBeenCalled();
  });

  it("pins the looked-up video for the raw artist name and reads the row before and after", async () => {
    await run({ mode: "pin", artist: "Kardinal Bertram", video: "https://youtu.be/Pbb0KmuwYSA?si=x", confirm: "PIN-YOUTUBE-PREVIEW" });
    expect(pinMock).toHaveBeenCalledTimes(1);
    expect(pinMock).toHaveBeenCalledWith("Kardinal Bertram", publicVideo);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Partial<typeof publicVideo>]>([
    ["private", { privacyStatus: "private" }],
    ["unlisted", { privacyStatus: "unlisted" }],
    ["not embeddable", { embeddable: false }],
  ])("refuses a %s video", async (_desc, overrides) => {
    snippetMock.mockResolvedValue({ ...publicVideo, ...overrides });
    await expect(run({ mode: "pin", artist: "Kardinal Bertram", video: "Pbb0KmuwYSA", confirm: "PIN-YOUTUBE-PREVIEW" })).rejects.toThrow(/not public and embeddable/);
    expect(pinMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown video id or a non-YouTube URL", async () => {
    snippetMock.mockResolvedValue(null);
    await expect(run({ mode: "pin", artist: "X", video: "Pbb0KmuwYSA", confirm: "PIN-YOUTUBE-PREVIEW" })).rejects.toThrow(/no video/);
    await expect(run({ mode: "pin", artist: "X", video: "https://vimeo.com/1", confirm: "PIN-YOUTUBE-PREVIEW" })).rejects.toThrow(/not a YouTube video/);
    expect(pinMock).not.toHaveBeenCalled();
  });
});
