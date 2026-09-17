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
 * All fixtures are real, unmodified pages captured directly from Poolen's
 * public website (poolen.dk) on 2026-09-17, via the read-only reachability
 * mode of .github/workflows/inspect-source.yml — after Poolen relaunched
 * its site with new `pc-shows__*`/`pc-concert__*` markup (see the doc
 * comment on poolenAdapter.ts). poolen-program.html is the live programme
 * listing (33 real upcoming shows, including a cancelled one, a sold-out
 * one, and two "Outside" sub-venue ones); poolen-event-electronic.html
 * (Kevin de Vries & Massano — explicit "melodic techno" bio evidence),
 * poolen-event-non-electronic.html (Ca7riel y Paco Amoroso — a genuinely
 * non-electronic trap/rock/pop bio), poolen-event-outside.html (R&B
 * Lovers – Outside, on Poolen's outdoor extension), poolen-event-cancelled
 * .html (Goran Bregović — real "Cancelled" status badge, no ticket link)
 * and poolen-event-with-support.html (Niarn — a real support-artist
 * section and "Few tix left" marquee flag) are five real per-event detail
 * pages chosen to exercise exactly the cases that matter.
 */
const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
const PROGRAM_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-program.html"), "utf-8");
const ELECTRONIC_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-electronic.html"), "utf-8");
const NON_ELECTRONIC_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-non-electronic.html"), "utf-8");
const OUTSIDE_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-outside.html"), "utf-8");
const CANCELLED_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-cancelled.html"), "utf-8");
const WITH_SUPPORT_HTML = readFileSync(path.join(FIXTURES_DIR, "poolen-event-with-support.html"), "utf-8");

describe("parsePoolenProgramHtml", () => {
  const entries = parsePoolenProgramHtml(PROGRAM_HTML);

  it("discovers every real event teaser on the programme page", () => {
    expect(entries.length).toBe(33);
  });

  it("extracts title, detail URL, ticket URL and the machine-readable date for a plain entry", () => {
    const niarn = entries.find((e) => e.title === "Niarn");
    expect(niarn).toEqual<PoolenProgramEntry>({
      title: "Niarn",
      detailUrl: "https://poolen.dk/concerts/niarn/",
      ticketUrl: "https://secure.tickster.com/7cwak39ey6pecvc",
      dateText: "2026-09-19",
    });
  });

  it("discovers the 'Outside' styled entry like any other — no special-cased structure — and decodes its HTML entities", () => {
    const outside = entries.find((e) => e.detailUrl.includes("rb-lovers-outside-2"));
    expect(outside?.title).toBe("R&B Lovers – Outside");
    expect(outside?.dateText).toBe("2027-05-29");
  });

  it("leaves ticketUrl null for a cancelled entry (status badge, not a ticket link)", () => {
    const goran = entries.find((e) => e.title === "Goran Bregović");
    expect(goran?.ticketUrl).toBeNull();
    expect(goran?.detailUrl).toBe("https://poolen.dk/concerts/goran-bregovic/");
  });

  it("leaves ticketUrl null for a sold-out entry too", () => {
    const omahLay = entries.find((e) => e.title === "Omah Lay");
    expect(omahLay?.ticketUrl).toBeNull();
  });

  it("never produces two entries pointing at the same detail page (adapter-level duplicate guard)", () => {
    const urls = entries.map((e) => e.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("parsePoolenEventDetailHtml — electronic event with an explicit specific-subgenre keyword", () => {
  const entry: PoolenProgramEntry = {
    title: "Kevin de Vries & Massano",
    detailUrl: "https://poolen.dk/concerts/kevin-de-vries-massano/",
    ticketUrl: null,
    dateText: "2026-10-02",
  };
  const event = parsePoolenEventDetailHtml(ELECTRONIC_HTML, entry);

  it("parses title, venue and provenance", () => {
    expect(event.title).toBe("Kevin de Vries & Massano");
    expect(event.venueName).toBe("Poolen");
    expect(event.sourceId).toBe("src-poolen");
    expect(event.officialEventUrl).toBe(entry.detailUrl);
  });

  it("converts the doors-time date/time to the correct Copenhagen-local UTC instant (2 Oct 2026, 22:00 CEST, period-separated)", () => {
    expect(event.startDatetime).toBe("2026-10-02T20:00:00.000Z");
    expect(event.endDatetime).toBeNull(); // never stated on this site — never invented
  });

  it("extracts a 'From X kr.' price and the detail page's own ticket link, not a guessed one", () => {
    expect(event.priceFrom).toBe(363);
    expect(event.ticketUrl).toBe("https://secure.tickster.com/j67gvutmnrgtf9j?c=6c52ydp");
  });

  it("has no support acts on this real page — artists is just the headliner", () => {
    expect(event.artists).toEqual(["Kevin de Vries & Massano"]);
  });

  it("resolves the specific subgenre stated explicitly in the venue's own text, at high confidence", () => {
    expect(event.genreHint).toBe("melodic-techno");
    expect(event.genreConfidenceHint).toBe("high");
  });

  it("pulls the event image from the detail page's own hero figure (the programme list no longer carries images)", () => {
    expect(event.imageUrl).toBe("https://poolen.dk/wp-content/uploads/kvdmas-web-1600x838.jpg");
  });

  it("publishes the real English-language description (no Danish-guard false positive)", () => {
    expect(event.description).toBeTruthy();
    expect(event.description).toContain("melodic techno");
  });
});

describe("parsePoolenEventDetailHtml — non-electronic event must not be published solely for being at Poolen", () => {
  const entry: PoolenProgramEntry = {
    title: "Ca7riel y Paco Amoroso",
    detailUrl: "https://poolen.dk/concerts/ca7riel-paco-amoroso/",
    ticketUrl: null,
    dateText: "2026-09-25",
  };
  const event = parsePoolenEventDetailHtml(NON_ELECTRONIC_HTML, entry);

  it("parses the real fields correctly", () => {
    expect(event.title).toBe("Ca7riel y Paco Amoroso");
    expect(event.venueName).toBe("Poolen");
    expect(event.startDatetime).toBe("2026-09-25T16:30:00.000Z"); // 18:30 CEST
    expect(event.priceFrom).toBe(445);
    expect(event.ticketUrl).toBe("https://www.ticketmaster.dk/event/1665380278?language=da-dk&#038;brand=dk_livenation");
  });

  it("resolves no genre hint at all — the bio is genuinely trap/rock/pop/experimental text with no electronic keyword anywhere", () => {
    expect(event.genreHint).toBeNull();
    expect(event.genreConfidenceHint).toBeNull();
  });
});

describe("parsePoolenEventDetailHtml — cancelled event (real 'Cancelled' status badge, no ticket link)", () => {
  const entry: PoolenProgramEntry = {
    title: "Goran Bregović",
    detailUrl: "https://poolen.dk/concerts/goran-bregovic/",
    ticketUrl: null,
    dateText: "2026-11-06",
  };
  const event = parsePoolenEventDetailHtml(CANCELLED_HTML, entry);

  it("is recognized as cancelled, with the real status badge text as evidence", () => {
    expect(event.cancelledHint).toBe(true);
    expect(event.soldOutHint).toBeNull();
    expect(event.cancellationEvidence).toBe('Poolen status badge "Cancelled"');
  });

  it("still resolves date/time correctly (period-separated facts, CET after Danish DST ends)", () => {
    expect(event.startDatetime).toBe("2026-11-06T19:00:00.000Z"); // 20:00 CET = UTC+1
  });

  it("has no ticket URL — the ticket action is a status badge, not a link, and the programme entry had none either", () => {
    expect(event.ticketUrl).toBeNull();
  });
});

describe("parsePoolenEventDetailHtml — Outside event stays tagged to the real Poolen venue", () => {
  const entry: PoolenProgramEntry = {
    title: "R&B Lovers – Outside",
    detailUrl: "https://poolen.dk/concerts/rb-lovers-outside-2/",
    ticketUrl: null,
    dateText: "2027-05-29",
  };
  const event = parsePoolenEventDetailHtml(OUTSIDE_HTML, entry);

  it("keeps the site's own '– Outside' title text but never invents a separate venue", () => {
    expect(event.title).toBe("R&B Lovers – Outside");
    expect(event.venueName).toBe("Poolen");
  });

  it("strips the '– Outside' suffix only from the artist name used for lineup/enrichment, not the title", () => {
    expect(event.artists).toEqual(["R&B Lovers"]);
  });

  it("converts 29 May 2027, 15:00 CEST correctly (period-separated facts, a different year than the other fixtures)", () => {
    expect(event.startDatetime).toBe("2027-05-29T13:00:00.000Z");
  });

  it("extracts the real billetto ticket link and price", () => {
    expect(event.ticketUrl).toBe("https://billetto.dk/en/e/outdoor-90s-00s-r-b-festival-copenhagen-billetter-1982682");
    expect(event.priceFrom).toBe(250);
  });
});

describe("parsePoolenEventDetailHtml — support-artist extraction and colon-separated times (real fixture)", () => {
  const entry: PoolenProgramEntry = {
    title: "Niarn",
    detailUrl: "https://poolen.dk/concerts/niarn/",
    ticketUrl: "https://secure.tickster.com/7cwak39ey6pecvc",
    dateText: "2026-09-19",
  };
  const event = parsePoolenEventDetailHtml(WITH_SUPPORT_HTML, entry);

  it("builds the artists list from the headliner plus a real support act", () => {
    expect(event.artists).toEqual(["Niarn", "Flammen"]);
  });

  it("parses colon-separated doors/show times (20:00 CEST) just as reliably as period-separated ones", () => {
    expect(event.startDatetime).toBe("2026-09-19T18:00:00.000Z");
  });

  it("a 'Few tix left' marquee flag near the hero image is not mistaken for a sold-out/cancelled status — only the ticket area's own badge counts", () => {
    expect(event.soldOutHint).toBeNull();
    expect(event.cancelledHint).toBeNull();
    expect(event.ticketUrl).toBe("https://secure.tickster.com/7cwak39ey6pecvc");
  });
});

describe("parsePoolenEventDetailHtml — genre resolution tiers (real page, bio paragraph swapped for controlled text — same technique as every other adapter's genre-tier tests)", () => {
  const PROSE_MARKER = '<div class="pc-concert__prose">';
  const proseStart = NON_ELECTRONIC_HTML.indexOf(PROSE_MARKER) + PROSE_MARKER.length;
  const supportOrLockersIdx = NON_ELECTRONIC_HTML.indexOf("pc-concert__lockers", proseStart);
  const originalProse = NON_ELECTRONIC_HTML.slice(proseStart, supportOrLockersIdx);

  function withProse(bioHtml: string): string {
    return NON_ELECTRONIC_HTML.slice(0, proseStart) + bioHtml + NON_ELECTRONIC_HTML.slice(proseStart + originalProse.length);
  }

  const entry: PoolenProgramEntry = {
    title: "Test Artist",
    detailUrl: "https://poolen.dk/concerts/test-artist/",
    ticketUrl: null,
    dateText: "2026-09-25",
  };

  it("resolves no genre hint — generic 'experimental' wording alone, with no electronic-music context, is not credible electronic evidence", () => {
    const event = parsePoolenEventDetailHtml(
      withProse("<p>An unpredictable blend of trap, rock, pop and experimental elements.</p>"),
      entry,
    );
    expect(event.genreHint).toBeNull();
    expect(event.genreConfidenceHint).toBeNull();
  });

  it("resolves ambient-experimental when the bio explicitly ties 'experimental' to electronic music", () => {
    const event = parsePoolenEventDetailHtml(withProse("<p>Deep, forward-leaning experimental electronic soundscapes.</p>"), entry);
    expect(event.genreHint).toBe("ambient-experimental");
    expect(event.genreConfidenceHint).toBe("high");
  });

  it("resolves electronic-other from an explicit but non-specific 'electronic' mention — real evidence, not a guessed subgenre", () => {
    const event = parsePoolenEventDetailHtml(withProse("<p>An evening of electronic music at Poolen.</p>"), entry);
    expect(event.genreHint).toBe("electronic-other");
    expect(event.genreConfidenceHint).toBe("high");
  });
});

describe("parsePoolenEventDetailHtml — missing/optional fields", () => {
  const entry: PoolenProgramEntry = {
    title: "Kevin de Vries & Massano",
    detailUrl: "https://poolen.dk/concerts/kevin-de-vries-massano/",
    ticketUrl: null,
    dateText: "2026-10-02",
  };

  it("falls back to the show-start time when doors time is absent", () => {
    const withoutDoors = ELECTRONIC_HTML.replace(/<dt>Doors<\/dt>\s*<dd>22\.00<\/dd>/, "");
    const event = parsePoolenEventDetailHtml(withoutDoors, entry);
    expect(event.startDatetime).toBe("2026-10-02T20:00:00.000Z"); // show time is also 22.00 on this real fixture
  });

  it("falls back to the programme entry's own ticket URL when the detail page's ticket link is missing", () => {
    const withoutTicket = ELECTRONIC_HTML.replace(
      /<a\s+class="pc-concert__action pc-chip pc-chip--pink"\s*href="[^"]+"/,
      `<a class="pc-concert__action pc-chip pc-chip--pink" href="#"`,
    ).replace('href="#"', "");
    const entryWithFallback: PoolenProgramEntry = { ...entry, ticketUrl: "https://example.com/fallback-ticket" };
    const event = parsePoolenEventDetailHtml(withoutTicket, entryWithFallback);
    expect(event.ticketUrl).toBe("https://example.com/fallback-ticket");
  });

  it("throws (never guesses) when the date is genuinely missing or unparseable — the caller skips a single bad record and continues", () => {
    const withoutDate = ELECTRONIC_HTML.replace(/<time datetime="2026-10-02">/, "<time>");
    expect(() => parsePoolenEventDetailHtml(withoutDate, entry)).toThrow(/unparseable date/);
  });

  it("throws when neither doors nor show time is present", () => {
    const withoutTimes = ELECTRONIC_HTML.replace(/<dt>Doors<\/dt>\s*<dd>22\.00<\/dd>/, "").replace(/<dt>Show<\/dt>\s*<dd>22\.00<\/dd>/, "");
    expect(() => parsePoolenEventDetailHtml(withoutTimes, entry)).toThrow(/no doors\/show time/);
  });

  it("still returns a valid event with an empty artists tail when there are no support acts", () => {
    const event = parsePoolenEventDetailHtml(NON_ELECTRONIC_HTML, {
      title: "Ca7riel y Paco Amoroso",
      detailUrl: "https://poolen.dk/concerts/ca7riel-paco-amoroso/",
      ticketUrl: null,
      dateText: "2026-09-25",
    });
    expect(event.artists).toEqual(["Ca7riel y Paco Amoroso"]);
  });
});

describe("parsePoolenEventDetailHtml — determinism (idempotency at the adapter level)", () => {
  it("parsing the same real page twice yields byte-identical results", () => {
    const entry: PoolenProgramEntry = {
      title: "Niarn",
      detailUrl: "https://poolen.dk/concerts/niarn/",
      ticketUrl: null,
      dateText: "2026-09-19",
    };
    const first = parsePoolenEventDetailHtml(WITH_SUPPORT_HTML, entry);
    const second = parsePoolenEventDetailHtml(WITH_SUPPORT_HTML, entry);
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

  it("fetches the programme page then every listed event's own detail page, never one combined request", async () => {
    // A tiny programme page with just two teasers, both of which have real
    // detail fixtures, keeps this test fast while still exercising the
    // real two-stage fetch orchestration end to end, using the real
    // pc-shows__* markup shape.
    const miniProgram = `
      <ol class="pc-shows__list" data-scroll-highlight>
        <li class="pc-shows__item is-hl-yellow" data-highlight-row>
          <div class="pc-shows__main">
            <a class="pc-shows__title" href="https://poolen.dk/concerts/kevin-de-vries-massano/">
              <span class="pc-shows__title-text">Kevin de Vries &#038; Massano</span>
            </a>
            <time class="pc-shows__when" datetime="2026-10-02">
              <span class="pc-shows__date pc-shows__date--compact">Fri 2 Oct</span>
            </time>
          </div>
          <a class="pc-shows__action pc-chip pc-chip--pink" href="https://secure.tickster.com/j67gvutmnrgtf9j?c=6c52ydp" target="_blank" rel="noopener">
            Buy tix
          </a>
        </li>
        <li class="pc-shows__item is-hl-yellow" data-highlight-row>
          <div class="pc-shows__main">
            <a class="pc-shows__title" href="https://poolen.dk/concerts/ca7riel-paco-amoroso/">
              <span class="pc-shows__title-text">Ca7riel y Paco Amoroso</span>
            </a>
            <time class="pc-shows__when" datetime="2026-09-25">
              <span class="pc-shows__date pc-shows__date--compact">Fri 25 Sep</span>
            </time>
          </div>
          <a class="pc-shows__action pc-chip pc-chip--pink" href="https://www.ticketmaster.dk/event/1665380278" target="_blank" rel="noopener">
            Buy tix
          </a>
        </li>
      </ol>
    `;
    const fetchImpl = fetchImplFor({
      [POOLEN_PROGRAM_URL]: miniProgram,
      "https://poolen.dk/concerts/kevin-de-vries-massano/": ELECTRONIC_HTML,
      "https://poolen.dk/concerts/ca7riel-paco-amoroso/": NON_ELECTRONIC_HTML,
    });
    const adapter = createPoolenAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const candidates = await adapter.fetchCandidates();

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.title).sort()).toEqual(["Ca7riel y Paco Amoroso", "Kevin de Vries & Massano"]);
    expect(candidates.every((c) => c.sourceId === "src-poolen")).toBe(true);
  });

  it("a single failing detail-page fetch drops only that one event — never the whole sync", async () => {
    const miniProgram = `
      <ol class="pc-shows__list" data-scroll-highlight>
        <li class="pc-shows__item is-hl-yellow" data-highlight-row>
          <div class="pc-shows__main">
            <a class="pc-shows__title" href="https://poolen.dk/concerts/kevin-de-vries-massano/">
              <span class="pc-shows__title-text">Kevin de Vries &#038; Massano</span>
            </a>
            <time class="pc-shows__when" datetime="2026-10-02"></time>
          </div>
          <a class="pc-shows__action pc-chip pc-chip--pink" href="https://secure.tickster.com/j67gvutmnrgtf9j?c=6c52ydp" target="_blank" rel="noopener">Buy tix</a>
        </li>
        <li class="pc-shows__item is-hl-yellow" data-highlight-row>
          <div class="pc-shows__main">
            <a class="pc-shows__title" href="https://poolen.dk/concerts/broken-page/">
              <span class="pc-shows__title-text">Broken Page Event</span>
            </a>
            <time class="pc-shows__when" datetime="2026-08-20"></time>
          </div>
          <a class="pc-shows__action pc-chip pc-chip--pink" href="https://example.com/tickets" target="_blank" rel="noopener">Buy tix</a>
        </li>
      </ol>
    `;
    const fetchImpl = fetchImplFor({
      [POOLEN_PROGRAM_URL]: miniProgram,
      "https://poolen.dk/concerts/kevin-de-vries-massano/": ELECTRONIC_HTML,
      // "broken-page" deliberately has no entry -> fetchImplFor returns 404 for it
    });
    const adapter = createPoolenAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const candidates = await adapter.fetchCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe("Kevin de Vries & Massano");
  });

  it("throws a descriptive error (source failure, not zero-events) when the programme page itself can't be fetched", async () => {
    const fetchImpl = async () => new Response("", { status: 503 });
    const adapter = createPoolenAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/503/);
  });
});
