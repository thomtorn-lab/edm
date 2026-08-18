import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePoolenProgramHtml,
  parsePoolenEventDetailHtml,
  createPoolenAdapter,
  POOLEN_PROGRAM_URL,
  type PoolenProgramEntry,
} from "./poolenAdapter";

/**
 * All four fixtures are real, unmodified pages saved directly from Poolen's
 * public website (poolen.dk) and supplied by the user after this session's
 * own network egress was confirmed unable to reach the domain — not
 * fabricated. poolen-program.html is the live programme listing;
 * poolen-event-electronic.html (Hernan Cattaneo), poolen-event-non-electronic.html
 * (Swae Lee) and poolen-event-outside.html (Omar S, on Poolen's "Outside"
 * extension) are three real per-event detail pages chosen to exercise
 * exactly the classification cases that matter: a genuinely electronic
 * artist whose own bio never uses a specific subgenre word, a genuinely
 * non-electronic (hip-hop/pop) artist, and an explicit techno/house event
 * on the venue's outdoor sub-area.
 */
const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
const PROGRAM_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-program.html"), "utf-8");
const ELECTRONIC_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-electronic.html"), "utf-8");
const NON_ELECTRONIC_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-non-electronic.html"), "utf-8");
const OUTSIDE_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-outside.html"), "utf-8");

