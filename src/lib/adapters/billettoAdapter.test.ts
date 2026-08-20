import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BILLETTO_API_URL,
  BILLETTO_SOURCE_ID,
  buildApiKeypairHeader,
  createBillettoAdapter,
  genreFromBillettoCategorization,
  isCopenhagenLocation,
  mapBillettoEvent,
  type BillettoEvent,
} from "./billettoAdapter";
import { findBestDuplicateMatch, normalizeUrl } from "../dedup";
import { findSyncMatch } from "../sync";
import type { ExistingEventForDedup } from "./pipeline";

/**
 * infectedMushroom, mellemOsSagt are real, unmodified records captured
 * directly from a live GET https://billetto.dk/api/v3/public/events run
 * during the Phase 1 diagnosis (2026-08-20). hardcorePunkMoshpit is
 * reconstructed from a real partial capture of that same live run (id,
 * title, url, startdate, venue, subcategory, organiser are all genuine —
 * see src/lib/data/sources.ts's src-billetto integrationNote) with the
 * remaining structural fields filled in to match the confirmed real schema
 * shape. outsideCopenhagenClassical is a synthetic fixture (Billetto's real
 * live feed simply didn't happen to include an outside-Copenhagen example
 * worth capturing) used only to exercise the location-rejection path.
 */
const FIXTURES_PATH = path.join(__dirname, "__fixtures__", "billetto-events.json");
const FIXTURES = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8")) as Record<string, BillettoEvent>;

describe("buildApiKeypairHeader", () => {
  it("joins id and secret with a colon, matching Billetto's documented Api-Keypair scheme", () => {
    expect(buildApiKeypairHeader("ACCESS_ID", "ACCESS_SECRET")).toBe("ACCESS_ID:ACCESS_SECRET");
  });
});

describe("isCopenhagenLocation", () => {
  it("accepts København and its postal-suffix variants observed live", () => {
    expect(isCopenhagenLocation("København")).toBe(true);
    expect(isCopenhagenLocation("København K")).toBe(true);
    expect(isCopenhagenLocation("København S")).toBe(true);
    expect(isCopenhagenLocation("København V")).toBe(true);
    expect(isCopenhagenLocation("København N")).toBe(true);
    expect(isCopenhagenLocation("København K.")).toBe(true);
    expect(isCopenhagenLocation("København ")).toBe(true); // trailing space observed live
  });

  it("accepts Frederiksberg, matching this app's own Venue.city union type", () => {
    expect(isCopenhagenLocation("Frederiksberg")).toBe(true);
  });

  it("rejects other Danish cities, even ones in the Hovedstaden region", () => {
    expect(isCopenhagenLocation("Helsingør")).toBe(false);
    expect(isCopenhagenLocation("Hillerød")).toBe(false);
    expect(isCopenhagenLocation("Aakirkeby")).toBe(false); // Bornholm — pulled in by region=Hovedstaden but never city-proper
    expect(isCopenhagenLocation("Aarhus")).toBe(false);
  });

  it("never matches on substring alone — a suburb merely containing part of the name is not the city proper", () => {
    expect(isCopenhagenLocation("Nørrebro")).toBe(false);
  });

  it("rejects missing/blank city rather than assuming in-scope", () => {
    expect(isCopenhagenLocation(null)).toBe(false);
    expect(isCopenhagenLocation(undefined)).toBe(false);
    expect(isCopenhagenLocation("")).toBe(false);
    expect(isCopenhagenLocation("   ")).toBe(false);
  });
});

