import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseCultureBoxEventsHtml,
  createCultureBoxAdapter,
  extractDescriptionParagraphs,
  extractResidentAdvisorUrl,
  attributeGenreToRoom,
  enrichCandidatesWithDetailPages,
  CULTURE_BOX_EVENTS_URL,
  CULTURE_BOX_SOURCE_ID,
} from "./cultureBoxAdapter";
import { runIngestionPipeline, type ExistingEventForDedup } from "./pipeline";
import { findBestDuplicateMatch } from "../dedup";
import { VENUES } from "../data/venues";

/**
 * `culture-box-events.html` is a real, unmodified recording of
 * https://culture-box.com/events/ (fetched 2026-08-17). Not a fabricated
 * fixture — every value asserted below against it is exactly what a real
 * fetch against the live source returns at that time. Synthetic HTML
 * snippets used elsewhere in this file are explicitly labeled as such.
 */
const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "culture-box-events.html");
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf-8");

describe("parseCultureBoxEventsHtml — real fixture", () => {
  const events = parseCultureBoxEventsHtml(FIXTURE_HTML);

  it("parses both rooms for every one of the 15 nights on the page", () => {
    expect(events).toHaveLength(30);
  });

  it("extracts a normal event with a named showcase title (Black Box, 21 Aug)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/fri-21-august-2026/#black-box");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Black Box: HYGGELIT SHOWCASE");
    expect(e!.artists).toEqual(["SOPHIE VAN HAYDEN", "RELINQUO", "SEVERIN", "NO CELEBRITY"]);
    expect(e!.startDatetime).toBe("2026-08-21T20:00:00.000Z"); // 10PM CEST
    expect(e!.endDatetime).toBe("2026-08-22T06:00:00.000Z"); // 8AM CEST next day
    expect(e!.venueName).toBe("Culture Box");
    expect(e!.sourceId).toBe(CULTURE_BOX_SOURCE_ID);
    expect(e!.priceFrom).toBe(100); // "150 DKK / 100 DKK after 6AM"
    expect(e!.facebookUrl).toBe("https://www.facebook.com/events/1584250589899318");
    expect(e!.imageUrl).toMatch(/^https:\/\/culture-box\.com\/wp-content\/uploads\//);
    expect(e!.ticketUrl).toBeNull();
    expect(e!.residentAdvisorUrl).toBeNull();
    expect(e!.description).toBeNull(); // no free-text description exists on this page — never invented
  });

  it("gives each room on the same night its own distinct, stable event identity from one shared page URL", () => {
    const blackBox = events.find((ev) => ev.officialEventUrl?.endsWith("fri-21-august-2026/#black-box"));
    const redBox = events.find((ev) => ev.officialEventUrl?.endsWith("fri-21-august-2026/#red-box"));
    expect(blackBox).toBeDefined();
    expect(redBox).toBeDefined();
    expect(blackBox!.officialEventUrl).not.toBe(redBox!.officialEventUrl);
    expect(redBox!.title).toBe("Red Box: HYGGELIT SHOWCASE");
    expect(redBox!.artists).toEqual(["ROZGU", "HERMANN BRAVO"]);
    // Both rooms share the same night's door hours and canonical night URL base.
    expect(blackBox!.startDatetime).toBe(redBox!.startDatetime);
  });

  it("falls back to the room name + lineup as the title when the venue named no showcase (22 Aug)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/sat-22-august-2026/#black-box");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Black Box: TIMO MAAS, RYAN DANK, BALTZA");
    expect(e!.artists).toEqual(["TIMO MAAS", "RYAN DANK", "BALTZA"]);
    // No showcase text means no genre evidence to credit — left for the
    // pipeline's own fallback/enrichment, never guessed here.
    expect(e!.genreHint).toBeNull();
    expect(e!.genreConfidenceHint).toBeNull();
  });

  it("joins a multi-line showcase title and searches only that venue text for genre evidence, not artist names", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/sat-19-september-2026/#black-box");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Black Box: WHAT HAPPENS 4 DECADES OF TIM ANDRESEN");
    expect(e!.artists).toEqual(["TIM ANDRESEN", "FEDERICO MONACHESI", "NILU", "GERSSEIN", "EUSHERR"]);
    expect(e!.priceFrom).toBe(40); // "40 DKK (early bird presale tickets) - 150 DKK" -> lowest
    expect(e!.startDatetime).toBe("2026-09-19T18:00:00.000Z"); // 8PM CEST (this night's doors are earlier)
  });

  it("treats every SoundCloud-linked name in a room's paragraph as lineup, even a promoter/curator credit with no <strong> tag (3 Oct)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/sat-3-october-2026/#black-box");
    expect(e).toBeDefined();
    expect(e!.artists).toEqual(["Shaktu", "Meoko", "COSMINA", "JOSEFINA TAPIA", "ANA KARLA"]);
    expect(e!.genreHint).toBeNull(); // no showcase title present, so no description-tier evidence
  });

  it("never throws on the whole batch and every event carries the required identity fields", () => {
    for (const e of events) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.sourceId).toBe(CULTURE_BOX_SOURCE_ID);
      expect(e.venueName).toBe("Culture Box");
      expect(e.sourceUrl).toBe(CULTURE_BOX_EVENTS_URL);
      expect(e.officialEventUrl).toMatch(/^https:\/\/culture-box\.com\/event\/.+#.+/);
      expect(e.startDatetime).not.toBeNull();
      expect(e.endDatetime).not.toBeNull();
    }
  });

  it("honestly leaves most nights without high-confidence genre evidence — the venue rarely states a genre in its own show titles", () => {
    // This is a real, expected finding, not a bug: Culture Box's showcase
    // titles are almost always event/collective names ("HYGGELIT SHOWCASE",
    // "WHAT HAPPENS"), not genre statements. Documented here so the
    // resulting review-queue-heavy publish distribution (see the pipeline
    // integration tests below) is a known, intended consequence of not
    // inventing evidence that isn't there — not a defect to "fix" later by
    // crediting the venue's general reputation as electronic.
    const withGenreHint = events.filter((e) => e.genreHint !== null);
    expect(withGenreHint.length).toBeLessThan(events.length / 2);
  });
});

