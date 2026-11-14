import { describe, expect, it } from "vitest";
import {
  getOrMatchArtistYoutubePreview,
  matchArtistYoutubePreview,
  titleContainsExactName,
  countBilledNames,
  normalizeArtistName,
  nonPerformanceTitleTerm,
  VERIFY_STALE_DAYS,
  MAX_SEARCH_RESULTS,
  type ArtistPreviewCacheEntry,
  type ArtistPreviewCacheStore,
  type YoutubePreviewClient,
} from "./youtubePreviewMatching";
import type { YoutubeSearchItem, YoutubeVideoDetails } from "./youtubeClient";
import { parseIso8601Duration } from "./youtubeClient";

/** In-memory cache — same shape/behavior as the Drizzle-backed one in src/db/youtubePreview.ts. */
function inMemoryCache(): ArtistPreviewCacheStore & { store: Map<string, ArtistPreviewCacheEntry> } {
  const store = new Map<string, ArtistPreviewCacheEntry>();
  return {
    store,
    async get(name) {
      return store.get(name) ?? null;
    },
    async set(entry) {
      store.set(entry.artistNameNormalized, entry);
    },
  };
}

interface ScriptedResponse {
  search?: Record<string, YoutubeSearchItem[]>;
  details?: Record<string, YoutubeVideoDetails>;
  throwOnSearch?: boolean;
}

/** A scriptable fake YouTube client — no network involved. Records calls for reuse-without-search assertions. */
function fakeYoutubeClient(script: ScriptedResponse): YoutubePreviewClient & { searchCalls: string[]; detailsCalls: string[][] } {
  const searchCalls: string[] = [];
  const detailsCalls: string[][] = [];
  return {
    searchCalls,
    detailsCalls,
    async searchVideos(query) {
      searchCalls.push(query);
      if (script.throwOnSearch) throw new Error("YouTube API unreachable");
      return script.search?.[query] ?? [];
    },
    async getVideoDetails(videoIds) {
      detailsCalls.push(videoIds);
      return videoIds.map((id) => script.details?.[id] ?? { videoId: id, durationSeconds: 0, embeddable: false, privacyStatus: "unknown" });
    },
  };
}

function video(overrides: Partial<YoutubeSearchItem> = {}): YoutubeSearchItem {
  return {
    videoId: "v1",
    channelId: "c1",
    channelTitle: "Some Channel",
    title: "Untitled",
    publishedAt: "2026-01-01T00:00:00Z",
    description: "",
    ...overrides,
  };
}

function details(overrides: Partial<YoutubeVideoDetails> = {}): YoutubeVideoDetails {
  return { videoId: "v1", durationSeconds: 3600, embeddable: true, privacyStatus: "public", ...overrides };
}

const NOW = new Date("2026-09-25T12:00:00Z");

describe("parseIso8601Duration", () => {
  it("parses hours/minutes/seconds", () => {
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("PT58M22S")).toBe(3502);
    expect(parseIso8601Duration("PT5M30S")).toBe(330);
    expect(parseIso8601Duration("PT2H16M12S")).toBe(8172);
  });
  it("malformed/missing input -> 0", () => {
    expect(parseIso8601Duration("")).toBe(0);
    expect(parseIso8601Duration("garbage")).toBe(0);
  });
});

describe("titleContainsExactName", () => {
  it("matches the exact name as a distinct phrase", () => {
    expect(titleContainsExactName("NAT | HÖR - October 31 / 2025", "Nat")).toBe(true);
    expect(titleContainsExactName("Âme Live feat. Curses", "Âme")).toBe(true);
  });
  it("does not match a name embedded in a longer word (word-boundary)", () => {
    expect(titleContainsExactName("DJ Nathalie live set", "Nat")).toBe(false);
  });

  it("does not match when the artist is the OBJECT of someone else's set (confirmed live, 30-artist benchmark, 2026-09-25)", () => {
    expect(titleContainsExactName("Papa Bo Selektah - warm up set for MEUTE", "Meute")).toBe(false);
    expect(titleContainsExactName("Some DJ opening for Eric Prydz", "Eric Prydz")).toBe(false);
    expect(titleContainsExactName("Support for CamelPhat at Printworks", "CamelPhat")).toBe(false);
  });

  it("still matches the artist as subject when nearby text merely mentions another act (not the supporting-act phrasing)", () => {
    expect(titleContainsExactName("VSNZ pres. CAMELPHAT @ VSNZ Winter Arc 2026", "CamelPhat")).toBe(true);
    expect(titleContainsExactName("Kasper Bjørke & Sexy Lazer AKA The Mansisters Boiler Room DJ Set at STRØM", "Kasper Bjørke")).toBe(true);
  });
});

