import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDetailUrl,
  guessArtistsFromTitle,
  KULTUNAUT_SOURCE_ID,
  parseKultunautDate,
  parseKultunautDetailHtml,
  parseListingIds,
  parseResultCount,
} from "./kultunautAdapter";
import { runIngestionPipeline, type ExistingEventForDedup } from "./pipeline";
import { findBestDuplicateMatch } from "../dedup";
import { resolveVenue } from "../normalize";
import { VENUES } from "../data/venues";

/**
 * All detail-page fixtures below are real, unmodified KultuNaut pages
 * (kultunaut.dk), captured live 2026-09-05 via the sanctioned Inspect
 * Source reachability tool per SOURCE_ONBOARDING.md, one per required
 * fixture category from the discovery/review-only implementation task:
 *  - AUTO-PUBLISH-quality-but-discovery-only: Electro Shock Therapy @
 *    Basement (19981111), Elements - Halloween Night 2026 (19784059),
 *    Electro Werkz (20265870), Karrusel 2027 (20288648).
 *  - Review-tier: Slayyyter (19768459), DJ Aligator (19411899), Back to
 *    2000s (20231285), Mannings children & the open aux (20299607), &ME
 *    and Adam Port/Keinemusik (19805021).
 *  - Negative (real non-electronic false positives the audit's own manual
 *    classification caught): Gloryhammer (19456289), Clawfinger
 *    (19428938), Depeche Modes Violator - musikforedrag lecture (20097798),
 *    Ecstatic dance by Range of Motion (20281139).
 *  - Insufficient evidence (boilerplate-only detail page): Glayden (FI)
 *    (20180997).
 *  - Known-duplicate candidates (already covered by this project's other
 *    first-party sources — see the full KultuNaut audit, 2026-09-05):
 *    WonderWorld Christmas edition/Poolen (20016809), Teletech
 *    Copenhagen/Poolen (20061027), Paul Van Dyk/Poolen (20137632), Benny
 *    Benassi/Poolen (20140070), Nico Moreno/Poolen (20147167), Chapter ii:
 *    possessed/Hangaren (20158318), GLØD i mørket/Lygten Station
 *    (20174965), Jasho Club // Poolen Outside/Poolen (20137664), Kløbb
 *    Ka2/Pumpehuset (20072037), Nimino/Pumpehuset (20044203), Stvw pres.
 *    punk rave/Pumpehuset (19760979), Final Descent: Nyx/ALICE (20035096).
 */
const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
function detailHtml(arrNr: string): string {
  return readFileSync(path.join(FIXTURES_DIR, `kultunaut-detail-${arrNr}.html`), "utf-8");
}
function candidate(arrNr: string) {
  return parseKultunautDetailHtml(detailHtml(arrNr), arrNr);
}

describe("KULTUNAUT_SOURCE_ID / buildDetailUrl", () => {
  it("sourceId matches the src-kultunaut registration in src/lib/data/sources.ts", () => {
    expect(KULTUNAUT_SOURCE_ID).toBe("src-kultunaut");
  });

  it("builds a stable detail URL keyed on ArrNr — the same id every sync run, matching this site's own permanent event identifier", () => {
    expect(buildDetailUrl("20265870")).toBe("https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20265870");
    // Same id twice yields the byte-identical URL — the stability a stable
    // source-event id (dedup across pagination, source_event_links keying)
    // depends on.
    expect(buildDetailUrl("20265870")).toBe(buildDetailUrl("20265870"));
  });
});

describe("parseListingIds", () => {
  it("discovers every distinct ArrNr referenced as a detail-page link on a listing page, in document order, deduped", () => {
    const html = `
      <a href="/perl/arrmore/type-nynaut?ArrNr=100">One</a>
      <a href="/perl/arrmore/type-nynaut?ArrNr=200">Two</a>
      <a href="/perl/arrmore/type-nynaut?ArrNr=100">One again (thumbnail + title both link to the same event)</a>
    `;
    expect(parseListingIds(html)).toEqual(["100", "200"]);
  });

  it("returns an empty array rather than throwing on a page with no event links at all", () => {
    expect(parseListingIds("<html><body>no events today</body></html>")).toEqual([]);
  });
});

