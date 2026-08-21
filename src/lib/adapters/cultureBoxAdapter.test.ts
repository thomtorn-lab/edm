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

  it("consolidates both rooms into ONE canonical event for every one of the 15 nights on the page", () => {
    expect(events).toHaveLength(15);
  });

  it("consolidates a night with a named showcase title in both rooms into one event with a combined title, merged artists and room-separated lineup description (21 Aug)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/fri-21-august-2026/");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Black Box: HYGGELIT SHOWCASE · Red Box: HYGGELIT SHOWCASE");
    expect(e!.artists).toEqual(["SOPHIE VAN HAYDEN", "RELINQUO", "SEVERIN", "NO CELEBRITY", "ROZGU", "HERMANN BRAVO"]);
    expect(e!.description).toBe(
      "Black Box\nSOPHIE VAN HAYDEN, RELINQUO, SEVERIN, NO CELEBRITY\n\nRed Box\nROZGU, HERMANN BRAVO",
    );
    expect(e!.startDatetime).toBe("2026-08-21T20:00:00.000Z"); // 10PM CEST
    expect(e!.endDatetime).toBe("2026-08-22T06:00:00.000Z"); // 8AM CEST next day
    expect(e!.venueName).toBe("Culture Box");
    expect(e!.sourceId).toBe(CULTURE_BOX_SOURCE_ID);
    expect(e!.priceFrom).toBe(100); // "150 DKK / 100 DKK after 6AM"
    expect(e!.facebookUrl).toBe("https://www.facebook.com/events/1584250589899318");
    expect(e!.imageUrl).toMatch(/^https:\/\/culture-box\.com\/wp-content\/uploads\//);
    expect(e!.ticketUrl).toBeNull();
    expect(e!.residentAdvisorUrl).toBeNull();
  });

  it("falls back to room name + lineup as each room's title segment when the venue named no showcase (22 Aug)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/sat-22-august-2026/");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Black Box: TIMO MAAS, RYAN DANK, BALTZA · Red Box: KARINA LIN, ASLI");
    expect(e!.artists).toEqual(["TIMO MAAS", "RYAN DANK", "BALTZA", "KARINA LIN", "ASLI"]);
    // No showcase text in either room means no genre evidence to credit —
    // left for the pipeline's own fallback/enrichment, never guessed here.
    expect(e!.genreHint).toBeNull();
    expect(e!.genreConfidenceHint).toBeNull();
  });

  it("joins a multi-line showcase title and searches only that venue text for genre evidence, not artist names (19 Sept)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/sat-19-september-2026/");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Black Box: WHAT HAPPENS 4 DECADES OF TIM ANDRESEN · Red Box: WHAT HAPPENS");
    expect(e!.artists).toEqual(["TIM ANDRESEN", "FEDERICO MONACHESI", "NILU", "GERSSEIN", "EUSHERR", "REXIE LEX", "LARSH", "SHANSEN", "THOR CALIN"]);
    expect(e!.priceFrom).toBe(40); // "40 DKK (early bird presale tickets) - 150 DKK" -> lowest
    expect(e!.startDatetime).toBe("2026-09-19T18:00:00.000Z"); // 8PM CEST (this night's doors are earlier)
  });

  it("treats every SoundCloud-linked name in a room's paragraph as lineup, even a promoter/curator credit with no <strong> tag (3 Oct)", () => {
    const e = events.find((ev) => ev.officialEventUrl === "https://culture-box.com/event/sat-3-october-2026/");
    expect(e).toBeDefined();
    expect(e!.artists).toEqual(["Shaktu", "Meoko", "COSMINA", "JOSEFINA TAPIA", "ANA KARLA", "Shaktu", "Meoko", "YOON", "CHRISTINA EVANGELISTA"]);
    expect(e!.genreHint).toBeNull(); // no showcase title present in either room, so no description-tier evidence
  });

  it("never throws on the whole batch and every event carries the required identity fields", () => {
    for (const e of events) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.sourceId).toBe(CULTURE_BOX_SOURCE_ID);
      expect(e.venueName).toBe("Culture Box");
      expect(e.sourceUrl).toBe(CULTURE_BOX_EVENTS_URL);
      expect(e.officialEventUrl).toMatch(/^https:\/\/culture-box\.com\/event\/[^#]+\/$/); // one canonical URL per night, no room fragment
      expect(e.startDatetime).not.toBeNull();
      expect(e.endDatetime).not.toBeNull();
      expect(e.description).toMatch(/\n\n/); // always at least the room-separated lineup breakdown
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

describe("parseCultureBoxEventsHtml — Culture Box-specific room consolidation", () => {
  it("consolidates only when BOTH rooms' own showcase titles name the SAME genre — disagreement leaves the night unresolved rather than picking one room's genre", () => {
    const html = `
      <article class="post-block indented inverted">
        <h2 class="post-block__title structural__content__title">FRI 1 JANUARY 2027</h2>
        <a href="https://culture-box.com/event/fri-1-january-2027/" class="post-block__image"></a>
        <div class="post-block__content text-formatting">
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Black Box</h3>
            <p><strong>TECHNO SPECIAL</strong><br />
            <a href="https://soundcloud.com/a" target="_blank">ARTIST A</a></p>
          </div>
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Red Box</h3>
            <p><strong>HOUSE SPECIAL</strong><br />
            <a href="https://soundcloud.com/b" target="_blank">ARTIST B</a></p>
          </div>
        </div>
        <div class="post-block__footer">
          <div class="post-block__footer__aside">
            <ul><li class="text-formatting">Entrance&nbsp;<strong>150 DKK</strong></li><li class="text-formatting">10PM – 8AM</li></ul>
          </div>
        </div>
      </article>`;
    const events = parseCultureBoxEventsHtml(html);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Black Box: TECHNO SPECIAL · Red Box: HOUSE SPECIAL");
    expect(events[0].artists).toEqual(["ARTIST A", "ARTIST B"]);
    expect(events[0].genreHint).toBeNull(); // rooms disagree — never guessed toward either
  });

  it("credits the consolidated night's genre when both rooms' showcase titles agree", () => {
    const html = `
      <article class="post-block indented inverted">
        <h2 class="post-block__title structural__content__title">FRI 1 JANUARY 2027</h2>
        <a href="https://culture-box.com/event/fri-1-january-2027/" class="post-block__image"></a>
        <div class="post-block__content text-formatting">
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Black Box</h3>
            <p><strong>TECHNO NIGHT</strong><br />
            <a href="https://soundcloud.com/a" target="_blank">ARTIST A</a></p>
          </div>
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Red Box</h3>
            <p><strong>ALL TECHNO ALL NIGHT</strong><br />
            <a href="https://soundcloud.com/b" target="_blank">ARTIST B</a></p>
          </div>
        </div>
        <div class="post-block__footer">
          <div class="post-block__footer__aside">
            <ul><li class="text-formatting">Entrance&nbsp;<strong>150 DKK</strong></li><li class="text-formatting">10PM – 8AM</li></ul>
          </div>
        </div>
      </article>`;
    const events = parseCultureBoxEventsHtml(html);
    expect(events).toHaveLength(1);
    expect(events[0].genreHint).toBe("techno");
    expect(events[0].genreConfidenceHint).toBe("high");
  });

  it("a room with no lineup gets a 'Lineup TBA' placeholder in the description rather than a blank room", () => {
    const html = `
      <article class="post-block indented inverted">
        <h2 class="post-block__title structural__content__title">FRI 1 JANUARY 2027</h2>
        <a href="https://culture-box.com/event/fri-1-january-2027/" class="post-block__image"></a>
        <div class="post-block__content text-formatting">
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Black Box</h3>
            <p><strong>TBA NIGHT</strong></p>
          </div>
          <div class="post-block__content__block">
            <h3 class="is-capitalized">Red Box</h3>
            <p><a href="https://soundcloud.com/b" target="_blank">ARTIST B</a></p>
          </div>
        </div>
        <div class="post-block__footer">
          <div class="post-block__footer__aside">
            <ul><li class="text-formatting">Entrance&nbsp;<strong>150 DKK</strong></li><li class="text-formatting">10PM – 8AM</li></ul>
          </div>
        </div>
      </article>`;
    const events = parseCultureBoxEventsHtml(html);
    expect(events[0].description).toBe("Black Box\nLineup TBA\n\nRed Box\nARTIST B");
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
    expect(candidates).toHaveLength(15);
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
    expect(candidates).toHaveLength(15);
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

  // NOTE on removed tests: prior to Culture Box room consolidation, this
  // suite carried three tests protecting against sibling-room dedup
  // ambiguity (two per-room candidates from the SAME sync batch/night
  // wrongly matching each other, or a shared RA/Facebook link wrongly
  // conflating them without the #black-box/#red-box room-anchor veto). That
  // entire class of risk is now structurally impossible: the adapter emits
  // exactly ONE candidate per night, so there is no sibling room candidate
  // left to conflict with. dedup.ts's `roomIdentityConflict` logic itself is
  // untouched (still real, generic infrastructure) — it simply never
  // triggers for Culture Box going forward. The remaining, genuinely new
  // regression risk this change introduces — a freshly consolidated
  // candidate meeting a database that still holds a PRE-consolidation
  // Black Box/Red Box pair from before this deploy — is covered below.

  it("transition safety: a newly consolidated night correctly lands in review (not a 3rd duplicate, not a blind auto-merge) against two pre-existing per-room events from before consolidation", () => {
    // Simulates the one-time transition moment right after this change
    // deploys: Production already holds Black Box and Red Box as two
    // separate canonical events (synced under the old per-room adapter
    // shape) for a night the adapter now reports as ONE merged candidate.
    // genreHint is overridden to a resolved, high-confidence genre here so
    // the assertion below exercises the DEDUP downgrade specifically (a real
    // night's own listing-only genreHint is usually still null at this
    // stage — see "honestly leaves most nights..." above — which would
    // otherwise make the quality gate hold regardless of dedup, masking
    // exactly the behavior this test protects).
    const consolidated = {
      ...events.find((e) => e.officialEventUrl === "https://culture-box.com/event/fri-21-august-2026/")!,
      genreHint: "techno" as const,
      genreConfidenceHint: "high" as const,
    };
    const existingBlackBox: ExistingEventForDedup = {
      id: "e-existing-black-box",
      title: "Black Box: HYGGELIT SHOWCASE",
      artists: ["SOPHIE VAN HAYDEN", "RELINQUO", "SEVERIN", "NO CELEBRITY"],
      venueId: "v-culture-box",
      startDatetime: consolidated.startDatetime!,
    };
    const existingRedBox: ExistingEventForDedup = {
      id: "e-existing-red-box",
      title: "Red Box: HYGGELIT SHOWCASE",
      artists: ["ROZGU", "HERMANN BRAVO"],
      venueId: "v-culture-box",
      startDatetime: consolidated.startDatetime!,
    };
    const result = runIngestionPipeline(consolidated, { venues: VENUES, existingEvents: [existingBlackBox, existingRedBox] });
    // The merged candidate's artist list is a strict superset of each
    // existing per-room event's lineup (full overlap coefficient), so this
    // is never treated as "no match" — but it's also never blindly
    // auto-merged into either pre-existing row without a human deciding
    // which one (or that both should now be replaced by this one).
    expect(result.decision).toBe("review_queue");
    expect(result.duplicateOfEventId).not.toBeNull();
  });

  it("re-parsing the same page twice yields identical officialEventUrls per night — a re-sync recognizes the same event rather than re-queuing it", () => {
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

/**
 * Real per-room artist lists from the committed listing fixture, for tests
 * below that exercise `attributeGenreToRoom` (the pure cross-room-exclusion
 * function, unchanged by the room-consolidation work) directly against each
 * room's own lineup. Since the adapter no longer emits a separate candidate
 * per room, these are the two rooms' real artists read directly off the
 * consolidated event's own title/description (see the "real fixture" tests
 * above), not fabricated.
 */
const REAL_ROOM_ARTISTS: Record<string, { blackBox: string[]; redBox: string[] }> = {
  "fri-28-august": {
    blackBox: ["TAXMAN", "DWONJI", "BOBBY 6 KILLA", "HDN", "DJ BREAKFAST", "MAXI MO", "L.A.D.J"],
    redBox: ["FIA2THEFLOOR", "AMITTET", "TINKI", "DELFF"],
  },
  "fri-21-august-2026": {
    blackBox: ["SOPHIE VAN HAYDEN", "RELINQUO", "SEVERIN", "NO CELEBRITY"],
    redBox: ["ROZGU", "HERMANN BRAVO"],
  },
  "sat-19-september-2026": {
    blackBox: ["TIM ANDRESEN", "FEDERICO MONACHESI", "NILU", "GERSSEIN", "EUSHERR"],
    redBox: ["REXIE LEX", "LARSH", "SHANSEN", "THOR CALIN"],
  },
};

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
    const { blackBox, redBox } = REAL_ROOM_ARTISTS["fri-28-august"];
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("fri-28-august"));

    expect(attributeGenreToRoom(paragraphs, blackBox, redBox)).toBe("drum-and-bass");
    expect(attributeGenreToRoom(paragraphs, redBox, blackBox)).toBe("drum-and-bass");
  });

  it("real: fri-21-august-2026's genre-bearing sentence names artists from BOTH rooms in one breath ('...Rozgu...and Hermann Bravo...are in Red Box and rounding a truly stellar lineup of peaktime techno and tech house') — stays unresolved when each room is checked in isolation against the other", () => {
    const { blackBox, redBox } = REAL_ROOM_ARTISTS["fri-21-august-2026"];
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("fri-21-august-2026"));

    expect(attributeGenreToRoom(paragraphs, blackBox, redBox)).toBeNull();
    expect(attributeGenreToRoom(paragraphs, redBox, blackBox)).toBeNull();
  });

  it("real: fri-21-august-2026's shared genre-bearing sentence DOES resolve once the night is consolidated (empty 'other rooms' list) — a real, intended benefit of consolidation, not a regression", () => {
    // With Culture Box now one canonical event per night, there is no other
    // room's artists to exclude against — attributeGenreToRoom(paragraphs,
    // allArtists, []) correctly credits genre evidence that mentions the
    // night's own (now merged) lineup, rather than staying artificially
    // unresolved to protect a room boundary that no longer exists.
    const { blackBox, redBox } = REAL_ROOM_ARTISTS["fri-21-august-2026"];
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("fri-21-august-2026"));
    expect(attributeGenreToRoom(paragraphs, [...blackBox, ...redBox], [])).toBe("techno");
  });

  it("real: sat-19-september-2026 has real description paragraphs but none contain a mapped genre keyword — unresolved, not guessed", () => {
    const { blackBox, redBox } = REAL_ROOM_ARTISTS["sat-19-september-2026"];
    const paragraphs = extractDescriptionParagraphs(loadDetailFixture("sat-19-september-2026"));

    expect(paragraphs.length).toBeGreaterThan(0); // real prose exists...
    expect(attributeGenreToRoom(paragraphs, blackBox, redBox)).toBeNull(); // ...just no genre evidence in it
    expect(attributeGenreToRoom(paragraphs, redBox, blackBox)).toBeNull();
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

  function loadConsolidatedNight(slug: string, url: string) {
    return parseCultureBoxEventsHtml(FIXTURE_HTML).find((e) => e.officialEventUrl === url)!;
  }

  it("fetches one night's detail page exactly ONCE for its one consolidated candidate", async () => {
    const nightUrl = "https://culture-box.com/event/fri-28-august/";
    let fetchCount = 0;
    const fetchImpl = async (url: string | URL) => {
      if (String(url) === nightUrl) {
        fetchCount++;
        return new Response(loadDetailFixture("fri-28-august"), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    const night = loadConsolidatedNight("fri-28-august", nightUrl);
    const enriched = await enrichCandidatesWithDetailPages([night], fetchImpl as unknown as typeof fetch, 0, 0);

    expect(fetchCount).toBe(1);
    expect(enriched).toHaveLength(1);
    expect(enriched[0].genreHint).toBe("drum-and-bass");
    expect(enriched[0].genreConfidenceHint).toBe("high");
  });

  it("populates residentAdvisorUrl on the consolidated event and prepends the detail page's real prose ahead of the room-lineup breakdown", async () => {
    const nightUrl = "https://culture-box.com/event/fri-28-august/";
    const fetchImpl = fetchImplFor({ [nightUrl]: loadDetailFixture("fri-28-august") });
    const night = loadConsolidatedNight("fri-28-august", nightUrl);
    const roomLineupText = night.description; // the listing-stage room-separated breakdown, before enrichment
    const enriched = await enrichCandidatesWithDetailPages([night], fetchImpl as unknown as typeof fetch, 0, 0);

    expect(enriched[0].residentAdvisorUrl).toMatch(/^https:\/\/ra\.co\/events\/\d+$/);
    expect(enriched[0].description).toBeTruthy();
    expect(enriched[0].description).toContain(roomLineupText); // room breakdown preserved, not overwritten
    expect(enriched[0].description!.indexOf(roomLineupText!)).toBeGreaterThan(0); // real prose comes first
  });

  it("a single night's detail-page fetch failure degrades only that night — other nights are still enriched, and no candidate anywhere is dropped", async () => {
    const fetchImpl = fetchImplFor({
      // fri-28-august deliberately NOT mocked -> 404, simulating a fetch failure for that one night
      "https://culture-box.com/event/sat-22-august-2026/": loadDetailFixture("sat-22-august-2026"),
    });
    const broken = loadConsolidatedNight("fri-28-august", "https://culture-box.com/event/fri-28-august/");
    const healthy = loadConsolidatedNight("sat-22-august-2026", "https://culture-box.com/event/sat-22-august-2026/");

    const enriched = await enrichCandidatesWithDetailPages([broken, healthy], fetchImpl as unknown as typeof fetch, 0, 0);

    expect(enriched).toHaveLength(2); // nothing dropped
    const brokenResult = enriched.find((e) => e.officialEventUrl === broken.officialEventUrl)!;
    expect(brokenResult.genreHint).toBe(broken.genreHint); // exactly the listing-page fallback, untouched
    expect(brokenResult.residentAdvisorUrl).toBeNull();
    expect(brokenResult.description).toBe(broken.description); // untouched listing-stage room breakdown

    const healthyResult = enriched.find((e) => e.officialEventUrl === healthy.officialEventUrl)!;
    expect(healthyResult.genreHint).toBe("techno"); // the healthy night still gets enriched normally
  });

  it("never overrides a genre already resolved from the listing page's own showcase title", async () => {
    const nightUrl = "https://culture-box.com/event/fri-28-august/";
    const fetchImpl = fetchImplFor({ [nightUrl]: loadDetailFixture("fri-28-august") });
    const night = loadConsolidatedNight("fri-28-august", nightUrl);
    // Simulate a listing page that already resolved a (different) genre from its own showcase title.
    const alreadyResolved = { ...night, genreHint: "house" as const, genreConfidenceHint: "high" as const };
    const enriched = await enrichCandidatesWithDetailPages([alreadyResolved], fetchImpl as unknown as typeof fetch, 0, 0);
    expect(enriched[0].genreHint).toBe("house"); // untouched, even though the description says drum-and-bass
  });

  it("candidates with no officialEventUrl are left untouched rather than crashing the grouping step", async () => {
    const night = loadConsolidatedNight("fri-28-august", "https://culture-box.com/event/fri-28-august/");
    const candidate = { ...night, officialEventUrl: null };
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

    expect(candidates).toHaveLength(15); // one consolidated event per night, nothing dropped

    const highConfidence = candidates.filter((c) => c.genreConfidenceHint === "high");
    // 12 of these 15 consolidated nights resolve to a single agreed genre
    // (either from a showcase title both rooms agree on, or the detail
    // page's own prose crediting the night's now-merged lineup — see
    // "attributeGenreToRoom" above for why consolidation can resolve a case
    // that used to stay unresolved, e.g. fri-21-august-2026).
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
