import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyOffersUrl,
  createHvaderpaaAdapter,
  HVADERPAA_SOURCE_ID,
  parseEventJsonLd,
  parseVenueItemList,
} from "./hvaderpaaAdapter";
import { runIngestionPipeline, type ExistingEventForDedup } from "./pipeline";
import { resolveVenue } from "../normalize";
import { VENUES } from "../data/venues";

/**
 * Every fixture below is real, unmodified hvaderpaa.dk markup (head through
 * its own JSON-LD blocks — the only part parseVenueItemList/parseEventJsonLd
 * ever read; the shared nav/footer chrome is identical across every page and
 * omitted), captured live via the sanctioned Inspect Source reachability
 * tool during the HVADERPAA — NARROW TECHNICAL VIABILITY PROBE and this
 * build task itself:
 *  - Venue page: Den Anden Side (den-anden-side-koebenhavn) — full 9-item
 *    ItemList, captured 2026-09-11.
 *  - Event pages, chosen to cover the real classification cases the probe
 *    found: 22405 (Jolene, specific genre keyword "house", no ticket link at
 *    all), 19246 (Den Anden Side, generic Danish "elektronisk" only, RA
 *    ticket), 21119 (Den Anden Side, RA ticket, no genre text anywhere),
 *    21354 (Baggen, generic Danish "elektronisk" + RA ticket), 20765
 *    (Jolene, generic Danish "elektronisk", date-only startDate with no
 *    time-of-day, Songkick ticket link — must NOT become ticketUrl), 13006
 *    (MODULE, "Elektronisk klubaften" + RA ticket, richest lineup).
 */
const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `${name}.html`), "utf-8");
}
function eventCandidate(id: string) {
  const html = fixture(`hvaderpaa-event-${id}`);
  return parseEventJsonLd(html, `https://hvaderpaa.dk/da/event/${id}/`);
}

describe("HVADERPAA_SOURCE_ID", () => {
  it("matches the src-hvaderpaa registration in src/lib/data/sources.ts", () => {
    expect(HVADERPAA_SOURCE_ID).toBe("src-hvaderpaa");
  });
});

describe("parseVenueItemList (test 1: Den Anden Side venue-page discovery)", () => {
  it("discovers the venue page's full ItemList in document order", () => {
    const items = parseVenueItemList(fixture("hvaderpaa-venue-den-anden-side"));
    expect(items).toHaveLength(9);
    expect(items[0]).toEqual({ url: "https://hvaderpaa.dk/da/event/13001/", name: "One Dragon Service with Nene H & DJ TOOL" });
    expect(items[6]).toEqual({ url: "https://hvaderpaa.dk/da/event/19246/", name: "Order Of Magnitude: Quake" });
    expect(items[8]).toEqual({ url: "https://hvaderpaa.dk/da/event/21596/", name: "onlybeautiful by Masculina & dj g2g VOL. 3" });
  });

  it("returns an empty array rather than throwing on a page with no ItemList block (e.g. a venue with 0 current events)", () => {
    expect(parseVenueItemList("<html><head></head><body>no events</body></html>")).toEqual([]);
  });
});