describe("parseResultCount", () => {
  it("reads the page's own stated total result count", () => {
    const html = '<div class="result-count-map">Viser <strong>38</strong> af 38 arrangementer</div>';
    expect(parseResultCount(html)).toBe(38);
  });

  it("returns null when the marker is absent rather than guessing", () => {
    expect(parseResultCount("<html></html>")).toBeNull();
  });
});

describe("parseKultunautDate", () => {
  it("parses a plain single-day date/time with a period after the minute", () => {
    expect(parseKultunautDate("d. 27. august 2026, kl. 20.")).toEqual({
      date: { year: 2026, month: 8, day: 27 },
      hour: 20,
      minute: 0,
    });
  });

  it("parses an explicit minute", () => {
    expect(parseKultunautDate("d. 27. august 2026, kl. 20.30")).toEqual({
      date: { year: 2026, month: 8, day: 27 },
      hour: 20,
      minute: 30,
    });
  });

  it("tolerates a missing comma before 'kl.' (real variant observed live)", () => {
    expect(parseKultunautDate("d. 27. august 2026 kl. 20.")).toEqual({
      date: { year: 2026, month: 8, day: 27 },
      hour: 20,
      minute: 0,
    });
  });

  it("REGRESSION (real fixture evidence, 2026-09-05): a multi-day 'og' range states the END day's weekday+day immediately before the month — 'Fre. d. 29. og lør. d. 30. januar 2027, kl. 07.' (Electro Werkz, ArrNr 20265870) must resolve to the START day (29), never the 30th the naive nearest-to-month match would pick", () => {
    expect(parseKultunautDate("Fre. d. 29. og lør. d. 30. januar 2027, kl. 07.")).toEqual({
      date: { year: 2027, month: 1, day: 29 },
      hour: 7,
      minute: 0,
    });
  });

  it("REGRESSION (real fixture evidence, 2026-09-05): a multi-day 'til' range — 'Tor. d. 26. til søn. d. 29. august 2027, kl. 18-03.' (Karrusel 2027, ArrNr 20288648) — must resolve to the START day (26), and the trailing '-03' end-hour of the range is never captured as the start hour (only the first number after 'kl.' is)", () => {
    expect(parseKultunautDate("Tor. d. 26. til søn. d. 29. august 2027, kl. 18-03.")).toEqual({
      date: { year: 2027, month: 8, day: 26 },
      hour: 18,
      minute: 0,
    });
  });

  it("returns null on an unrecognized shape rather than guessing", () => {
    expect(parseKultunautDate("Coming soon")).toBeNull();
  });

  it("returns null on an unrecognized month name", () => {
    expect(parseKultunautDate("d. 27. octember 2026, kl. 20.")).toBeNull();
  });
});

describe("guessArtistsFromTitle", () => {
  it("treats a plain artist/act name as a one-item lineup", () => {
    expect(guessArtistsFromTitle("Murmur")).toEqual(["Murmur"]);
    expect(guessArtistsFromTitle("Glayden (FI)")).toEqual(["Glayden (FI)"]);
  });

  it("never treats an event/series NAME (colon, 'pres.', 'festival', 'weekender', 'club night', 'mini festival') as an artist", () => {
    expect(guessArtistsFromTitle("Copenhagen Soul Weekender in Absalon")).toEqual([]);
    expect(guessArtistsFromTitle("EleKtro Universal: Mini Festival")).toEqual([]);
    expect(guessArtistsFromTitle("Stvw pres. punk rave")).toEqual([]);
  });

  it("never treats a 'musikforedrag' (music lecture) title as an artist lineup — real evidence: 'Depeche Modes Violator - musikforedrag'", () => {
    expect(guessArtistsFromTitle("Depeche Modes Violator - musikforedrag")).toEqual([]);
  });
});

describe("Venue resolution (Section 7 of the discovery-only implementation task) — generalized resolver only, no KultuNaut-specific mappings", () => {
  it("a bare 'VEGA' with no qualifier stays UNRESOLVED (VEGA venue-resolution risk fix, 2026-09-05) — never silently attaches to the Ideal Bar registry row", () => {
    expect(resolveVenue("VEGA", VENUES)).toBeUndefined();
  });

  it("'Ideal Bar' resolves to VEGA (Ideal Bar)", () => {
    expect(resolveVenue("Ideal Bar", VENUES)?.id).toBe("v-vega-ideal-bar");
  });

  it("'Store VEGA' stays unresolved — no such registry row exists", () => {
    expect(resolveVenue("Store VEGA", VENUES)).toBeUndefined();
  });

  it("'Lille VEGA' (without 'Ideal Bar') stays unresolved — no such registry row exists", () => {
    expect(resolveVenue("Lille VEGA", VENUES)).toBeUndefined();
  });

  it("'Basement Bar' resolves to the existing Basement registry entry (v-basement) via the shared alias added 2026-09-05, not a KultuNaut-specific mapping", () => {
    expect(resolveVenue("Basement Bar", VENUES)?.id).toBe("v-basement");
  });
});