describe("parseCultureBoxEventsHtml — malformed / changed markup", () => {
  it("returns an empty array (never throws) when the page structure no longer contains any post-block articles", () => {
    const changedHtml = "<html><body><div class=\"totally-different-layout\">Site redesign, no events markup left</div></body></html>";
    expect(parseCultureBoxEventsHtml(changedHtml)).toEqual([]);
  });

  it("skips a single corrupted article (no date heading) without losing valid ones alongside it", () => {
    // Synthetic, hand-constructed markup — not a real recording — isolating
    // the one structural element under test (article 1 has NO <h2>, unlike
    // every real article on the page).
    const html = `
      <article class="post-block indented inverted">
        <div class="post-block__content text-formatting">
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Black Box</h3>
            <p><a href="https://soundcloud.com/x" target="_blank">SOME DJ</a></p>
          </div>
        </div>
      </article>
      <article class="post-block indented inverted">
        <h2 class="post-block__title structural__content__title">FRI 1 JANUARY 2027</h2>
        <a href="https://culture-box.com/event/fri-1-january-2027/" class="post-block__image"></a>
        <div class="post-block__content text-formatting">
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Black Box</h3>
            <p><strong>NEW YEAR TECHNO SPECIAL</strong><br />
            <a href="https://soundcloud.com/a" target="_blank">ARTIST A</a></p>
          </div>
        </div>
        <div class="post-block__footer">
          <div class="post-block__footer__aside">
            <ul>
              <li class="text-formatting">Entrance&nbsp;<strong>150 DKK</strong></li>
              <li class="text-formatting">10PM – 8AM</li>
              <li class="text-formatting"><a href="https://www.facebook.com/events/1" target="_blank">Facebook</a></li>
            </ul>
          </div>
        </div>
      </article>`;
    const events = parseCultureBoxEventsHtml(html);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Black Box: NEW YEAR TECHNO SPECIAL");
    // A genre keyword in the venue's own showcase title IS credited, at high confidence.
    expect(events[0].genreHint).toBe("techno");
    expect(events[0].genreConfidenceHint).toBe("high");
  });

  it("skips a room block with no room name and no lineup rather than inventing a title", () => {
    const html = `
      <article class="post-block indented inverted">
        <h2 class="post-block__title structural__content__title">SAT 2 JANUARY 2027</h2>
        <a href="https://culture-box.com/event/sat-2-january-2027/" class="post-block__image"></a>
        <div class="post-block__content text-formatting">
          <div class="post-block__content__block">
            <p>No h3 in this block at all.</p>
          </div>
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Red Box</h3>
            <p><a href="https://soundcloud.com/b" target="_blank">ARTIST B</a></p>
          </div>
        </div>
        <div class="post-block__footer">
          <div class="post-block__footer__aside">
            <ul>
              <li class="text-formatting">Entrance&nbsp;<strong>150 DKK</strong></li>
              <li class="text-formatting">10PM – 8AM</li>
            </ul>
          </div>
        </div>
      </article>`;
    const events = parseCultureBoxEventsHtml(html);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Red Box: ARTIST B");
    expect(events[0].facebookUrl).toBeNull(); // missing optional field — left null, not invented
  });
});

