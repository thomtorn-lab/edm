import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePumpehusetConcertsJson,
  parseDanishDate,
  parseDotTime,
  extractEventDateAndTime,
  extractLineupFromBodyLines,
  extractGenreTags,
  isLikelyDanish,
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
/**
 * `pumpehuset-detail-afro-sundown-fest.html` is a real, unmodified recording
 * of https://pumpehuset.dk/koncerter/byhaven-afro-sundown-fest/ (fetched via
 * inspect-source.yml's reachability mode, 2026-08-21 — Data Quality & Trust
 * follow-up review) — its own body text states its lineup as "DJ lineup:"
 * followed by a single comma-separated line ("Bullet, Panda, Sule, Xzyl,
 * Ynxg Irie, Jayce + MC Mazi"), a shape the original one-name-per-line
 * "Line-Up:" extractor didn't recognize at all, so this adapter previously
 * only ever extracted the generic title-derived placeholder "Afro Sundown
 * Fest" as the sole "artist".
 */
const AFRO_SUNDOWN_DETAIL_HTML = readFileSync(path.join(__dirname, "__fixtures__", "pumpehuset-detail-afro-sundown-fest.html"), "utf-8");
/**
 * `pumpehuset-detail-shrek-rave.html` is a real, unmodified recording of
 * https://pumpehuset.dk/koncerter/shrek-rave/ (fetched via inspect-source.yml's
 * reachability mode, 2026-08-30 — first-party source completeness audit).
 * This event is the real, live counterexample that exposed the Pumpehuset
 * multi-genre-tag completeness bug: fetch_concerts' own listing record
 * reduces it to a single genre, "Pop" (confirmed via this same page's own
 * GTM dataLayer marker, `genreName: 'Pop'`), even though this exact page
 * itself links three real tags — Pop, Indie, and Elektronisk (see
 * parsePumpehusetConcertsJson's and extractGenreTags's doc comments).
 */
const SHREK_RAVE_DETAIL_HTML = readFileSync(path.join(__dirname, "__fixtures__", "pumpehuset-detail-shrek-rave.html"), "utf-8");

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

