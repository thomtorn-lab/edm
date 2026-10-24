import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin CLI for per-event YouTube videos (2026-10-23). run() is exercised with
 * the DB module and the YouTube client mocked — never a live DB or YouTube
 * call. Covers: confirm gating, input validation before any I/O, the
 * playable-video check, the verify run, and the artist-pin migration's
 * write order (event first, artist second) and re-run safety.
 */

const EVENT = {
  id: "e-a2b5cf47",
  slug: "black-box-steamboi-kardinal-bertram-lmn-e-a2b5cf47",
  title: "Black Box: STEAMBOI, KARDINAL BERTRAM, LMN",
  artists: ["STEAMBOI", "KARDINAL BERTRAM", "LMN"],
  startDatetime: new Date("2026-11-27T21:00:00Z"),
  published: true,
};
const OTHER_STEAMBOI_EVENT = { ...EVENT, id: "e-22222222", slug: "other-e-22222222", title: "Other night", artists: ["steamboi"] };
const PUBLIC_VIDEO = {
  videoId: "Pbb0KmuwYSA",
  title: "steamboi | REX Radio (10.11.25)",
  channelId: "UCIvOWIx4ISwqaYLc9kEwqxA",
  channelTitle: "REX Radio",
  embeddable: true,
  privacyStatus: "public",
};
const PINNED_ROW = {
  artistNameNormalized: "steamboi",
  status: "accepted",
  matchRule: "manual",
  videoId: "Pbb0KmuwYSA",
  videoTitle: PUBLIC_VIDEO.title,
  channelTitle: "REX Radio",
  manualBlock: false,
  expiresAt: new Date("2100-01-01T00:00:00Z"),
};
const LMN_ROW = { artistNameNormalized: "lmn", status: "accepted", matchRule: "A", videoId: "p5shUAENRzM", manualBlock: true };

type Row = Record<string, unknown> | null;
let override: Row = null;
let artistRows: Record<string, Row> = {};
const calls: string[] = [];

const db = {
  findEvent: vi.fn(async (ref: { id?: string; slug?: string }) => (ref.id === EVENT.id || ref.slug === EVENT.slug ? EVENT : null)),
  getOverride: vi.fn(async () => override),
  getArtistCacheRow: vi.fn(async (n: string) => artistRows[n] ?? null),
  getArtistCacheRows: vi.fn(async (ns: string[]) => ns.flatMap((n) => (artistRows[n] ? [artistRows[n]] : []))),
  setEventVideo: vi.fn(async (eventId: string, video: { videoId: string }) => {
    calls.push(`setEventVideo:${eventId}:${video.videoId}`);
    override = { eventId, mode: "video", videoId: video.videoId, available: true };
  }),
  hideEventVideo: vi.fn(async (eventId: string) => {
    calls.push(`hide:${eventId}`);
  }),
  clearEventOverride: vi.fn(async (eventId: string) => {
    calls.push(`clear:${eventId}`);
  }),
  listVideoOverrides: vi.fn(async (): Promise<{ eventId: string; videoId: string; available: boolean }[]> => []),
  applyVerification: vi.fn(async (updates: unknown[]) => {
    calls.push(`applyVerification:${updates.length}`);
  }),
  unpinArtistPreviewRow: vi.fn(async (row: { artistNameNormalized: string }) => {
    calls.push(`unpin:${row.artistNameNormalized}`);
    artistRows[row.artistNameNormalized] = { ...artistRows[row.artistNameNormalized], status: "abstain", matchRule: null, videoId: null };
  }),
  listUpcomingPublishedEvents: vi.fn(async () => [EVENT, OTHER_STEAMBOI_EVENT]),
};
vi.mock("./eventYoutubeOverrides", () => db);

const youtube = {
  getVideoSnippet: vi.fn(async (): Promise<typeof PUBLIC_VIDEO | null> => PUBLIC_VIDEO),
  getVideoDetails: vi.fn(async (ids: string[]) => ids.map((videoId) => ({ videoId, durationSeconds: 3600, embeddable: true, privacyStatus: "public" }))),
};
vi.mock("@/lib/enrichment/youtubeClient", () => youtube);