describe("countBilledNames", () => {
  it("tolerates a two-person B2B", () => {
    expect(countBilledNames("Kasper Bjørke & Sexy Lazer AKA The Mansisters Boiler Room DJ Set at STRØM")).toBeLessThanOrEqual(2);
  });
  it("flags a diluted multi-artist lineup stream", () => {
    expect(countBilledNames("Sub Focus, Dimension, Culture Shock & 1991: LA Livestream | WORSHIP x DNBNL x UKF On Air")).toBeGreaterThanOrEqual(3);
  });
});

describe("matchArtistYoutubePreview — Rule A", () => {
  it("accepts an artist-owned channel match", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Eric Prydz dj set": [video({ videoId: "v1", channelTitle: "Eric Prydz", title: "ERIC PRYDZ LIVE @ ULTRA MIAMI 2026 | RESISTANCE MEGASTRUCTURE" })],
      },
      details: { v1: details({ videoId: "v1", durationSeconds: 7080 }) },
    });

    const result = await matchArtistYoutubePreview("Eric Prydz", client);

    expect(result.status).toBe("accepted");
    expect(result.matchRule).toBe("A");
    expect(result.videoId).toBe("v1");
    expect(result.channelTitle).toBe("Eric Prydz");
  });

  it("accepts a trusted third-party (Boiler Room) dedicated set", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Octave One live": [video({ videoId: "v2", channelTitle: "Boiler Room", title: "Octave One | Boiler Room Festival Berlin: Refuge Worldwide" })],
        "Octave One dj set": [], // primary query finds nothing eligible -> fallback "live" is tried
      },
      details: { v2: details({ videoId: "v2", durationSeconds: 3562 }) },
    });

    const result = await matchArtistYoutubePreview("Octave One", client);

    expect(result.status).toBe("accepted");
    expect(result.channelTitle).toBe("Boiler Room");
    expect(client.searchCalls).toEqual(["Octave One dj set", "Octave One live"]);
  });

  it.each([
    ["HÖR BERLIN", "UCmfF7JZv26UUKyRedViGIlw", "Fabian Krooss | HÖR - Nov 3 / 2025"],
    ["Cercle", "UCPKT_csvP72boVX0XrMtagQ", "Fabian Krooss live at Château de Chambord, France for Cercle"],
    ["Mixmag", "UCQdCIrTpkhEH5Z8KPsn7NvQ", "Fabian Krooss | Mixmag Lab LDN"],
    ["Keep Hush", "UCQAnY_suiNH0MvdTHk5GiBA", "Fabian Krooss | Keep Hush Live Berlin"],
  ])("accepts a set on the trusted live channel %s with its verified channel id", async (channelTitle, channelId, title) => {
    const client = fakeYoutubeClient({
      search: { "Fabian Krooss dj set": [video({ videoId: "t1", channelTitle, channelId, title })] },
      details: { t1: details({ videoId: "t1", durationSeconds: 3600 }) },
    });
    const result = await matchArtistYoutubePreview("Fabian Krooss", client);
    expect(result).toMatchObject({ status: "accepted", videoId: "t1", channelTitle });
  });

  it.each(["HÖR BERLIN", "Cercle", "Mixmag", "Keep Hush"])("a channel merely NAMED %s, with another channel id, never qualifies", async (channelTitle) => {
    const client = fakeYoutubeClient({
      search: {
        "Fabian Krooss dj set": [video({ videoId: "t4", channelTitle, channelId: "UCimpostor000000000000", title: "Fabian Krooss | Live Set" })],
        "Fabian Krooss live": [],
      },
      details: { t4: details({ videoId: "t4", durationSeconds: 3600 }) },
    });
    expect((await matchArtistYoutubePreview("Fabian Krooss", client)).status).toBe("abstain");
    expect(client.detailsCalls).toHaveLength(0);
  });

  it("the original four trusted channels are still matched by name", async () => {
    const client = fakeYoutubeClient({
      search: { "Fabian Krooss dj set": [video({ videoId: "t5", channelTitle: "Boiler Room", channelId: "any", title: "Fabian Krooss | Boiler Room Berlin" })] },
      details: { t5: details({ videoId: "t5", durationSeconds: 3600 }) },
    });
    expect((await matchArtistYoutubePreview("Fabian Krooss", client)).status).toBe("accepted");
  });

  it("a look-alike of a trusted live channel never qualifies (exact channel name only)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Fabian Krooss dj set": [video({ videoId: "t2", channelTitle: "Cercle Fan Uploads", title: "Fabian Krooss for Cercle" })],
        "Fabian Krooss live": [video({ videoId: "t2", channelTitle: "Mixmag Archive", title: "Fabian Krooss | Mixmag" })],
      },
      details: { t2: details({ videoId: "t2", durationSeconds: 3600 }) },
    });
    expect((await matchArtistYoutubePreview("Fabian Krooss", client)).status).toBe("abstain");
    expect(client.detailsCalls).toHaveLength(0);
  });

  it("the short-continuation guard also protects the new trusted channels (Benji vs \"Benji B\")", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "t3", channelTitle: "HÖR BERLIN", channelId: "UCmfF7JZv26UUKyRedViGIlw", title: "Benji B | HÖR - Mar 1 / 2025" })],
        "Benji live": [video({ videoId: "t3", channelTitle: "HÖR BERLIN", channelId: "UCmfF7JZv26UUKyRedViGIlw", title: "Benji B | HÖR - Mar 1 / 2025" })],
      },
      details: { t3: details({ videoId: "t3", durationSeconds: 3600 }) },
    });
    expect((await matchArtistYoutubePreview("Benji", client)).status).toBe("abstain");
  });

  it("asks YouTube for 15 results per search — same 100-unit cost, more candidates", async () => {
    const asked: number[] = [];
    const client = fakeYoutubeClient({});
    const recording = { ...client, async searchVideos(q: string, n: number) { asked.push(n); return client.searchVideos(q, n); } };
    await matchArtistYoutubePreview("Nobody Here", recording);
    expect(asked).toEqual([15, 15]);
    expect(MAX_SEARCH_RESULTS).toBe(15);
  });

  it("verifies all eligible candidates from one search in a single batched details call", async () => {
    const items = Array.from({ length: 12 }, (_, i) => video({ videoId: `c${i}`, channelTitle: "Eric Prydz", title: `Eric Prydz live ${i}`, publishedAt: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
    const client = fakeYoutubeClient({
      search: { "Eric Prydz dj set": items },
      details: Object.fromEntries(items.map((v) => [v.videoId, details({ videoId: v.videoId, durationSeconds: 3600 })])),
    });
    const result = await matchArtistYoutubePreview("Eric Prydz", client);
    expect(client.detailsCalls).toHaveLength(1);
    expect(client.detailsCalls[0]).toHaveLength(12);
    expect(result.videoId).toBe("c11"); // still the newest safe candidate
  });

  it("abstains on a generic/common-word name even with an exact same-named channel", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Utopia dj set": [video({ videoId: "v3", channelTitle: "UTOPIA", title: "UTOPIA – Hybrid Live Set at Stopića Cave" })],
        "Utopia live": [video({ videoId: "v3", channelTitle: "UTOPIA", title: "UTOPIA – Hybrid Live Set at Stopića Cave" })],
      },
      details: { v3: details({ videoId: "v3", durationSeconds: 3466 }) },
    });

    const result = await matchArtistYoutubePreview("Utopia", client);

    expect(result.status).toBe("abstain");
    expect(client.detailsCalls).toHaveLength(0); // never spent an enrichment call on a structurally-ineligible candidate
  });

  it("abstains when the title bills 3+ other artists, even on a trusted channel", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Sub Focus dj set": [
          video({
            videoId: "v4",
            channelTitle: "UKF On Air",
            title: "Sub Focus, Dimension, Culture Shock & 1991: LA Livestream | WORSHIP x DNBNL x UKF On Air",
          }),
        ],
        "Sub Focus live": [],
      },
      details: { v4: details({ videoId: "v4" }) },
    });

    const result = await matchArtistYoutubePreview("Sub Focus", client);

    expect(result.status).toBe("abstain");
  });

  it("abstains below the 20-minute duration floor", async () => {
    const client = fakeYoutubeClient({
      search: {
        "MCR-T dj set": [video({ videoId: "v5", channelTitle: "Boiler Room", title: "MCR-T | Boiler Room Berlin: Live From Earth" })],
        "MCR-T live": [video({ videoId: "v5", channelTitle: "Boiler Room", title: "MCR-T | Boiler Room Berlin: Live From Earth" })],
      },
      details: { v5: details({ videoId: "v5", durationSeconds: 300 }) },
    });

    const result = await matchArtistYoutubePreview("MCR-T", client);
    expect(result.status).toBe("abstain");
  });

  it("abstains on a non-embeddable video", async () => {
    const client = fakeYoutubeClient({
      search: {
        "MCR-T dj set": [video({ videoId: "v6", channelTitle: "Boiler Room", title: "MCR-T | Boiler Room Berlin: Live From Earth" })],
        "MCR-T live": [video({ videoId: "v6", channelTitle: "Boiler Room", title: "MCR-T | Boiler Room Berlin: Live From Earth" })],
      },
      details: { v6: details({ videoId: "v6", embeddable: false }) },
    });

    const result = await matchArtistYoutubePreview("MCR-T", client);
    expect(result.status).toBe("abstain");
  });

  it("abstains on a private/unavailable video", async () => {
    const client = fakeYoutubeClient({
      search: {
        "MCR-T dj set": [video({ videoId: "v7", channelTitle: "Boiler Room", title: "MCR-T | Boiler Room Berlin: Live From Earth" })],
        "MCR-T live": [video({ videoId: "v7", channelTitle: "Boiler Room", title: "MCR-T | Boiler Room Berlin: Live From Earth" })],
      },
      details: { v7: details({ videoId: "v7", privacyStatus: "private" }) },
    });

    const result = await matchArtistYoutubePreview("MCR-T", client);
    expect(result.status).toBe("abstain");
  });

  it("abstains on a wrong/similarly-named artist (no exact-name title match)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Kardinal Bertram dj set": [video({ videoId: "v8", channelTitle: "KARDENAL", title: "HARDTECHNO POWER SET | Kardenal" })],
        "Kardinal Bertram live": [],
      },
      details: {},
    });

    const result = await matchArtistYoutubePreview("Kardinal Bertram", client);
    expect(result.status).toBe("abstain");
  });

  it("lets a lower-ranked valid candidate beat an invalid rank-1 result", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Meute dj set": [
          video({ videoId: "v_remix", channelTitle: "MEUTE", title: "MEUTE - You & Me (Flume Remix)" }),
          video({ videoId: "v_full", channelTitle: "MEUTE", title: "MEUTE - Live in Paris [Full Concert]" }),
        ],
      },
      details: {
        v_remix: details({ videoId: "v_remix", durationSeconds: 330 }), // fails the duration floor
        v_full: details({ videoId: "v_full", durationSeconds: 4200 }),
      },
    });

    const result = await matchArtistYoutubePreview("Meute", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_full");
  });

  it("abstains rather than accept another artist's warm-up set uploaded to the target's own channel (confirmed live, 30-artist benchmark, 2026-09-25)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Meute dj set": [video({ videoId: "v_warmup", channelTitle: "MEUTE", title: "Papa Bo Selektah - warm up set for MEUTE" })],
        "Meute live": [],
      },
      details: { v_warmup: details({ videoId: "v_warmup", durationSeconds: 3600 }) },
    });

    const result = await matchArtistYoutubePreview("Meute", client);
    expect(result.status).toBe("abstain");
  });

  it("rejects the artist's own podcast/release-preview upload and picks the real set instead (Mat Eclair, 2026-11-14)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Mat Eclair dj set": [
          video({ videoId: "pod", channelTitle: "Mat Eclair", title: "MAT ECLAIR PODCAST / 2024 New Years Eve Special / EP Early Listen", publishedAt: "2026-01-01T00:00:00Z" }),
          video({ videoId: "gig", channelTitle: "Mat Eclair", title: "Mat Eclair DJ Set @ Pumpehuset", publishedAt: "2024-01-01T00:00:00Z" }),
        ],
      },
      details: { pod: details({ videoId: "pod", durationSeconds: 3600 }), gig: details({ videoId: "gig", durationSeconds: 3600 }) },
    });

    const result = await matchArtistYoutubePreview("Mat Eclair", client);
    expect(result.videoId).toBe("gig"); // the newer podcast never even reaches verification
    expect(client.detailsCalls[0]).toEqual(["gig"]);
  });

  it("abstains when the only own-channel candidates are podcasts, radio shows or release previews", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Mat Eclair dj set": [
          video({ videoId: "a", channelTitle: "Mat Eclair", title: "Mat Eclair Podcast #12" }),
          video({ videoId: "b", channelTitle: "Mat Eclair", title: "Mat Eclair - Radio Show Episode 4" }),
        ],
        "Mat Eclair live": [video({ videoId: "c", channelTitle: "Mat Eclair", title: "Mat Eclair - New EP full album listen" })],
      },
      details: { a: details({ videoId: "a" }), b: details({ videoId: "b" }), c: details({ videoId: "c" }) },
    });

    const result = await matchArtistYoutubePreview("Mat Eclair", client);
    expect(result.status).toBe("abstain");
    expect(client.detailsCalls).toHaveLength(0);
  });

  it("propagates a genuine API failure rather than silently returning an abstain", async () => {
    const client = fakeYoutubeClient({ throwOnSearch: true });
    await expect(matchArtistYoutubePreview("Eric Prydz", client)).rejects.toThrow(/unreachable/);
  });
});