describe("extractGenreTags — real detail-page fixture (multi-genre completeness fix)", () => {
  it("reads every /program?genre=... tag a real detail page links, not just the listing's single primary genre (Shrek Rave: Pop, Indie, Elektronisk)", () => {
    const tags = extractGenreTags(SHREK_RAVE_DETAIL_HTML);
    expect(tags).toEqual(expect.arrayContaining(["Pop", "Indie", "Elektronisk"]));
    expect(tags.length).toBe(3); // deduplicated — the fixture links "Pop" twice
  });

  it("returns an empty array when a page has no genre tag links", () => {
    expect(extractGenreTags("<html><body>No genre links here.</body></html>")).toEqual([]);
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

describe("parsePumpehusetConcertsJson — multi-genre completeness fix (Shrek Rave root cause)", () => {
  it("keeps a candidate whose listing genre isn't Elektronisk, instead of dropping it — genreHint left null for enrichWithShowTimes to resolve from the real detail-page tag list", () => {
    const json = JSON.stringify([
      {
        title: "Shrek Rave",
        link: "https://pumpehuset.dk/koncerter/shrek-rave/",
        genre: "Pop", // the listing's own single primary genre — real, live value
      },
    ]);
    const [e] = parsePumpehusetConcertsJson(json);
    expect(e).toBeDefined();
    expect(e.title).toBe("Shrek Rave");
    expect(e.genreHint).toBeNull();
    expect(e.genreConfidenceHint).toBeNull();
  });

  it("still credits genre immediately when the listing's own genre field already says Elektronisk (no regression for the common case)", () => {
    const json = JSON.stringify([
      {
        title: "Test Show",
        link: "https://pumpehuset.dk/koncerter/test-show/",
        genre: "Elektronisk",
      },
    ]);
    const [e] = parsePumpehusetConcertsJson(json);
    expect(e.genreHint).toBe("electronic-other");
    expect(e.genreConfidenceHint).toBe("high");
  });

  it("keeps a candidate with a missing/empty genre field the same way — never drops on genre alone at listing time", () => {
    const json = JSON.stringify([{ title: "No Genre Listed", link: "https://pumpehuset.dk/koncerter/no-genre-listed/" }]);
    const [e] = parsePumpehusetConcertsJson(json);
    expect(e).toBeDefined();
    expect(e.genreHint).toBeNull();
  });
});

describe("parsePumpehusetConcertsJson — ticket_status lifecycle signal (event lifecycle/status handling, 2026-08-28)", () => {
  const events = parsePumpehusetConcertsJson(CONCERTS_JSON);

  it("does not flag soldOut/cancelled for a real 'Få tilbage' (few tickets left) concert — still purchasable, not sold out", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/mph-360-xp-guests/");
    expect(e).toBeDefined();
    expect(e!.soldOutHint).toBeNull();
    expect(e!.cancelledHint).toBeNull();
  });

  it("does not flag soldOut/cancelled for a real 'Flyttet' (moved) concert — ambiguous on its own, left to the generic date-diff mechanism instead of guessed here", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://pumpehuset.dk/koncerter/tonser/");
    expect(e).toBeDefined();
    expect(e!.soldOutHint).toBeNull();
    expect(e!.cancelledHint).toBeNull();
  });

  it("every normally-on-sale concert in the fixture has null soldOut/cancelled hints — never guessed from an unrecognized status", () => {
    for (const e of events) {
      expect(e.soldOutHint).toBeNull();
      expect(e.cancelledHint).toBeNull();
    }
  });

  it("recognizes an explicit 'Udsolgt' (sold out) ticket_status", () => {
    const json = JSON.stringify([
      {
        title: "Test Show",
        link: "https://pumpehuset.dk/koncerter/test-show/",
        genre: "Elektronisk",
        ticket_status: "Udsolgt",
      },
    ]);
    const [e] = parsePumpehusetConcertsJson(json);
    expect(e.soldOutHint).toBe(true);
    expect(e.cancelledHint).toBeNull();
  });

  it("recognizes an explicit 'Aflyst' (cancelled) ticket_status", () => {
    const json = JSON.stringify([
      {
        title: "Test Show",
        link: "https://pumpehuset.dk/koncerter/test-show/",
        genre: "Elektronisk",
        ticket_status: "Aflyst",
      },
    ]);
    const [e] = parsePumpehusetConcertsJson(json);
    expect(e.cancelledHint).toBe(true);
    expect(e.soldOutHint).toBeNull();
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
        // Deliberately unfiltered (multi-genre completeness fix): requesting
        // genres=Elektronisk server-side would silently re-introduce the
        // Shrek Rave root cause — see fetchAllConcerts's doc comment.
        expect(body).toContain("genres=");
        expect(body).not.toContain("genres=Elektronisk");
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
      if (urlStr === "https://pumpehuset.dk/koncerter/byhaven-afro-sundown-fest/") {
        return new Response(AFRO_SUNDOWN_DETAIL_HTML, { status: 200 });
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

    // Pumpehuset information-gap fix (data-quality follow-up review): the
    // detail page's own written description is read as real evidence for
    // genre resolution below — WITCHZ's real page explicitly says his own
    // sound is electronic ("elektroniske lyd" / "mørk electronica"). But
    // that text is Danish (editorial-description follow-up: English-language
    // guard), so it's never shown as the public description — only used
    // internally as genre evidence.
    expect(witchz!.description).toBeNull();
    expect(witchz!.genreHint).toBe("electronic-other"); // no NAMED specific subgenre — the assertion signal (relevance.ts) is what carries it, not genre precision
    expect(witchz!.genreConfidenceHint).toBe("high");

    // Byhaven Love.Rave's fetch_concerts JSON carried no support_bands data
    // at all, so this adapter previously extracted only the promoter/event
    // name itself as the "artist". The real detail page's own body text
    // both names the genre ("house-leverandørerne") and states a real
    // "Line-Up:" list this adapter now also extracts.
    expect(byhaven!.genreHint).toBe("house");
    expect(byhaven!.genreConfidenceHint).toBe("high");
    expect(byhaven!.artists).toEqual(["Leeni & Danilo Kupfernagel", "Lush", "NILU"]);

    // Editorial-description follow-up: real Byhaven copy is Danish, so the
    // English-language guard suppresses it entirely here regardless of the
    // lineup-duplication fix (see the dedicated lineup-range-exclusion unit
    // test below, using English text, for that mechanism in isolation).
    expect(byhaven!.description).toBeNull();

    // Afro Sundown Fest data-quality gap fix (Round 5): the fetch_concerts
    // JSON carries no support_bands data (support_bands: false), so the
    // only "artist" this adapter previously extracted was the generic
    // title-derived placeholder "Afro Sundown Fest". The real detail page's
    // own body states its lineup as "DJ lineup:" followed by one
    // comma-separated line — a shape the original extractor didn't
    // recognize (a "DJ "-prefixed marker, and every name on one line rather
    // than one per line) — now correctly parsed into the real per-artist
    // lineup, keeping the combined act "Jayce + MC Mazi" as one entry.
    const afroSundown = results.find((e) => e.officialEventUrl === "https://pumpehuset.dk/koncerter/byhaven-afro-sundown-fest/");
    expect(afroSundown!.artists).toEqual(["Bullet", "Panda", "Sule", "Xzyl", "Ynxg Irie", "Jayce + MC Mazi"]);
    // Also real Danish copy — suppressed by the same English-language guard.
    expect(afroSundown!.description).toBeNull();
  });
});

describe("createPumpehusetAdapter — multi-genre completeness fix (Shrek Rave, first-party source completeness audit 2026-08-30)", () => {
  it("discovers a real event whose listing genre isn't Elektronisk by confirming the tag on its own detail page (Shrek Rave, listed genre 'Pop')", async () => {
    const concertsJson = JSON.stringify([
      {
        title: "Shrek Rave",
        link: "https://pumpehuset.dk/koncerter/shrek-rave/",
        genre: "Pop", // real, live listing value — Pop is the primary GTM genre, not Elektronisk
      },
    ]);
    const fetchImpl = async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr === PUMPEHUSET_AJAX_URL) {
        return new Response(concertsJson, { status: 200 });
      }
      if (urlStr === "https://pumpehuset.dk/koncerter/shrek-rave/") {
        return new Response(SHREK_RAVE_DETAIL_HTML, { status: 200 });
      }
      return new Response("<html></html>", { status: 404 });
    };

    const adapter = createPumpehusetAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const results = await adapter.fetchCandidates();

    expect(results.length).toBe(1);
    const shrekRave = results[0];
    expect(shrekRave.title).toBe("Shrek Rave");
    expect(shrekRave.startDatetime).toBe("2026-08-28T19:00:00.000Z"); // 21:00 CEST (UTC+2), "Showet starter"
    // Confirmed electronic-relevant from the detail page's own real tag list
    // (Pop, Indie, Elektronisk — see extractGenreTags), not the listing's
    // single misleading "Pop" field. No specific subgenre keyword appears in
    // this event's title/description, so it lands at the same
    // official-source-metadata floor as any other Elektronisk-tagged show.
    expect(shrekRave.genreHint).toBe("electronic-other");
    expect(shrekRave.genreConfidenceHint).toBe("high");
  });

  it("drops a candidate whose detail page never confirms Elektronisk either — the fix does not flood non-electronic shows into the pipeline", async () => {
    const concertsJson = JSON.stringify([
      {
        title: "Some Metal Show",
        link: "https://pumpehuset.dk/koncerter/some-metal-show/",
        genre: "Metal",
      },
    ]);
    const fetchImpl = async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr === PUMPEHUSET_AJAX_URL) {
        return new Response(concertsJson, { status: 200 });
      }
      if (urlStr === "https://pumpehuset.dk/koncerter/some-metal-show/") {
        // A real detail page for a genuinely non-electronic show: its own
        // /program?genre= links never include Elektronisk.
        return new Response('<a href="/program?genre=Metal">Metal</a><a href="/program?genre=Rock">Rock</a>', { status: 200 });
      }
      return new Response("<html></html>", { status: 404 });
    };

    const adapter = createPumpehusetAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const results = await adapter.fetchCandidates();

    expect(results).toEqual([]);
  });

  it("drops a candidate whose detail page fetch fails outright and was never confirmed electronic at listing time", async () => {
    const concertsJson = JSON.stringify([
      {
        title: "Unreachable Show",
        link: "https://pumpehuset.dk/koncerter/unreachable-show/",
        genre: "Pop",
      },
    ]);
    const fetchImpl = async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr === PUMPEHUSET_AJAX_URL) {
        return new Response(concertsJson, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    const adapter = createPumpehusetAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const results = await adapter.fetchCandidates();

    expect(results).toEqual([]);
  });
});

