import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseGravityHomeHtml, parseGravityEventDetailHtml, createGravityAdapter, GRAVITY_SOURCE_ID, GRAVITY_BASE_URL } from "./gravityAdapter";
import { runIngestionPipeline } from "./pipeline";
import { VENUES } from "@/lib/data/venues";
import { resolveVenue } from "@/lib/normalize";

/**
 * All fixtures are real, unmodified pages captured directly from
 * gravitycph.dk via the sanctioned Inspect Source reachability tool
 * (Gravity source-repair audit, 2026-08-25) — not fabricated. There was no
 * prior working adapter for this source to preserve fixtures from (see the
 * module doc comment in gravityAdapter.ts): the registry's pre-existing
 * src-gravity entry was a deliberately-degraded placeholder, never a real
 * integration. The homepage fixture is the real hero carousel at the time
 * of capture (Eric Prydz, Armin van Buuren, CamelPhat, I Hate Models — all
 * confirmed live, all confirmed via dedup-simulate against the real
 * Production DB to be genuinely new, non-duplicate events).
 */
const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
const HOME_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-home.html"), "utf-8");
const ERIC_PRYDZ_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-eric-prydz.html"), "utf-8");
const ARMIN_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-armin-van-buuren.html"), "utf-8");
const CAMELPHAT_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-camelphat.html"), "utf-8");
const I_HATE_MODELS_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-i-hate-models.html"), "utf-8");

const DETAIL_HTML_BY_URL: Record<string, string> = {
  "https://gravitycph.dk/armin-van-buuren/": ARMIN_HTML,
  "https://gravitycph.dk/camelphat-copenhagen-2026/": CAMELPHAT_HTML,
  "https://gravitycph.dk/eric-prydz-copenhagen/": ERIC_PRYDZ_HTML,
  "https://gravitycph.dk/i-hate-models-cph/": I_HATE_MODELS_HTML,
};

describe("parseGravityHomeHtml", () => {
  it("finds all 4 real upcoming events, deduplicated (the real markup repeats every card twice for responsive breakpoints)", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.title)).toEqual(["ARMIN VAN BUUREN", "Gravity Opera: CAMELPHAT", "ERIC PRYDZ", "I HATE MODELS"]);
    expect(entries.map((e) => e.detailUrl)).toEqual(Object.keys(DETAIL_HTML_BY_URL));
  });

  it("parses the real DD.MM.YYYY listing date into a full DateKey", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const eric = entries.find((e) => e.title === "ERIC PRYDZ");
    expect(eric?.dateKey).toEqual({ year: 2026, month: 10, day: 23 });
  });
});

