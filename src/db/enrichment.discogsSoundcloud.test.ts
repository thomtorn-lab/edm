import { beforeEach, describe, expect, it, vi } from "vitest";

/** db faked: only checks that the genre cache's write keeps a verified SoundCloud assessment across a re-lookup. */
const stored: { discogsArtistId: number | null; evidence: unknown }[] = [];
const written: { evidence: unknown }[] = [];
vi.mock("./client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => stored }) }) }),
    insert: () => ({ values: (row: { evidence: unknown }) => ({ onConflictDoUpdate: async () => void written.push(row) }) }),
  },
}));

const { drizzleCacheStore } = await import("./enrichment");
const sc = { verdict: "verifiable", reason: "ok", profileUrl: "https://soundcloud.com/x", soundcloudName: "X", checkedAt: "2026-11-07T00:00:00.000Z" };
const entry = (discogsArtistId: number | null) => ({
  artistNameNormalized: "aaaa bbbb",
  lookupStatus: "found" as const,
  proposedGenre: null,
  genreConfidence: null,
  identityConfidence: "medium" as const,
  discogsArtistId,
  evidence: { releasesExamined: [] },
  classificationMethod: "discogs",
  lookedUpAt: new Date(),
  expiresAt: new Date(),
});

beforeEach(() => {
  stored.length = 0;
  written.length = 0;
});

describe("artist_genre_cache writes (e.g. a later sync's genre refresh)", () => {
  it("keep the stored SoundCloud verification for the same Discogs artist", async () => {
    stored.push({ discogsArtistId: 42, evidence: { soundcloud: sc } });
    await drizzleCacheStore.set(entry(42));
    expect(written[0].evidence).toEqual({ releasesExamined: [], soundcloud: sc });
  });

  it("drop it when Discogs now resolves to another artist", async () => {
    stored.push({ discogsArtistId: 42, evidence: { soundcloud: sc } });
    await drizzleCacheStore.set(entry(9));
    expect(written[0].evidence).toEqual({ releasesExamined: [] });
  });
});
