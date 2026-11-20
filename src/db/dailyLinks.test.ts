import { beforeEach, describe, expect, it, vi } from "vitest";
import { artistGenreCache, artistYoutubePreviewCache, events } from "./schema";

/** db, the matchers and the page read paths are faked: this tests the job's selection, limits, stopping and measuring. */
const tables = new Map<unknown, unknown[]>();
vi.mock("./client", () => ({
  db: { select: () => ({ from: (t: unknown) => ({ where: async () => tables.get(t) ?? [] }) }) },
}));
const resolveDiscogsSoundcloud = vi.fn();
vi.mock("./discogsSoundcloud", () => ({ resolveDiscogsSoundcloud: (...a: unknown[]) => resolveDiscogsSoundcloud(...a) }));
vi.mock("./youtubePreview", () => ({ drizzleCacheStore: {} }));
const getOrMatch = vi.fn();
vi.mock("@/lib/enrichment/youtubePreviewMatching", async (orig) => ({ ...(await orig<object>()), getOrMatchArtistYoutubePreview: (...a: unknown[]) => getOrMatch(...a) }));
const q = {
  getSoundcloudLinksForEvents: vi.fn(),
  readEventOverrides: vi.fn(),
  getPreviewAvailabilityForEvents: vi.fn(),
  getEventYoutubePreview: vi.fn(),
};
vi.mock("@/lib/queries", async (orig) => ({
  upcomingCandidateCondition: (await orig<typeof import("@/lib/queries")>()).upcomingCandidateCondition,
  getSoundcloudLinksForEvents: (...a: unknown[]) => q.getSoundcloudLinksForEvents(...a),
  readEventOverrides: (...a: unknown[]) => q.readEventOverrides(...a),
  getPreviewAvailabilityForEvents: (...a: unknown[]) => q.getPreviewAvailabilityForEvents(...a),
  getEventYoutubePreview: (...a: unknown[]) => q.getEventYoutubePreview(...a),
}));

const { runDailyLinks } = await import("./dailyLinks");
const { YoutubeDailyQuotaExhaustedError } = await import("@/lib/enrichment/youtubeClient");

const NOW = new Date("2026-11-20T03:10:00.000Z");
const start = (d: string) => new Date(`2026-11-${d}T22:00:00.000Z`);
const config = (over: object = {}) => ({ youtubeEnabled: false, youtubeMaxArtists: 10, soundcloudMaxLookups: 10, reportEmail: undefined, ...over });
const okSummary = (over: object = {}) => ({ considered: 1, lookedUp: 1, verifiable: 0, uncertain: 0, missing: 1, failed: 0, ...over });
const send = vi.fn();
const sleep = vi.fn(async () => {});
const run = (over: object = {}, now: () => Date = () => NOW) => runDailyLinks({ config: config(over), now, sleep, send });

beforeEach(() => {
  tables.clear();
  tables.set(events, [
    { id: "late", title: "Late", startDatetime: start("29"), endDatetime: null, artists: ["Moor Mother"] },
    { id: "early", title: "Early", startDatetime: start("21"), endDatetime: null, artists: ["Amelie Duchow", "Byetone"] },
  ]);
  for (const f of [resolveDiscogsSoundcloud, getOrMatch, send, sleep, ...Object.values(q)]) f.mockReset();
  q.getSoundcloudLinksForEvents.mockResolvedValue(new Map([["early", []], ["late", []]]));
  q.readEventOverrides.mockResolvedValue(new Map());
  q.getPreviewAvailabilityForEvents.mockResolvedValue([false, false]);
  q.getEventYoutubePreview.mockResolvedValue(null);
  resolveDiscogsSoundcloud.mockResolvedValue(okSummary());
  getOrMatch.mockResolvedValue({ status: "abstain" });
});