describe("parseGravityEventDetailHtml", () => {
  it("Eric Prydz: real detail page resolves start/end time, venue, and a specific genre from the page's own 'Music:' tag", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "ERIC PRYDZ")!;
    const candidate = parseGravityEventDetailHtml(ERIC_PRYDZ_HTML, entry);

    expect(candidate.sourceId).toBe(GRAVITY_SOURCE_ID);
    expect(candidate.title).toBe("ERIC PRYDZ");
    expect(candidate.artists).toEqual(["ERIC PRYDZ"]);
    expect(candidate.venueName).toBe("TAP 1");
    expect(candidate.startDatetime).toBe("2026-10-23T18:00:00.000Z"); // 20:00 Copenhagen (CEST, UTC+2)
    expect(candidate.endDatetime).toBe("2026-10-24T02:00:00.000Z"); // 04:00 the next morning
    expect(candidate.genreHint).not.toBeNull();
    expect(candidate.genreConfidenceHint).toBe("high");
    expect(candidate.description).toContain("Music:");
  });

  it("CamelPhat: strips the 'Gravity Opera:' theme-night brand prefix from artists but keeps it in the real title verbatim", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "Gravity Opera: CAMELPHAT")!;
    const candidate = parseGravityEventDetailHtml(CAMELPHAT_HTML, entry);

    expect(candidate.title).toBe("Gravity Opera: CAMELPHAT");
    expect(candidate.artists).toEqual(["CAMELPHAT"]);
    expect(candidate.genreHint).toBe("melodic-techno"); // real "Music: Melodic Techno & Techno" tag
  });

  it("Armin van Buuren: real venue name resolves against the existing registry to TAP1 (v-tap1), not assumed from the source", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "ARMIN VAN BUUREN")!;
    const candidate = parseGravityEventDetailHtml(ARMIN_HTML, entry);

    const resolved = resolveVenue(candidate.venueName!, VENUES);
    expect(resolved?.id).toBe("v-tap1");
  });

  it("I Hate Models: real 'Music: Techno' tag resolves to a high-confidence techno genreHint", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "I HATE MODELS")!;
    const candidate = parseGravityEventDetailHtml(I_HATE_MODELS_HTML, entry);

    expect(candidate.genreHint).toBe("techno");
    expect(candidate.genreConfidenceHint).toBe("high");
  });

  it("throws on a missing Location info-row rather than guessing a venue", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "ERIC PRYDZ")!;
    const brokenHtml = ERIC_PRYDZ_HTML.replace(/Location:/, "NoLocationLabel:");
    expect(() => parseGravityEventDetailHtml(brokenHtml, entry)).toThrow(/Location/);
  });

  it("throws when the listing date itself is unparseable rather than inventing one", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "ERIC PRYDZ")!;
    expect(() => parseGravityEventDetailHtml(ERIC_PRYDZ_HTML, { ...entry, dateKey: null })).toThrow(/date/);
  });
});

describe("end-to-end pipeline: all 4 real Gravity candidates route to auto_publish", () => {
  it("every real current candidate resolves to a high-confidence genre and auto_publish, with real venue resolution to TAP1", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    for (const entry of entries) {
      const html = DETAIL_HTML_BY_URL[entry.detailUrl];
      const candidate = parseGravityEventDetailHtml(html, entry);
      const result = runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [], trustedElectronicSource: false });
      expect(result.decision, `${entry.title} should auto_publish`).toBe("auto_publish");
      expect(result.genreConfidence).toBe("high");
    }
  });
});

describe("createGravityAdapter (end-to-end, mocked fetch over the real fixtures)", () => {
  it("fetches the homepage, dedupes cards, and fetches every distinct event's detail page", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url === GRAVITY_BASE_URL) {
        return new Response(HOME_HTML, { status: 200 });
      }
      const detailHtml = DETAIL_HTML_BY_URL[url];
      if (detailHtml) return new Response(detailHtml, { status: 200 });
      return new Response("not found", { status: 404 });
    });

    const adapter = createGravityAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const results = await adapter.fetchCandidates();

    expect(requestedUrls[0]).toBe(GRAVITY_BASE_URL);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.sourceId === GRAVITY_SOURCE_ID)).toBe(true);
    expect(results.map((r) => r.title).sort()).toEqual(["ARMIN VAN BUUREN", "ERIC PRYDZ", "Gravity Opera: CAMELPHAT", "I HATE MODELS"].sort());
  });

  it("skips a single detail-page failure without failing the whole sync", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GRAVITY_BASE_URL) return new Response(HOME_HTML, { status: 200 });
      if (url === "https://gravitycph.dk/armin-van-buuren/") return new Response("not found", { status: 404 });
      const detailHtml = DETAIL_HTML_BY_URL[url];
      return detailHtml ? new Response(detailHtml, { status: 200 }) : new Response("not found", { status: 404 });
    });

    const adapter = createGravityAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const results = await adapter.fetchCandidates();

    // 4 events discovered, 1 detail fetch fails (404, no retry since <500) — the other 3 still come back.
    expect(results).toHaveLength(3);
    expect(results.some((r) => r.title === "ARMIN VAN BUUREN")).toBe(false);
  });

  it("throws when the homepage itself fails (a genuine source failure, not a droppable single record)", async () => {
    const fetchImpl = vi.fn(async () => new Response("error", { status: 500 }));
    const adapter = createGravityAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow();
  });
});
