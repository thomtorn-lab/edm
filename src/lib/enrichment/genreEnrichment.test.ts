import { describe, expect, it, vi } from "vitest";
import {
  getOrLookupArtistGenre,
  enrichEventGenre,
  normalizeArtistName,
  CLASSIFICATION_METHOD,
  type ArtistCacheEntry,
  type ArtistGenreCacheStore,
  type DiscogsLookupClient,
} from "./genreEnrichment";

/** In-memory cache — same shape/behavior as the Drizzle-backed one in src/db/enrichment.ts. */
function inMemoryCache(): ArtistGenreCacheStore & { store: Map<string, ArtistCacheEntry> } {
  const store = new Map<string, ArtistCacheEntry>();
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

/** A scriptable fake Discogs client — no network involved. */
function fakeDiscogsClient(overrides: Partial<DiscogsLookupClient> = {}): DiscogsLookupClient & { searchCalls: string[] } {
  const searchCalls: string[] = [];
  return {
    searchCalls,
    async searchArtist(name) {
      searchCalls.push(name);
      return overrides.searchArtist ? await overrides.searchArtist(name) : [];
    },
    async getArtistReleaseIds(id, limit) {
      return overrides.getArtistReleaseIds ? await overrides.getArtistReleaseIds(id, limit) : [];
    },
    async getReleaseGenres(id) {
      return overrides.getReleaseGenres ? await overrides.getReleaseGenres(id) : { genres: [], styles: [] };
    },
  };
}

const NOW = new Date("2026-08-16T12:00:00Z");

describe("getOrLookupArtistGenre", () => {
  it("cache miss: performs a Discogs lookup and writes the result to the cache", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 1, title: "Gerd Janson" }],
      getArtistReleaseIds: async () => [100],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["House"] }),
    });

    const result = await getOrLookupArtistGenre("Gerd Janson", cache, client, NOW);

    expect(result.lookupStatus).toBe("found");
    expect(result.proposedGenre).toBe("house");
    expect(result.genreConfidence).toBe("medium");
    expect(result.identityConfidence).toBe("medium");
    expect(result.discogsArtistId).toBe(1);
    expect(result.classificationMethod).toBe(CLASSIFICATION_METHOD);
    expect(cache.store.has(normalizeArtistName("Gerd Janson"))).toBe(true);
  });

  it("cache hit: an unexpired entry is returned without calling Discogs again", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({ searchArtist: async () => [{ id: 1, title: "Gerd Janson" }] });

    await getOrLookupArtistGenre("Gerd Janson", cache, client, NOW);
    expect(client.searchCalls).toHaveLength(1);

    await getOrLookupArtistGenre("Gerd Janson", cache, client, new Date(NOW.getTime() + 60_000));
    expect(client.searchCalls).toHaveLength(1); // still 1 — no second network call
  });

  it("an expired cache entry triggers a fresh lookup", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({ searchArtist: async () => [] }); // not_found -> short TTL

    await getOrLookupArtistGenre("Nobody Known", cache, client, NOW);
    expect(client.searchCalls).toHaveLength(1);

    const eightDaysLater = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000); // past the 7-day not_found TTL
    await getOrLookupArtistGenre("Nobody Known", cache, client, eightDaysLater);
    expect(client.searchCalls).toHaveLength(2);
  });

  it("exact artist match: resolves genre when exactly one Discogs artist matches the name", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [
        { id: 5, title: "Bicep" },
        { id: 6, title: "Some Other Artist" }, // must be filtered out — not an exact name match
      ],
      getArtistReleaseIds: async () => [200],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Deep House"] }),
    });

    const result = await getOrLookupArtistGenre("Bicep", cache, client, NOW);
    expect(result.lookupStatus).toBe("found");
    expect(result.discogsArtistId).toBe(5);
    expect(result.proposedGenre).toBe("deep-house");
  });

  it("same-name ambiguity: multiple distinct Discogs artists under the exact same name are never auto-picked", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [
        { id: 10, title: "SKALA" },
        { id: 11, title: "SKALA (2)" }, // Discogs' own disambiguation — a genuinely different real person
      ],
    });

    const result = await getOrLookupArtistGenre("SKALA", cache, client, NOW);
    expect(result.lookupStatus).toBe("ambiguous");
    expect(result.identityConfidence).toBe("low");
    expect(result.proposedGenre).toBeNull();
    expect(result.discogsArtistId).toBeNull();
  });

  it("a bare unique same-name match is only ever 'medium' identity confidence, never 'high'", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 20, title: "Oliver Koletzki" }],
      getArtistReleaseIds: async () => [300],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Melodic Techno"] }),
    });

    const result = await getOrLookupArtistGenre("Oliver Koletzki", cache, client, NOW);
    expect(result.identityConfidence).toBe("medium");
    expect(result.identityConfidence).not.toBe("high");
  });

  it("unsupported/multi-genre evidence does not force a single genre", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 30, title: "B From E" }],
      getArtistReleaseIds: async () => [400, 401],
      getReleaseGenres: async (id) =>
        id === 400 ? { genres: ["Electronic"], styles: ["Trance"] } : { genres: ["Electronic"], styles: ["Techno"] },
    });

    const result = await getOrLookupArtistGenre("B From E", cache, client, NOW);
    expect(result.lookupStatus).toBe("found"); // identity resolved fine
    expect(result.proposedGenre).toBeNull(); // but genre is genuinely conflicting — not guessed
  });

  it("no genre confidence ever exceeds medium, even across many matching releases", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 40, title: "Very Well Documented Artist" }],
      getArtistReleaseIds: async () => [1, 2, 3],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Techno"] }),
    });

    const result = await getOrLookupArtistGenre("Very Well Documented Artist", cache, client, NOW);
    expect(result.proposedGenre).toBe("techno");
    expect(result.genreConfidence).toBe("medium");
    expect(result.genreConfidence).not.toBe("high");
  });

  it("a Discogs search failure propagates as a rejected promise, not a false result", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => {
        throw new Error("Discogs request failed: HTTP 429 for /database/search");
      },
    });

    await expect(getOrLookupArtistGenre("Anyone", cache, client, NOW)).rejects.toThrow(/429/);
  });

  it("a release-detail failure for one release does not fail the whole artist lookup", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 50, title: "Solomun" }],
      getArtistReleaseIds: async () => [500, 501],
      getReleaseGenres: async (id) => {
        if (id === 500) throw new Error("Discogs request failed: HTTP 503 for /releases/500");
        return { genres: ["Electronic"], styles: ["Deep House"] };
      },
    });

    const result = await getOrLookupArtistGenre("Solomun", cache, client, NOW);
    expect(result.lookupStatus).toBe("found");
    expect(result.proposedGenre).toBe("deep-house");
  });
});

