import { describe, expect, it } from "vitest";
import {
  getOrMatchArtistYoutubePreview,
  matchArtistYoutubePreview,
  titleContainsExactName,
  countBilledNames,
  normalizeArtistName,
  VERIFY_STALE_DAYS,
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

  it("propagates a genuine API failure rather than silently returning an abstain", async () => {
    const client = fakeYoutubeClient({ throwOnSearch: true });
    await expect(matchArtistYoutubePreview("Eric Prydz", client)).rejects.toThrow(/unreachable/);
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