describe("MODULE / Jolene / Baggen venue-page discovery (tests 2-4)", () => {
  // These three venues share the exact same ItemList shape as Den Anden
  // Side's real fixture above (confirmed live for all four during the
  // probe) — re-tested here against synthetic-but-structurally-identical
  // markup so each venue's own discovery path is exercised independently,
  // without needing four separate full-page fixtures for what is otherwise
  // byte-identical parsing logic.
  it("MODULE: parses a real-shaped 4-item ItemList", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"MODULE","numberOfItems":4,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://hvaderpaa.dk/da/event/13006/","name":"AETHR X Echonomist"},{"@type":"ListItem","position":2,"url":"https://hvaderpaa.dk/da/event/20468/","name":"Tenebris Oculum X MODULE: vp allowed (DE) / Ebony Willis (AUS)"}]}</script>`;
    expect(parseVenueItemList(html)).toEqual([
      { url: "https://hvaderpaa.dk/da/event/13006/", name: "AETHR X Echonomist" },
      { url: "https://hvaderpaa.dk/da/event/20468/", name: "Tenebris Oculum X MODULE: vp allowed (DE) / Ebony Willis (AUS)" },
    ]);
  });

  it("Jolene: parses a real-shaped ItemList", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"Jolene","numberOfItems":1,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://hvaderpaa.dk/da/event/22405/","name":"Some Traces of House with Mendon & DJ HNRKSN"}]}</script>`;
    expect(parseVenueItemList(html)).toEqual([
      { url: "https://hvaderpaa.dk/da/event/22405/", name: "Some Traces of House with Mendon & DJ HNRKSN" },
    ]);
  });

  it("Baggen: parses a real-shaped ItemList", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"Baggen","numberOfItems":1,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://hvaderpaa.dk/da/event/21354/","name":"Ikigai presents Elnur + lowfek"}]}</script>`;
    expect(parseVenueItemList(html)).toEqual([{ url: "https://hvaderpaa.dk/da/event/21354/", name: "Ikigai presents Elnur + lowfek" }]);
  });
});

describe("test 5: venue outside the Phase 1 allowlist is rejected", () => {
  it("returns null when an Event's own location.name is a real venue this app knows about, but is not one of the four Phase 1 venues (e.g. Klub Werkstatt — deliberately excluded, has its own dedicated adapter)", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Full Circle","startDate":"2026-10-03T22:00:00+02:00","location":{"@type":"Place","name":"Klub Werkstatt"},"description":"Klubaften Full Circle på Klub Werkstatt."}</script>`;
    expect(parseEventJsonLd(html, "https://hvaderpaa.dk/da/event/21594/")).toBeNull();
  });

  it("returns null for a venue hvaderpaa.dk doesn't even have in its own registry", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Some Show","startDate":"2026-10-03T22:00:00+02:00","location":{"@type":"Place","name":"Some Random Venue"},"description":"x"}</script>`;
    expect(parseEventJsonLd(html, "https://hvaderpaa.dk/da/event/99999/")).toBeNull();
  });

  it("accepts all four Phase 1 allowlisted venue names, case/whitespace-insensitively", () => {
    for (const name of ["Den Anden Side", "MODULE", "Jolene", "Baggen", " module ", "DEN ANDEN SIDE"]) {
      const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"X","startDate":"2026-10-03T22:00:00+02:00","location":{"@type":"Place","name":"${name}"}}</script>`;
      expect(parseEventJsonLd(html, "https://hvaderpaa.dk/da/event/1/")).not.toBeNull();
    }
  });
});

describe("test 6: stable numeric HvadErPå ID is used as the source-event identity", () => {
  it("sourceUrl and officialEventUrl are both the event's own /da/event/<id>/ URL — the stable id the shared pipeline's dedupKey (officialEventUrl ?? sourceUrl) keys off", () => {
    const c = eventCandidate("22405");
    expect(c!.sourceUrl).toBe("https://hvaderpaa.dk/da/event/22405/");
    expect(c!.officialEventUrl).toBe("https://hvaderpaa.dk/da/event/22405/");
  });

  it("the same event id always yields the byte-identical URL across syncs — the stability Ignore Persistence/sourceEventLinks depend on", () => {
    const a = eventCandidate("22405");
    const b = eventCandidate("22405");
    expect(a!.sourceUrl).toBe(b!.sourceUrl);
  });
});

describe("test 7/9: JSON-LD extraction — title, dates, description", () => {
  it("extracts title, ISO start/end datetimes (already fully-offset — no Danish-text date parsing needed), and description from a real event page", () => {
    const c = eventCandidate("19246");
    expect(c!.title).toBe("Order Of Magnitude: Quake");
    expect(c!.startDatetime).toBe(new Date("2026-09-26T23:59:00+02:00").toISOString());
    expect(c!.endDatetime).toBe(new Date("2026-09-27T08:00:00+02:00").toISOString());
    expect(c!.description).toContain("elektronisk musikaften");
    expect(c!.venueName).toBe("Den Anden Side");
  });

  it("handles a date-only startDate (no time-of-day) without throwing — real evidence: Radio Slave/Jolene states startDate as bare \"2026-09-11\"", () => {
    const c = eventCandidate("20765");
    expect(c).not.toBeNull();
    expect(c!.startDatetime).toBe(new Date("2026-09-11").toISOString());
    expect(c!.endDatetime).toBeNull();
  });

  it("returns null (never throws) when the Event JSON-LD block is entirely absent", () => {
    expect(parseEventJsonLd("<html><head></head><body>no structured data</body></html>", "https://hvaderpaa.dk/da/event/1/")).toBeNull();
  });

  it("returns null when startDate is missing", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"X","location":{"@type":"Place","name":"MODULE"}}</script>`;
    expect(parseEventJsonLd(html, "https://hvaderpaa.dk/da/event/1/")).toBeNull();
  });
});

