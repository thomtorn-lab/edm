import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseHangarenEventsHtml, createHangarenAdapter, HANGAREN_EVENTS_URL, truncateAtBoundary } from "./hangarenAdapter";
import { effectiveEndInstant } from "../datetime";

/**
 * `hangaren-events.html` is a real, unmodified recording of
 * https://www.hangaren.dk/events (fetched 2026-08-14, after confirming the
 * domain reachable — see also src/lib/adapters/hangarenAdapter.ts's header
 * comment for the evaluation that led to picking this source). This is not
 * a fabricated fixture: every field asserted below is exactly what a real
 * fetch against the live source returns at that time.
 */
const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "hangaren-events.html");
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf-8");

describe("parseHangarenEventsHtml", () => {
  const events = parseHangarenEventsHtml(FIXTURE_HTML);

  it("parses every real upcoming event on the page, skipping the past-events archive", () => {
    expect(events).toHaveLength(19);
    expect(FIXTURE_HTML).not.toContain("eventlist-event--past");
  });

  it("extracts an overnight event's start/end via the Google Calendar UTC instant, not text parsing", () => {
    const gerdJanson = events.find((e) => e.title.startsWith("Gerd Janson"));
    expect(gerdJanson).toBeDefined();
    expect(gerdJanson!.startDatetime).toBe("2026-08-14T18:00:00.000Z"); // 20:00 CEST
    expect(gerdJanson!.endDatetime).toBe("2026-08-15T04:00:00.000Z"); // 06:00 CEST next day
    expect(gerdJanson!.artists).toEqual(["Gerd Janson (Running Back)", "Harrison Heat", "NAT", "Tamara", "DJ Lovecatt", "Roussakis"]);
    expect(gerdJanson!.ticketUrl).toBe("https://ra.co/events/2461521");
    expect(gerdJanson!.residentAdvisorUrl).toBe("https://ra.co/events/2461521");
    expect(gerdJanson!.officialEventUrl).toBe("https://www.hangaren.dk/events/20268/0814/gerdjanson");
    expect(gerdJanson!.venueName).toBe("Hangaren");
    expect(gerdJanson!.imageUrl).toMatch(/^https:\/\/images\.squarespace-cdn\.com\//);
  });

  it("correctly identifies a same-day (non-overnight) event", () => {
    const sundayPsy = events.find((e) => e.title.includes("Agata, Neri J"));
    expect(sundayPsy).toBeDefined();
    expect(sundayPsy!.startDatetime).toBe("2026-08-23T14:00:00.000Z");
    expect(sundayPsy!.endDatetime).toBe("2026-08-23T21:59:00.000Z");
    // Same calendar date on both ends (Copenhagen local) — not overnight.
    expect(sundayPsy!.startDatetime!.slice(0, 10)).toBe(sundayPsy!.endDatetime!.slice(0, 10));
  });

  it("extracts lineup from the official description text, not a title guess, when available", () => {
    const kander = events.find((e) => e.title.startsWith("Kander"));
    expect(kander!.artists).toEqual(["Kander", "Kardinal Bertram", "Uber Knast", "Mëtro", "Elliott Taguchi", "Holtz"]);
  });

  it("never renders the venue's own bio text as the public description (editorial-description follow-up: generic artist biography, not event-specific)", () => {
    for (const e of events) {
      expect(e.description).toBeNull();
    }
  });

  it("credits an explicit genre statement in the venue's own bio as high-confidence (official-description tier), not the generic medium-confidence fallback", () => {
    const kander = events.find((e) => e.title.startsWith("Kander"));
    expect(kander!.genreHint).toBe("techno");
    expect(kander!.genreConfidenceHint).toBe("high");
  });

  it("searches the FULL bio for a genre keyword even though the bio itself is never publicly shown", () => {
    // Daria's bio states "the fastest-rising names in the techno scene" well past
    // character 600 — genre classification reads the full bio text as evidence
    // even though none of that text is ever rendered as a public description.
    const daria = events.find((e) => e.title.startsWith("Daria Kolosova"));
    expect(daria!.description).toBeNull();
    expect(daria!.genreHint).toBe("techno");
    expect(daria!.genreConfidenceHint).toBe("high");
  });

  it("leaves genreHint null when the bio genuinely never states a genre — never a guess dressed up as evidence", () => {
    const gerdJanson = events.find((e) => e.title.startsWith("Gerd Janson"));
    expect(gerdJanson!.genreHint).toBeNull();
    expect(gerdJanson!.genreConfidenceHint).toBeNull();
  });

  it("falls back to a Billetto ticket link when no Resident Advisor link is present", () => {
    const possessed = events.find((e) => e.title.includes("POSSESSED"));
    expect(possessed).toBeDefined();
    expect(possessed!.ticketUrl).toBe("https://billetto.dk/e/chapter-ii-possessed-billetter-1968565");
    expect(possessed!.residentAdvisorUrl).toBeNull();
  });

  it("strips embedded raw SoundCloud URLs out of lineup entries, keeping the real artist names (Arcanum Collective: POSSESSED)", () => {
    const possessed = events.find((e) => e.title.includes("POSSESSED"));
    expect(possessed).toBeDefined();
    expect(possessed!.artists).toEqual(
      expect.arrayContaining(["Kromagon", "Oxyflux", "Shenanigan", "Freya Rose", "Mental Projection", "Krypto"]),
    );
    for (const artist of possessed!.artists) {
      expect(artist).not.toMatch(/https?:\/\//);
    }
  });

  it("never throws on the whole batch even though individual events vary wildly in structure", () => {
    for (const e of events) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.sourceId).toBe("src-hangaren");
      expect(e.venueName).toBe("Hangaren");
    }
  });
});

