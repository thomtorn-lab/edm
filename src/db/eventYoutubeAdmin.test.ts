import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin-UI per-event YouTube video (2026-10-24): validation, which writes
 * happen (and which don't), and how existing override rows read back. The
 * DB writes, the YouTube lookup and the automated match are mocked; the
 * rules (parseYoutubeVideoId, isVideoPlayable, resolveEventOverride) are real.
 */

const findEvent = vi.fn();
const getOverride = vi.fn();
const setEventVideo = vi.fn();
const hideEventVideo = vi.fn();
const clearEventOverride = vi.fn();
const getVideoSnippet = vi.fn();
const getArtistYoutubePreviewForLineup = vi.fn();

vi.mock("./eventYoutubeOverrides", () => ({ findEvent, getOverride, setEventVideo, hideEventVideo, clearEventOverride }));
vi.mock("@/lib/enrichment/youtubeClient", () => ({ getVideoSnippet }));
vi.mock("@/lib/queries", () => ({ getArtistYoutubePreviewForLineup }));

const { getEventYoutubeAdminState, setEventYoutubeVideo, hideEventYoutubeVideo, resetEventYoutubeToAuto, EventYoutubeAdminError } = await import(
  "./eventYoutubeAdmin"
);

const EVENT = { id: "e-a2b5cf47", slug: "steamboi-e-a2b5cf47", title: "Steamboi", artists: ["STEAMBOI", "Kardinal Bertram"], startDatetime: new Date(), published: true };
const AUTO = { artistName: "STEAMBOI", videoId: "AUTOsteamb1", videoTitle: "Auto video", channelTitle: "Auto channel" };
const SNIPPET = { videoId: "Pbb0KmuwYSA", title: "steamboi | REX Radio", channelId: "UC1", channelTitle: "REX Radio", embeddable: true, privacyStatus: "public" };
const updated = new Date("2026-10-24T10:00:00Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    eventId: EVENT.id,
    mode: "video",
    videoId: "Pbb0KmuwYSA",
    videoTitle: "steamboi | REX Radio",
    channelId: "UC1",
    channelTitle: "REX Radio",
    artistName: null,
    available: true,
    lastVerifiedAt: updated,
    unavailableSince: null,
    createdAt: updated,
    updatedAt: updated,
    ...overrides,
  };
}

/** No write at all happened. */
function expectNoWrites() {
  expect(setEventVideo).not.toHaveBeenCalled();
  expect(hideEventVideo).not.toHaveBeenCalled();
  expect(clearEventOverride).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  findEvent.mockImplementation(async (ref: { id: string }) => (ref.id === EVENT.id ? EVENT : null));
  getOverride.mockResolvedValue(null);
  getArtistYoutubePreviewForLineup.mockResolvedValue(AUTO);
  getVideoSnippet.mockResolvedValue(SNIPPET);
});