describe("placeholder artist names", () => {
  it("skips TBA/TBD/TBC entirely — never searched, never cached", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 1, title: "Should Not Be Called" }],
    });

    const result = await enrichEventGenre(["TBA", "tbd", "T.B.C."], cache, client, NOW);
    expect(client.searchCalls).toHaveLength(0);
    expect(cache.store.size).toBe(0);
    expect(result.perArtist).toHaveLength(0);
    expect(result.genre).toBeNull();
  });

  it("still processes real artists alongside skipped placeholders in the same lineup", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async (name) => [{ id: 1, title: name }],
      getArtistReleaseIds: async () => [1],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Techno"] }),
    });

    const result = await enrichEventGenre(["TBA", "Working Artist"], cache, client, NOW);
    expect(client.searchCalls).toEqual(["Working Artist"]);
    expect(result.genre).toBe("techno");
  });
});

describe("lineup annotation cleanup (real Hangaren examples)", () => {
  it('cleans "Âme (live) (Innervisions)" to "Âme" for search/cache identity, but preserves the raw string in evidence', async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 5, title: "Âme" }],
      getArtistReleaseIds: async () => [200],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Deep House"] }),
    });

    const result = await getOrLookupArtistGenre("Âme (live) (Innervisions)", cache, client, NOW);
    expect(client.searchCalls).toEqual(["Âme"]);
    expect(result.artistNameNormalized).toBe(normalizeArtistName("Âme"));
    expect((result.evidence as { rawArtistName: string }).rawArtistName).toBe("Âme (live) (Innervisions)");
    expect((result.evidence as { cleanedArtistName: string }).cleanedArtistName).toBe("Âme");
    // "Âme" is itself short/generic (<=4 letters) — see the short-name identity
    // safety tests below — so identity is correctly degraded even once cleaned.
    expect(result.identityConfidence).toBe("low");
    expect(result.proposedGenre).toBeNull();
  });

  it('cleans "Oliver Koletzki [Stil vor Talent]" to "Oliver Koletzki" and resolves genre normally', async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 20, title: "Oliver Koletzki" }],
      getArtistReleaseIds: async () => [300],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Melodic Techno"] }),
    });

    const result = await getOrLookupArtistGenre("Oliver Koletzki [Stil vor Talent]", cache, client, NOW);
    expect(client.searchCalls).toEqual(["Oliver Koletzki"]);
    expect((result.evidence as { rawArtistName: string }).rawArtistName).toBe("Oliver Koletzki [Stil vor Talent]");
    expect(result.identityConfidence).toBe("medium");
    expect(result.proposedGenre).toBe("melodic-techno");
  });

  it('cleans "Mira (Kater, MiZi MuZiK, Kiosk I.D.)" to "Mira" for search/cache identity, but preserves the raw string in evidence', async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 50, title: "Mira" }],
      getArtistReleaseIds: async () => [500],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Deep House"] }),
    });

    const result = await getOrLookupArtistGenre("Mira (Kater, MiZi MuZiK, Kiosk I.D.)", cache, client, NOW);
    expect(client.searchCalls).toEqual(["Mira"]);
    expect((result.evidence as { rawArtistName: string }).rawArtistName).toBe("Mira (Kater, MiZi MuZiK, Kiosk I.D.)");
    expect((result.evidence as { cleanedArtistName: string }).cleanedArtistName).toBe("Mira");
    // "Mira" is itself short/generic (4 letters) — degraded for the same reason as Âme above.
    expect(result.identityConfidence).toBe("low");
    expect(result.proposedGenre).toBeNull();
  });

  it("does not strip a name down to nothing when it is entirely one bracketed group", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({ searchArtist: async () => [] });

    await getOrLookupArtistGenre("(Unknown Collective)", cache, client, NOW);
    // The whole name is one trailing bracketed group — stripping it would
    // leave an empty search term, so the guard against reducing a name to
    // nothing must kick in and leave it untouched.
    expect(client.searchCalls).toEqual(["(Unknown Collective)"]);
  });
});

