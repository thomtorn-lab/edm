import { describe, expect, it } from "vitest";
import { dailyLinksConfig, formatDailyLinksReport, newSoundcloudLinks, soundcloudCandidates, youtubeCandidateGroups, type DailyLinksEvent, type YoutubeCacheState } from "./dailyLinks";

const NOW = new Date("2026-11-20T03:10:00.000Z");
const FRESH = new Date("2026-12-20T00:00:00.000Z");
const EXPIRED = new Date("2026-11-01T00:00:00.000Z");
const ev = (id: string, artists: string[], title = `Night ${id}`): DailyLinksEvent => ({ id, title, startDatetime: "2026-11-22T22:00:00.000Z", artists });
const row = (over: Partial<YoutubeCacheState> = {}): YoutubeCacheState => ({ status: "abstain", manualBlock: false, expiresAt: FRESH, videoTitle: null, channelTitle: null, ...over });

describe("dailyLinksConfig", () => {
  it("YouTube is off unless explicitly enabled; sensible caps", () => {
    expect(dailyLinksConfig({})).toEqual({ youtubeEnabled: false, youtubeMaxArtists: 10, soundcloudMaxLookups: 10, reportEmail: undefined });
    expect(dailyLinksConfig({ DAILY_LINKS_YOUTUBE_ENABLED: "1" }).youtubeEnabled).toBe(false);
    expect(dailyLinksConfig({ DAILY_LINKS_YOUTUBE_ENABLED: "true" }).youtubeEnabled).toBe(true);
  });
  it("caps are bounded; junk falls back to the default", () => {
    expect(dailyLinksConfig({ DAILY_LINKS_YOUTUBE_MAX_ARTISTS: "500", DAILY_LINKS_SOUNDCLOUD_MAX_LOOKUPS: "-3" })).toMatchObject({ youtubeMaxArtists: 40, soundcloudMaxLookups: 10 });
    expect(dailyLinksConfig({ DAILY_LINKS_YOUTUBE_MAX_ARTISTS: "0" }).youtubeMaxArtists).toBe(0);
  });
});

describe("soundcloudCandidates", () => {
  it("skips names the page already links (manual, venue or reused), dedupes across events, keeps date order", () => {
    const events = [ev("a", ["Sub Zero Project", "Amelie Duchow"]), ev("b", ["Amelie Duchow", "Moor Mother US"])];
    const shown = new Map([["a", [{ name: "Sub Zero Project", url: "https://soundcloud.com/s" }]]]);
    expect(soundcloudCandidates(events, shown)).toEqual(["Amelie Duchow", "Moor Mother US"]);
  });
  it("never proposes a multi-act entry", () => {
    expect(soundcloudCandidates([ev("a", ["Amelie Duchow & Moor Mother"])], new Map())).toEqual([]);
  });
});

describe("youtubeCandidateGroups respects admin choices before any search", () => {
  const events = [ev("a", ["Amelie Duchow", "Moor Mother"]), ev("b", ["Byetone"]), ev("c", ["Kangding Ray"]), ev("d", ["TBA", "Rrose"])];
  it("skips events with an override or a shown video, blocked and freshly cached artists, placeholders", () => {
    const cache = new Map([
      ["amelie duchow", row({ manualBlock: true, expiresAt: EXPIRED })],
      ["rrose", row({ expiresAt: FRESH })],
    ]);
    expect(youtubeCandidateGroups(events, new Set(["b"]), new Set(["c"]), cache, NOW)).toEqual([{ eventId: "a", artists: ["Moor Mother"] }]);
  });
  it("retries an expired row, and an accepted row that fails today's content rules", () => {
    const cache = new Map([
      ["byetone", row({ expiresAt: EXPIRED })],
      ["kangding ray", row({ status: "accepted", videoTitle: "Kangding Ray - podcast episode 12", channelTitle: "Some Radio" })],
    ]);
    const groups = youtubeCandidateGroups(events, new Set(), new Set(), cache, NOW);
    expect(groups.map((g) => g.eventId)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("newSoundcloudLinks measures what the page shows, not what was searched", () => {
  it("only names newly shown", () => {
    const before = new Map([["a", [{ name: "X", url: "u1" }]]]);
    const after = new Map([["a", [{ name: "X", url: "u1" }, { name: "Y", url: "u2" }]], ["b", []]]);
    expect(newSoundcloudLinks(before, after)).toEqual([{ eventId: "a", artistName: "Y", url: "u2" }]);
  });
});

describe("formatDailyLinksReport", () => {
  it("is short: counts, then the new links, then errors", () => {
    const { subject, text } = formatDailyLinksReport(
      {
        eventsChecked: 120,
        soundcloud: { lookedUp: 4, remaining: 3, added: [{ eventId: "a", artistName: "Y", url: "https://soundcloud.com/y" }] },
        youtube: { enabled: false, artistsLookedUp: 0, remaining: 0, added: [] },
        errors: ["Discogs-opslag fejlede"],
      },
      new Map([["a", ev("a", ["Y"], "Techno Night")]]),
    );
    expect(subject).toBe("Electronic CPH links: +1 SoundCloud, +0 YouTube, 1 fejl");
    expect(text).toContain("Kontrollerede events: 120\nNye SoundCloud-links: 1\nNye YouTube-videoer: – (YouTube-delen er slået fra)\nFejl: 1");
    expect(text).toContain("- 2026-11-22 Techno Night: Y → https://soundcloud.com/y");
    expect(text).toContain("Opslag: Discogs 4 (3 venter), YouTube 0 (0 venter).");
  });
});
