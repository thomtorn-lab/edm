import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePumpehusetConcertsJson,
  parseDanishDate,
  parseDotTime,
  extractEventDateAndTime,
  createPumpehusetAdapter,
  PUMPEHUSET_SOURCE_ID,
  PUMPEHUSET_AJAX_URL,
} from "./pumpehusetAdapter";

/**
 * `pumpehuset-fetch-concerts.json` is a real, unmodified recording of a
 * POST to https://pumpehuset.dk/wp-admin/admin-ajax.php
 * (action=fetch_concerts&genres=Elektronisk&sort=concert_date&pageAmount=50)
 * — fetched via inspect-source.yml's reachability mode (2026-08-20), since
 * this is the exact call the site's own frontend (a Vue app) makes to
 * render its genre-filtered programme. Not fabricated: every value
 * asserted below is exactly what the live source returned.
 *
 * `pumpehuset-detail-witchz.html` is a real, unmodified recording of
 * https://pumpehuset.dk/koncerter/witchz/, one of the events in the fixture
 * above — carries the door/show time this adapter needs but the listing
 * response doesn't.
 */
const CONCERTS_FIXTURE_PATH = path.join(__dirname, "__fixtures__", "pumpehuset-fetch-concerts.json");
const CONCERTS_JSON = readFileSync(CONCERTS_FIXTURE_PATH, "utf-8");
const WITCHZ_DETAIL_HTML = readFileSync(path.join(__dirname, "__fixtures__", "pumpehuset-detail-witchz.html"), "utf-8");
/**
 * `pumpehuset-detail-byhaven-love-rave.html` is a real, unmodified
 * recording of https://pumpehuset.dk/koncerter/byhaven-love-rave-16/ — a
 * free-entry "Byhaven" pop-up night, structurally different in kind from a
 * ticketed show (Fri entré instead of a kr. price), used to confirm the
 * same door/show-time card exists and parses correctly for this event type
 * too.
 */
const BYHAVEN_DETAIL_HTML = readFileSync(path.join(__dirname, "__fixtures__", "pumpehuset-detail-byhaven-love-rave.html"), "utf-8");

describe("parseDanishDate", () => {
  it("parses a real listing date", () => {
    expect(parseDanishDate("20. aug 2026")).toEqual({ year: 2026, month: 8, day: 20 });
  });
  it("parses a real detail-page date", () => {
    expect(parseDanishDate("13. sep 2026")).toEqual({ year: 2026, month: 9, day: 13 });
  });
  it("parses every Danish month abbreviation", () => {
    expect(parseDanishDate("1. jan 2027")).toEqual({ year: 2027, month: 1, day: 1 });
    expect(parseDanishDate("1. maj 2027")).toEqual({ year: 2027, month: 5, day: 1 });
    expect(parseDanishDate("1. okt 2027")).toEqual({ year: 2027, month: 10, day: 1 });
  });
  it("returns null for unrecognized text, never guesses", () => {
    expect(parseDanishDate("TBA")).toBeNull();
    expect(parseDanishDate("")).toBeNull();
    expect(parseDanishDate("32. aug 2026")).toBeNull();
  });
});

describe("parseDotTime", () => {
  it("parses a real door/show time", () => {
    expect(parseDotTime("20.00")).toEqual({ hour: 20, minute: 0 });
    expect(parseDotTime("21.00")).toEqual({ hour: 21, minute: 0 });
  });
  it("returns null for unrecognized text, never guesses", () => {
    expect(parseDotTime("TBA")).toBeNull();
    expect(parseDotTime("25.00")).toBeNull();
    expect(parseDotTime("20:00")).toBeNull(); // colon, not this site's dot format
  });
});

describe("extractEventDateAndTime — real detail-page fixtures", () => {
  it("extracts the real date and prefers the show-start time over doors (ticketed show, WITCHZ)", () => {
    const result = extractEventDateAndTime(WITCHZ_DETAIL_HTML);
    expect(result).toEqual({ dateKey: { year: 2026, month: 9, day: 13 }, hour: 21, minute: 0 });
  });

  it("parses a free-entry Byhaven pop-up night the same way", () => {
    const result = extractEventDateAndTime(BYHAVEN_DETAIL_HTML);
    expect(result).toEqual({ dateKey: { year: 2026, month: 8, day: 23 }, hour: 15, minute: 0 });
  });
});

