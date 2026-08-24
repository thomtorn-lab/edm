import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseAliceProgramHtml,
  parseAliceEventDetailHtml,
  parseAliceTitle,
  createAliceAdapter,
  ALICE_PROGRAM_URL,
  type AliceProgramEntry,
} from "./aliceAdapter";

/**
 * All fixtures are real, unmodified pages captured directly from ALICE's
 * public website (alicecph.com) via the sanctioned Inspect Source
 * reachability tool (source-onboarding audit, venue-source ranking task) —
 * not fabricated. alice-home.html is the live homepage's own upcoming-events
 * grid (the venue's real "now" programme — the /en/event/ archive page
 * returns old, already-past events with no working "upcoming only" filter,
 * so the homepage is used instead). The three detail-page fixtures were
 * chosen to exercise exactly the classification cases that matter: a
 * genuinely electronic artist whose bio names a specific subgenre keyword
 * (Dengue Dengue Dengue — techno), a mixed-genre act whose bio only makes a
 * generic "electronic music" mention with no specific subgenre (Aïta Mon
 * Amour + 3Phaz), and a genuinely non-electronic artist (Beverly
 * Glenn-Copeland, an ambient/folk composer).
 */
const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
const HOME_HTML = readFileSync(path.join(FIXTURES_DIR, "alice-home.html"), "utf-8");
const DENGUE_HTML = readFileSync(path.join(FIXTURES_DIR, "alice-event-dengue-dengue-dengue-pe.html"), "utf-8");
const AITA_HTML = readFileSync(path.join(FIXTURES_DIR, "alice-event-aita-mon-amour-ma.html"), "utf-8");
const BEVERLY_HTML = readFileSync(path.join(FIXTURES_DIR, "alice-event-beverly-glenn-copeland-ca.html"), "utf-8");

describe("parseAliceTitle", () => {
  it("splits a single-artist title with a country-code superscript", () => {
    expect(parseAliceTitle("Dengue Dengue Dengue <sup>PE</sup>")).toEqual({
      title: "Dengue Dengue Dengue PE",
      artists: ["Dengue Dengue Dengue PE"],
    });
  });

  it("splits a multi-artist bill on '+' into separate artists, preserving each artist's own country code", () => {
    expect(parseAliceTitle("Aïta Mon Amour <sup>MA</sup> + 3Phaz <sup>EG</sup>")).toEqual({
      title: "Aïta Mon Amour MA + 3Phaz EG",
      artists: ["Aïta Mon Amour MA", "3Phaz EG"],
    });
  });

  it("handles a parenthesised country-code convention too", () => {
    expect(parseAliceTitle("Faratuben <sup>(ML/DK)</sup>")).toEqual({
      title: "Faratuben ML/DK",
      artists: ["Faratuben ML/DK"],
    });
  });
});