describe("matchArtistYoutubePreview — recency preference among Rule A-safe candidates (2026-09-27)", () => {
  it("selects the newest of two Rule A-safe candidates from the same query", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Eric Prydz dj set": [
          video({ videoId: "v_old", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set 2023", publishedAt: "2023-01-01T00:00:00Z" }),
          video({ videoId: "v_new", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set 2026", publishedAt: "2026-06-01T00:00:00Z" }),
        ],
      },
      details: { v_old: details({ videoId: "v_old" }), v_new: details({ videoId: "v_new" }) },
    });

    const result = await matchArtistYoutubePreview("Eric Prydz", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_new");
  });

  it("an older safe candidate wins over a newer candidate that fails Rule A safety (correctness always outranks recency)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Eric Prydz dj set": [
          video({ videoId: "v_new_unsafe", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set 2026", publishedAt: "2026-06-01T00:00:00Z" }),
          video({ videoId: "v_old_safe", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set 2023", publishedAt: "2023-01-01T00:00:00Z" }),
        ],
      },
      details: {
        v_new_unsafe: details({ videoId: "v_new_unsafe", durationSeconds: 300 }), // fails the 20-minute floor
        v_old_safe: details({ videoId: "v_old_safe" }),
      },
    });

    const result = await matchArtistYoutubePreview("Eric Prydz", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_old_safe");
  });

  it("selects the newest of two safe own-channel candidates", async () => {
    const client = fakeYoutubeClient({
      search: {
        "MEUTE dj set": [
          video({ videoId: "v_own_old", channelTitle: "MEUTE", title: "MEUTE - Live in Paris [Full Concert]", publishedAt: "2022-05-01T00:00:00Z" }),
          video({ videoId: "v_own_new", channelTitle: "MEUTE", title: "MEUTE - Live in Berlin [Full Concert]", publishedAt: "2026-03-01T00:00:00Z" }),
        ],
      },
      details: { v_own_old: details({ videoId: "v_own_old" }), v_own_new: details({ videoId: "v_own_new" }) },
    });

    const result = await matchArtistYoutubePreview("MEUTE", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_own_new");
    expect(result.channelTitle).toBe("MEUTE");
  });

  it("selects the newest of two safe trusted-channel candidates", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Octave One dj set": [
          video({ videoId: "v_trusted_old", channelTitle: "Boiler Room", title: "Octave One | Boiler Room Festival Berlin", publishedAt: "2021-01-01T00:00:00Z" }),
          video({ videoId: "v_trusted_new", channelTitle: "Boiler Room", title: "Octave One | Boiler Room London", publishedAt: "2026-02-01T00:00:00Z" }),
        ],
      },
      details: { v_trusted_old: details({ videoId: "v_trusted_old" }), v_trusted_new: details({ videoId: "v_trusted_new" }) },
    });

    const result = await matchArtistYoutubePreview("Octave One", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_trusted_new");
    expect(result.channelTitle).toBe("Boiler Room");
  });

  it("a safe primary-query candidate still wins over a newer safe fallback candidate — fallback is never even queried", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Eric Prydz dj set": [video({ videoId: "v_primary", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set 2023", publishedAt: "2023-01-01T00:00:00Z" })],
        "Eric Prydz live": [video({ videoId: "v_fallback_newer", channelTitle: "Eric Prydz", title: "Eric Prydz Live 2026", publishedAt: "2026-06-01T00:00:00Z" })],
      },
      details: { v_primary: details({ videoId: "v_primary" }), v_fallback_newer: details({ videoId: "v_fallback_newer" }) },
    });

    const result = await matchArtistYoutubePreview("Eric Prydz", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_primary");
    expect(client.searchCalls).toEqual(["Eric Prydz dj set"]); // primary already had a safe candidate — no fallback/recency comparison across queries
  });

  it("no safe primary candidate -> fallback runs, and the newest safe fallback candidate wins", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Octave One dj set": [],
        "Octave One live": [
          video({ videoId: "v_fb_old", channelTitle: "Boiler Room", title: "Octave One | Boiler Room Refuge Worldwide", publishedAt: "2021-01-01T00:00:00Z" }),
          video({ videoId: "v_fb_new", channelTitle: "Boiler Room", title: "Octave One | Boiler Room London", publishedAt: "2026-02-01T00:00:00Z" }),
        ],
      },
      details: { v_fb_old: details({ videoId: "v_fb_old" }), v_fb_new: details({ videoId: "v_fb_new" }) },
    });

    const result = await matchArtistYoutubePreview("Octave One", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_fb_new");
    expect(client.searchCalls).toEqual(["Octave One dj set", "Octave One live"]);
  });

  it("a single safe old candidate is still accepted — recency is a preference, not a maximum-age cutoff", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Eric Prydz dj set": [video({ videoId: "v_ancient", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set 2018", publishedAt: "2018-01-01T00:00:00Z" })],
      },
      details: { v_ancient: details({ videoId: "v_ancient" }) },
    });

    const result = await matchArtistYoutubePreview("Eric Prydz", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_ancient");
  });

  it("no Rule A-safe candidates at all -> abstain, unaffected by the recency change", async () => {
    const client = fakeYoutubeClient({
      search: { "Some New Artist dj set": [], "Some New Artist live": [] },
      details: {},
    });

    const result = await matchArtistYoutubePreview("Some New Artist", client);

    expect(result.status).toBe("abstain");
    expect(result.videoId).toBeNull();
  });
});