const { run, VERIFY_MAX_OVERRIDES } = await import("./eventYoutubeOverride");

const writeCalls = () => calls.slice();

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  calls.length = 0;
  override = null;
  artistRows = { steamboi: { ...PINNED_ROW }, lmn: { ...LMN_ROW } };
  for (const fn of [...Object.values(db), ...Object.values(youtube)]) fn.mockClear();
  youtube.getVideoSnippet.mockResolvedValue(PUBLIC_VIDEO);
  db.listVideoOverrides.mockResolvedValue([]);
});

describe("confirm gating — no write mode runs without its own exact token", () => {
  it.each([
    ["set", "SET-EVENT-YOUTUBE-VIDEO"],
    ["hide", "HIDE-EVENT-YOUTUBE-VIDEO"],
    ["clear", "CLEAR-EVENT-YOUTUBE-VIDEO"],
    ["verify", "VERIFY-EVENT-YOUTUBE-VIDEOS"],
    ["migrate-artist-pin", "MIGRATE-ARTIST-PIN"],
  ])("%s", async (mode, token) => {
    const args = { mode, event: EVENT.id, video: "Pbb0KmuwYSA", artist: "STEAMBOI" };
    await expect(run(args)).rejects.toThrow(new RegExp(`--confirm=${token}`));
    await expect(run({ ...args, confirm: "SET-EVENT-YOUTUBE-VIDEO".replace("SET", "WRONG") })).rejects.toThrow(/--confirm=/);
    await expect(run({ ...args, confirm: ` ${token}` })).rejects.toThrow(/--confirm=/);
    expect(writeCalls()).toEqual([]);
  });

  it("unknown mode throws", async () => {
    await expect(run({ mode: "delete", event: EVENT.id })).rejects.toThrow(/--mode=</);
  });
});

describe("validation happens before any DB or YouTube call", () => {
  it.each(["", "not an event!", "slug'; drop table events;--"])("rejects --event=%j", async (event) => {
    await expect(run({ mode: "set", event, video: "Pbb0KmuwYSA", confirm: "SET-EVENT-YOUTUBE-VIDEO" })).rejects.toThrow(/--event/);
    expect(db.findEvent).not.toHaveBeenCalled();
    expect(youtube.getVideoSnippet).not.toHaveBeenCalled();
  });

  it("an event that does not exist", async () => {
    await expect(run({ mode: "set", event: "e-00000000", video: "Pbb0KmuwYSA", confirm: "SET-EVENT-YOUTUBE-VIDEO" })).rejects.toThrow(/No event found/);
    expect(writeCalls()).toEqual([]);
  });

  it.each(["", "https://vimeo.com/1", "https://youtube.com.evil.example/watch?v=Pbb0KmuwYSA"])("rejects --video=%j", async (video) => {
    await expect(run({ mode: "set", event: EVENT.id, video, confirm: "SET-EVENT-YOUTUBE-VIDEO" })).rejects.toThrow(/--video/);
    expect(youtube.getVideoSnippet).not.toHaveBeenCalled();
    expect(writeCalls()).toEqual([]);
  });

  it("--artist must be in the event's lineup", async () => {
    await expect(run({ mode: "set", event: EVENT.id, video: "Pbb0KmuwYSA", artist: "Someone Else", confirm: "SET-EVENT-YOUTUBE-VIDEO" })).rejects.toThrow(/not in the lineup/);
    expect(writeCalls()).toEqual([]);
  });
});

