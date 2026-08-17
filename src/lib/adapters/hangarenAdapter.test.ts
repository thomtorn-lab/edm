import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseHangarenEventsHtml, createHangarenAdapter, HANGAREN_EVENTS_URL } from "./hangarenAdapter";

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
    expect(kander!.description).toContain("Hard Bounce, Schranz and Techno");
  });

  it("credits an explicit genre statement in the venue's own bio as high-confidence (official-description tier), not the generic medium-confidence fallback", () => {
    const kander = events.find((e) => e.title.startsWith("Kander"));
    expect(kander!.genreHint).toBe("techno");
    expect(kander!.genreConfidenceHint).toBe("high");
  });

  it("searches the FULL bio for a genre keyword, not just the truncated 600-char stored description", () => {
    // Daria's bio states "the fastest-rising names in the techno scene" well past
    // character 600 — the stored `description` is truncated for display, but
    // genre classification must not silently miss evidence past that cutoff.
    const daria = events.find((e) => e.title.startsWith("Daria Kolosova"));
    expect(daria!.description!.length).toBeLessThanOrEqual(600);
    expect(daria!.description).not.toContain("techno");
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

  it("never throws on the whole batch even though individual events vary wildly in structure", () => {
    for (const e of events) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.sourceId).toBe("src-hangaren");
      expect(e.venueName).toBe("Hangaren");
    }
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