describe("runDailyLinks — SoundCloud", () => {
  it("looks up missing artists earliest event first and reports only links the page now shows", async () => {
    q.getSoundcloudLinksForEvents
      .mockResolvedValueOnce(new Map([["early", [{ name: "Byetone", url: "https://soundcloud.com/b" }]], ["late", []]]))
      .mockResolvedValueOnce(new Map([["early", [{ name: "Byetone", url: "https://soundcloud.com/b" }, { name: "Amelie Duchow", url: "https://soundcloud.com/a" }]], ["late", []]]));
    const r = await run();
    expect(resolveDiscogsSoundcloud.mock.calls.map((c) => c[0])).toEqual([["Amelie Duchow"], ["Moor Mother"]]);
    expect(r.eventsChecked).toBe(2);
    expect(r.soundcloud).toMatchObject({ lookedUp: 2, remaining: 0, added: [{ eventId: "early", artistName: "Amelie Duchow", url: "https://soundcloud.com/a" }] });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: "Electronic CPH links: +1 SoundCloud, +0 YouTube" }));
    expect(r.emailSent).toBe(true);
  });

  it("skips artists the Discogs cache already answers", async () => {
    tables.set(artistGenreCache, [{ key: "amelie duchow", lookupStatus: "not_found", evidence: {}, expiresAt: new Date("2027-01-01") }]);
    await run();
    expect(resolveDiscogsSoundcloud.mock.calls.map((c) => c[0])).toEqual([["Byetone"], ["Moor Mother"]]);
  });

  it("honours the daily cap; the rest waits for tomorrow", async () => {
    const r = await run({ soundcloudMaxLookups: 1 });
    expect(resolveDiscogsSoundcloud).toHaveBeenCalledTimes(1);
    expect(r.soundcloud.remaining).toBe(2);
  });

  it("stops at the time budget, leaving the rest", async () => {
    let t = NOW.getTime();
    sleep.mockImplementation(async () => void (t += 160_000)); // the pause after the first lookup crosses the budget
    const r = await run({}, () => new Date(t));
    expect(resolveDiscogsSoundcloud).toHaveBeenCalledTimes(1);
    expect(r.soundcloud.remaining).toBe(2);
  });

  it("stops on the first Discogs failure (rate limit) and reports it", async () => {
    resolveDiscogsSoundcloud.mockResolvedValueOnce(okSummary({ failed: 1, missing: 0 }));
    const r = await run();
    expect(resolveDiscogsSoundcloud).toHaveBeenCalledTimes(1);
    expect(r.errors).toHaveLength(1);
    expect(r.soundcloud.remaining).toBe(2);
  });
});

describe("runDailyLinks — YouTube", () => {
  it("is off by default: no YouTube work at all", async () => {
    const r = await run();
    expect(getOrMatch).not.toHaveBeenCalled();
    expect(q.readEventOverrides).not.toHaveBeenCalled();
    expect(r.youtube.enabled).toBe(false);
  });

  it("skips overridden events and blocked artists, stops an event at its first accepted match", async () => {
    q.readEventOverrides.mockResolvedValue(new Map([["late", { mode: "hidden" }]]));
    tables.set(artistYoutubePreviewCache, [{ key: "byetone", status: "abstain", manualBlock: true, expiresAt: new Date("2026-11-01"), videoTitle: null, channelTitle: null }]);
    getOrMatch.mockResolvedValue({ status: "accepted" });
    q.getEventYoutubePreview.mockResolvedValue({ artistName: "Amelie Duchow", videoId: "vid1" });
    const r = await run({ youtubeEnabled: true });
    expect(getOrMatch.mock.calls.map((c) => c[0])).toEqual(["Amelie Duchow"]);
    expect(r.youtube).toMatchObject({ artistsLookedUp: 1, added: [{ eventId: "early", artistName: "Amelie Duchow", videoId: "vid1" }] });
  });

  it("never runs when the override read fails (fail closed)", async () => {
    q.readEventOverrides.mockResolvedValue(null);
    const r = await run({ youtubeEnabled: true });
    expect(getOrMatch).not.toHaveBeenCalled();
    expect(r.errors[0]).toMatch(/overrides/);
  });

  it("stops at confirmed search quota exhaustion", async () => {
    getOrMatch.mockRejectedValueOnce(new YoutubeDailyQuotaExhaustedError("quota"));
    const r = await run({ youtubeEnabled: true });
    expect(getOrMatch).toHaveBeenCalledTimes(1);
    expect(r.youtube.remaining).toBe(2);
    expect(r.errors.some((e) => /kvote/.test(e))).toBe(true);
  });

  it("honours the per-run artist cap", async () => {
    const r = await run({ youtubeEnabled: true, youtubeMaxArtists: 2 });
    expect(getOrMatch).toHaveBeenCalledTimes(2);
    expect(r.youtube.remaining).toBe(1);
  });
});

it("a failed report email never fails the run", async () => {
  send.mockRejectedValue(new Error("Email is not configured"));
  const r = await run();
  expect(r.emailSent).toBe(false);
});
