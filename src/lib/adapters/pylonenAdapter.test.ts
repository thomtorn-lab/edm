import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPylonenAdapter,
  parsePylonenHomepage,
  PYLONEN_BASE_URL,
  PYLONEN_SOURCE_ID,
} from "./pylonenAdapter";
import { runIngestionPipeline } from "./pipeline";
import { VENUES } from "../data/venues";
import { getSourceById } from "../data/sources";
import type { RawCandidateEvent } from "./types";

/**
 * Tests for the Pylonen discovery-only adapter (Pylonen source-gap audit,
 * 2026-09-13). Fixtures are real, unmodified excerpts captured live from
 * pylonen.horse (see the fixture files' own header comments) — never
 * hand-imagined HTML, per SOURCE_ONBOARDING.md.
 */

const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
const HOMEPAGE_HTML = readFileSync(path.join(FIXTURES_DIR, "pylonen-homepage.html"), "utf-8");
const BOLLEBASS_HTML = readFileSync(path.join(FIXTURES_DIR, "pylonen-bollebass.html"), "utf-8");

describe("Pylonen adapter — programme parsing", () => {
  it("parses every item in the programme list, including bare (linkless) and linked items", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async (url) =>
      url === "https://pylonen.horse/bollebass/" ? BOLLEBASS_HTML : null,
    );
    // Fixture carries 6 items: Summer Isn't Over Yet (Sep 13), Myrk, DJ
    // DOPAMINA X NORA ASTEROID, BØLLEBAS (linked), Summer isn't over yet
    // (Nov 1 recurrence), Adam/Shaan Fest.
    expect(results).toHaveLength(6);
    expect(results.map((r) => r.title)).toEqual([
      "Summer Isn't Over Yet",
      "Myrk",
      "DJ DOPAMINA X NORA ASTEROID — BDAY BASH",
      "BØLLEBAS",
      "Summer isn't over yet",
      "Adam/Shaan Fest",
    ]);
  });

  it("every candidate carries sourceId, venueName Pylonen, and no artists/end time invented", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    for (const r of results) {
      expect(r.sourceId).toBe(PYLONEN_SOURCE_ID);
      expect(r.venueName).toBe("Pylonen");
      expect(r.artists).toEqual([]);
      expect(r.endDatetime).toBeNull();
      expect(r.facebookUrl).toBeNull();
      expect(r.imageUrl).toBeNull();
      expect(r.priceFrom).toBeNull();
      // Cancellation is unsupported for this source — never invented true or false.
      expect(r.cancelledHint).toBeUndefined();
      expect(r.soldOutHint).toBeUndefined();
      // Pylonen DQ identity stabilization, 2026-09-13 — every candidate's
      // own sourceUrl is a stable per-candidate identity in its own right
      // (see RawCandidateEvent.stableSourceUrl's own doc comment), so
      // src/db/sync.ts's dedup key must never re-key off a later-appearing
      // officialEventUrl for this source.
      expect(r.stableSourceUrl).toBe(true);
    }
  });
});

describe("Pylonen adapter — time/date parsing (Europe/Copenhagen)", () => {
  it("treats the <time datetime> attribute's own digits as Copenhagen local wall-clock, never as real UTC (the site's +00:00 suffix is mislabeled)", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    const myrk = results.find((r) => r.title === "Myrk")!;
    // "Sat 19 Sep · 22:00" — September is CEST (UTC+2), so 22:00 local = 20:00 UTC.
    // A naive read of the mislabeled datetime="...T22:00:00+00:00" attribute
    // as real UTC would produce 22:00Z instead — this asserts the correct one.
    expect(myrk.startDatetime).toBe("2026-09-19T20:00:00.000Z");

    const adamShaan = results.find((r) => r.title === "Adam/Shaan Fest")!;
    // "Sat 12 Dec · 20:00" — December is CET (UTC+1), so 20:00 local = 19:00 UTC.
    expect(adamShaan.startDatetime).toBe("2026-12-12T19:00:00.000Z");
  });

  it("a bare-date item with no time shown uses Copenhagen local midnight as its best-known start instant", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    const summer = results.find((r) => r.title === "Summer Isn't Over Yet")!;
    // "Sun 13 Sep" (no time) — 00:00 CEST (UTC+2) = 22:00Z the previous day.
    expect(summer.startDatetime).toBe("2026-09-12T22:00:00.000Z");
  });
});