describe("short/generic artist name identity safety", () => {
  it("does not treat a bare exact-name match on a short/generic name as verified identity, even with confidently electronic releases (real incident: ENNA)", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 2764722, title: "ENNA" }],
      getArtistReleaseIds: async () => [1, 2],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Downtempo", "Glitch", "Tech House"] }),
    });

    const result = await getOrLookupArtistGenre("ENNA", cache, client, NOW);
    expect(result.lookupStatus).toBe("found");
    expect(result.discogsArtistId).toBe(2764722);
    expect(result.identityConfidence).toBe("low");
    expect(result.proposedGenre).toBeNull();
    expect(result.genreConfidence).toBeNull();
  });

  it("a longer, distinctive name with the same confirmed-electronic evidence is NOT degraded", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 99, title: "Recondite" }],
      getArtistReleaseIds: async () => [1],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Tech House"] }),
    });

    const result = await getOrLookupArtistGenre("Recondite", cache, client, NOW);
    expect(result.identityConfidence).toBe("medium");
    expect(result.proposedGenre).toBe("tech-house");
    expect(result.genreConfidence).toBe("medium");
    expect(result.genreConfidence).not.toBe("high"); // MEDIUM confidence ceiling stays intact
  });

  it("a degraded short-name result is still cached (as low/no-genre) so it isn't re-looked-up every sync", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async () => [{ id: 2764722, title: "ENNA" }],
      getArtistReleaseIds: async () => [1],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Downtempo"] }),
    });

    await getOrLookupArtistGenre("ENNA", cache, client, NOW);
    expect(client.searchCalls).toHaveLength(1);
    const cached = await cache.get(normalizeArtistName("ENNA"));
    expect(cached?.identityConfidence).toBe("low");

    await getOrLookupArtistGenre("ENNA", cache, client, new Date(NOW.getTime() + 60_000));
    expect(client.searchCalls).toHaveLength(1); // cache satisfied it — no regression to cache behavior
  });
});