describe("matchArtistYoutubePreview — trusted-channel short-suffix guard (2026-09-29)", () => {
  it("rejects a trusted-channel match where the title continues with a different short stage name (Benji / Benji B, the confirmed false positive)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_benji_b", channelTitle: "Boiler Room", title: "Benji B | Boiler Room London" })],
        "Benji live": [],
      },
      details: { v_benji_b: details({ videoId: "v_benji_b" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("abstain");
    expect(result.videoId).toBeNull();
  });

  it("accepts a glued apostrophe continuation of the same name (SAMA / Sama' Abdulhadi)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "SAMA dj set": [video({ videoId: "v_sama", channelTitle: "Boiler Room", title: "Sama' Abdulhadi | Boiler Room: Palestine" })],
      },
      details: { v_sama: details({ videoId: "v_sama" }) },
    });

    const result = await matchArtistYoutubePreview("SAMA", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_sama");
  });

  it("accepts a continuation that names the channel itself (Stenny / Boiler Room Munich DJ Set)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Stenny dj set": [video({ videoId: "v_stenny", channelTitle: "Boiler Room", title: "Stenny Boiler Room Munich DJ Set" })],
      },
      details: { v_stenny: details({ videoId: "v_stenny" }) },
    });

    const result = await matchArtistYoutubePreview("Stenny", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_stenny");
  });

  it("rejects a hyphen-separated short continuation on a trusted channel (same ambiguity as a space-separated one)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_hyphen", channelTitle: "Boiler Room", title: "Benji - B | Boiler Room London" })],
        "Benji live": [],
      },
      details: { v_hyphen: details({ videoId: "v_hyphen" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("abstain");
  });

  it("accepts a hyphen-separated continuation that is a substantive word, not a short token", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_hyphen_safe", channelTitle: "Boiler Room", title: "Benji - Boiler Room Session" })],
      },
      details: { v_hyphen_safe: details({ videoId: "v_hyphen_safe" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_hyphen_safe");
  });

  it("rejects an en-dash-separated short continuation on a trusted channel, same as an ASCII hyphen (Benji – B)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_endash", channelTitle: "Boiler Room", title: "Benji – B | Boiler Room London" })],
        "Benji live": [],
      },
      details: { v_endash: details({ videoId: "v_endash" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("abstain");
  });

  it("rejects an em-dash-separated short continuation on a trusted channel, same as an ASCII hyphen (Benji — B)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_emdash", channelTitle: "Boiler Room", title: "Benji — B | Boiler Room London" })],
        "Benji live": [],
      },
      details: { v_emdash: details({ videoId: "v_emdash" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("abstain");
  });

  it("accepts an en-dash-separated continuation that is a substantive word, not a short token", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_endash_safe", channelTitle: "Boiler Room", title: "Benji – Boiler Room Session" })],
      },
      details: { v_endash_safe: details({ videoId: "v_endash_safe" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_endash_safe");
  });

  it("accepts an em-dash-separated continuation that is a substantive word, not a short token", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_emdash_safe", channelTitle: "Boiler Room", title: "Benji — Boiler Room Session" })],
      },
      details: { v_emdash_safe: details({ videoId: "v_emdash_safe" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_emdash_safe");
  });

  it("accepts a legitimate artist name that itself contains an ASCII hyphen, unaffected by dash handling in the continuation check (MCR-T)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "MCR-T dj set": [video({ videoId: "v_mcrt", channelTitle: "Boiler Room", title: "MCR-T – Boiler Room Berlin: Live From Earth" })],
      },
      details: { v_mcrt: details({ videoId: "v_mcrt" }) },
    });

    const result = await matchArtistYoutubePreview("MCR-T", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_mcrt");
  });

  it("rejects a colon-separated short continuation on a trusted channel", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_colon", channelTitle: "Boiler Room", title: "Benji: B | Boiler Room London" })],
        "Benji live": [],
      },
      details: { v_colon: details({ videoId: "v_colon" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("abstain");
  });

  it("accepts a colon-separated continuation that names the channel", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_colon_safe", channelTitle: "Boiler Room", title: "Benji: Boiler Room DJ Set" })],
      },
      details: { v_colon_safe: details({ videoId: "v_colon_safe" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_colon_safe");
  });

  it("accepts a legitimate b2b credit on a trusted channel — the connector is not a distinct name", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_b2b", channelTitle: "Boiler Room", title: "Benji b2b Todd | Boiler Room X" })],
      },
      details: { v_b2b: details({ videoId: "v_b2b" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_b2b");
  });

  it("rejects a short version tag rather than assuming it's harmless (ambiguous -> abstain, not allow-listed)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_v2", channelTitle: "Boiler Room", title: "Benji V2 | Boiler Room" })],
        "Benji live": [],
      },
      details: { v_v2: details({ videoId: "v_v2" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("abstain");
  });

  it("does not apply the short-suffix guard to own-channel matches (scoped to trusted channels only)", async () => {
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "v_own", channelTitle: "Benji", title: "Benji B Official Highlights" })],
      },
      details: { v_own: details({ videoId: "v_own" }) },
    });

    const result = await matchArtistYoutubePreview("Benji", client);

    expect(result.status).toBe("accepted");
    expect(result.videoId).toBe("v_own");
    expect(result.channelTitle).toBe("Benji");
  });
});