describe("Pylonen adapter — deterministic synthetic identity", () => {
  it("a bare (linkless) item gets a synthetic, same-origin sourceUrl and a null officialEventUrl", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    const myrk = results.find((r) => r.title === "Myrk")!;
    expect(myrk.officialEventUrl).toBeNull();
    expect(myrk.sourceUrl.startsWith(`${PYLONEN_BASE_URL}/#pylonen-2026-09-19-`)).toBe(true);
    expect(new URL(myrk.sourceUrl).hostname).toBe("pylonen.horse");
  });

  it("identity is stable across repeated parses of the same unchanged HTML (no duplicate DQ rows on repeat sync)", async () => {
    const first = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    const second = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    expect(first.map((r) => r.sourceUrl)).toEqual(second.map((r) => r.sourceUrl));
  });

  it("two distinct occurrences of the same recurring title on different dates get distinct identities (never merged)", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    const occurrences = results.filter((r) => r.title.toLowerCase() === "summer isn't over yet".toLowerCase());
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].sourceUrl).not.toBe(occurrences[1].sourceUrl);
  });

  it("a real event-detail URL is still captured as officialEventUrl, but never displaces the synthetic sourceUrl as this candidate's identity (Pylonen DQ identity stabilization, 2026-09-13 — see src/db/sync.ts's dedupKey computation, which reads stableSourceUrl before falling back to officialEventUrl ?? sourceUrl)", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async (url) =>
      url === "https://pylonen.horse/bollebass/" ? BOLLEBASS_HTML : null,
    );
    const bollebas = results.find((r) => r.title === "BØLLEBAS")!;
    expect(bollebas.officialEventUrl).toBe("https://pylonen.horse/bollebass/");
    expect(bollebas.stableSourceUrl).toBe(true);
    expect(bollebas.sourceUrl.startsWith(`${PYLONEN_BASE_URL}/#pylonen-2026-11-06-`)).toBe(true);
    // The effective dedupKey (computed in src/db/sync.ts, not here) is this
    // candidate's own sourceUrl, not officialEventUrl — see
    // src/db/sync.test.ts's own dedicated identity-stability describe block
    // for full end-to-end coverage of that computation.
  });
});

describe("Pylonen adapter — real event-detail URL vs. homepage-only provenance", () => {
  it("a real event-detail page's own description is used, and is never invented for a bare item", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async (url) =>
      url === "https://pylonen.horse/bollebass/" ? BOLLEBASS_HTML : null,
    );
    const bollebas = results.find((r) => r.title === "BØLLEBAS")!;
    expect(bollebas.description).toContain("Hardcore er tilbage i København");

    const myrk = results.find((r) => r.title === "Myrk")!;
    expect(myrk.description).toBeNull();
  });

  it("no genre is invented from title alone — a bare item's genreHint is null (the shared pipeline's own title-keyword fallback, not this adapter, is what may later resolve it)", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    for (const r of results) {
      expect(r.genreHint).toBeNull();
      expect(r.genreConfidenceHint).toBeNull();
    }
  });

  it("ticket URL is never invented — a bare item has ticketUrl null, and a linked item with no genuine ticket link on its own page also stays null", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async (url) =>
      url === "https://pylonen.horse/bollebass/" ? BOLLEBASS_HTML : null,
    );
    for (const r of results) {
      expect(r.ticketUrl).toBeNull();
    }
  });

  it("a genuine RA/Billetto ticket link on a real detail page IS extracted (same precedent as hangarenAdapter.ts)", async () => {
    const detailWithTicket = `${BOLLEBASS_HTML}\n<a href="https://ra.co/events/1234567">Tickets</a>`;
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async (url) =>
      url === "https://pylonen.horse/bollebass/" ? detailWithTicket : null,
    );
    const bollebas = results.find((r) => r.title === "BØLLEBAS")!;
    expect(bollebas.ticketUrl).toBe("https://ra.co/events/1234567");
    expect(bollebas.residentAdvisorUrl).toBe("https://ra.co/events/1234567");
  });

  it("the homepage/programme page itself is never used as officialEventUrl for a bare item — it stays provenance-only via the synthetic sourceUrl", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    const bareItems = results.filter((r) => r.title !== "BØLLEBAS");
    for (const r of bareItems) {
      expect(r.officialEventUrl).toBeNull();
      expect(r.sourceUrl).not.toBe(PYLONEN_BASE_URL);
      expect(r.sourceUrl).not.toBe(`${PYLONEN_BASE_URL}/`);
    }
  });

  it("a third-party link (e.g. the 'Submit a signal' form) is never mistaken for a programme item's own detail URL", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    expect(results.some((r) => r.officialEventUrl?.includes("pylonen-event-submission"))).toBe(false);
    expect(results).toHaveLength(6);
  });

  it("a cross-host href inside the programme list is never trusted as officialEventUrl", async () => {
    const myrkLi =
      '<li><div><span class="pylonen-list-number">02</span><time datetime="2026-09-19T22:00:00+00:00">Sat 19 Sep · 22:00</time><strong>Myrk</strong><span class="pylonen-arrow" aria-hidden="true"></span></div></li>';
    const myrkLiWithExternalLink =
      '<li><a href="https://not-pylonen.example.com/evil"><span class="pylonen-list-number">02</span><time datetime="2026-09-19T22:00:00+00:00">Sat 19 Sep · 22:00</time><strong>Myrk</strong><span class="pylonen-arrow" aria-hidden="true"></span></a></li>';
    expect(HOMEPAGE_HTML).toContain(myrkLi);
    const htmlWithExternalLink = HOMEPAGE_HTML.replace(myrkLi, myrkLiWithExternalLink);
    const results = await parsePylonenHomepage(htmlWithExternalLink, async () => null);
    const myrk = results.find((r) => r.title === "Myrk")!;
    expect(myrk.officialEventUrl).toBeNull();
  });
});