describe("parsePumpehusetConcertsJson — real fetch_concerts fixture", () => {
  const events = parsePumpehusetConcertsJson(CONCERTS_JSON);

  it("parses every genre-filtered concert in the fixture", () => {
    expect(events.length).toBe(27);
  });

  it("every candidate carries this source's id and a null startDatetime (resolved later from the detail page)", () => {
    for (const e of events) {
      expect(e.sourceId).toBe(PUMPEHUSET_SOURCE_ID);
      expect(e.startDatetime).toBeNull();
      expect(e.venueName).toBe("Pumpehuset");
    }
  });

  it("extracts a single-headliner show with a ticket link (WITCHZ)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/witchz/");
    expect(e).toBeDefined();
    expect(e!.title).toBe("WITCHZ");
    expect(e!.artists).toEqual(["WITCHZ"]);
    expect(e!.ticketUrl).toBe("https://www.ticketmaster.dk/event/670950875?language=da-dk&brand=dk_livenation");
    expect(e!.priceFrom).toBe(260);
    expect(e!.description).toBeNull(); // no support_bands bios for this event — never invented
  });

  it("extracts support-band names and bios as artists/description when present (MASTER BOOT RECORD + Fulci)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/master-boot-record-fulci/");
    expect(e).toBeDefined();
    expect(e!.artists).toEqual(["Fulci", "MASTER BOOT RECORD", "arottenbit"]);
    expect(e!.description).toContain("Master Boot Record");
  });

  it("recognizes free-entry events and reports priceFrom 0 (Byhaven pop-up nights)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/byhaven-love-rave-16/");
    expect(e).toBeDefined();
    expect(e!.priceFrom).toBe(0);
  });

  it("parses a 'fra <n>' (from) price as its numeric floor (MPH 360° XP)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/mph-360-xp-guests/");
    expect(e).toBeDefined();
    expect(e!.priceFrom).toBe(225);
  });

  it("credits the venue's own genre field as official-source-metadata evidence when no specific subgenre is named (WITCHZ)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/witchz/");
    expect(e!.genreHint).toBe("electronic-other");
    expect(e!.genreConfidenceHint).toBe("high");
  });

  it("sharpens to a specific subgenre when the venue's own title text names one, still at high confidence (Origin Of Trance)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/origin-of-trance-30-years-of-etnica-celebration/");
    expect(e).toBeDefined();
    expect(e!.genreHint).toBe("trance");
    expect(e!.genreConfidenceHint).toBe("high");
  });

  it("recognizes a Resident Advisor ticket link (MPH 360° XP)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/mph-360-xp-guests/");
    expect(e!.residentAdvisorUrl).toBe("https://ra.co/events/2464279");
  });

  it("never throws on malformed input", () => {
    expect(parsePumpehusetConcertsJson("not json")).toEqual([]);
    expect(parsePumpehusetConcertsJson("{}")).toEqual([]);
    expect(parsePumpehusetConcertsJson("[{}]")).toEqual([]); // missing title/link — skipped, not thrown
  });
});

describe("createPumpehusetAdapter", () => {
  it("posts the genre-filtered fetch_concerts action and resolves each candidate's startDatetime from its detail page", async () => {
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === PUMPEHUSET_AJAX_URL) {
        expect(init?.method).toBe("POST");
        const body = String(init?.body);
        expect(body).toContain("action=fetch_concerts");
        expect(body).toContain("genres=Elektronisk");
        // Simulate real pagination: page 1 returns the fixture (fewer than
        // pageAmount, since the fixture is the full real result set), which
        // ends the pagination loop after one page.
        return new Response(CONCERTS_JSON, { status: 200 });
      }
      if (urlStr === "https://pumpehuset.dk/koncerter/witchz/") {
        return new Response(WITCHZ_DETAIL_HTML, { status: 200 });
      }
      if (urlStr === "https://pumpehuset.dk/koncerter/byhaven-love-rave-16/") {
        return new Response(BYHAVEN_DETAIL_HTML, { status: 200 });
      }
      // Every other event's detail page: no recorded fixture, so degrade
      // gracefully to startDatetime: null for it, same as a real 404 would.
      return new Response("<html></html>", { status: 404 });
    };

    const adapter = createPumpehusetAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const results = await adapter.fetchCandidates();

    expect(results.length).toBe(27);
    const witchz = results.find((e) => e.officialEventUrl === "https://pumpehuset.dk/koncerter/witchz/");
    expect(witchz!.startDatetime).toBe("2026-09-13T19:00:00.000Z"); // 21:00 CEST (UTC+2)

    const byhaven = results.find((e) => e.officialEventUrl === "https://pumpehuset.dk/koncerter/byhaven-love-rave-16/");
    expect(byhaven!.startDatetime).toBe("2026-08-23T13:00:00.000Z"); // 15:00 CEST (UTC+2)

    const other = results.find(
      (e) => e.officialEventUrl !== "https://pumpehuset.dk/koncerter/witchz/" && e.officialEventUrl !== "https://pumpehuset.dk/koncerter/byhaven-love-rave-16/",
    );
    expect(other!.startDatetime).toBeNull(); // detail page unavailable — never guessed
  });
});