describe("known real-source anomaly — KARRUSEL AFTERPARTY end date, now caught generically (public-visibility follow-up, 2026-08-29; recurrence confirmed and closed 2026-09-04)", () => {
  const events = parseHangarenEventsHtml(FIXTURE_HTML);

  // Investigated after a real report that a Fri 28 Aug, 12:00-21:00 event
  // (same-day, not overnight) was still publicly visible on 29 Aug, traced
  // to this exact listing's Google Calendar export metadata
  // (dates=20260828T100000Z/20260829T190000Z) stating an anomalous ~33-hour
  // span. Then, on 2026-09-04, the IMMEDIATELY FOLLOWING instance of this
  // same recurring slot ("TOCCORORO Meilgaarden WE.LL", Sat 29 Aug)
  // independently exhibited the identical shape — confirming this is a
  // recurring Hangaren-side data-entry issue on this specific recurring
  // slot, not a one-off, and that a per-event manual correction alone
  // doesn't close the ingestion problem for the NEXT occurrence.
  //
  // Both instances of the bad listing also carry a distinguishing structural
  // signature no legitimate Hangaren listing has: their own visible copy
  // includes a disambiguating "note: the event starts at HH(AM|PM)
  // (DAY DD.MM)" line whose stated real day is the gcal link's END day, not
  // its START day — i.e. Hangaren's own source data contradicts itself. See
  // hasStartDateNoteMismatch in hangarenAdapter.ts. This is deliberately NOT
  // a duration-based heuristic: real Production data has a genuine ~28h
  // Hangaren anniversary event and a genuine ~31h Billetto multi-day
  // festival, both close to or above this ~33h error's own length, so no
  // fixed duration threshold could separate real from erroneous — see the
  // event-integrity diagnostic's audit and datetime.test.ts's matching
  // "hasTrustworthyEndDatetime" suite. The adapter now nulls the untrusted
  // end automatically instead of carrying it through; the shared no-end-time
  // fallback (src/lib/datetime.ts) then determines public expiry.
  it("nulls the untrustworthy end for the Aug 28 Kyle Starkey instance, leaving start untouched", () => {
    const kyleStarkey = events.find((e) => e.title.startsWith("KARRUSEL AFTERPARTY: Kyle Starkey"));
    expect(kyleStarkey).toBeDefined();
    expect(kyleStarkey!.startDatetime).toBe("2026-08-28T10:00:00.000Z"); // not second-guessed — see hasStartDateNoteMismatch's doc comment
    expect(kyleStarkey!.endDatetime).toBeNull();
  });

  it("nulls the untrustworthy end for the following Aug 29 TOCCORORO instance too — the recurrence is caught generically, not by hardcoding this event", () => {
    const toccororo = events.find((e) => e.title.startsWith("KARRUSEL AFTERPARTY: TOCCORORO"));
    expect(toccororo).toBeDefined();
    expect(toccororo!.startDatetime).toBe("2026-08-29T10:00:00.000Z");
    expect(toccororo!.endDatetime).toBeNull();
  });

  it("a synthetic future occurrence of the same structural defect (different title/dates entirely) is rejected automatically, proving this isn't keyed to a specific event", () => {
    const syntheticBlock = `<article class="eventlist-event eventlist-event--upcoming">
      <h1 class="eventlist-title"><a href="/events/fake" class="eventlist-title-link">KARRUSEL AFTERPARTY: Future Artist</a></h1>
      <a href="http://www.google.com/calendar/event?action=TEMPLATE&text=Future&dates=20271105T100000Z/20271106T190000Z" class="eventlist-meta-export-google">Google Calendar</a>
      <div class="sqs-html-content"><p><strong>05.11.2027</strong><br><em>note: the event starts at 3AM (SAT 06.11)</em></p></div>
    </article>`;
    const synthetic = parseHangarenEventsHtml(syntheticBlock);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].startDatetime).toBe("2027-11-05T10:00:00.000Z");
    expect(synthetic[0].endDatetime).toBeNull();
  });

  it("the effective public-expiry fallback for a nulled-end TOCCORORO instance is the normal 06:00-next-day rule, not the bogus 33h span", () => {
    const toccororo = events.find((e) => e.title.startsWith("KARRUSEL AFTERPARTY: TOCCORORO"))!;
    const end = effectiveEndInstant({ startDatetime: toccororo.startDatetime!, endDatetime: toccororo.endDatetime });
    // Sat 29 Aug 12:00 CEST start -> nightlife day Aug 29 -> fallback 06:00 Aug 30 CEST.
    expect(end.toISOString()).toBe(new Date("2026-08-30T06:00:00+02:00").toISOString());
  });

  it("a normal same-day KARRUSEL instance (Aug 27 SKALA, no note present) is left completely untouched", () => {
    const skala = events.find((e) => e.title.startsWith("KARRUSEL AFTERPARTY: SKALA"));
    expect(skala).toBeDefined();
    expect(skala!.startDatetime!.slice(0, 10)).toBe(skala!.endDatetime!.slice(0, 10));
  });

  it("a legitimate overnight, non-KARRUSEL Hangaren event (crosses midnight, no note present) keeps its real end", () => {
    const gerdJanson = events.find((e) => e.title.startsWith("Gerd Janson"));
    expect(gerdJanson).toBeDefined();
    expect(gerdJanson!.startDatetime).toBe("2026-08-14T18:00:00.000Z");
    expect(gerdJanson!.endDatetime).toBe("2026-08-15T04:00:00.000Z"); // legitimate 10h overnight span, untouched
  });
});