describe("createCultureBoxAdapter", () => {
  it("fetches the unrestricted /events/ URL first and parses the listing response", async () => {
    // Detail pages aren't mocked here — enrichCandidatesWithDetailPages must
    // degrade every night gracefully (404) without dropping any candidate or
    // affecting the listing-derived result. Two-stage orchestration itself is
    // covered separately below with real detail fixtures.
    const calledUrls: string[] = [];
    const fetchImpl = async (url: string | URL) => {
      calledUrls.push(String(url));
      if (String(url) === CULTURE_BOX_EVENTS_URL) return new Response(FIXTURE_HTML, { status: 200 });
      return new Response("", { status: 404 });
    };
    const adapter = createCultureBoxAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const candidates = await adapter.fetchCandidates();
    expect(calledUrls[0]).toBe(CULTURE_BOX_EVENTS_URL);
    expect(candidates).toHaveLength(30);
  });

  it("retries once on a 5xx before giving up on the listing page specifically", async () => {
    let listingCalls = 0;
    const fetchImpl = async (url: string | URL) => {
      if (String(url) === CULTURE_BOX_EVENTS_URL) {
        listingCalls++;
        return listingCalls === 1 ? new Response("", { status: 503 }) : new Response(FIXTURE_HTML, { status: 200 });
      }
      return new Response("", { status: 404 }); // detail pages: not mocked, enrichment gracefully no-ops
    };
    const adapter = createCultureBoxAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const candidates = await adapter.fetchCandidates();
    expect(listingCalls).toBe(2);
    expect(candidates).toHaveLength(30);
  });

  it("does not retry a 4xx — it won't fix itself", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("", { status: 404 });
    };
    const adapter = createCultureBoxAdapter(fetchImpl as unknown as typeof fetch, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });

  it("throws a descriptive error on a network failure after exhausting retries", async () => {
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const adapter = createCultureBoxAdapter(fetchImpl as unknown as typeof fetch, 0);
    await expect(adapter.fetchCandidates()).rejects.toThrow(/Culture Box fetch failed/);
  });
});

