import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseGravityHomeHtml, parseGravityEventDetailHtml, createGravityAdapter, GRAVITY_SOURCE_ID, GRAVITY_BASE_URL } from "./gravityAdapter";
import { runIngestionPipeline } from "./pipeline";
import { VENUES } from "@/lib/data/venues";
import { resolveVenue } from "@/lib/normalize";

/**
 * All fixtures are real, unmodified pages captured directly from
 * gravitycph.dk via the sanctioned Inspect Source reachability tool. There
 * was no prior working adapter for this source to preserve fixtures from
 * (see the module doc comment in gravityAdapter.ts): the registry's
 * pre-existing src-gravity entry was a deliberately-degraded placeholder,
 * never a real integration. The homepage fixture is the real hero carousel
 * at the time of capture (Eric Prydz, Armin van Buuren, CamelPhat, I Hate
 * Models — all confirmed live, all confirmed via dedup-simulate against the
 * real Production DB to be genuinely new, non-duplicate events).
 *
 * QA follow-up (2026-08-29): re-captured against the real live site again
 * after Production reported CamelPhat's detail page failing to parse. That
 * page's real URL had also changed (a "-2" slug suffix was added), and its
 * markup turned out to have been migrated to a different template entirely
 * (schema.org MusicEvent JSON-LD, no more "icon-box" info-rows) — the other
 * three detail-page fixtures were re-captured too and confirmed unchanged
 * (still the original template), which is how tryOldTemplateFields vs.
 * tryJsonLdFields in gravityAdapter.ts was discovered to be the right shape
 * for this adapter, not a wholesale switch to JSON-LD.
 */
const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
const HOME_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-home.html"), "utf-8");
const ERIC_PRYDZ_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-eric-prydz.html"), "utf-8");
const ARMIN_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-armin-van-buuren.html"), "utf-8");
const CAMELPHAT_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-camelphat.html"), "utf-8");
const I_HATE_MODELS_HTML = readFileSync(path.join(FIXTURES_DIR, "gravity-i-hate-models.html"), "utf-8");

const DETAIL_HTML_BY_URL: Record<string, string> = {
  "https://gravitycph.dk/armin-van-buuren/": ARMIN_HTML,
  "https://gravitycph.dk/camelphat-copenhagen-2026-2/": CAMELPHAT_HTML,
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

  it("CamelPhat: real detail page is on the new JSON-LD template (no icon-box info-rows) — resolves via the JSON-LD fallback path", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "Gravity Opera: CAMELPHAT")!;
    const candidate = parseGravityEventDetailHtml(CAMELPHAT_HTML, entry);

    expect(candidate.title).toBe("Gravity Opera: CAMELPHAT");
    expect(candidate.artists).toEqual(["CAMELPHAT"]);
    // JSON-LD startDate/endDate already carry a UTC offset (2026-10-03T22:00:00+02:00 / 06:00 next day).
    expect(candidate.startDatetime).toBe("2026-10-03T20:00:00.000Z");
    expect(candidate.endDatetime).toBe("2026-10-04T04:00:00.000Z");
    expect(candidate.venueName).toBe("TAP1 Copenhagen"); // JSON-LD location.name, resolves against the registry below
    expect(candidate.description).toContain("dark warehouse");
    // The new template's JSON-LD description has no explicit genre keyword
    // (real evidence — not the old template's "Music:" tag, which no
    // longer exists on this page), so genreHint correctly resolves to no
    // hint rather than a guessed/remembered one.
    expect(candidate.genreHint).toBeNull();
  });

  it("CamelPhat: real venue name from JSON-LD resolves against the existing registry to TAP1 (v-tap1)", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "Gravity Opera: CAMELPHAT")!;
    const candidate = parseGravityEventDetailHtml(CAMELPHAT_HTML, entry);

    const resolved = resolveVenue(candidate.venueName!, VENUES);
    expect(resolved?.id).toBe("v-tap1");
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

  it("throws when neither the old template's info-rows nor a JSON-LD block are present, rather than guessing a venue", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "ERIC PRYDZ")!;
    const brokenHtml = ERIC_PRYDZ_HTML.replace(/Location:/, "NoLocationLabel:");
    expect(() => parseGravityEventDetailHtml(brokenHtml, entry)).toThrow(/parseable start\/end time/);
  });

  it("falls back to JSON-LD when the old template's info-rows are broken but a JSON-LD block is present (dual-template robustness)", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "ERIC PRYDZ")!;
    // Break the old-template venue row (so tryOldTemplateFields returns
    // null) but graft on a real JSON-LD block from the CamelPhat fixture —
    // proves the fallback genuinely engages rather than the old path
    // happening to still succeed some other way.
    const jsonLdMatch = CAMELPHAT_HTML.match(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"MusicEvent".*?<\/script>/);
    expect(jsonLdMatch).not.toBeNull();
    const brokenOldTemplateHtml = ERIC_PRYDZ_HTML.replace(/Location:/, "NoLocationLabel:") + jsonLdMatch![0];

    const candidate = parseGravityEventDetailHtml(brokenOldTemplateHtml, entry);
    expect(candidate.venueName).toBe("TAP1 Copenhagen"); // from the grafted JSON-LD, not the (broken) old template
  });

  it("throws when the listing date itself is unparseable rather than inventing one", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "ERIC PRYDZ")!;
    expect(() => parseGravityEventDetailHtml(ERIC_PRYDZ_HTML, { ...entry, dateKey: null })).toThrow(/date/);
  });
});

describe("end-to-end pipeline: all 4 real Gravity candidates ingest with real venue resolution to TAP1", () => {
  it("Eric Prydz, Armin van Buuren, and I Hate Models (old template, explicit 'Music:' tag) auto_publish at high genre confidence", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    for (const title of ["ERIC PRYDZ", "ARMIN VAN BUUREN", "I HATE MODELS"]) {
      const entry = entries.find((e) => e.title === title)!;
      const html = DETAIL_HTML_BY_URL[entry.detailUrl];
      const candidate = parseGravityEventDetailHtml(html, entry);
      const result = runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [], trustedElectronicSource: false });
      expect(result.decision, `${title} should auto_publish`).toBe("auto_publish");
      expect(result.genreConfidence).toBe("high");
      expect(result.resolvedVenueId).toBe("v-tap1");
    }
  });

  it("CamelPhat (new JSON-LD template, no genre keyword in its own description) parses successfully and resolves venue, but holds for review rather than silently vanishing", () => {
    const entries = parseGravityHomeHtml(HOME_HTML);
    const entry = entries.find((e) => e.title === "Gravity Opera: CAMELPHAT")!;
    const html = DETAIL_HTML_BY_URL[entry.detailUrl];
    // The parse itself must not throw — this is the actual Production bug
    // being fixed. Whether the pipeline then auto-publishes is a separate,
    // independent question answered below.
    const candidate = parseGravityEventDetailHtml(html, entry);
    const result = runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [], trustedElectronicSource: false });
    expect(result.resolvedVenueId).toBe("v-tap1");
    expect(result.genreConfidence).not.toBe("high");
    // Real behavior change vs. the old template's explicit "Music:" tag:
    // with no genre keyword and no other electronic-relevance signal in the
    // JSON-LD description, the quality gate correctly holds this for human
    // review rather than guessing a genre — a real, honest trade-off (see
    // the QA follow-up report), not a bug in this fix.
    expect(result.decision).toBe("hold");
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