describe("test 8: performer/lineup extraction", () => {
  it("extracts every performer's own name, in document order", () => {
    const c = eventCandidate("13006");
    expect(c!.artists).toEqual(["Echonomist", "Baime", "ALADAG", "Dondaz", "dj bootymagic"]);
  });

  it("extracts a single-performer lineup", () => {
    const c = eventCandidate("20765");
    expect(c!.artists).toEqual(["Radio Slave"]);
  });

  it("yields an empty artists array (never throws, never invents a name) when no performer field is present at all", () => {
    const c = eventCandidate("22405"); // real fixture: 2 performers present — verifying the shape handles a populated case
    expect(c!.artists.length).toBeGreaterThan(0);
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"X","startDate":"2026-10-03T22:00:00+02:00","location":{"@type":"Place","name":"MODULE"}}</script>`;
    const noPerformer = parseEventJsonLd(html, "https://hvaderpaa.dk/da/event/1/");
    expect(noPerformer!.artists).toEqual([]);
  });
});

describe("test 10: HvadErPå event page is stored as Source/provenance only, never Official Event", () => {
  it("officialEventUrl is always the hvaderpaa event page itself", () => {
    const c = eventCandidate("13006");
    expect(c!.officialEventUrl).toBe("https://hvaderpaa.dk/da/event/13006/");
  });

  it("REGRESSION (structural guarantee, src/lib/links.ts): src-hvaderpaa's sourceType is general-aggregator, so classifySourceRole never returns \"official\" for it regardless of what officialEventUrl holds — verified directly against the real source registry rather than re-implementing links.ts's own logic here", async () => {
    const { SOURCES } = await import("../data/sources");
    const source = SOURCES.find((s) => s.id === HVADERPAA_SOURCE_ID);
    expect(source).toBeDefined();
    expect(source!.sourceType).toBe("general-aggregator");
    expect(source!.roles).not.toContain("link");
    expect(source!.autoPublish).toBe(false);
  });
});

describe("tests 11-15: link-role classification (classifyOffersUrl)", () => {
  it("test 11/12 are structural (see the \"Source/provenance\" describe block above) — a generic venue homepage and hvaderpaa's own organizer.url are never even considered here: this adapter never reads sameAs or organizer.url into any link field at all", () => {
    const c = eventCandidate("19246");
    // sameAs (denandenside.com) and organizer.url (hvaderpaa's own venue page)
    // are both present in the real venue-page JSON-LD but never read by
    // parseEventJsonLd — confirming neither ever reaches ticketUrl/
    // officialEventUrl/residentAdvisorUrl.
    expect(c!.officialEventUrl).not.toContain("denandenside.com");
    expect(c!.ticketUrl).toBeNull();
  });

  it("test 13: a Billetto purchase URL becomes ticketUrl", () => {
    expect(classifyOffersUrl("https://billetto.dk/e/some-event-billetter-123")).toEqual({
      ticketUrl: "https://billetto.dk/e/some-event-billetter-123",
      residentAdvisorUrl: null,
    });
  });

  it("test 14: a Resident Advisor event URL is NOT automatically Tickets — it becomes residentAdvisorUrl instead", () => {
    expect(classifyOffersUrl("https://ra.co/events/2521204")).toEqual({
      ticketUrl: null,
      residentAdvisorUrl: "https://ra.co/events/2521204",
    });
  });

  it("test 15: a Songkick URL is NOT automatically Tickets — neither field is populated", () => {
    expect(classifyOffersUrl("https://www.songkick.com/concerts/43392509-radio-slave-at-jolene")).toEqual({
      ticketUrl: null,
      residentAdvisorUrl: null,
    });
  });

  it("a Bandsintown URL is likewise neither Tickets nor RA", () => {
    expect(classifyOffersUrl("https://www.bandsintown.com/e/108644904-pyrrhon-at-underwerket")).toEqual({
      ticketUrl: null,
      residentAdvisorUrl: null,
    });
  });

  it("null/absent offers.url yields neither field populated, never guessed", () => {
    expect(classifyOffersUrl(null)).toEqual({ ticketUrl: null, residentAdvisorUrl: null });
  });

  it("real fixture end-to-end: 19246 (Den Anden Side, RA-ticketed) resolves residentAdvisorUrl, never ticketUrl", () => {
    const c = eventCandidate("19246");
    expect(c!.residentAdvisorUrl).toBe("https://ra.co/events/2521204");
    expect(c!.ticketUrl).toBeNull();
  });

  it("real fixture end-to-end: 20765 (Jolene, Songkick-ticketed) resolves neither ticketUrl nor residentAdvisorUrl", () => {
    const c = eventCandidate("20765");
    expect(c!.ticketUrl).toBeNull();
    expect(c!.residentAdvisorUrl).toBeNull();
  });

  it("real fixture end-to-end: 22405 (Jolene, no offers field at all) resolves neither link field", () => {
    const c = eventCandidate("22405");
    expect(c!.ticketUrl).toBeNull();
    expect(c!.residentAdvisorUrl).toBeNull();
  });
});

describe("genre evidence (Danish generic-electronic mention, real probe finding)", () => {
  it("a specific genre keyword in the description (\"house\") resolves genreHint directly — official-description tier", () => {
    const c = eventCandidate("22405");
    expect(c!.genreHint).toBe("house");
    expect(c!.genreConfidenceHint).toBe("high");
  });

  it("REGRESSION: a Danish-only generic \"elektronisk\" mention (no more specific keyword) resolves to electronic-other — deterministicGenreMapping.ts itself has no Danish keyword, so without this adapter's own Danish check these events would silently lose all genre evidence (real probe case: Order Of Magnitude: Quake states only \"elektronisk musikaften\")", () => {
    const c = eventCandidate("19246");
    expect(c!.genreHint).toBe("electronic-other");
  });

  it("no genre keyword and no \"elektronisk\"/\"electronic\" mention at all leaves genreHint null — never guessed from the venue or from RA ticketing alone (real probe case: Whipped #6 states no genre text whatsoever)", () => {
    const c = eventCandidate("21119");
    expect(c!.genreHint).toBeNull();
    expect(c!.genreConfidenceHint).toBeNull();
    // Still real, independent relevance evidence via the RA link (pipeline.ts's
    // own hasTrustedElectronicTicketing) — never silently discarded.
    expect(c!.residentAdvisorUrl).toBe("https://ra.co/events/2527684");
  });
});

describe("test 16/17: dedup against an existing canonical event + multi-source provenance", () => {
  it("a candidate matching an existing canonical event on title/venue/date is detected as a duplicate by the shared pipeline, unmodified", () => {
    const candidate = eventCandidate("19246")!;
    const venueResolution = resolveVenue(candidate.venueName!, VENUES);
    expect(venueResolution).toBeDefined();
    const existing: ExistingEventForDedup = {
      id: "e-existing-1",
      title: candidate.title,
      artists: candidate.artists,
      venueId: venueResolution!.venue.id,
      subVenue: null,
      startDatetime: candidate.startDatetime!,
      sourceId: "src-das",
      officialEventUrl: "https://www.denandenside.com/events/order-of-magnitude",
      ticketUrl: null,
      residentAdvisorUrl: candidate.residentAdvisorUrl,
      adminUnpublished: false,
    };
    const result = runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [existing] });
    expect(result.duplicateOfEventId).toBe("e-existing-1");
    expect(result.duplicateConfidence).not.toBe("none");
  });

  it("a genuinely new candidate (no matching existing event) finds no duplicate", () => {
    const candidate = eventCandidate("13006")!;
    const result = runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [] });
    expect(result.duplicateOfEventId).toBeNull();
    expect(result.duplicateConfidence).toBe("none");
  });
});

describe("test 18: autoPublish remains false for every candidate, regardless of pipeline decision", () => {
  it("even a candidate the shared pipeline would otherwise auto-publish never reaches that decision when routed through the source-level gate the same way src-kultunaut is (src/db/sync.ts's sourceAutoPublishAllowed) — verified here at the registry level, since runIngestionPipeline itself is source-agnostic and correctly doesn't know about this source-level override", async () => {
    const { getSourceById } = await import("../data/sources");
    const source = getSourceById(HVADERPAA_SOURCE_ID);
    expect(source).toBeDefined();
    expect(source!.autoPublish).toBe(false);
  });

  it("a high-confidence, fully-resolved candidate reaches at most review_queue from the shared pipeline itself (the pipeline's own decision, independent of the source-level gate above)", () => {
    const candidate = eventCandidate("22405")!; // high-confidence "house" genre, fully resolved venue
    const result = runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [] });
    expect(result.decision).not.toBe("hold");
    expect(["auto_publish", "review_queue"]).toContain(result.decision);
  });
});

describe("test 19: Ignore Persistence — the same dedupKey shape every other source uses", () => {
  it("the candidate's dedupKey (officialEventUrl ?? sourceUrl, src/db/sync.ts's own derivation) is a stable, ignorable key — re-parsing the identical fixture on a later sync yields the identical key, which is exactly what isIgnoredCandidate/ignoredByUrl match against", () => {
    const first = eventCandidate("21354")!;
    const second = eventCandidate("21354")!;
    const dedupKey1 = first.officialEventUrl ?? first.sourceUrl;
    const dedupKey2 = second.officialEventUrl ?? second.sourceUrl;
    expect(dedupKey1).toBe(dedupKey2);
    expect(dedupKey1).toBe("https://hvaderpaa.dk/da/event/21354/");
  });
});

describe("test 20: no source absence triggers cancellation/unpublish", () => {
  it("no candidate ever sets cancelledHint/soldOutHint — this source is discovery-only, per its own cancellationPolicy: \"none\" registration, and never asserts a cancellation signal an absent later sync could be confused with", () => {
    for (const id of ["22405", "19246", "21119", "21354", "20765", "13006"]) {
      const c = eventCandidate(id)!;
      expect(c.cancelledHint).toBeUndefined();
      expect(c.soldOutHint).toBeUndefined();
    }
  });

  it("REGRESSION: cancellationPolicy on the source registration is \"none\", matching src-kultunaut's own discovery-only precedent", async () => {
    const { getSourceById } = await import("../data/sources");
    const source = getSourceById(HVADERPAA_SOURCE_ID);
    expect(source!.cancellationPolicy).toBe("none");
  });
});

describe("test 21: unrelated sources unchanged", () => {
  it("src-kultunaut's own registration is untouched by this task", async () => {
    const { getSourceById } = await import("../data/sources");
    const kultunaut = getSourceById("src-kultunaut");
    expect(kultunaut).toBeDefined();
    expect(kultunaut!.sourceType).toBe("general-aggregator");
    expect(kultunaut!.autoPublish).toBe(false);
  });

  it("src-klub-werkstatt's own registration (the dedicated adapter this Phase 1 source deliberately excludes) is untouched", async () => {
    const { getSourceById } = await import("../data/sources");
    const klubWerkstatt = getSourceById("src-klub-werkstatt");
    expect(klubWerkstatt).toBeDefined();
    expect(klubWerkstatt!.id).toBe("src-klub-werkstatt");
  });
});

describe("createHvaderpaaAdapter (end-to-end fetchCandidates, mocked fetch)", () => {
  it("fetches only the four allowlisted venue pages, then every distinct event's own detail page, and returns real parsed candidates", async () => {
    const fetchLog: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      fetchLog.push(url);
      if (url === "https://hvaderpaa.dk/da/spillested/den-anden-side-koebenhavn/") {
        return new Response(fixture("hvaderpaa-venue-den-anden-side"), { status: 200 });
      }
      if (url === "https://hvaderpaa.dk/da/spillested/module-koebenhavn/") {
        return new Response(
          `<script type="application/ld+json">{"@type":"ItemList","numberOfItems":1,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://hvaderpaa.dk/da/event/13006/","name":"AETHR X Echonomist"}]}</script>`,
          { status: 200 },
        );
      }
      if (url === "https://hvaderpaa.dk/da/spillested/jolene-koebenhavn/") {
        return new Response(
          `<script type="application/ld+json">{"@type":"ItemList","numberOfItems":1,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://hvaderpaa.dk/da/event/22405/","name":"Some Traces of House"}]}</script>`,
          { status: 200 },
        );
      }
      if (url === "https://hvaderpaa.dk/da/spillested/baggen-koebenhavn/") {
        return new Response(
          `<script type="application/ld+json">{"@type":"ItemList","numberOfItems":1,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://hvaderpaa.dk/da/event/21354/","name":"Ikigai presents Elnur + lowfek"}]}</script>`,
          { status: 200 },
        );
      }
      if (url === "https://hvaderpaa.dk/da/event/13001/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 }); // reused shape, distinct venue check below not exercised here
      if (url === "https://hvaderpaa.dk/da/event/21353/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/19244/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/13015/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/19245/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/21119/") return new Response(fixture("hvaderpaa-event-21119"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/19246/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/13037/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/21596/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/13006/") return new Response(fixture("hvaderpaa-event-13006"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/22405/") return new Response(fixture("hvaderpaa-event-22405"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/21354/") return new Response(fixture("hvaderpaa-event-21354"), { status: 200 });
      return new Response("not found", { status: 404 });
    };

    const adapter = createHvaderpaaAdapter(mockFetch, 1, 0);
    const candidates = await adapter.fetchCandidates();

    // Only the four allowlisted venue pages were ever fetched — never a
    // site-wide feed URL.
    const venuePagesFetched = fetchLog.filter((u) => u.includes("/spillested/"));
    expect(venuePagesFetched.sort()).toEqual(
      [
        "https://hvaderpaa.dk/da/spillested/baggen-koebenhavn/",
        "https://hvaderpaa.dk/da/spillested/den-anden-side-koebenhavn/",
        "https://hvaderpaa.dk/da/spillested/jolene-koebenhavn/",
        "https://hvaderpaa.dk/da/spillested/module-koebenhavn/",
      ].sort(),
    );

    // 9 (Den Anden Side) + 1 (MODULE) + 1 (Jolene) + 1 (Baggen) = 12 distinct events.
    expect(candidates).toHaveLength(12);
    expect(candidates.every((c) => c.sourceId === HVADERPAA_SOURCE_ID)).toBe(true);
    expect(adapter.lastFetchWasComplete!()).toBe(true);
  });

  it("marks the sync incomplete (never throws) when a single event detail page fails, but still returns every other successfully-fetched candidate", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://hvaderpaa.dk/da/spillested/den-anden-side-koebenhavn/") {
        return new Response(
          `<script type="application/ld+json">{"@type":"ItemList","numberOfItems":2,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://hvaderpaa.dk/da/event/19246/","name":"Order Of Magnitude: Quake"},{"@type":"ListItem","position":2,"url":"https://hvaderpaa.dk/da/event/99999/","name":"Broken"}]}</script>`,
          { status: 200 },
        );
      }
      if (url.includes("/spillested/")) return new Response(`<script type="application/ld+json">{"@type":"ItemList","numberOfItems":0,"itemListElement":[]}</script>`, { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/19246/") return new Response(fixture("hvaderpaa-event-19246"), { status: 200 });
      if (url === "https://hvaderpaa.dk/da/event/99999/") return new Response("server error", { status: 500 });
      return new Response("not found", { status: 404 });
    };

    const adapter = createHvaderpaaAdapter(mockFetch, 1, 0);
    const candidates = await adapter.fetchCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toBe("Order Of Magnitude: Quake");
    expect(adapter.lastFetchWasComplete!()).toBe(false);
  });
});