describe("--mode=set", () => {
  it("looks the video up and writes it for this event only (by slug, event URL or id)", async () => {
    for (const event of [EVENT.id, EVENT.slug, `https://www.electroniccph.com/events/${EVENT.slug}`]) {
      calls.length = 0;
      await run({ mode: "set", event, video: "https://youtu.be/Pbb0KmuwYSA?si=x", artist: "steamboi", confirm: "SET-EVENT-YOUTUBE-VIDEO" });
      expect(youtube.getVideoSnippet).toHaveBeenLastCalledWith("Pbb0KmuwYSA");
      expect(db.setEventVideo).toHaveBeenLastCalledWith(EVENT.id, PUBLIC_VIDEO, "STEAMBOI");
      expect(writeCalls()).toEqual([`setEventVideo:${EVENT.id}:Pbb0KmuwYSA`]);
    }
    expect(db.unpinArtistPreviewRow).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<typeof PUBLIC_VIDEO> | null, RegExp]>([
    ["unknown", null, /no video/],
    ["private", { privacyStatus: "private" }, /not public and embeddable/],
    ["unlisted", { privacyStatus: "unlisted" }, /not public and embeddable/],
    ["not embeddable", { embeddable: false }, /not public and embeddable/],
  ])("refuses an %s video", async (_desc, overrides, error) => {
    youtube.getVideoSnippet.mockResolvedValue(overrides ? { ...PUBLIC_VIDEO, ...overrides } : null);
    await expect(run({ mode: "set", event: EVENT.id, video: "Pbb0KmuwYSA", confirm: "SET-EVENT-YOUTUBE-VIDEO" })).rejects.toThrow(error);
    expect(writeCalls()).toEqual([]);
  });
});

describe("--mode=hide / clear / plan", () => {
  it("hide and clear act on the resolved event id", async () => {
    await run({ mode: "hide", event: EVENT.slug, confirm: "HIDE-EVENT-YOUTUBE-VIDEO" });
    await run({ mode: "clear", event: EVENT.slug, confirm: "CLEAR-EVENT-YOUTUBE-VIDEO" });
    expect(writeCalls()).toEqual([`hide:${EVENT.id}`, `clear:${EVENT.id}`]);
  });

  it("plan only reads", async () => {
    await run({ mode: "plan", event: EVENT.id, video: "Pbb0KmuwYSA" });
    expect(writeCalls()).toEqual([]);
  });
});

describe("--mode=verify / verify-plan", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ eventId: `e-${i}`, videoId: `vid${String(i).padStart(8, "0")}`, available: true }));

  it("verify-plan lists, never calls YouTube, never writes", async () => {
    db.listVideoOverrides.mockResolvedValue(rows(3));
    await run({ mode: "verify-plan" });
    expect(youtube.getVideoDetails).not.toHaveBeenCalled();
    expect(writeCalls()).toEqual([]);
  });

  it("verify checks in chunks of at most 50 ids (videos.list only) and records every result", async () => {
    db.listVideoOverrides.mockResolvedValue(rows(51));
    await run({ mode: "verify", confirm: "VERIFY-EVENT-YOUTUBE-VIDEOS" });
    expect(youtube.getVideoDetails).toHaveBeenCalledTimes(2);
    expect(youtube.getVideoDetails.mock.calls.map((c) => c[0].length)).toEqual([50, 1]);
    expect(youtube.getVideoSnippet).not.toHaveBeenCalled();
    expect(writeCalls()).toEqual(["applyVerification:51"]);
  });

  it("a video shared by several events is looked up once", async () => {
    db.listVideoOverrides.mockResolvedValue([
      { eventId: "e-1", videoId: "Pbb0KmuwYSA", available: true },
      { eventId: "e-2", videoId: "Pbb0KmuwYSA", available: true },
    ]);
    await run({ mode: "verify", confirm: "VERIFY-EVENT-YOUTUBE-VIDEOS" });
    expect(youtube.getVideoDetails).toHaveBeenCalledWith(["Pbb0KmuwYSA"]);
  });

  it("refuses to run at all above the fail-safe ceiling", async () => {
    db.listVideoOverrides.mockResolvedValue(rows(VERIFY_MAX_OVERRIDES + 1));
    await expect(run({ mode: "verify", confirm: "VERIFY-EVENT-YOUTUBE-VIDEOS" })).rejects.toThrow(/fail-safe ceiling/);
    expect(youtube.getVideoDetails).not.toHaveBeenCalled();
    expect(writeCalls()).toEqual([]);
  });

  it("no overrides -> no YouTube call", async () => {
    await run({ mode: "verify", confirm: "VERIFY-EVENT-YOUTUBE-VIDEOS" });
    expect(youtube.getVideoDetails).not.toHaveBeenCalled();
  });
});

