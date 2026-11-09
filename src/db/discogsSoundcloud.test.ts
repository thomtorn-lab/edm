import { beforeEach, describe, expect, it, vi } from "vitest";

/** db, the existing Discogs integration and fetch are faked: this tests the cache-first, bounded behaviour only. */
const cacheRows: { key: string; lookupStatus: string; evidence: unknown; expiresAt: Date }[] = [];
const updates: { set: unknown }[] = [];
vi.mock("./client", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => cacheRows }) }),
    update: () => ({ set: (set: unknown) => ({ where: async () => void updates.push({ set }) }) }),
  },
}));
vi.mock("./enrichment", () => ({ drizzleCacheStore: {} }));
const lookup = vi.fn();
vi.mock("@/lib/enrichment/genreEnrichment", async (orig) => ({ ...(await orig<object>()), getOrLookupArtistGenre: (...a: unknown[]) => lookup(...a) }));
const getArtistUrls = vi.fn();
vi.mock("@/lib/enrichment/discogsClient", () => ({ getArtistUrls: (...a: unknown[]) => getArtistUrls(...a) }));

const { resolveDiscogsSoundcloud } = await import("./discogsSoundcloud");
const NOW = new Date("2026-11-07T00:00:00.000Z");
const later = new Date("2027-01-01T00:00:00.000Z");
const found = (key: string, identityConfidence: "medium" | "low" = "medium") => ({ artistNameNormalized: key, lookupStatus: "found", identityConfidence, discogsArtistId: 42, evidence: { discogsArtistId: 42 } });

beforeEach(() => {
  cacheRows.length = 0;
  updates.length = 0;
  lookup.mockReset();
  getArtistUrls.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ author_name: "Sub Zero Project" }), { status: 200 })));
});

describe("resolveDiscogsSoundcloud", () => {
  it("verifiable: stores the assessment in the existing evidence, keeping it", async () => {
    lookup.mockResolvedValueOnce(found("sub zero project"));
    getArtistUrls.mockResolvedValueOnce(["https://soundcloud.com/subzeroproject", "https://subzeroproject.com"]);
    const s = await resolveDiscogsSoundcloud(["Sub Zero Project"], 2, NOW);
    expect(s).toMatchObject({ lookedUp: 1, verifiable: 1 });
    expect(lookup).toHaveBeenCalledWith("sub zero project", expect.anything(), expect.anything(), NOW);
    expect(updates[0].set).toEqual({
      evidence: { discogsArtistId: 42, soundcloud: expect.objectContaining({ verdict: "verifiable", profileUrl: "https://soundcloud.com/subzeroproject", soundcloudName: "Sub Zero Project" }) },
    });
  });

  it("no repeated lookups: already assessed, or cached not found / ambiguous, costs nothing", async () => {
    cacheRows.push(
      { key: "hatikwa", lookupStatus: "found", evidence: { soundcloud: { verdict: "missing", reason: "", profileUrl: null } }, expiresAt: later },
      { key: "jersey", lookupStatus: "ambiguous", evidence: {}, expiresAt: later },
      { key: "whoshe", lookupStatus: "not_found", evidence: {}, expiresAt: later },
    );
    const s = await resolveDiscogsSoundcloud(["HATIKWA", "Jersey", "WhoShe"], 2, NOW);
    expect(s.lookedUp).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("at most maxLookups artists per run", async () => {
    lookup.mockResolvedValue({ artistNameNormalized: "x", lookupStatus: "not_found", identityConfidence: null, discogsArtistId: null, evidence: {} });
    const s = await resolveDiscogsSoundcloud(["Aaaa Bbbb", "Cccc Dddd", "Eeee Ffff"], 2, NOW);
    expect(s.lookedUp).toBe(2);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("low identity: recorded as uncertain without fetching URLs", async () => {
    lookup.mockResolvedValueOnce(found("sylvia", "low"));
    const s = await resolveDiscogsSoundcloud(["Sylvia Xyz"], 2, NOW);
    expect(s.uncertain).toBe(1);
    expect(getArtistUrls).not.toHaveBeenCalled();
  });

  it("a rate limit stops the run; nothing is written for it", async () => {
    lookup.mockRejectedValueOnce(new Error("Discogs request failed: HTTP 429 for /database/search"));
    const s = await resolveDiscogsSoundcloud(["Aaaa Bbbb", "Cccc Dddd"], 2, NOW);
    expect(s).toMatchObject({ lookedUp: 1, failed: 1 });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
  });
});