describe("state — existing overrides read back as they are", () => {
  it("no override: automatic, shows the automated match", async () => {
    const s = await getEventYoutubeAdminState(EVENT.id);
    expect(s.status).toBe("auto");
    expect(s.override).toBeNull();
    expect(s.shown).toEqual({ videoId: "AUTOsteamb1", videoTitle: "Auto video", channelTitle: "Auto channel" });
    expect(getArtistYoutubePreviewForLineup).toHaveBeenCalledWith(EVENT.artists);
  });

  it("no override and no match: automatic, shows nothing", async () => {
    getArtistYoutubePreviewForLineup.mockResolvedValue(null);
    const s = await getEventYoutubeAdminState(EVENT.id);
    expect(s.status).toBe("auto");
    expect(s.shown).toBeNull();
  });

  it("a chosen video wins over the automated match, which is still reported for reference", async () => {
    getOverride.mockResolvedValue(row());
    const s = await getEventYoutubeAdminState(EVENT.id);
    expect(s.status).toBe("manual-video");
    expect(s.shown).toEqual({ videoId: "Pbb0KmuwYSA", videoTitle: "steamboi | REX Radio", channelTitle: "REX Radio" });
    expect(s.autoMatch?.videoId).toBe("AUTOsteamb1");
    expect(s.override).toMatchObject({ mode: "video", videoId: "Pbb0KmuwYSA", available: true, updatedAt: updated.toISOString() });
  });

  it("a chosen video that went unavailable shows nothing (no artist fallback) and keeps the chosen video visible to the admin", async () => {
    const since = new Date("2026-10-20T05:17:00Z");
    getOverride.mockResolvedValue(row({ available: false, unavailableSince: since }));
    const s = await getEventYoutubeAdminState(EVENT.id);
    expect(s.status).toBe("manual-unavailable");
    expect(s.shown).toBeNull();
    expect(s.override).toMatchObject({ videoId: "Pbb0KmuwYSA", available: false, unavailableSince: since.toISOString() });
  });

  it("hidden shows nothing, and keeps a previously chosen video's details", async () => {
    getOverride.mockResolvedValue(row({ mode: "hidden" }));
    const s = await getEventYoutubeAdminState(EVENT.id);
    expect(s.status).toBe("manual-hidden");
    expect(s.shown).toBeNull();
    expect(s.override?.videoId).toBe("Pbb0KmuwYSA");
  });

  it("a malformed row (unknown mode, or video mode without an id) counts as hidden, never as automatic", async () => {
    getOverride.mockResolvedValue(row({ mode: "weird" }));
    expect((await getEventYoutubeAdminState(EVENT.id)).status).toBe("manual-hidden");
    getOverride.mockResolvedValue(row({ videoId: null }));
    const s = await getEventYoutubeAdminState(EVENT.id);
    expect(s.status).toBe("manual-hidden");
    expect(s.shown).toBeNull();
  });

  it("reading never writes", async () => {
    getOverride.mockResolvedValue(row({ available: false }));
    await getEventYoutubeAdminState(EVENT.id);
    expectNoWrites();
    expect(getVideoSnippet).not.toHaveBeenCalled();
  });

  it("an unknown event is a 404", async () => {
    await expect(getEventYoutubeAdminState("e-00000000")).rejects.toMatchObject({ status: 404 });
  });

  it("a failed override read is an error, never reported as automatic", async () => {
    getOverride.mockRejectedValue(new Error('relation "event_youtube_preview_overrides" does not exist'));
    await expect(getEventYoutubeAdminState(EVENT.id)).rejects.toThrow(/does not exist/);
  });
});