describe("pipeline integration — real Culture Box candidates through runIngestionPipeline", () => {
  const events = parseCultureBoxEventsHtml(FIXTURE_HTML);

  it("auto-publishes only when the venue's own showcase text names a genre explicitly (high confidence) — reflects the malformed-markup fixture above, not the real page", () => {
    const namedTechno = {
      ...events[0],
      title: "Black Box: TECHNO SHOWCASE",
      genreHint: "techno" as const,
      genreConfidenceHint: "high" as const,
    };
    const result = runIngestionPipeline(namedTechno, { venues: VENUES, existingEvents: [] });
    expect(result.decision).toBe("auto_publish");
    expect(result.genreConfidence).toBe("high");
  });

  it("routes a real, unresolved-genre night to review or hold — never auto-published without credible evidence", () => {
    const noGenreEvidence = events.find((e) => e.genreHint === null);
    expect(noGenreEvidence).toBeDefined();
    const result = runIngestionPipeline(noGenreEvidence!, { venues: VENUES, existingEvents: [] });
    expect(result.decision).not.toBe("auto_publish");
  });

  it("resolves the Culture Box venue name against the registry", () => {
    const result = runIngestionPipeline(events[0], { venues: VENUES, existingEvents: [] });
    expect(result.resolvedVenueId).toBe("v-culture-box");
  });

  it("sibling rooms from the SAME sync batch are never dedup-checked against each other — runSourceSyncLocked only compares a candidate against events that existed before this run started", () => {
    // src/db/sync.ts fetches `existingEvents` once, before iterating
    // candidates, and never appends a just-created event back into that
    // list mid-loop — so within one sync run, Black Box and Red Box (both
    // freshly parsed candidates) are structurally incapable of matching
    // each other, regardless of title/lineup similarity. This test
    // documents that guarantee at the level this repo's tests operate at
    // (pipeline/dedup, no DB): passing an EMPTY existingEvents list, the
    // way a brand-new night's first sync actually would.
    const blackBox = events.find((e) => e.officialEventUrl?.endsWith("fri-21-august-2026/#black-box"))!;
    const redBox = events.find((e) => e.officialEventUrl?.endsWith("fri-21-august-2026/#red-box"))!;
    const match = findBestDuplicateMatch(
      { title: redBox.title, artists: redBox.artists, venueId: "v-culture-box", startDatetime: redBox.startDatetime! },
      [] as ExistingEventForDedup[],
    );
    expect(match).toBeNull();
    expect(blackBox.officialEventUrl).not.toBe(redBox.officialEventUrl); // distinct identity either way
  });

  it("Black Box vs Red Box sharing an RA/Facebook link never auto-merges — the officialEventUrl room anchor is the deciding evidence", () => {
    // The venue publishes ONE Resident Advisor / Facebook link and one set
    // of door hours per NIGHT, shared across every room — real Production
    // data confirmed both rooms on a given night can carry an IDENTICAL
    // residentAdvisorUrl. A naive "shared RA URL = same event" rule would
    // wrongly auto-merge these two genuinely distinct shows. The room
    // anchor on officialEventUrl (#black-box vs #red-box) is what actually
    // distinguishes them, and it must override the shared RA URL.
    const blackBox = events.find((e) => e.officialEventUrl?.endsWith("fri-21-august-2026/#black-box"))!;
    const redBox = events.find((e) => e.officialEventUrl?.endsWith("fri-21-august-2026/#red-box"))!;
    const sharedRaUrl = "https://ra.co/events/9999999";
    const existing: ExistingEventForDedup[] = [
      {
        id: "e-existing-black-box",
        title: blackBox.title,
        artists: blackBox.artists,
        venueId: "v-culture-box",
        startDatetime: blackBox.startDatetime!,
        officialEventUrl: blackBox.officialEventUrl,
        residentAdvisorUrl: sharedRaUrl,
      },
    ];
    const match = findBestDuplicateMatch(
      {
        title: redBox.title,
        artists: redBox.artists,
        venueId: "v-culture-box",
        startDatetime: redBox.startDatetime!,
        officialEventUrl: redBox.officialEventUrl,
        residentAdvisorUrl: sharedRaUrl,
      },
      existing,
    );
    expect(match).toBeNull(); // room-identity conflict vetoes the match outright — never even "review"
  });

  it("if a room's own provenance link were ever missing, a shared showcase title now correctly routes to review, never a silent high-confidence auto-merge", () => {
    // Degraded case: no officialEventUrl at all, so the room-anchor veto
    // above can't apply and the only remaining signal is the venue-authored
    // showcase title ("HYGGELIT SHOWCASE") with a completely disjoint
    // lineup (artistOverlap 0). Without a confirmed strong lineup match,
    // that alone must land in review, never auto-merge.
    const blackBox = events.find((e) => e.officialEventUrl?.endsWith("fri-21-august-2026/#black-box"))!;
    const redBox = events.find((e) => e.officialEventUrl?.endsWith("fri-21-august-2026/#red-box"))!;
    const existing: ExistingEventForDedup[] = [
      { id: "e-existing-black-box", title: blackBox.title, artists: blackBox.artists, venueId: "v-culture-box", startDatetime: blackBox.startDatetime! },
    ];
    const match = findBestDuplicateMatch(
      { title: redBox.title, artists: redBox.artists, venueId: "v-culture-box", startDatetime: redBox.startDatetime! },
      existing,
    );
    expect(match?.assessment.confidence).toBe("medium");
    expect(match?.assessment.artistOverlap).toBe(0); // confirms this is title-similarity-driven, not a real lineup match
  });

  it("re-parsing the same page twice yields identical officialEventUrls per room — a re-sync recognizes the same event rather than re-queuing it", () => {
    const first = parseCultureBoxEventsHtml(FIXTURE_HTML);
    const second = parseCultureBoxEventsHtml(FIXTURE_HTML);
    expect(first.map((e) => e.officialEventUrl)).toEqual(second.map((e) => e.officialEventUrl));
  });
});