describe("Pylonen adapter — malformed-record resilience", () => {
  it("a single malformed <li> (no <time>) is skipped without throwing or dropping the rest", async () => {
    const withMalformed = HOMEPAGE_HTML.replace(
      '<li><div><span class="pylonen-list-number">02</span><time datetime="2026-09-19T22:00:00+00:00">Sat 19 Sep · 22:00</time><strong>Myrk</strong><span class="pylonen-arrow" aria-hidden="true"></span></div></li>',
      '<li><div><span class="pylonen-list-number">02</span><strong>Myrk</strong></div></li>',
    );
    const results = await parsePylonenHomepage(withMalformed, async () => null);
    expect(results.some((r) => r.title === "Myrk")).toBe(false);
    expect(results.length).toBe(5);
  });

  it("empty/missing programme list returns an empty array, never throws", async () => {
    const results = await parsePylonenHomepage("<html><body>no programme here</body></html>", async () => null);
    expect(results).toEqual([]);
  });

  it("a detail-page fetch failure never drops the list item itself", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => {
      throw new Error("network error");
    });
    const bollebas = results.find((r) => r.title === "BØLLEBAS")!;
    expect(bollebas).toBeDefined();
    expect(bollebas.officialEventUrl).toBe("https://pylonen.horse/bollebass/");
    expect(bollebas.description).toBeNull();
  });
});

describe("Pylonen adapter — canonical venue mapping (pipeline integration)", () => {
  it("resolves to the existing canonical venue v-pylonen, never auto-creating a new one", async () => {
    const results = await parsePylonenHomepage(HOMEPAGE_HTML, async () => null);
    const myrk = results.find((r) => r.title === "Myrk")!;
    const result = runIngestionPipeline(myrk, { venues: VENUES, existingEvents: [] });
    expect(result.resolvedVenueId).toBe("v-pylonen");
    // VENUES is the static registry itself — proving resolution found an
    // EXISTING entry rather than this test (or the adapter) fabricating one.
    expect(VENUES.some((v) => v.id === "v-pylonen" && v.name === "Pylonen")).toBe(true);
  });
});

describe("Pylonen adapter — no auto-publish (registry + pipeline)", () => {
  it("src-pylonen is registered with autoPublish: false", () => {
    const source = getSourceById(PYLONEN_SOURCE_ID);
    expect(source).toBeDefined();
    expect(source?.autoPublish).toBe(false);
    expect(source?.cancellationPolicy).toBe("none");
    expect(source?.sourceType).toBe("official-venue");
  });

  it("even a candidate the pipeline itself would auto-publish never does so once src/db/sync.ts's sourceAutoPublishAllowed gate is applied (documented contract, exercised the same way src-kultunaut/src-hvaderpaa already are)", () => {
    // DJ DOPAMINA X NORA ASTEROID's title alone carries a real "DJ" genre
    // keyword the shared deterministic fallback picks up — a genuinely
    // strong-looking candidate — yet must still never auto-publish for this
    // source. The actual gate lives in src/db/sync.ts (sourceAutoPublishAllowed
    // = getSourceById(sourceId)?.autoPublish ?? false), not in the adapter or
    // the pipeline — this test proves the registry fact that gate reads.
    const source = getSourceById(PYLONEN_SOURCE_ID);
    expect(source?.autoPublish).toBe(false);
  });
});

describe("Pylonen adapter — createPylonenAdapter (fetch orchestration)", () => {
  it("fetches the homepage and parses it via injected fetchImpl", async () => {
    let homepageRequested = false;
    const fetchImpl = (async (url: string) => {
      if (url === PYLONEN_BASE_URL) homepageRequested = true;
      return new Response(url === PYLONEN_BASE_URL ? HOMEPAGE_HTML : BOLLEBASS_HTML, { status: 200 });
    }) as typeof fetch;
    const adapter = createPylonenAdapter(fetchImpl);
    const results = await adapter.fetchCandidates();
    expect(homepageRequested).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r: RawCandidateEvent) => r.sourceId === PYLONEN_SOURCE_ID)).toBe(true);
  });

  it("retries once on a transient failure, then succeeds", async () => {
    let homepageCalls = 0;
    const fetchImpl = (async (url: string) => {
      if (url !== PYLONEN_BASE_URL) return new Response(BOLLEBASS_HTML, { status: 200 });
      homepageCalls++;
      if (homepageCalls === 1) throw new Error("ECONNRESET");
      return new Response(HOMEPAGE_HTML, { status: 200 });
    }) as typeof fetch;
    const adapter = createPylonenAdapter(fetchImpl, 1);
    const results = await adapter.fetchCandidates();
    expect(homepageCalls).toBe(2);
    expect(results.length).toBeGreaterThan(0);
  });

  it("throws after both attempts fail", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const adapter = createPylonenAdapter(fetchImpl, 1);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/network down/);
  });
});