describe("parsePoolenProgramHtml", () => {
  const entries = parsePoolenProgramHtml(PROGRAM_HTML);

  it("discovers every real event teaser on the programme page", () => {
    expect(entries.length).toBe(26);
  });

  it("extracts title, detail URL, ticket URL, image URL and date text for a plain entry", () => {
    const bingo = entries.find((e) => e.title === "Bingo Loco");
    expect(bingo).toEqual<PoolenProgramEntry>({
      title: "Bingo Loco",
      detailUrl: "https://poolen.dk/da/koncerter/bingo-loco-7/",
      ticketUrl: "https://eu.bingoloco.com/copenhagen",
      imageUrl: "https://poolen.dk/wp-content/uploads/Bingo-Loco-2.jpg",
      dateText: "22 august 2026",
    });
  });

  it("handles an entry with a support-lineup label without corrupting title/date extraction (skips the weekday label correctly)", () => {
    const teletech = entries.find((e) => e.title === "Teletech");
    expect(teletech?.dateText).toBe("18 december 2026");
    expect(teletech?.detailUrl).toBe("https://poolen.dk/da/koncerter/teletech-2/");
  });

  it("discovers the 'Outside' styled entry like any other — no special-cased structure", () => {
    const jasho = entries.find((e) => e.detailUrl.includes("jasho-club"));
    expect(jasho?.title).toBe("Jasho Club vol. 5: The Comeback – Outside");
    expect(jasho?.dateText).toBe("12 september 2026");
  });

  it("decodes HTML entities in titles (e.g. Ca7riel y Paco Amoroso's & and Kevin de Vries & Massano)", () => {
    expect(entries.some((e) => e.title === "Kevin de Vries & Massano")).toBe(true);
  });

  it("never produces two entries pointing at the same detail page (adapter-level duplicate guard)", () => {
    const urls = entries.map((e) => e.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("parsePoolenEventDetailHtml — electronic event with no specific-subgenre keyword", () => {
  const entry: PoolenProgramEntry = {
    title: "Hernan Cattaneo",
    detailUrl: "https://poolen.dk/da/koncerter/hernan-cattaneo/",
    ticketUrl: null,
    imageUrl: "https://poolen.dk/wp-content/uploads/Hernan-Cattaneo.jpg",
    dateText: null,
  };
  const event = parsePoolenEventDetailHtml(ELECTRONIC_HTML, entry);

  it("parses title, venue and provenance", () => {
    expect(event.title).toBe("Hernan Cattaneo");
    expect(event.venueName).toBe("Poolen");
    expect(event.sourceId).toBe("src-poolen");
    expect(event.officialEventUrl).toBe(entry.detailUrl);
  });

  it("converts the doors-time date/time to the correct Copenhagen-local UTC instant (18 Jul 2026, 19:00 CEST)", () => {
    expect(event.startDatetime).toBe("2026-07-18T17:00:00.000Z"); // 19:00 CEST = UTC+2
    expect(event.endDatetime).toBeNull(); // never stated on this site — never invented
  });

  it("extracts price and the detail page's own ticket link (pretix), not a guessed one", () => {
    expect(event.priceFrom).toBe(250);
    expect(event.ticketUrl).toBe("https://pretix.eu/Distriktsouth/DS2026/");
  });

  it("builds the artists list from the headliner plus support acts", () => {
    expect(event.artists).toEqual(["Hernan Cattaneo", "Tim Andresen"]);
  });

  it("is genuinely electronic evidence (the venue's own text explicitly says 'electronic'/'elektronisk') but states no specific subgenre — tagged electronic-other, not a guessed genre, still at official-description/high confidence", () => {
    expect(event.genreHint).toBe("electronic-other");
    expect(event.genreConfidenceHint).toBe("high");
  });
});

describe("parsePoolenEventDetailHtml — non-electronic event must not be published solely for being at Poolen", () => {
  const entry: PoolenProgramEntry = {
    title: "Swae Lee",
    detailUrl: "https://poolen.dk/da/koncerter/swae-lee/",
    ticketUrl: null,
    imageUrl: "https://poolen.dk/wp-content/uploads/Swae-Lee.jpg",
    dateText: null,
  };
  const event = parsePoolenEventDetailHtml(NON_ELECTRONIC_HTML, entry);

  it("parses the real fields correctly", () => {
    expect(event.title).toBe("Swae Lee");
    expect(event.venueName).toBe("Poolen");
    expect(event.startDatetime).toBe("2026-08-17T16:30:00.000Z"); // 18:30 CEST
    expect(event.priceFrom).toBe(390);
    expect(event.ticketUrl).toBe("https://www.ticketmaster.dk/event/508093953?language=da-dk");
    expect(event.artists).toEqual(["Swae Lee", "Max Felix"]);
  });

  it("resolves no genre hint at all — the bio is genuinely hip-hop/pop/R&B text with no electronic keyword anywhere", () => {
    expect(event.genreHint).toBeNull();
    expect(event.genreConfidenceHint).toBeNull();
  });
});

describe("parsePoolenEventDetailHtml — Outside event stays tagged to the real Poolen venue", () => {
  const entry: PoolenProgramEntry = {
    title: "Omar S – Outside",
    detailUrl: "https://poolen.dk/da/koncerter/omar-s-outside/",
    ticketUrl: null,
    imageUrl: "https://poolen.dk/wp-content/uploads/Omar-S-web-2560x1588.jpeg",
    dateText: null,
  };
  const event = parsePoolenEventDetailHtml(OUTSIDE_HTML, entry);

  it("keeps the site's own '– Outside' title text but never invents a separate venue", () => {
    expect(event.title).toBe("Omar S – Outside");
    expect(event.venueName).toBe("Poolen");
  });

  it("strips the '– Outside' suffix only from the artist name used for lineup/enrichment, not the title", () => {
    expect(event.artists).toEqual(["Omar S", "Waqar", "Harrison Heat", "Téa Cirkeline"]);
  });

  it("converts 13 May 2026, 20:00 CEST correctly (a different month than the other two fixtures)", () => {
    expect(event.startDatetime).toBe("2026-05-13T18:00:00.000Z"); // 20:00 CEST = UTC+2
  });

  it("resolves a specific subgenre (techno) from the venue's own text — the strongest possible evidence, still high confidence, not published on venue alone", () => {
    expect(event.genreHint).toBe("techno");
    expect(event.genreConfidenceHint).toBe("high");
  });

  it("extracts the billet.to ticket link and price", () => {
    expect(event.ticketUrl).toBe("https://billet.to/1879768-poolens-website-omars");
    expect(event.priceFrom).toBe(230);
  });
});

describe("parsePoolenEventDetailHtml — missing/optional fields", () => {
  it("falls back to the show-start time when doors time is absent", () => {
    const withoutDoors = ELECTRONIC_HTML.replace(
      /Dørene åbner\s*<\/div>\s*<div class="text__headline text__headline--size-4 text__headline--size-4--bold grid">\s*19\.00\s*<\/div>/,
      "",
    );
    const entry: PoolenProgramEntry = {
      title: "Hernan Cattaneo",
      detailUrl: "https://poolen.dk/da/koncerter/hernan-cattaneo/",
      ticketUrl: null,
      imageUrl: null,
      dateText: null,
    };
    const event = parsePoolenEventDetailHtml(withoutDoors, entry);
    expect(event.startDatetime).toBe("2026-07-18T19:00:00.000Z"); // 21:00 CEST show start
  });

  it("falls back to the program entry's own ticket URL when the detail page's ticket link is missing", () => {
    const withoutTicket = ELECTRONIC_HTML.replace(
      /<a class="inline-block text-box-black" href="[^"]+" target='_blank'>/,
      `<a class="inline-block text-box-black" target='_blank'>`,
    );
    const entry: PoolenProgramEntry = {
      title: "Hernan Cattaneo",
      detailUrl: "https://poolen.dk/da/koncerter/hernan-cattaneo/",
      ticketUrl: "https://eu.bingoloco.com/copenhagen",
      imageUrl: null,
      dateText: null,
    };
    const event = parsePoolenEventDetailHtml(withoutTicket, entry);
    expect(event.ticketUrl).toBe("https://eu.bingoloco.com/copenhagen");
  });

  it("throws (never guesses) when the date is genuinely missing or unparseable — the caller skips a single bad record and continues", () => {
    const withoutDate = ELECTRONIC_HTML.replace(
      /<div class="lowercase text__h3 as-typed pb-6">\s*18\. july 2026\s*<\/div>/,
      `<div class="lowercase text__h3 as-typed pb-6"></div>`,
    );
    const entry: PoolenProgramEntry = {
      title: "Hernan Cattaneo",
      detailUrl: "https://poolen.dk/da/koncerter/hernan-cattaneo/",
      ticketUrl: null,
      imageUrl: null,
      dateText: null,
    };
    expect(() => parsePoolenEventDetailHtml(withoutDate, entry)).toThrow();
  });

  it("still returns a valid event with an empty artists tail when there are no support acts (Swae Lee's page has exactly one)", () => {
    const entry: PoolenProgramEntry = {
      title: "Swae Lee",
      detailUrl: "https://poolen.dk/da/koncerter/swae-lee/",
      ticketUrl: null,
      imageUrl: null,
      dateText: null,
    };
    const withoutSupport = NON_ELECTRONIC_HTML.replace(/<div class="support-artists">[\s\S]*?<\/section>/, "</section>");
    const event = parsePoolenEventDetailHtml(withoutSupport, entry);
    expect(event.artists).toEqual(["Swae Lee"]);
  });
});

describe("parsePoolenEventDetailHtml — determinism (idempotency at the adapter level)", () => {
  it("parsing the same real page twice yields byte-identical results", () => {
    const entry: PoolenProgramEntry = {
      title: "Omar S – Outside",
      detailUrl: "https://poolen.dk/da/koncerter/omar-s-outside/",
      ticketUrl: null,
      imageUrl: null,
      dateText: null,
    };
    const first = parsePoolenEventDetailHtml(OUTSIDE_HTML, entry);
    const second = parsePoolenEventDetailHtml(OUTSIDE_HTML, entry);
    expect(second).toEqual(first);
  });
});

describe("createPoolenAdapter — orchestration (programme fetch + per-event detail fetches)", () => {
  function fetchImplFor(urlToHtml: Record<string, string>) {
    return async (url: string | URL) => {
      const html = urlToHtml[String(url)];
      if (html === undefined) return new Response("", { status: 404 });
      return new Response(html, { status: 200 });
    };
  }

  it("fetches the programme page then every listed event's own detail page, never the robots-relevant risk of a single combined request", async () => {
    // A tiny programme page with just two teasers, both of which have real
    // detail fixtures, keeps this test fast while still exercising the
    // real two-stage fetch orchestration end to end.
    const miniProgram = `
      <section class="component component-event-teaser default-grid">
        <div class="boxed-grid">
          <div class="image-wrapper" onclick="window.location.href='https://poolen.dk/da/koncerter/hernan-cattaneo/';" style="background-image: url('https://poolen.dk/wp-content/uploads/Hernan-Cattaneo.jpg');">
            <div class="inline"><span class="inline">
              <div class="boxify light-yellow"><h2 class="text__h2">Hernan Cattaneo</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">Lørdag</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">18 july 2026</h2></div>
            </span></div>
            <div class="cta-container">
              <a href="https://pretix.eu/Distriktsouth/DS2026/" target="_blank" class="btn btn--boxed-grey">KØB BILLET</a>
              <a href="https://poolen.dk/da/koncerter/hernan-cattaneo/" class="btn btn--boxed-black">MERE INFO</a>
            </div>
          </div>
        </div>
      </section>
      <section class="component component-event-teaser default-grid">
        <div class="boxed-grid">
          <div class="image-wrapper" onclick="window.location.href='https://poolen.dk/da/koncerter/swae-lee/';" style="background-image: url('https://poolen.dk/wp-content/uploads/Swae-Lee.jpg');">
            <div class="inline"><span class="inline">
              <div class="boxify light-yellow"><h2 class="text__h2">Swae Lee</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">Mandag</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">17 august 2026</h2></div>
            </span></div>
            <div class="cta-container">
              <a href="https://www.ticketmaster.dk/event/508093953?language=da-dk" target="_blank" class="btn btn--boxed-grey">KØB BILLET</a>
              <a href="https://poolen.dk/da/koncerter/swae-lee/" class="btn btn--boxed-black">MERE INFO</a>
            </div>
          </div>
        </div>
      </section>
    `;
    const fetchImpl = fetchImplFor({
      [POOLEN_PROGRAM_URL]: miniProgram,
      "https://poolen.dk/da/koncerter/hernan-cattaneo/": ELECTRONIC_HTML,
      "https://poolen.dk/da/koncerter/swae-lee/": NON_ELECTRONIC_HTML,
    });
    const adapter = createPoolenAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const candidates = await adapter.fetchCandidates();

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.title).sort()).toEqual(["Hernan Cattaneo", "Swae Lee"]);
    expect(candidates.every((c) => c.sourceId === "src-poolen")).toBe(true);
  });

  it("a single failing detail-page fetch drops only that one event — never the whole sync", async () => {
    const miniProgram = `
      <section class="component component-event-teaser default-grid">
        <div class="boxed-grid">
          <div class="image-wrapper" onclick="window.location.href='https://poolen.dk/da/koncerter/hernan-cattaneo/';" style="background-image: url('https://poolen.dk/wp-content/uploads/Hernan-Cattaneo.jpg');">
            <div class="inline"><span class="inline">
              <div class="boxify light-yellow"><h2 class="text__h2">Hernan Cattaneo</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">Lørdag</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">18 july 2026</h2></div>
            </span></div>
            <div class="cta-container">
              <a href="https://pretix.eu/Distriktsouth/DS2026/" target="_blank" class="btn btn--boxed-grey">KØB BILLET</a>
              <a href="https://poolen.dk/da/koncerter/hernan-cattaneo/" class="btn btn--boxed-black">MERE INFO</a>
            </div>
          </div>
        </div>
      </section>
      <section class="component component-event-teaser default-grid">
        <div class="boxed-grid">
          <div class="image-wrapper" onclick="window.location.href='https://poolen.dk/da/koncerter/broken-page/';" style="background-image: url('');">
            <div class="inline"><span class="inline">
              <div class="boxify light-yellow"><h2 class="text__h2">Broken Page Event</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">Mandag</h2></div>
              <div class="boxify yellow"><h2 class="text__h2">20 august 2026</h2></div>
            </span></div>
            <div class="cta-container">
              <a href="https://example.com/tickets" target="_blank" class="btn btn--boxed-grey">KØB BILLET</a>
              <a href="https://poolen.dk/da/koncerter/broken-page/" class="btn btn--boxed-black">MERE INFO</a>
            </div>
          </div>
        </div>
      </section>
    `;
    const fetchImpl = fetchImplFor({
      [POOLEN_PROGRAM_URL]: miniProgram,
      "https://poolen.dk/da/koncerter/hernan-cattaneo/": ELECTRONIC_HTML,
      // "broken-page" deliberately has no entry -> fetchImplFor returns 404 for it
    });
    const adapter = createPoolenAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const candidates = await adapter.fetchCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe("Hernan Cattaneo");
  });

  it("throws a descriptive error (source failure, not zero-events) when the programme page itself can't be fetched", async () => {
    const fetchImpl = async () => new Response("", { status: 503 });
    const adapter = createPoolenAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/503/);
  });
});