describe("createHangarenAdapter", () => {
  it("fetches the plain (robots.txt-permitted) /events URL and parses the response", async () => {
    const fetchImpl = async (url: string | URL) => {
      expect(String(url)).toBe(HANGAREN_EVENTS_URL);
      expect(String(url)).not.toContain("format=json");
      expect(String(url)).not.toContain("format=ical");
      return new Response(FIXTURE_HTML, { status: 200 });
    };
    const adapter = createHangarenAdapter(fetchImpl as unknown as typeof fetch);
    const candidates = await adapter.fetchCandidates();
    expect(candidates).toHaveLength(19);
  });

  it("retries once on a 5xx before giving up", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 1 ? new Response("", { status: 503 }) : new Response(FIXTURE_HTML, { status: 200 });
    };
    const adapter = createHangarenAdapter(fetchImpl as unknown as typeof fetch, 0);
    const candidates = await adapter.fetchCandidates();
    expect(calls).toBe(2);
    expect(candidates).toHaveLength(19);
  });

  it("does not retry a 4xx — it won't fix itself", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("", { status: 404 });
    };
    const adapter = createHangarenAdapter(fetchImpl as unknown as typeof fetch, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });

  it("throws a descriptive error on a non-OK response after exhausting retries (source failure, not zero-events)", async () => {
    const fetchImpl = async () => new Response("", { status: 503 });
    const adapter = createHangarenAdapter(fetchImpl as unknown as typeof fetch, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/503/);
  });

  it("throws a descriptive error on a network failure after exhausting retries", async () => {
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const adapter = createHangarenAdapter(fetchImpl as unknown as typeof fetch, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/Hangaren fetch failed/);
  });
});

describe("truncateAtBoundary — no mid-word/mid-sentence cuts (editorial-description follow-up)", () => {
  it("cuts at the last complete sentence instead of a bare 600-char slice mid-word (real Production bio, Daria Kolosova)", () => {
    // Real, unmodified Production description text (as of this task's live audit)
    // that a bare `.slice(0, 600)` cut to a dangling "...Today, ".
    const realBio =
      'Daria Kolosova: Daria was born in the small town of Lutugino in eastern Ukraine. Her love for music was instilled by her father, and her devotion to electronic music began at the age of nine when she first heard "Diesel Power" by The Prodigy. Her passion grew even stronger when her mother sent her to music school, where she studied piano. Drawn to DJing from an early age, Daria embraced her vocation, which led to her first performance in February 2010. Following her debut, she continued performing actively in clubs across Luhansk and other cities, while also organizing her own parties. Today, she is';
    const result = truncateAtBoundary(realBio, 600);
    expect(result.endsWith("Today,")).toBe(false);
    expect(result.endsWith(".")).toBe(true);
    expect(result).toContain("while also organizing her own parties.");
  });

  it("returns the text unchanged when already under the limit", () => {
    expect(truncateAtBoundary("Short bio.", 600)).toBe("Short bio.");
  });

  it("falls back to the last word boundary when no sentence end exists near the limit", () => {
    const noSentences = "word ".repeat(200).trim(); // 999 chars, no punctuation at all
    const result = truncateAtBoundary(noSentences, 600);
    expect(result.length).toBeLessThanOrEqual(600);
    expect(result.endsWith("word")).toBe(true); // never a dangling partial word
  });
});
