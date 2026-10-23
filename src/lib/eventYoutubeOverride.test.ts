import { describe, expect, it } from "vitest";
import { isVideoPlayable, parseEventRef, parseYoutubeVideoId, planVerification, resolveEventOverride, type EventOverrideRow } from "./eventYoutubeOverride";

const base: EventOverrideRow = {
  eventId: "e-a2b5cf47",
  mode: "video",
  videoId: "Pbb0KmuwYSA",
  videoTitle: "steamboi | REX Radio (10.11.25)",
  channelTitle: "REX Radio",
  artistName: "STEAMBOI",
  available: true,
};

describe("resolveEventOverride", () => {
  it("no row -> automated matching", () => {
    expect(resolveEventOverride(null)).toEqual({ kind: "auto" });
    expect(resolveEventOverride(undefined)).toEqual({ kind: "auto" });
  });

  it("available video -> that video", () => {
    expect(resolveEventOverride(base)).toEqual({
      kind: "video",
      videoId: "Pbb0KmuwYSA",
      videoTitle: "steamboi | REX Radio (10.11.25)",
      channelTitle: "REX Radio",
      artistName: "STEAMBOI",
    });
  });

  it.each<[string, Partial<EventOverrideRow>]>([
    ["unavailable video", { available: false }],
    ["hidden", { mode: "hidden" }],
    ["hidden, even if marked available", { mode: "hidden", available: true }],
    ["video mode without an id", { videoId: null }],
    ["unknown mode", { mode: "something-new" }],
  ])("%s -> no video at all (never the automated match)", (_desc, overrides) => {
    expect(resolveEventOverride({ ...base, ...overrides })).toEqual({ kind: "none" });
  });
});

describe("parseYoutubeVideoId", () => {
  it.each([
    ["Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["  Pbb0KmuwYSA  ", "Pbb0KmuwYSA"],
    ["https://youtu.be/Pbb0KmuwYSA?si=DGtesIfBBSpPnOoQ", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/watch?v=Pbb0KmuwYSA&t=60", "Pbb0KmuwYSA"],
    ["https://m.youtube.com/watch?v=Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://music.youtube.com/watch?v=Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/embed/Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube-nocookie.com/embed/Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/shorts/Pbb0KmuwYSA", "Pbb0KmuwYSA"],
    ["https://www.youtube.com/live/Pbb0KmuwYSA?feature=share", "Pbb0KmuwYSA"],
  ])("%s -> %s", (input, expected) => {
    expect(parseYoutubeVideoId(input)).toBe(expected);
  });

  it.each([
    "",
    "not a url",
    "Pbb0KmuwYS", // 10 chars
    "Pbb0KmuwYSA1", // 12 chars
    "Pbb0Kmu'YSA",
    "https://vimeo.com/Pbb0KmuwYSA",
    "https://evil.example/watch?v=Pbb0KmuwYSA",
    "https://youtube.com.evil.example/watch?v=Pbb0KmuwYSA",
    "https://www.youtube.com/channel/UCIvOWIx4ISwqaYLc9kEwqxA",
    "https://www.youtube.com/watch?v=Pbb0KmuwYSA%22",
    "javascript:alert(1)//youtu.be/Pbb0KmuwYSA",
    "https://youtu.be/short",
  ])("rejects %j", (input) => {
    expect(parseYoutubeVideoId(input)).toBeNull();
  });
});

describe("parseEventRef", () => {
  it.each([
    ["e-a2b5cf47", { id: "e-a2b5cf47" }],
    [
      "black-box-steamboi-kardinal-bertram-lmn-red-box-qwenty-ooops-avon-sandy-p-maditation-valentina-silk-e-a2b5cf47",
      { slug: "black-box-steamboi-kardinal-bertram-lmn-red-box-qwenty-ooops-avon-sandy-p-maditation-valentina-silk-e-a2b5cf47" },
    ],
    ["https://www.electroniccph.com/events/kasst-culture-box-copenhagen-2026-09-19", { slug: "kasst-culture-box-copenhagen-2026-09-19" }],
    ["https://www.electroniccph.com/events/some-night-e-a2b5cf47/?utm=x#video", { slug: "some-night-e-a2b5cf47" }],
  ])("%s", (input, expected) => {
    expect(parseEventRef(input)).toEqual(expected);
  });

  it.each(["", "E-A2B5CF47 x", "E-A2B5CF47", "slug with spaces", "slug'; drop table events;--", "-leading-dash", "double--dash", "https://example.com/venues/x"])(
    "rejects %j",
    (input) => {
      expect(parseEventRef(input)).toBeNull();
    },
  );
});

describe("isVideoPlayable", () => {
  it("only public + embeddable counts", () => {
    expect(isVideoPlayable({ videoId: "x", embeddable: true, privacyStatus: "public" })).toBe(true);
    expect(isVideoPlayable({ videoId: "x", embeddable: false, privacyStatus: "public" })).toBe(false);
    expect(isVideoPlayable({ videoId: "x", embeddable: true, privacyStatus: "unlisted" })).toBe(false);
    expect(isVideoPlayable({ videoId: "x", embeddable: true, privacyStatus: "private" })).toBe(false);
    expect(isVideoPlayable(null)).toBe(false);
  });
});

describe("planVerification", () => {
  const now = new Date("2026-10-26T05:17:00Z");
  const ok = (videoId: string) => ({ videoId, embeddable: true, privacyStatus: "public" });

  it("still available -> unchanged, unavailableSince untouched", () => {
    expect(planVerification([{ eventId: "e1", videoId: "v1", available: true }], [ok("v1")], now)).toEqual([
      { eventId: "e1", videoId: "v1", available: true, unavailableSince: undefined, changed: false },
    ]);
  });

  it("deleted (not returned by YouTube) -> unavailable since now", () => {
    expect(planVerification([{ eventId: "e1", videoId: "v1", available: true }], [], now)[0]).toEqual({
      eventId: "e1",
      videoId: "v1",
      available: false,
      unavailableSince: now,
      changed: true,
    });
  });

  it("made private or unembeddable -> unavailable", () => {
    const rows = [
      { eventId: "e1", videoId: "v1", available: true },
      { eventId: "e2", videoId: "v2", available: true },
    ];
    const updates = planVerification(rows, [{ ...ok("v1"), privacyStatus: "private" }, { ...ok("v2"), embeddable: false }], now);
    expect(updates.map((u) => u.available)).toEqual([false, false]);
  });

  it("still unavailable -> keeps the original unavailableSince", () => {
    expect(planVerification([{ eventId: "e1", videoId: "v1", available: false }], [], now)[0].unavailableSince).toBeUndefined();
  });

  it("back again -> available, unavailableSince cleared", () => {
    expect(planVerification([{ eventId: "e1", videoId: "v1", available: false }], [ok("v1")], now)[0]).toEqual({
      eventId: "e1",
      videoId: "v1",
      available: true,
      unavailableSince: null,
      changed: true,
    });
  });

  it("two events sharing one video get the same answer", () => {
    const rows = [
      { eventId: "e1", videoId: "v1", available: true },
      { eventId: "e2", videoId: "v1", available: false },
    ];
    expect(planVerification(rows, [ok("v1")], now).map((u) => u.available)).toEqual([true, true]);
  });
});