describe("genreFromBillettoCategorization", () => {
  it("trusts techno/house/electro/trance as high-confidence official-source-metadata", () => {
    expect(genreFromBillettoCategorization({ category: "music", subcategory: "techno", type: "party" })).toBe("techno");
    expect(genreFromBillettoCategorization({ category: "music", subcategory: "house", type: "concert" })).toBe("house");
    expect(genreFromBillettoCategorization({ category: "music", subcategory: "electro", type: "party" })).toBe("electro");
    expect(genreFromBillettoCategorization({ category: "music", subcategory: "trance", type: "concert" })).toBe("trance");
  });

  it("maps the generic edm_electronic tag to the equally generic electronic-other slug, not a guessed subgenre", () => {
    expect(genreFromBillettoCategorization({ category: "music", subcategory: "edm_electronic", type: "concert" })).toBe(
      "electronic-other",
    );
  });

  it("REGRESSION: never trusts hardcore as electronic evidence — Phase 1 caught a real hardcore-punk event tagged this way", () => {
    expect(genreFromBillettoCategorization({ category: "music", subcategory: "hardcore", type: "concert" })).toBeNull();
  });

  it("never trusts disco — ambiguous funk/retro framing is common under that tag", () => {
    expect(genreFromBillettoCategorization({ category: "music", subcategory: "disco", type: "party" })).toBeNull();
  });

  it("never trusts a non-music category, even one that sounds plausible", () => {
    expect(genreFromBillettoCategorization({ category: "performing_arts", subcategory: "techno", type: "concert" })).toBeNull();
  });

  it("returns null for missing categorization/subcategory rather than throwing", () => {
    expect(genreFromBillettoCategorization(null)).toBeNull();
    expect(genreFromBillettoCategorization({ category: "music", subcategory: null, type: null })).toBeNull();
  });
});