describe("extractLineupFromBodyLines — consumedRange exclusion (editorial-description follow-up)", () => {
  it("reports the exact line range a one-name-per-line list occupies, so it can be excluded from the stored description", () => {
    const lines = [
      "An English test night with a great lineup, entirely in English for this test.",
      "Line-Up:",
      "Artist One",
      "Artist Two",
      "Artist Three",
      "Tickets purchased in advance remain valid until 00:30.",
    ];
    const { artists, consumedRange } = extractLineupFromBodyLines(lines);
    expect(artists).toEqual(["Artist One", "Artist Two", "Artist Three"]);
    expect(consumedRange).toEqual([1, 5]);

    // Excluding exactly that range keeps the intro AND the trailing prose,
    // dropping only the marker + name lines that became `artists`.
    const withoutLineup = [...lines.slice(0, consumedRange![0]), ...lines.slice(consumedRange![1])];
    expect(withoutLineup).toEqual([
      "An English test night with a great lineup, entirely in English for this test.",
      "Tickets purchased in advance remain valid until 00:30.",
    ]);
  });

  it("reports a 2-line range for the single-line comma-separated shape", () => {
    const lines = ["Intro text.", "DJ lineup:", "Artist One, Artist Two, Artist Three"];
    const { artists, consumedRange } = extractLineupFromBodyLines(lines);
    expect(artists).toEqual(["Artist One", "Artist Two", "Artist Three"]);
    expect(consumedRange).toEqual([1, 3]);
  });

  it("returns a null range when there's no Line-Up marker at all", () => {
    expect(extractLineupFromBodyLines(["Just some prose.", "No marker here."])).toEqual({ artists: [], consumedRange: null });
  });
});

describe("isLikelyDanish — English-language guard (editorial-description follow-up)", () => {
  it("treats real Danish prose (æ/ø/å) as Danish", () => {
    expect(isLikelyDanish("Vi åbner kl. 15.00 og baren bugner af lækre øl.")).toBe(true);
    expect(isLikelyDanish("Forbered dig på årets største dansefest med kæmpe stemning.")).toBe(true);
  });

  it("treats plain English prose as not Danish", () => {
    expect(isLikelyDanish("Doors open at 21:00 and the lineup is stacked with techno DJs.")).toBe(false);
  });

  it("is a narrow heuristic, not full language detection — English text is only flagged if it happens to contain æ/ø/å", () => {
    expect(isLikelyDanish("A short quote with no special characters at all.")).toBe(false);
  });
});