describe("--mode=migrate-artist-pin (Steamboi: artist-level pin -> this event only)", () => {
  const args = {
    mode: "migrate-artist-pin",
    artist: "STEAMBOI",
    event: EVENT.id,
    video: "https://youtu.be/Pbb0KmuwYSA?si=DGtesIfBBSpPnOoQ",
    "assert-blocked": "LMN",
    confirm: "MIGRATE-ARTIST-PIN",
  };

  it("writes the event override FIRST, then releases the artist — never the other way round", async () => {
    await run(args);
    expect(writeCalls()).toEqual([`setEventVideo:${EVENT.id}:Pbb0KmuwYSA`, "unpin:steamboi"]);
    expect(db.setEventVideo).toHaveBeenCalledWith(EVENT.id, PUBLIC_VIDEO, "STEAMBOI");
  });

  it("the plan variant lists the other Steamboi events and writes nothing", async () => {
    await run({ ...args, mode: "migrate-artist-pin-plan", confirm: "" });
    expect(db.listUpcomingPublishedEvents).toHaveBeenCalled();
    expect(writeCalls()).toEqual([]);
    expect(youtube.getVideoSnippet).not.toHaveBeenCalled();
  });

  it("leaves the artist pinned if the override does not read back", async () => {
    db.setEventVideo.mockImplementationOnce(async () => {
      calls.push("setEventVideo:lost");
    });
    await expect(run(args)).rejects.toThrow(/did not read back/);
    expect(writeCalls()).toEqual(["setEventVideo:lost"]);
  });

  it("stops before any write if LMN is no longer blocked", async () => {
    artistRows.lmn = { ...LMN_ROW, manualBlock: false };
    await expect(run(args)).rejects.toThrow(/"LMN" to be manually blocked/);
    expect(writeCalls()).toEqual([]);
  });

  it("refuses when the pin is on a different video", async () => {
    await expect(run({ ...args, video: "AAAAAAAAAAA" })).rejects.toThrow(/not AAAAAAAAAAA/);
    expect(writeCalls()).toEqual([]);
  });

  it("refuses to overwrite a different, existing event override", async () => {
    override = { eventId: EVENT.id, mode: "hidden", videoId: null, available: true };
    await expect(run(args)).rejects.toThrow(/already has a different override/);
    expect(writeCalls()).toEqual([]);
  });

  it("refuses when the artist is not in the event's lineup", async () => {
    await expect(run({ ...args, artist: "QWENTY" })).rejects.toThrow(/not in the lineup/);
    expect(writeCalls()).toEqual([]);
  });

  it("refuses when the video is no longer playable (nothing written)", async () => {
    youtube.getVideoSnippet.mockResolvedValue({ ...PUBLIC_VIDEO, privacyStatus: "private" });
    await expect(run(args)).rejects.toThrow(/not public and embeddable/);
    expect(writeCalls()).toEqual([]);
  });

  it("re-run after a partial failure (override written, artist still pinned) only finishes step 2", async () => {
    override = { eventId: EVENT.id, mode: "video", videoId: "Pbb0KmuwYSA", available: true };
    await run(args);
    expect(writeCalls()).toEqual(["unpin:steamboi"]);
  });

  it("re-run after completion is a no-op", async () => {
    await run(args);
    calls.length = 0;
    await run(args);
    expect(writeCalls()).toEqual([]);
  });

  it("refuses an artist that was never pinned (no accidental reset of an automated match)", async () => {
    artistRows.steamboi = { ...PINNED_ROW, matchRule: "A" };
    await expect(run(args)).rejects.toThrow(/no artist-level pin/);
    expect(writeCalls()).toEqual([]);
  });
});