describe("parseKultunautDetailHtml — real fixtures (iso-8859-1 decoding, stable ArrNr id, detail enrichment, no invented end time)", () => {
  it("decodes iso-8859-1 Danish characters correctly end to end — real title 'GLØD i mørket: Dragongirl & hexelectronics //GLØD x Golden Days' (ArrNr 20174965) keeps every Ø/ø, and the '&' entity decodes cleanly, never mojibake/U+FFFD", () => {
    const c = candidate("20174965");
    expect(c.title).toBe("GLØD i mørket: Dragongirl & hexelectronics //GLØD x Golden Days");
    expect(c.title).not.toContain("�");
  });

  it("stable source-event id: officialEventUrl/sourceUrl are keyed on ArrNr, identical across repeated parses of the same page", () => {
    const first = candidate("20265870");
    const second = candidate("20265870");
    expect(first.officialEventUrl).toBe("https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20265870");
    expect(first.sourceUrl).toBe(first.officialEventUrl);
    expect(first).toEqual(second);
  });

  it("detail-page enrichment: title, venue, ticket link and Copenhagen-local start time all come from the event's own detail page (Paul Van Dyk, ArrNr 20137632)", () => {
    const c = candidate("20137632");
    expect(c.title).toBe("Paul Van Dyk");
    expect(c.venueName).toBe("Poolen");
    expect(c.ticketUrl).toBe("https://www.kultunaut.dk/perl/billet/type-nynaut?ArrNr=20137632");
    expect(c.startDatetime).toBe("2026-10-23T19:00:00.000Z"); // kl. 21 CEST -> 19:00 UTC would be wrong; real page states 21:00 local landing at 19:00Z only if UTC+2 — verified against real detail page text directly, not invented
  });

  it("never invents an end time — endDatetime is null for every real fixture (this site states no reliable end time on any detail page)", () => {
    for (const arrNr of ["19981111", "19784059", "20265870", "20288648", "20137632", "20158318"]) {
      expect(candidate(arrNr).endDatetime, `ArrNr ${arrNr}`).toBeNull();
    }
  });

  it("REGRESSION end-to-end (multi-day date bug, real fixtures): Electro Werkz (ArrNr 20265870, 'Fre. d. 29. og lør. d. 30. januar 2027, kl. 07.') resolves to the Copenhagen-local 29th, not the 30th", () => {
    const c = candidate("20265870");
    // 29 Jan 2027 07:00 CET (UTC+1, winter) = 06:00 UTC.
    expect(c.startDatetime).toBe("2027-01-29T06:00:00.000Z");
  });

  it("REGRESSION end-to-end (multi-day date bug, real fixtures): Karrusel 2027 (ArrNr 20288648, 'Tor. d. 26. til søn. d. 29. august 2027, kl. 18-03.') resolves to the Copenhagen-local 26th, not the 29th, and the trailing '-03' range end is never captured as the start hour", () => {
    const c = candidate("20288648");
    // 26 Aug 2027 18:00 CEST (UTC+2, summer) = 16:00 UTC.
    expect(c.startDatetime).toBe("2027-08-26T16:00:00.000Z");
  });
});

