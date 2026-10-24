import { describe, expect, it } from "vitest";
import { recheckRelevance, RELEVANCE_RECHECK_BASIS, RELEVANCE_RECHECK_LIMITATIONS, cacheKeyForArtist, toCacheEntry, ARTIST_CACHE_SQL, type RelevanceRecheckInput } from "./auditRelevance";
import { runIngestionPipeline } from "@/lib/adapters/pipeline";
import { VENUES } from "@/lib/data/venues";
import type { ArtistCacheEntry } from "@/lib/enrichment/genreEnrichment";

function row(overrides: Partial<RelevanceRecheckInput> = {}): RelevanceRecheckInput {
  return {
    title: "Some night",
    description: null,
    artists: [],
    venue_name: "Pumpehuset",
    start_datetime: "2026-12-05T21:00:00Z",
    end_datetime: null,
    canonical_source_id: "src-pumpehuset",
    official_event_url: "https://pumpehuset.dk/koncerter/x/",
    ticket_url: null,
    resident_advisor_url: null,
    ...overrides,
  };
}

const NO_CACHE = new Map<string, ArtistCacheEntry>();

function cached(name: string, proposedGenre: string | null): [string, ArtistCacheEntry] {
  const key = cacheKeyForArtist(name);
  return [
    key,
    toCacheEntry({
      artist_name_normalized: key,
      lookup_status: proposedGenre ? "found" : "not_found",
      proposed_genre: proposedGenre,
      genre_confidence: proposedGenre ? "medium" : null,
      identity_confidence: proposedGenre ? "medium" : null,
      discogs_artist_id: 1,
      classification_method: "discogs-artist-releases@v1",
      looked_up_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-01-02T00:00:00Z", // long expired: cached data is still used, never refreshed
    }),
  ];
}

describe("recheckRelevance — current recomputation, read-only (editorial screening, 2026-10-17)", () => {
  it("is always labelled as a current recomputation, not the historical publish decision", async () => {
    const r = await recheckRelevance(row(), NO_CACHE);
    expect(r.basis).toBe(RELEVANCE_RECHECK_BASIS);
    expect(r.basis).toMatch(/NOT the historical publish decision/);
  });

  it("names the missing source categories as a known limit on every result", async () => {
    const r = await recheckRelevance(row(), NO_CACHE);
    expect(r.limitations).toBe(RELEVANCE_RECHECK_LIMITATIONS);
    expect(r.limitations.join(" ")).toMatch(/category tags .* not stored on events/);
  });

  it("explicit techno text: strong, with the reason named", async () => {
    const r = await recheckRelevance(row({ title: "Nico Moreno", description: "One of the leading acts in the global hard techno scene." }), NO_CACHE);
    expect(r.relevance).toBe("strong");
    expect(r.textGenre).toBe("hard-techno");
    expect(r.reasons).toContain("specific genre in the event's own text: hard-techno");
  });

  it("a pop band with no electronic evidence: none, with the reason named", async () => {
    const r = await recheckRelevance(
      row({ title: "Kind mod Kind", description: "Skyder et nyt kapitel i gang med en Danmarkstour og en ny popsingle." }),
      NO_CACHE,
    );
    expect(r.relevance).toBe("none");
    expect(r.reasons.some((x) => x.startsWith("against:"))).toBe(true);
  });

  it("never uses the stored genre: the input carries none, and an event whose text has no genre gets none from it", async () => {
    const r = await recheckRelevance(row({ title: "Part Time Killer", description: null }), NO_CACHE);
    expect(r.textGenre).toBeNull();
    expect(r.reasons.join(" ")).not.toMatch(/specific genre/);
  });

  it("uses the FULL stored description, not the audit's 400-character copy", async () => {
    const filler = "Doors open at eight and the bar serves drinks all night long. ".repeat(10);
    expect(filler.length).toBeGreaterThan(400);
    const r = await recheckRelevance(row({ description: `${filler} Expect deep house until close.` }), NO_CACHE);
    expect(r.textGenre).toBe("deep-house");
  });

  it("a trusted electronic source is named as a reason", async () => {
    const r = await recheckRelevance(row({ canonical_source_id: "src-hangaren", venue_name: "Hangaren", title: "Part Time Killer" }), NO_CACHE);
    expect(r.trustedElectronicSource).toBe(true);
    expect(r.reasons[0]).toMatch(/trusted electronic source/);
  });

  it("a stored RA link counts as electronic ticketing evidence", async () => {
    const r = await recheckRelevance(row({ resident_advisor_url: "https://ra.co/events/1" }), NO_CACHE);
    expect(r.reasons).toContain("Resident Advisor link stored");
  });

  it("cached Discogs lineup data (even expired) is used read-only; uncached artists add nothing and never trigger a lookup", async () => {
    const cache = new Map([cached("Tim Andresen", "house"), cached("Nobody Known", null)]);
    const r = await recheckRelevance(row({ title: "Tim Andresen", description: "A night with Tim Andresen.", artists: ["Tim Andresen", "Uncached Artist"] }), cache);
    expect(r.discogsGenre).toBe("house");
    expect(r.reasons).toContain("cached Discogs lineup data: house");
    const none = await recheckRelevance(row({ title: "Uncached Artist", artists: ["Uncached Artist"] }), cache);
    expect(none.discogsGenre).toBeNull();
  });

  it("without Discogs input, the verdict equals the pipeline's own relevance for the same candidate (drift guard)", async () => {
    const cases = [
      row({ title: "Nico Moreno", description: "Hard techno all night." }),
      row({ title: "Kind mod Kind", description: "Dansk popband på Danmarkstour." }),
      row({ title: "Headline Flip", description: "A special night of electronic club music.", resident_advisor_url: "https://ra.co/events/2" }),
      row({ title: "La Malafamera", description: "The best of Cumbia, RKT and Reggaeton." }),
    ];
    for (const c of cases) {
      const recheck = await recheckRelevance(c, NO_CACHE);
      const pipeline = runIngestionPipeline(
        {
          sourceId: c.canonical_source_id ?? "admin",
          sourceUrl: c.official_event_url ?? "",
          title: c.title,
          description: c.description,
          relevanceText: c.description,
          artists: c.artists ?? [],
          startDatetime: String(c.start_datetime),
          endDatetime: null,
          venueName: c.venue_name,
          officialEventUrl: c.official_event_url,
          ticketUrl: null,
          facebookUrl: null,
          residentAdvisorUrl: c.resident_advisor_url,
          imageUrl: null,
          priceFrom: null,
          genreHint: null,
          genreConfidenceHint: null,
        },
        { venues: VENUES, existingEvents: [] },
      );
      expect(recheck.relevance).toBe(pipeline.relevance);
    }
  });

  it("the cache query is a single read-only SELECT", () => {
    expect(ARTIST_CACHE_SQL.trim()).toMatch(/^SELECT /);
    expect(ARTIST_CACHE_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i);
  });
});