describe("mapBillettoEvent", () => {
  it("maps a real explicit-subcategory electronic event (Infected Mushroom, trance) end to end", () => {
    const mapped = mapBillettoEvent(FIXTURES.infectedMushroom);
    expect(mapped).not.toBeNull();
    expect(mapped!.sourceId).toBe(BILLETTO_SOURCE_ID);
    expect(mapped!.title).toBe("Infected Mushroom – 30th Anniversary Tour");
    expect(mapped!.venueName).toBe("Poolen");
    expect(mapped!.startDatetime).toBe("2026-10-03T19:00:00Z");
    expect(mapped!.endDatetime).toBe("2026-10-04T01:00:00Z");
    expect(mapped!.genreHint).toBe("trance");
    expect(mapped!.genreConfidenceHint).toBe("high");
  });

  it("maps headliners into artists", () => {
    const mapped = mapBillettoEvent(FIXTURES.infectedMushroom);
    expect(mapped!.artists).toEqual(["Infected Mushroom"]);
  });

  it("maps an event with no headliners to an empty artist list, never invented names", () => {
    const mapped = mapBillettoEvent(FIXTURES.mellemOsSagt);
    expect(mapped!.artists).toEqual([]);
  });

  it("maps minimum_price.amount_in_cents as already-whole-DKK (the field name is misleading — confirmed against real live prices, e.g. a touring-artist show at 425 is 425 DKK, not 4.25 DKK)", () => {
    expect(mapBillettoEvent(FIXTURES.infectedMushroom)!.priceFrom).toBe(425);
    expect(mapBillettoEvent(FIXTURES.mellemOsSagt)!.priceFrom).toBe(50);
  });

  it("returns null priceFrom when minimum_price is absent", () => {
    const noPrice: BillettoEvent = { ...FIXTURES.infectedMushroom, minimum_price: null };
    expect(mapBillettoEvent(noPrice)!.priceFrom).toBeNull();
  });

  it("sets both officialEventUrl and ticketUrl to Billetto's own event URL — it is simultaneously both", () => {
    const mapped = mapBillettoEvent(FIXTURES.infectedMushroom);
    expect(mapped!.officialEventUrl).toBe(FIXTURES.infectedMushroom.url);
    expect(mapped!.ticketUrl).toBe(FIXTURES.infectedMushroom.url);
  });

  it("never sets facebookUrl/residentAdvisorUrl — Billetto's API exposes neither", () => {
    const mapped = mapBillettoEvent(FIXTURES.infectedMushroom);
    expect(mapped!.facebookUrl).toBeNull();
    expect(mapped!.residentAdvisorUrl).toBeNull();
  });

  it("rejects a real event outside Copenhagen even though it is genuinely category=music", () => {
    expect(mapBillettoEvent(FIXTURES.outsideCopenhagenClassical)).toBeNull();
  });

  it("rejects an event with a missing location entirely, never assuming in-scope", () => {
    const noLocation: BillettoEvent = { ...FIXTURES.infectedMushroom, location: null };
    expect(mapBillettoEvent(noLocation)).toBeNull();
  });

  it("rejects an event with a missing city on an otherwise-present location object", () => {
    const noCity: BillettoEvent = { ...FIXTURES.infectedMushroom, location: { ...FIXTURES.infectedMushroom.location!, city: null } };
    expect(mapBillettoEvent(noCity)).toBeNull();
  });

  it("rejects a non-published (cancelled/draft/unrecognized-state) event", () => {
    const cancelled: BillettoEvent = { ...FIXTURES.infectedMushroom, state: "cancelled" };
    expect(mapBillettoEvent(cancelled)).toBeNull();
    const draft: BillettoEvent = { ...FIXTURES.infectedMushroom, state: "draft" };
    expect(mapBillettoEvent(draft)).toBeNull();
  });

  it("still includes a published-but-sold-out event — availability=false alone is not grounds for exclusion", () => {
    const soldOut: BillettoEvent = { ...FIXTURES.infectedMushroom, availability: false };
    expect(mapBillettoEvent(soldOut)).not.toBeNull();
  });

  it("REGRESSION: rejects the real hardcore-punk moshpit event as electronic evidence — subcategory alone must never qualify it, and its title/description carry no deterministic electronic keyword either", () => {
    const mapped = mapBillettoEvent(FIXTURES.hardcorePunkMoshpit);
    expect(mapped).not.toBeNull(); // still a valid Copenhagen music-category candidate...
    expect(mapped!.genreHint).toBeNull(); // ...but never classified as electronic
    expect(mapped!.genreConfidenceHint).toBeNull();
  });

  it("rejects a genuinely non-electronic music event (storytelling night) as electronic evidence", () => {
    const mapped = mapBillettoEvent(FIXTURES.mellemOsSagt);
    expect(mapped!.genreHint).toBeNull();
    expect(mapped!.genreConfidenceHint).toBeNull();
  });

  it("falls back to deterministic title/description text evidence when the subcategory itself is untrustworthy", () => {
    // subcategory is the untrusted "hardcore" tag, but the description text
    // explicitly names a deterministically-mapped genre — this must still be
    // credited via the same official-description tier every other adapter
    // uses, not silently dropped just because the subcategory was rejected.
    const explicitInDescription: BillettoEvent = {
      ...FIXTURES.hardcorePunkMoshpit,
      description: "A night of hard techno and driving rhythms.",
    };
    const mapped = mapBillettoEvent(explicitInDescription);
    expect(mapped!.genreHint).toBe("hard-techno");
    expect(mapped!.genreConfidenceHint).toBe("high");
  });

  it("throws on a genuinely missing title — callers skip a single bad record and continue", () => {
    const noTitle: BillettoEvent = { ...FIXTURES.infectedMushroom, title: "" };
    expect(() => mapBillettoEvent(noTitle)).toThrow();
  });

  it("throws on a genuinely missing start date", () => {
    const noDate: BillettoEvent = { ...FIXTURES.infectedMushroom, startdate: null };
    expect(() => mapBillettoEvent(noDate)).toThrow();
  });
});