describe("getOrMatchArtistYoutubePreview — manual block survives the Rule A short-suffix fix (2026-09-29)", () => {
  it("a fresh re-lookup for the previously-blocked Benji entry now abstains (Benji B correctly rejected), and the manual block is preserved", async () => {
    const cache = inMemoryCache();
    await cache.set({
      artistNameNormalized: normalizeArtistName("Benji"),
      provider: "youtube",
      status: "accepted",
      matchRule: "A",
      query: "Benji dj set",
      videoId: "GsleNHtYFGU",
      videoTitle: "Benji B | Boiler Room London",
      channelId: "UCGBpxWJr9FNOcFYA5GkKrMg",
      channelTitle: "Boiler Room",
      evidence: {},
      manualBlock: true,
      matchedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      lastVerifiedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(NOW.getTime() - 1), // expired -> triggers a fresh lookup
    });
    const client = fakeYoutubeClient({
      search: {
        "Benji dj set": [video({ videoId: "GsleNHtYFGU", channelTitle: "Boiler Room", title: "Benji B | Boiler Room London" })],
        "Benji live": [],
      },
      details: { GsleNHtYFGU: details({ videoId: "GsleNHtYFGU" }) },
    });

    const result = await getOrMatchArtistYoutubePreview("Benji", cache, client, NOW);

    expect(result.status).toBe("abstain"); // the matcher itself now correctly rejects Benji B
    expect(result.videoId).toBeNull();
    expect(result.manualBlock).toBe(true); // the manual block is preserved regardless
  });
});