describe("choose / replace a video", () => {
  it.each([
    ["a watch URL", "https://www.youtube.com/watch?v=Pbb0KmuwYSA&t=10s"],
    ["a youtu.be URL", "https://youtu.be/Pbb0KmuwYSA"],
    ["a shorts URL", "https://www.youtube.com/shorts/Pbb0KmuwYSA"],
    ["a bare id", "  Pbb0KmuwYSA "],
  ])("accepts %s, checks it with YouTube, and saves it on this event only", async (_label, input) => {
    getOverride.mockResolvedValue(row()); // what the write leaves behind
    const s = await setEventYoutubeVideo(EVENT.id, input);
    expect(getVideoSnippet).toHaveBeenCalledWith("Pbb0KmuwYSA");
    expect(setEventVideo).toHaveBeenCalledTimes(1);
    expect(setEventVideo).toHaveBeenCalledWith(EVENT.id, SNIPPET, null);
    expect(hideEventVideo).not.toHaveBeenCalled();
    expect(clearEventOverride).not.toHaveBeenCalled();
    expect(s.status).toBe("manual-video");
  });

  it("replacing an existing chosen video writes the new one", async () => {
    getOverride.mockResolvedValue(row());
    const other = { ...SNIPPET, videoId: "dQw4w9WgXcQ", title: "Other" };
    getVideoSnippet.mockResolvedValue(other);
    await setEventYoutubeVideo(EVENT.id, "https://youtu.be/dQw4w9WgXcQ");
    expect(setEventVideo).toHaveBeenCalledWith(EVENT.id, other, null);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["not a string", 42],
    ["missing", undefined],
    ["a non-YouTube URL", "https://vimeo.com/123456789"],
    ["a channel URL", "https://www.youtube.com/@rexradio"],
    ["an id of the wrong length", "Pbb0Kmuw"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a lookalike host", "https://youtube.com.evil.example/watch?v=Pbb0KmuwYSA"],
  ])("rejects %s with a 400 before calling YouTube, and saves nothing", async (_label, input) => {
    const err = await setEventYoutubeVideo(EVENT.id, input).catch((e) => e);
    expect(err).toBeInstanceOf(EventYoutubeAdminError);
    expect(err.status).toBe(400);
    expect(getVideoSnippet).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each([
    ["unknown to YouTube (deleted)", null, /no video/],
    ["private", { ...SNIPPET, privacyStatus: "private" }, /public/],
    ["unlisted", { ...SNIPPET, privacyStatus: "unlisted" }, /public/],
    ["not embeddable", { ...SNIPPET, embeddable: false }, /embedding disabled/],
  ])("refuses a video that is %s (the #166 availability rule) and saves nothing", async (_label, snippet, message) => {
    getVideoSnippet.mockResolvedValue(snippet);
    const err = await setEventYoutubeVideo(EVENT.id, "Pbb0KmuwYSA").catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(message);
    expectNoWrites();
  });

  it("a failed YouTube lookup (no key, network, quota) is a 502 and saves nothing", async () => {
    getVideoSnippet.mockRejectedValue(new Error("YOUTUBE_API_KEY is not set"));
    const err = await setEventYoutubeVideo(EVENT.id, "Pbb0KmuwYSA").catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).not.toContain("YOUTUBE_API_KEY");
    expectNoWrites();
  });

  it("an unknown event is a 404 and saves nothing (and spends no YouTube quota)", async () => {
    const err = await setEventYoutubeVideo("e-00000000", "Pbb0KmuwYSA").catch((e) => e);
    expect(err.status).toBe(404);
    expect(getVideoSnippet).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("a failed database write propagates as an error (not reported as saved)", async () => {
    setEventVideo.mockRejectedValue(new Error("connection terminated"));
    await expect(setEventYoutubeVideo(EVENT.id, "Pbb0KmuwYSA")).rejects.toThrow("connection terminated");
  });
});

describe("hide / back to automatic", () => {
  it("hide writes a hidden override for this event only", async () => {
    getOverride.mockResolvedValue(row({ mode: "hidden" }));
    const s = await hideEventYoutubeVideo(EVENT.id);
    expect(hideEventVideo).toHaveBeenCalledTimes(1);
    expect(hideEventVideo).toHaveBeenCalledWith(EVENT.id);
    expect(setEventVideo).not.toHaveBeenCalled();
    expect(clearEventOverride).not.toHaveBeenCalled();
    expect(s.status).toBe("manual-hidden");
    expect(s.shown).toBeNull();
  });

  it("back to automatic removes this event's override only, and the automated match shows again", async () => {
    const s = await resetEventYoutubeToAuto(EVENT.id);
    expect(clearEventOverride).toHaveBeenCalledTimes(1);
    expect(clearEventOverride).toHaveBeenCalledWith(EVENT.id);
    expect(setEventVideo).not.toHaveBeenCalled();
    expect(hideEventVideo).not.toHaveBeenCalled();
    expect(s.status).toBe("auto");
    expect(s.shown?.videoId).toBe("AUTOsteamb1");
  });

  it("an unknown event is a 404 for both, and nothing is written", async () => {
    await expect(hideEventYoutubeVideo("e-00000000")).rejects.toMatchObject({ status: 404 });
    await expect(resetEventYoutubeToAuto("e-00000000")).rejects.toMatchObject({ status: 404 });
    expectNoWrites();
  });

  it("failed writes propagate", async () => {
    hideEventVideo.mockRejectedValue(new Error("db down"));
    clearEventOverride.mockRejectedValue(new Error("db down"));
    await expect(hideEventYoutubeVideo(EVENT.id)).rejects.toThrow("db down");
    await expect(resetEventYoutubeToAuto(EVENT.id)).rejects.toThrow("db down");
  });
});