describe("createBillettoAdapter", () => {
  const OLD_ENV = process.env;
  const withCreds = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    process.env = { ...OLD_ENV, BILLETTO_ACCESS_KEY_ID: "test-id", BILLETTO_ACCESS_KEY_SECRET: "test-secret" };
    try {
      return await fn();
    } finally {
      process.env = OLD_ENV;
    }
  };

  function jsonResponse(data: BillettoEvent[], status = 200): Response {
    return new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });
  }

  it("throws a clear, credential-value-free error when credentials are not configured", async () => {
    process.env = { ...OLD_ENV, BILLETTO_ACCESS_KEY_ID: "", BILLETTO_ACCESS_KEY_SECRET: "" };
    try {
      const adapter = createBillettoAdapter(async () => jsonResponse([]));
      await expect(adapter.fetchCandidates()).rejects.toThrow(/BILLETTO_ACCESS_KEY_ID/);
    } finally {
      process.env = OLD_ENV;
    }
  });

  it("sends the Api-Keypair header built from the configured credentials, and never a plain-text alternative", async () => {
    await withCreds(async () => {
      let capturedHeaders: Headers | undefined;
      const fetchImpl = async (_url: string | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        return jsonResponse([]);
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch);
      await adapter.fetchCandidates();
      expect(capturedHeaders?.get("Api-Keypair")).toBe("test-id:test-secret");
    });
  });

  it("requests the documented endpoint with the subregion Copenhagen filter and page limit", async () => {
    await withCreds(async () => {
      let capturedUrl: string | undefined;
      const fetchImpl = async (url: string | URL) => {
        capturedUrl = String(url);
        return jsonResponse([]);
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch);
      await adapter.fetchCandidates();
      expect(capturedUrl).toContain(BILLETTO_API_URL);
      expect(capturedUrl).toContain("limit=100");
      expect(capturedUrl).toContain("subregion=Byen"); // URLSearchParams encodes the space as + or %20 depending on encoder
    });
  });

  it("paginates via the after cursor until a page returns fewer than the limit", async () => {
    await withCreds(async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({ ...FIXTURES.infectedMushroom, id: `p1-${i}` }));
      const page2 = Array.from({ length: 40 }, (_, i) => ({ ...FIXTURES.infectedMushroom, id: `p2-${i}` }));
      const urls: string[] = [];
      const fetchImpl = async (url: string | URL) => {
        urls.push(String(url));
        return urls.length === 1 ? jsonResponse(page1) : jsonResponse(page2);
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch);
      const candidates = await adapter.fetchCandidates();
      expect(urls).toHaveLength(2);
      expect(urls[1]).toContain(`after=p1-99`); // cursor is the last event id of page 1
      expect(candidates).toHaveLength(140);
    });
  });

  it("terminates immediately when the first page is already short (no unnecessary second request)", async () => {
    await withCreds(async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        return jsonResponse([FIXTURES.infectedMushroom]);
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch);
      await adapter.fetchCandidates();
      expect(calls).toBe(1);
    });
  });

  it("has loop protection: never exceeds a bounded number of pages even if every page is deceptively full", async () => {
    await withCreds(async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        // Always exactly 100 with a strictly increasing id, so pagination
        // never naturally terminates on its own — only MAX_PAGES stops it.
        const page = Array.from({ length: 100 }, (_, i) => ({ ...FIXTURES.infectedMushroom, id: `loop-${calls}-${i}` }));
        return jsonResponse(page);
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch, 0);
      const candidates = await adapter.fetchCandidates();
      expect(calls).toBeLessThanOrEqual(25);
      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  it("stops pagination if the API stops advancing the cursor (defensive infinite-loop guard)", async () => {
    await withCreds(async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        // Same last id every time — a misbehaving API that ignores `after`.
        const page = Array.from({ length: 100 }, (_, i) => ({ ...FIXTURES.infectedMushroom, id: i === 99 ? "stuck-id" : `x-${calls}-${i}` }));
        return jsonResponse(page);
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch, 0);
      await adapter.fetchCandidates();
      expect(calls).toBeLessThanOrEqual(3); // should bail out almost immediately once the cursor repeats
    });
  });

  it("skips a single malformed record without losing the rest of the page", async () => {
    await withCreds(async () => {
      const malformed = { ...FIXTURES.infectedMushroom, id: "bad", title: "" };
      const fetchImpl = async () => jsonResponse([malformed, FIXTURES.mellemOsSagt]);
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch);
      const candidates = await adapter.fetchCandidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].title).toBe("Mellem Os Sagt");
    });
  });

  it("throws (a genuine source failure) when the very first page fails", async () => {
    await withCreds(async () => {
      const fetchImpl = async () => new Response("Internal Server Error", { status: 500 });
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch, 0);
      await expect(adapter.fetchCandidates()).rejects.toThrow();
    });
  });

  it("retries once on a 5xx before giving up", async () => {
    await withCreds(async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        return calls === 1 ? new Response("", { status: 503 }) : jsonResponse([FIXTURES.infectedMushroom]);
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch, 0);
      const candidates = await adapter.fetchCandidates();
      expect(calls).toBe(2);
      expect(candidates).toHaveLength(1);
    });
  });

  it("does not retry a 401/403 (invalid credentials never fix themselves) and reports a clear, credential-value-free error", async () => {
    await withCreds(async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        return new Response(JSON.stringify({ error: { message: "Invalid credentials", type: "authentication_error" } }), { status: 401 });
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch, 0);
      await expect(adapter.fetchCandidates()).rejects.toThrow(/401/);
      expect(calls).toBe(1);
      // The thrown error must never contain the test credential values.
      try {
        await adapter.fetchCandidates();
      } catch (err) {
        expect(String(err)).not.toContain("test-secret");
      }
    });
  });

  it("on a later-page failure, returns everything gathered so far rather than discarding a partial success", async () => {
    await withCreds(async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        if (calls === 1) return jsonResponse(Array.from({ length: 100 }, (_, i) => ({ ...FIXTURES.infectedMushroom, id: `p-${i}` })));
        return new Response("", { status: 500 });
      };
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch, 0);
      const candidates = await adapter.fetchCandidates();
      expect(candidates.length).toBe(100);
    });
  });

  it("mapping is deterministic across repeated fetches of the same page (idempotent by construction)", async () => {
    await withCreds(async () => {
      const fetchImpl = async () => jsonResponse([FIXTURES.infectedMushroom, FIXTURES.mellemOsSagt]);
      const adapter = createBillettoAdapter(fetchImpl as unknown as typeof fetch);
      const first = await adapter.fetchCandidates();
      const second = await adapter.fetchCandidates();
      expect(first).toEqual(second);
    });
  });
});