describe("getOrMatchArtistYoutubePreview — cache behavior", () => {
  it("cache miss performs a lookup and writes the result to the cache", async () => {
    const cache = inMemoryCache();
    const client = fakeYoutubeClient({
      search: { "Eric Prydz dj set": [video({ videoId: "v1", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set" })] },
      details: { v1: details() },
    });

    const result = await getOrMatchArtistYoutubePreview("Eric Prydz", cache, client, NOW);

    expect(result.status).toBe("accepted");
    expect(cache.store.has(normalizeArtistName("Eric Prydz"))).toBe(true);
  });

  it("a cached podcast match accepted under older rules is matched again, not served from cache", async () => {
    const cache = inMemoryCache();
    await cache.set({
      artistNameNormalized: "mat eclair",
      provider: "youtube",
      status: "accepted",
      matchRule: "A",
      query: "Mat Eclair dj set",
      videoId: "pod",
      videoTitle: "MAT ECLAIR PODCAST / 2024 New Years Eve Special / EP Early Listen",
      channelId: "c1",
      channelTitle: "Mat Eclair",
      evidence: {},
      manualBlock: false,
      matchedAt: NOW,
      lastVerifiedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000),
    });
    const client = fakeYoutubeClient({
      search: { "Mat Eclair dj set": [video({ videoId: "gig", channelTitle: "Mat Eclair", title: "Mat Eclair DJ Set" })] },
      details: { gig: details({ videoId: "gig" }) },
    });

    const result = await getOrMatchArtistYoutubePreview("Mat Eclair", cache, client, NOW);
    expect(client.searchCalls).toEqual(["Mat Eclair dj set"]);
    expect(result.videoId).toBe("gig");
  });

  it("an accepted match is reused across events without a new search", async () => {
    const cache = inMemoryCache();
    const client = fakeYoutubeClient({
      search: { "Eric Prydz dj set": [video({ videoId: "v1", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set" })] },
      details: { v1: details() },
    });

    const first = await getOrMatchArtistYoutubePreview("Eric Prydz", cache, client, NOW);
    // A different event's lineup, same artist, different casing/whitespace — same normalized identity.
    const second = await getOrMatchArtistYoutubePreview("  ERIC   PRYDZ  ", cache, client, new Date(NOW.getTime() + 60_000));

    expect(client.searchCalls).toHaveLength(1); // still 1 — no second network call
    expect(second.videoId).toBe(first.videoId);
  });

  it("an abstain is also reused across events without a new search", async () => {
    const cache = inMemoryCache();
    const client = fakeYoutubeClient({
      search: {
        "Utopia dj set": [video({ videoId: "v3", channelTitle: "UTOPIA", title: "UTOPIA – Hybrid Live Set" })],
        "Utopia live": [video({ videoId: "v3", channelTitle: "UTOPIA", title: "UTOPIA – Hybrid Live Set" })],
      },
      details: { v3: details() },
    });

    await getOrMatchArtistYoutubePreview("Utopia", cache, client, NOW);
    expect(client.searchCalls).toHaveLength(2); // primary + fallback on the first lookup

    const second = await getOrMatchArtistYoutubePreview("Utopia", cache, client, new Date(NOW.getTime() + 60_000));
    expect(client.searchCalls).toHaveLength(2); // unchanged — no re-search on the cached abstain
    expect(second.status).toBe("abstain");
  });

  it("re-verifies a stale accepted match's embeddable/public status without re-searching, and flips to abstain if it now fails", async () => {
    const cache = inMemoryCache();
    const client = fakeYoutubeClient({
      search: { "Eric Prydz dj set": [video({ videoId: "v1", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set" })] },
      details: { v1: details({ videoId: "v1", privacyStatus: "private" }) }, // now private, at re-verification time
    });

    // Seed a cache entry as if matched VERIFY_STALE_DAYS+1 days ago and still valid (expiresAt far in the future).
    await cache.set({
      artistNameNormalized: normalizeArtistName("Eric Prydz"),
      provider: "youtube",
      status: "accepted",
      matchRule: "A",
      query: "Eric Prydz dj set",
      videoId: "v1",
      videoTitle: "Eric Prydz DJ Set",
      channelId: "c1",
      channelTitle: "Eric Prydz",
      evidence: {},
      manualBlock: false,
      matchedAt: new Date(NOW.getTime() - (VERIFY_STALE_DAYS + 1) * 24 * 60 * 60 * 1000),
      lastVerifiedAt: new Date(NOW.getTime() - (VERIFY_STALE_DAYS + 1) * 24 * 60 * 60 * 1000),
      expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const result = await getOrMatchArtistYoutubePreview("Eric Prydz", cache, client, NOW);

    expect(client.searchCalls).toHaveLength(0); // re-verification never re-searches
    expect(client.detailsCalls).toHaveLength(1); // one cheap videos.list call
    expect(result.status).toBe("abstain");
    expect(result.videoId).toBeNull();
  });

  it("a manual block survives a fresh re-lookup", async () => {
    const cache = inMemoryCache();
    await cache.set({
      artistNameNormalized: normalizeArtistName("Eric Prydz"),
      provider: "youtube",
      status: "accepted",
      matchRule: "A",
      query: "Eric Prydz dj set",
      videoId: "v1",
      videoTitle: "Eric Prydz DJ Set",
      channelId: "c1",
      channelTitle: "Eric Prydz",
      evidence: {},
      manualBlock: true,
      matchedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      lastVerifiedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(NOW.getTime() - 1), // expired -> triggers a fresh lookup
    });
    const client = fakeYoutubeClient({
      search: { "Eric Prydz dj set": [video({ videoId: "v1", channelTitle: "Eric Prydz", title: "Eric Prydz DJ Set" })] },
      details: { v1: details() },
    });

    const result = await getOrMatchArtistYoutubePreview("Eric Prydz", cache, client, NOW);

    expect(result.status).toBe("accepted"); // the matcher itself still accepts it
    expect(result.manualBlock).toBe(true); // but the block is preserved for the serving layer to respect
  });
});

describe("nonPerformanceTitleTerm", () => {
  it("flags podcasts, episodes, radio shows, release previews and studio/talk videos", () => {
    for (const title of [
      "MAT ECLAIR PODCAST / 2024 New Years Eve Special / EP Early Listen",
      "Artist - Episode 41",
      "Artist Radio Show 2025",
      "Artist - Debut Album Listening Session",
      "Artist LP preview",
      "Artist - Essential Mix",
      "Artist Guest Mix for XYZ",
      "Artist Mixtape Vol. 3",
      "Artist interview",
      "Artist in the studio",
      "Artist Q&A",
    ]) {
      expect(nonPerformanceTitleTerm(title, "Artist"), title).not.toBeNull();
    }
  });

  it("leaves real sets alone, including live mixes and trusted-channel names", () => {
    for (const title of [
      "ERIC PRYDZ LIVE @ ULTRA MIAMI 2026 | RESISTANCE MEGASTRUCTURE",
      "Artist | Boiler Room London",
      "Artist Live Mix at Berghain",
      "Artist - Mixmag Lab LDN",
      "Artist b2b Other DJ Set",
    ]) {
      expect(nonPerformanceTitleTerm(title, "Artist"), title).toBeNull();
    }
  });

  it("ignores words that are part of the artist's own name", () => {
    expect(nonPerformanceTitleTerm("Radio Slave | Boiler Room Berlin", "radio slave")).toBeNull();
    expect(nonPerformanceTitleTerm("The Album Leaf live at KEXP", "The Album Leaf")).toBeNull();
    expect(nonPerformanceTitleTerm("The Album Leaf - podcast", "The Album Leaf")).toBe("podcast");
  });
});