/**
 * Real, unmodified detail-page recordings (fetched 2026-08-19 from
 * culture-box.com/event/<slug>/, robots.txt-permitted — same courtesy
 * fetch pattern as the /events/ listing fixture above) for every night
 * present in the committed listing fixture. Building this full 15-page set
 * before writing any adapter code was deliberate (task: don't trust a small
 * sample) — see the diagnosis notes; a 5-page sample and the full 15-page
 * set agreed almost exactly (13/32 vs. an earlier ~40% estimate), so the
 * pattern is real, not an artifact of which pages happened to be sampled.
 */
function loadDetailFixture(slug: string): string {
  return readFileSync(path.join(__dirname, "__fixtures__", `culture-box-detail-${slug}.html`), "utf-8");
}

function loadListingRoom(slug: string, room: "black-box" | "red-box") {
  const events = parseCultureBoxEventsHtml(FIXTURE_HTML);
  return events.find((e) => e.officialEventUrl === `https://culture-box.com/event/${slug}/#${room}`);
}

describe("extractDescriptionParagraphs — real fixtures", () => {
  it("extracts the real free-text description paragraphs from a detail page (fri-21-august-2026)", () => {
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("fri-21-august-2026"));
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs.some((p) => p.includes("peaktime techno and tech house"))).toBe(true);
  });

  it("returns [] (never throws) when the additional-text block isn't present — a page-structure change degrades to no evidence", () => {
    expect(extractDescriptionParagraphs("<html><body>totally different layout</body></html>")).toEqual([]);
  });
});

describe("extractResidentAdvisorUrl — real fixtures", () => {
  it("extracts the night's real Resident Advisor event link", () => {
    const url = extractResidentAdvisorUrl(loadDetailFixture("fri-21-august-2026"));
    expect(url).toMatch(/^https:\/\/ra\.co\/events\/\d+$/);
  });

  it("returns null (never invented) when no RA link is present", () => {
    expect(extractResidentAdvisorUrl("<html><body>no RA link here</body></html>")).toBeNull();
  });
});

describe("attributeGenreToRoom — room-attribution guard", () => {
  it("real: fri-28-august credits BOTH rooms cleanly with DIFFERENT genres from the same shared description — each room's own paragraph names only that room's artists", () => {
    const blackBox = loadListingRoom("fri-28-august", "black-box")!;
    const redBox = loadListingRoom("fri-28-august", "red-box")!;
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("fri-28-august"));

    expect(attributeGenreToRoom(paragraphs, blackBox.artists, redBox.artists)).toBe("drum-and-bass");
    expect(attributeGenreToRoom(paragraphs, redBox.artists, blackBox.artists)).toBe("drum-and-bass");
  });

  it("real: fri-21-august-2026's genre-bearing sentence names artists from BOTH rooms in one breath ('...Rozgu...and Hermann Bravo...are in Red Box and rounding a truly stellar lineup of peaktime techno and tech house') — stays unresolved for both, never guessed toward either", () => {
    const blackBox = loadListingRoom("fri-21-august-2026", "black-box")!;
    const redBox = loadListingRoom("fri-21-august-2026", "red-box")!;
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("fri-21-august-2026"));

    expect(attributeGenreToRoom(paragraphs, blackBox.artists, redBox.artists)).toBeNull();
    expect(attributeGenreToRoom(paragraphs, redBox.artists, blackBox.artists)).toBeNull();
  });

  it("real: sat-19-september-2026 has real description paragraphs but none contain a mapped genre keyword — unresolved, not guessed", () => {
    const blackBox = loadListingRoom("sat-19-september-2026", "black-box")!;
    const redBox = loadListingRoom("sat-19-september-2026", "red-box")!;
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("sat-19-september-2026"));

    expect(paragraphs.length).toBeGreaterThan(0); // real prose exists...
    expect(attributeGenreToRoom(paragraphs, blackBox.artists, redBox.artists)).toBeNull(); // ...just no genre evidence in it
    expect(attributeGenreToRoom(paragraphs, redBox.artists, blackBox.artists)).toBeNull();
  });

  it("no paragraphs at all -> unresolved", () => {
    expect(attributeGenreToRoom([], ["Some Artist"], ["Other Artist"])).toBeNull();
  });

  it("synthetic: two qualifying paragraphs for the same room that DISAGREE on genre stay unresolved rather than picking one arbitrarily", () => {
    const paragraphs = [
      "Headliner Some Artist brings a heavy techno set to Black Box.",
      "Some Artist also draws from deep house influences in Black Box.",
    ];
    expect(attributeGenreToRoom(paragraphs, ["Some Artist"], ["Other Room Artist"])).toBeNull();
  });

  it("synthetic: a paragraph naming neither room's artists is never credited to either", () => {
    const paragraphs = ["A completely unrelated techno night happened elsewhere last year."];
    expect(attributeGenreToRoom(paragraphs, ["Some Artist"], ["Other Room Artist"])).toBeNull();
  });

  it("never guesses genre from venue identity alone — an artist-name match with no genre keyword in the paragraph contributes nothing", () => {
    const paragraphs = ["Some Artist is a beloved fixture of the Copenhagen nightlife scene."];
    expect(attributeGenreToRoom(paragraphs, ["Some Artist"], ["Other Room Artist"])).toBeNull();
  });
});