/**
 * Dedup/pipeline integration — exercises the real, shared, Production-
 * validated functions (src/lib/dedup.ts, src/lib/sync.ts) with
 * Billetto-shaped data, never a Billetto-specific reimplementation. This is
 * the mechanism Phase 1 reasoned through and this validation confirms.
 */
describe("Billetto candidates through the shared dedup model", () => {
  const infectedMushroomCandidate = mapBillettoEvent(FIXTURES.infectedMushroom)!;

  it("AUTO_LINK: a Billetto candidate whose URL matches an existing event's stored ticketUrl (after normalizeUrl strips utm_* tracking params) matches with high confidence and would attach, not duplicate", () => {
    // Real value captured from src/lib/adapters/__fixtures__/poolen-program.html:
    // Poolen's own site links to this exact Billetto event as its ticket URL,
    // with different utm_* tracking params than the ones on Billetto's own copy.
    const existingPoolenRecord: ExistingEventForDedup = {
      id: "e-poolen-infected-mushroom",
      title: "Infected Mushroom",
      artists: ["Infected Mushroom"],
      venueId: "v-poolen",
      startDatetime: "2026-10-03T19:00:00.000Z",
      sourceId: "src-poolen",
      officialEventUrl: "https://poolen.dk/da/koncerter/infected-mushroom/",
      ticketUrl: "https://billetto.dk/e/infected-mushroom-30th-anniversary-tour-billetter-1879852?utm_source=organiser&utm_medium=share&utm_campaign=copy_link&utm_content=1",
      residentAdvisorUrl: null,
    };

    expect(normalizeUrl(existingPoolenRecord.ticketUrl)).toBe(normalizeUrl(infectedMushroomCandidate.officialEventUrl));

    const best = findBestDuplicateMatch(
      {
        title: infectedMushroomCandidate.title,
        artists: infectedMushroomCandidate.artists,
        venueId: "v-poolen", // resolved via the shared venue registry, same as any other adapter
        startDatetime: infectedMushroomCandidate.startDatetime!,
        sourceId: BILLETTO_SOURCE_ID,
        officialEventUrl: infectedMushroomCandidate.officialEventUrl,
        ticketUrl: infectedMushroomCandidate.ticketUrl,
        residentAdvisorUrl: null,
      },
      [existingPoolenRecord],
    );

    expect(best).not.toBeNull();
    expect(best!.assessment.confidence).toBe("high");
    expect(best!.match.id).toBe("e-poolen-infected-mushroom");

    const match = findSyncMatch(null, best!.match.id, best!.assessment.confidence);
    expect(match).toEqual({ kind: "high-confidence-duplicate", eventId: "e-poolen-infected-mushroom" });
  });

  it("REVIEW_DUPLICATE stays in review: a same-venue/same-night candidate with only partial title/lineup signal and no shared URL is never silently auto-linked", () => {
    const ambiguousExisting: ExistingEventForDedup = {
      id: "e-poolen-some-other-night",
      title: "Anniversary Session",
      artists: [],
      venueId: "v-poolen",
      startDatetime: "2026-10-03T19:00:00.000Z",
      sourceId: "src-poolen",
      officialEventUrl: "https://poolen.dk/da/koncerter/some-other-event/",
      ticketUrl: null,
      residentAdvisorUrl: null,
    };

    const best = findBestDuplicateMatch(
      {
        title: infectedMushroomCandidate.title,
        artists: infectedMushroomCandidate.artists,
        venueId: "v-poolen",
        startDatetime: infectedMushroomCandidate.startDatetime!,
        sourceId: BILLETTO_SOURCE_ID,
        officialEventUrl: infectedMushroomCandidate.officialEventUrl,
        ticketUrl: infectedMushroomCandidate.ticketUrl,
        residentAdvisorUrl: null,
      },
      [ambiguousExisting],
    );

    // "30th Anniversary Tour" vs "Anniversary Session" shares no distinctive
    // token overlap strong enough alone, and there is no artist overlap or
    // shared URL — same venue + same night alone must never be enough.
    expect(best === null || best.assessment.confidence !== "high").toBe(true);
    if (best) {
      const match = findSyncMatch(null, best.match.id, best.assessment.confidence);
      expect(match).toBeNull(); // medium/low confidence is never auto-attached
    }
  });

  it("a genuinely new Billetto candidate with no matching existing event finds no duplicate at all", () => {
    const unrelated: ExistingEventForDedup = {
      id: "e-hangaren-unrelated",
      title: "Some Unrelated Techno Night",
      artists: ["Someone Else"],
      venueId: "v-hangaren",
      startDatetime: "2026-09-01T20:00:00.000Z",
      sourceId: "src-hangaren",
      officialEventUrl: "https://www.hangaren.dk/events/whatever",
      ticketUrl: null,
      residentAdvisorUrl: null,
    };

    const best = findBestDuplicateMatch(
      {
        title: infectedMushroomCandidate.title,
        artists: infectedMushroomCandidate.artists,
        venueId: "v-poolen",
        startDatetime: infectedMushroomCandidate.startDatetime!,
        sourceId: BILLETTO_SOURCE_ID,
        officialEventUrl: infectedMushroomCandidate.officialEventUrl,
        ticketUrl: infectedMushroomCandidate.ticketUrl,
        residentAdvisorUrl: null,
      },
      [unrelated],
    );
    expect(best).toBeNull();
  });
});