describe("enrichEventGenre", () => {
  it("resolves the event genre when every artist with evidence agrees", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async (name) => [{ id: name.length, title: name }],
      getArtistReleaseIds: async () => [1],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Techno"] }),
    });

    const result = await enrichEventGenre(["Artist One", "Artist Two"], cache, client, NOW);
    expect(result.genre).toBe("techno");
    expect(result.genreConfidence).toBe("medium");
    expect(result.perArtist).toHaveLength(2);
  });

  it("treats an unresolved artist as neutral, not contradicting", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async (name) => (name === "Known Artist" ? [{ id: 1, title: name }] : []),
      getArtistReleaseIds: async () => [1],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Deep House"] }),
    });

    const result = await enrichEventGenre(["Known Artist", "Totally Unknown DJ"], cache, client, NOW);
    expect(result.genre).toBe("deep-house");
  });

  it("does not force a genre when two artists in the lineup disagree", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async (name) => [{ id: name === "Techno Artist" ? 1 : 2, title: name }],
      getArtistReleaseIds: async (artistId) => [artistId],
      getReleaseGenres: async (id) => (id === 1 ? { genres: ["Electronic"], styles: ["Techno"] } : { genres: ["Electronic"], styles: ["Trance"] }),
    });

    const result = await enrichEventGenre(["Techno Artist", "Trance Artist"], cache, client, NOW);
    expect(result.genre).toBeNull();
  });

  it("a Discogs failure for one artist does not block enrichment for the rest of the lineup", async () => {
    const cache = inMemoryCache();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = fakeDiscogsClient({
      searchArtist: async (name) => {
        if (name === "Broken Lookup") throw new Error("network timeout");
        return [{ id: 1, title: name }];
      },
      getArtistReleaseIds: async () => [1],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["House"] }),
    });

    const result = await enrichEventGenre(["Broken Lookup", "Working Artist"], cache, client, NOW);
    expect(result.genre).toBe("house");
    errorSpy.mockRestore();
  });

  it("repeated sync (second call with the same lineup) reuses the cache and makes no new Discogs calls", async () => {
    const cache = inMemoryCache();
    const client = fakeDiscogsClient({
      searchArtist: async (name) => [{ id: 1, title: name }],
      getArtistReleaseIds: async () => [1],
      getReleaseGenres: async () => ({ genres: ["Electronic"], styles: ["Techno"] }),
    });

    await enrichEventGenre(["Repeat Artist"], cache, client, NOW);
    expect(client.searchCalls).toHaveLength(1);

    // Simulates the next scheduled sync (6h later) re-encountering the same lineup.
    await enrichEventGenre(["Repeat Artist"], cache, client, new Date(NOW.getTime() + 6 * 60 * 60 * 1000));
    expect(client.searchCalls).toHaveLength(1); // no second lookup — cache satisfied it
  });
});