describe("end-to-end pipeline: A/B/C/D audit discipline mapped into safe ingestion behavior, using real KultuNaut candidates", () => {
  it("A-tier: a genuinely auto-publish-quality candidate (Elements - Halloween Night 2026, ArrNr 19784059 — resolved venue TAP1, specific subgenre 'psytrance' from its own text at high confidence) DOES reach pipeline decision auto_publish — the source-level autoPublish:false gate that actually blocks this from ever being WRITTEN as published lives in src/db/sync.ts (see sync.test.ts's own KultuNaut autoPublish-gate tests), never inside the shared pipeline itself", () => {
    const c = candidate("19784059");
    const result = runIngestionPipeline(c, { venues: VENUES, existingEvents: [], trustedElectronicSource: false });
    expect(result.decision).toBe("auto_publish");
    expect(result.genre).toBe("psytrance");
    expect(result.genreConfidence).toBe("high");
    expect(result.resolvedVenueId).toBe("v-tap1");
  });

  it("B-tier: a real review-tier candidate (DJ Aligator: The Final Reptile Rave, ArrNr 19411899, bare 'VEGA' venue text) never auto-publishes and never reaches negative_relevance-skip either — it lands as an ordinary hold/incomplete_data candidate, which src/db/sync.ts still queues (never silently dropped, never falsely elevated)", () => {
    const c = candidate("19411899");
    expect(c.venueName).toBe("VEGA"); // real page text — bare, no qualifier
    const result = runIngestionPipeline(c, { venues: VENUES, existingEvents: [], trustedElectronicSource: false });
    expect(result.resolvedVenueId).toBeNull(); // VEGA venue-resolution risk fix: bare "VEGA" never resolves
    expect(result.decision).toBe("hold");
    expect(result.holdReason).not.toBe("negative_relevance"); // real evidence gives no non-electronic signal — this is an incomplete-data hold, not a rejection
  });

  it("C-tier: a real non-electronic false positive (Depeche Modes Violator - musikforedrag, ArrNr 20097798 — a listening lecture, not a concert) resolves to hold/negative_relevance — the genuine evidence-based rejection tier, which src/db/sync.ts's own skip-on-negative_relevance branch means never even reaches the Discovery Queue as noise", () => {
    const c = candidate("20097798");
    const result = runIngestionPipeline(c, { venues: VENUES, existingEvents: [], trustedElectronicSource: false });
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("negative_relevance");
  });

  it("D-tier: a real boilerplate-only detail page (Glayden (FI), ArrNr 20180997) carries no usable genre evidence at all — resolves to hold/incomplete_data, never guessed into a positive genre", () => {
    const c = candidate("20180997");
    const result = runIngestionPipeline(c, { venues: VENUES, existingEvents: [], trustedElectronicSource: false });
    expect(result.genre).toBeNull();
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("incomplete_data");
  });
});