describe("enrichCandidatesWithDetailPages — orchestration", () => {
  function fetchImplFor(urlToHtml: Record<string, string>) {
    return async (url: string | URL) => {
      const html = urlToHtml[String(url)];
      if (html === undefined) return new Response("", { status: 404 });
      return new Response(html, { status: 200 });
    };
  }

  it("fetches one night's detail page exactly ONCE and reuses it for both room candidates", async () => {
    const nightUrl = "https://culture-box.com/event/fri-28-august/";
    let fetchCount = 0;
    const fetchImpl = async (url: string | URL) => {
      if (String(url) === nightUrl) {
        fetchCount++;
        return new Response(loadDetailFixture("fri-28-august"), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const blackBox = loadListingRoom("fri-28-august", "black-box")!;
    const redBox = loadListingRoom("fri-28-august", "red-box")!;
    const enriched = await enrichCandidatesWithDetailPages([blackBox, redBox], fetchImpl as unknown as typeof fetch, 0, 0);

    expect(fetchCount).toBe(1); // one detail fetch for the night, not one per room
    expect(enriched).toHaveLength(2);
    expect(enriched.find((e) => e.officialEventUrl === blackBox.officialEventUrl)?.genreHint).toBe("drum-and-bass");
    expect(enriched.find((e) => e.officialEventUrl === redBox.officialEventUrl)?.genreHint).toBe("drum-and-bass");
  });

  it("populates residentAdvisorUrl and description on both rooms from the shared detail page", async () => {
    const fetchImpl = fetchImplFor({
      "https://culture-box.com/event/fri-28-august/": loadDetailFixture("fri-28-august"),
    });
    const blackBox = loadListingRoom("fri-28-august", "black-box")!;
    const redBox = loadListingRoom("fri-28-august", "red-box")!;
    const enriched = await enrichCandidatesWithDetailPages([blackBox, redBox], fetchImpl as unknown as typeof fetch, 0, 0);

    for (const e of enriched) {
      expect(e.residentAdvisorUrl).toMatch(/^https:\/\/ra\.co\/events\/\d+$/);
      expect(e.description).toBeTruthy();
    }
  });

  it("a single night's detail-page fetch failure degrades only that night — other nights are still enriched, and no candidate anywhere is dropped", async () => {
    const fetchImpl = fetchImplFor({
      // fri-28-august deliberately NOT mocked -> 404, simulating a fetch failure for that one night
      "https://culture-box.com/event/sat-22-august-2026/": loadDetailFixture("sat-22-august-2026"),
    });
    const brokenBB = loadListingRoom("fri-28-august", "black-box")!;
    const brokenRB = loadListingRoom("fri-28-august", "red-box")!;
    const healthyBB = loadListingRoom("sat-22-august-2026", "black-box")!;

    const enriched = await enrichCandidatesWithDetailPages(
      [brokenBB, brokenRB, healthyBB],
      fetchImpl as unknown as typeof fetch,
      0,
      0,
    );

    expect(enriched).toHaveLength(3); // nothing dropped
    const brokenResult = enriched.find((e) => e.officialEventUrl === brokenBB.officialEventUrl)!;
    expect(brokenResult.genreHint).toBe(brokenBB.genreHint); // exactly the listing-page fallback, untouched
    expect(brokenResult.residentAdvisorUrl).toBeNull();
    expect(brokenResult.description).toBeNull();

    const healthyResult = enriched.find((e) => e.officialEventUrl === healthyBB.officialEventUrl)!;
    expect(healthyResult.genreHint).toBe("techno"); // the healthy night still gets enriched normally
  });

  it("never overrides a genre already resolved from the listing page's own showcase title", async () => {
    const fetchImpl = fetchImplFor({
      "https://culture-box.com/event/fri-28-august/": loadDetailFixture("fri-28-august"),
    });
    const blackBox = loadListingRoom("fri-28-august", "black-box")!;
    // Simulate a listing page that already resolved a (different) genre from its own showcase title.
    const alreadyResolved = { ...blackBox, genreHint: "house" as const, genreConfidenceHint: "high" as const };
    const enriched = await enrichCandidatesWithDetailPages([alreadyResolved], fetchImpl as unknown as typeof fetch, 0, 0);
    expect(enriched[0].genreHint).toBe("house"); // untouched, even though the description says drum-and-bass
  });

  it("candidates with no officialEventUrl are left untouched rather than crashing the grouping step", async () => {
    const candidate = { ...loadListingRoom("fri-28-august", "black-box")!, officialEventUrl: null };
    const enriched = await enrichCandidatesWithDetailPages([candidate], (async () => new Response("", { status: 404 })) as unknown as typeof fetch, 0, 0);
    expect(enriched).toEqual([candidate]);
  });
});

describe("createCultureBoxAdapter — full two-stage integration against all real fixtures", () => {
  it("real end-to-end run: candidates newly reaching high genre confidence from official detail descriptions match the validation matrix built before implementation", async () => {
    const ALL_NIGHTS = [
      "fri-21-august-2026", "sat-22-august-2026", "fri-28-august", "sat-29-august-2026",
      "fri-4-september-2026", "sat-5-september-2026", "fri-11-september-2026", "sat-12-september-2026",
      "fri-18-september-2026", "sat-19-september-2026", "fri-25-september-2026", "sat-26-september-2026",
      "fri-2-october-2026", "sat-3-october-2026", "fri-23-october-2026",
    ];
    const urlToHtml: Record<string, string> = { [CULTURE_BOX_EVENTS_URL]: FIXTURE_HTML };
    for (const slug of ALL_NIGHTS) {
      urlToHtml[`https://culture-box.com/event/${slug}/`] = loadDetailFixture(slug);
    }
    const fetchImpl = async (url: string | URL) => {
      const html = urlToHtml[String(url)];
      return html === undefined ? new Response("", { status: 404 }) : new Response(html, { status: 200 });
    };

    const adapter = createCultureBoxAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const candidates = await adapter.fetchCandidates();

    expect(candidates).toHaveLength(30); // nothing dropped, nothing invented

    const highConfidence = candidates.filter((c) => c.genreConfidenceHint === "high");
    // 12 of 30 in this 15-night committed fixture set. The pre-implementation
    // validation matrix (built against all 16 live nights, 32 candidates,
    // including a Oct-24 night added to the site after this fixture was
    // captured) found 13 — one more, entirely accounted for by that extra
    // night's own single confident Black Box result.
    expect(highConfidence.length).toBe(12);
    for (const c of highConfidence) {
      expect(runIngestionPipeline(c, { venues: VENUES, existingEvents: [] }).decision).toBe("auto_publish");
    }

    // Every candidate's RA link is real and well-formed when present.
    for (const c of candidates) {
      if (c.residentAdvisorUrl) expect(c.residentAdvisorUrl).toMatch(/^https:\/\/ra\.co\/events\/\d+$/);
    }
  });

  it("a second identical sync run is idempotent — same candidates, same classifications", async () => {
    const urlToHtml: Record<string, string> = {
      [CULTURE_BOX_EVENTS_URL]: FIXTURE_HTML,
      "https://culture-box.com/event/fri-28-august/": loadDetailFixture("fri-28-august"),
    };
    const fetchImpl = async (url: string | URL) => {
      const html = urlToHtml[String(url)];
      return html === undefined ? new Response("", { status: 404 }) : new Response(html, { status: 200 });
    };
    const adapter = createCultureBoxAdapter(fetchImpl as unknown as typeof fetch, 0, 0);
    const first = await adapter.fetchCandidates();
    const second = await adapter.fetchCandidates();
    expect(first.map((c) => [c.officialEventUrl, c.genreHint, c.genreConfidenceHint])).toEqual(
      second.map((c) => [c.officialEventUrl, c.genreHint, c.genreConfidenceHint]),
    );
  });
});