describe("parseAliceProgramHtml", () => {
  const entries = parseAliceProgramHtml(HOME_HTML);

  it("discovers every real upcoming event on the homepage's own programme grid", () => {
    expect(entries.length).toBe(38);
  });

  it("extracts title, artists, detail URL, teaser, image URL and date text for a plain single-artist entry", () => {
    const dengue = entries.find((e) => e.detailUrl.includes("dengue-dengue-dengue-pe"));
    expect(dengue).toEqual<AliceProgramEntry>({
      title: "Dengue Dengue Dengue PE",
      artists: ["Dengue Dengue Dengue PE"],
      detailUrl: "https://alicecph.com/en/event/dengue-dengue-dengue-pe/",
      teaser: "A psychedelic tropical bass duo lures audiences into a colorful and futuristic fever dream of a concert experience",
      imageUrl:
        "https://alicecph.com/content/uploads/2026/04/01-DNGDNGDNG-Photo-by-Alejandro-Loayza-Grisi-_-Masks-by-Twee-Muizen-680x440.jpg",
      dateText: "Saturday _05.09.26",
    });
  });

  it("splits a real multi-artist bill into separate artists", () => {
    const aita = entries.find((e) => e.detailUrl.includes("aita-mon-amour-ma"));
    expect(aita?.title).toBe("Aïta Mon Amour MA + 3Phaz EG");
    expect(aita?.artists).toEqual(["Aïta Mon Amour MA", "3Phaz EG"]);
  });

  it("keeps trailing status text (e.g. an age-advisory note) in dateText without corrupting date parsing later", () => {
    const aita = entries.find((e) => e.detailUrl.includes("aita-mon-amour-ma"));
    expect(aita?.dateText).toBe("Friday _04.09.26 · Advisory");
  });

  it("never produces two entries pointing at the same detail page (adapter-level duplicate guard)", () => {
    const urls = entries.map((e) => e.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("parseAliceEventDetailHtml — specific-subgenre keyword in the event's own description (Dengue Dengue Dengue)", () => {
  const entry: AliceProgramEntry = {
    title: "Dengue Dengue Dengue PE",
    artists: ["Dengue Dengue Dengue PE"],
    detailUrl: "https://alicecph.com/en/event/dengue-dengue-dengue-pe/",
    teaser: "A psychedelic tropical bass duo…",
    imageUrl: "https://alicecph.com/content/uploads/2026/04/01-DNGDNGDNG.jpg",
    dateText: "Saturday _05.09.26",
  };
  const event = parseAliceEventDetailHtml(DENGUE_HTML, entry);

  it("trusts the listing page's own title/artists rather than re-deriving them (the detail page's only <h1> is the site-wide logo link, not the event title)", () => {
    expect(event.title).toBe("Dengue Dengue Dengue PE");
    expect(event.artists).toEqual(["Dengue Dengue Dengue PE"]);
  });

  it("parses doors time as the real start, in Copenhagen local time converted to UTC", () => {
    expect(event.startDatetime).toBe("2026-09-05T18:00:00.000Z"); // 20:00 CEST
    expect(event.endDatetime).toBeNull();
  });

  it("extracts the real ticket URL and lowest DKK price", () => {
    expect(event.ticketUrl).toBe("https://billet.alicecph.com/da/buyingflow/tickets/33869/105134/");
    expect(event.priceFrom).toBe(175);
  });

  it("extracts a real, event-specific description", () => {
    expect(event.description).toContain("Dengue Dengue Dengue");
    expect(event.description).toContain("psychedelic cumbia, dub, salsa, footwork, and techno");
  });

  it("credits the specific subgenre keyword ('techno') from the event's own description at high (official-description) confidence", () => {
    expect(event.genreHint).toBe("techno");
    expect(event.genreConfidenceHint).toBe("high");
  });
});

describe("parseAliceEventDetailHtml — generic 'electronic' mention only, no specific subgenre (Aïta Mon Amour + 3Phaz)", () => {
  const entry: AliceProgramEntry = {
    title: "Aïta Mon Amour MA + 3Phaz EG",
    artists: ["Aïta Mon Amour MA", "3Phaz EG"],
    detailUrl: "https://alicecph.com/en/event/aita-mon-amour-ma/",
    teaser: "Ancient Moroccan blues traditions and pulsating electronics…",
    imageUrl: "https://alicecph.com/content/uploads/2026/05/aita.jpg",
    dateText: "Friday _04.09.26 · Advisory",
  };
  const event = parseAliceEventDetailHtml(AITA_HTML, entry);

  it("keeps trailing status text out of the parsed date and still resolves the correct day", () => {
    expect(event.startDatetime).toBe("2026-09-04T18:00:00.000Z"); // 20:00 CEST
  });

  it("does NOT credit the false-positive 'trance-inducing' (adjective) as the Trance genre", () => {
    expect(event.genreHint).not.toBe("trance");
  });

  it("credits the explicit but non-specific 'electronic music' mention as electronic-other, same tier/rule as poolenAdapter.ts", () => {
    expect(event.genreHint).toBe("electronic-other");
    expect(event.genreConfidenceHint).toBe("high");
  });
});

describe("parseAliceEventDetailHtml — genuinely non-electronic-club artist (Beverly Glenn-Copeland)", () => {
  const entry: AliceProgramEntry = {
    title: "Beverly Glenn-Copeland CA",
    artists: ["Beverly Glenn-Copeland CA"],
    detailUrl: "https://alicecph.com/en/event/beverly-glenn-copeland-ca/",
    teaser: "Legendary composer…",
    imageUrl: "https://alicecph.com/content/uploads/2026/03/beverly.jpg",
    dateText: "Monday _07.09.26",
  };
  const event = parseAliceEventDetailHtml(BEVERLY_HTML, entry);

  it("extracts a real external ticket URL when ALICE co-presents at another venue (Bellevue Theatre) instead of its own ticket shop", () => {
    expect(event.ticketUrl).toBe("https://www.bellevueteatret.dk/forestillinger/beverly-glenn-copeland");
  });

  it("never invents a price when none is stated", () => {
    expect(event.priceFrom).toBeNull();
  });
});

describe("parseAliceEventDetailHtml — malformed input", () => {
  it("throws when the date/ticket-info block is missing entirely", () => {
    const entry: AliceProgramEntry = {
      title: "Some Artist",
      artists: ["Some Artist"],
      detailUrl: "https://alicecph.com/en/event/some-artist/",
      teaser: null,
      imageUrl: null,
      dateText: null,
    };
    expect(() => parseAliceEventDetailHtml("<html><body>No info here</body></html>", entry)).toThrow();
  });
});

describe("createAliceAdapter", () => {
  it("fetches the homepage then every listed event's detail page, skipping a single failing event without failing the whole sync", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === ALICE_PROGRAM_URL) {
        return { ok: true, text: async () => HOME_HTML } as Response;
      }
      if (url.includes("dengue-dengue-dengue-pe")) {
        return { ok: true, text: async () => DENGUE_HTML } as Response;
      }
      // Every other real event's detail page fails to fetch in this test —
      // the adapter must skip each one and still return the events that did work.
      return { ok: false, status: 500 } as Response;
    });

    const adapter = createAliceAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const results = await adapter.fetchCandidates();

    expect(results.some((r) => r.officialEventUrl?.includes("dengue-dengue-dengue-pe"))).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(38); // every other detail fetch failed and was skipped
    expect(fetchImpl).toHaveBeenCalledWith(ALICE_PROGRAM_URL, expect.anything());
  });

  it("throws when the homepage itself fails to fetch (a genuine source failure, not a single-event skip)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const adapter = createAliceAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow();
  });
});