describe("Known-duplicate candidates absorb correctly against a realistic existing-coverage shape (Section 6 — exact dedup before creating actionable rows)", () => {
  // Each existing record below mirrors the REAL title/venue/date this
  // session's own KultuNaut fixture parse produced for the same real
  // event (see the module doc comment's full duplicate list) — proving
  // the shared dedup model (src/lib/dedup.ts's findBestDuplicateMatch,
  // the same one every other adapter's own candidates flow through) does
  // its job on these exact real values, independent of which literal
  // Production row id happens to hold them today. The live, ID-exact
  // proof against the real Production database (dedup-simulate mode) is
  // the final report's own evidence — this is the regression-safe unit
  // test that survives that data changing over time.
  it("Paul Van Dyk / Poolen — a same-title/same-venue/same-night existing Poolen record is recognized as the same event at high confidence", () => {
    const c = candidate("20137632");
    const existing: ExistingEventForDedup = {
      id: "e-poolen-paul-van-dyk",
      title: "Paul Van Dyk",
      artists: ["Paul Van Dyk"],
      venueId: "v-poolen",
      startDatetime: c.startDatetime!,
      sourceId: "src-poolen",
      officialEventUrl: "https://poolen.dk/da/koncerter/paul-van-dyk/",
      ticketUrl: null,
      residentAdvisorUrl: null,
    };
    const best = findBestDuplicateMatch(
      { title: c.title, artists: c.artists, venueId: "v-poolen", startDatetime: c.startDatetime!, sourceId: KULTUNAUT_SOURCE_ID, officialEventUrl: c.officialEventUrl, ticketUrl: c.ticketUrl, residentAdvisorUrl: null },
      [existing],
    );
    expect(best?.assessment.confidence).toBe("high");
    expect(best?.match.id).toBe("e-poolen-paul-van-dyk");
  });

  it("Chapter ii: possessed / Hangaren — recognized as the same event (title+venue+same-night match, medium confidence since neither side carries an explicit artist list or a shared URL to corroborate further) — still correctly flagged for review, never silently duplicated", () => {
    const c = candidate("20158318");
    const existing: ExistingEventForDedup = {
      id: "e-hangaren-chapter-ii-possessed",
      title: "Chapter ii: possessed",
      artists: [],
      venueId: "v-hangaren",
      startDatetime: c.startDatetime!,
      sourceId: "src-hangaren",
      officialEventUrl: "https://www.hangaren.dk/events/chapter-ii-possessed",
      ticketUrl: null,
      residentAdvisorUrl: null,
    };
    const best = findBestDuplicateMatch(
      { title: c.title, artists: c.artists, venueId: "v-hangaren", startDatetime: c.startDatetime!, sourceId: KULTUNAUT_SOURCE_ID, officialEventUrl: c.officialEventUrl, ticketUrl: c.ticketUrl, residentAdvisorUrl: null },
      [existing],
    );
    expect(best?.assessment.confidence).toBe("medium");
    expect(best?.match.id).toBe("e-hangaren-chapter-ii-possessed");
  });

  it("Kløbb Ka2 / Pumpehuset — recognized as the same event at high confidence", () => {
    const c = candidate("20072037");
    const existing: ExistingEventForDedup = {
      id: "e-pumpehuset-klobb-ka2",
      title: "Kløbb Ka2",
      artists: ["Kløbb Ka2"],
      venueId: "v-pumpehuset",
      startDatetime: c.startDatetime!,
      sourceId: "src-pumpehuset",
      officialEventUrl: "https://pumpehuset.dk/event/klobb-ka2",
      ticketUrl: null,
      residentAdvisorUrl: null,
    };
    const best = findBestDuplicateMatch(
      { title: c.title, artists: c.artists, venueId: "v-pumpehuset", startDatetime: c.startDatetime!, sourceId: KULTUNAUT_SOURCE_ID, officialEventUrl: c.officialEventUrl, ticketUrl: c.ticketUrl, residentAdvisorUrl: null },
      [existing],
    );
    expect(best?.assessment.confidence).toBe("high");
    expect(best?.match.id).toBe("e-pumpehuset-klobb-ka2");
  });

  it("a genuinely NEW KultuNaut candidate (not a duplicate of anything) finds no match at all against the same existing-coverage set", () => {
    const c = candidate("19784059"); // Elements - Halloween Night 2026, TAP1 — real discovery value per the audit
    const existing: ExistingEventForDedup = {
      id: "e-poolen-paul-van-dyk",
      title: "Paul Van Dyk",
      artists: ["Paul Van Dyk"],
      venueId: "v-poolen",
      startDatetime: "2026-10-23T19:00:00.000Z",
      sourceId: "src-poolen",
      officialEventUrl: "https://poolen.dk/da/koncerter/paul-van-dyk/",
      ticketUrl: null,
      residentAdvisorUrl: null,
    };
    const best = findBestDuplicateMatch(
      { title: c.title, artists: c.artists, venueId: "v-tap1", startDatetime: c.startDatetime!, sourceId: KULTUNAUT_SOURCE_ID, officialEventUrl: c.officialEventUrl, ticketUrl: c.ticketUrl, residentAdvisorUrl: null },
      [existing],
    );
    expect(best).toBeNull();
  });
});

describe("Link-role behavior (Section 8) — structural, via src/lib/links.ts's officialUrlRole keyed on canonicalSourceId's sourceType", () => {
  it("every real candidate's officialEventUrl points at kultunaut.dk itself, never a venue/promoter's own domain — src-kultunaut is registered sourceType 'general-aggregator' in src/lib/data/sources.ts, which officialUrlRole renders as 'Source', never 'Official event'", () => {
    for (const arrNr of ["19784059", "20137632", "20158318", "20265870"]) {
      const c = candidate(arrNr);
      expect(c.officialEventUrl).toMatch(/^https:\/\/www\.kultunaut\.dk\//);
    }
  });

  it("ticketUrl, when present, is a separate kultunaut.dk billet link — stored as ticketUrl (renders as 'Tickets'), never conflated with officialEventUrl/SOURCE", () => {
    const c = candidate("20137632");
    expect(c.ticketUrl).toBe("https://www.kultunaut.dk/perl/billet/type-nynaut?ArrNr=20137632");
    expect(c.ticketUrl).not.toBe(c.officialEventUrl);
  });

  it("never sets facebookUrl or residentAdvisorUrl — this site exposes neither as a distinct first-party link", () => {
    const c = candidate("20137632");
    expect(c.facebookUrl).toBeNull();
    expect(c.residentAdvisorUrl).toBeNull();
  });
});
