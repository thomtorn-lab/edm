import { describe, expect, it } from "vitest";
import { runIngestionPipeline, applyEnrichedGenre, type ExistingEventForDedup } from "./pipeline";
import { VENUES } from "../data/venues";
import type { RawCandidateEvent } from "./types";

function raw(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
  return {
    sourceId: "src-culture-box",
    sourceUrl: "https://culture-box.com/events/example",
    title: "Box Standard",
    description: "A night of techno and melodic techno.",
    artists: ["NAILS", "TEODORA LUX"],
    startDatetime: "2026-08-14T23:30:00+02:00",
    endDatetime: "2026-08-15T06:00:00+02:00",
    venueName: "Culture Box",
    officialEventUrl: "https://culture-box.com/events/example",
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    priceFrom: 120,
    genreHint: "techno",
    genreConfidenceHint: "high",
    ...overrides,
  };
}

describe("runIngestionPipeline", () => {
  it("auto-publishes a complete, high-confidence, non-duplicate record", () => {
    const result = runIngestionPipeline(raw(), { venues: VENUES, existingEvents: [] });
    expect(result.decision).toBe("auto_publish");
    expect(result.resolvedVenueId).toBe("v-culture-box");
    expect(result.missingFields).toHaveLength(0);
  });

  it("holds a record missing required fields", () => {
    const result = runIngestionPipeline(raw({ venueName: null }), { venues: VENUES, existingEvents: [] });
    expect(result.decision).toBe("hold");
    expect(result.missingFields).toContain("venue");
  });

  it("falls back to deterministic keyword mapping when no genre hint is present", () => {
    const result = runIngestionPipeline(raw({ genreHint: null, genreConfidenceHint: null, title: "Hard Techno Night" }), {
      venues: VENUES,
      existingEvents: [],
    });
    expect(result.genre).toBe("hard-techno");
    expect(result.genreConfidence).toBe("medium");
    expect(result.decision).toBe("review_queue");
  });

  it("holds when genre cannot be determined at all", () => {
    const result = runIngestionPipeline(
      raw({ genreHint: null, genreConfidenceHint: null, title: "Friday Night Out", description: "Drinks and vibes." }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBeNull();
    expect(result.decision).toBe("hold");
  });

  it("routes a likely duplicate to the review queue instead of auto-publishing", () => {
    const existing: ExistingEventForDedup[] = [
      { id: "e-existing", title: "Box Standard", artists: ["NAILS", "TEODORA LUX"], venueId: "v-culture-box", startDatetime: "2026-08-14T23:00:00+02:00" },
    ];
    const result = runIngestionPipeline(raw(), { venues: VENUES, existingEvents: existing });
    expect(result.duplicateOfEventId).toBe("e-existing");
    expect(result.duplicateConfidence).toBe("high");
    expect(result.decision).toBe("review_queue");
  });

  it("does not treat an unresolvable venue name as a pass", () => {
    const result = runIngestionPipeline(raw({ venueName: "Some Unknown Bar" }), { venues: VENUES, existingEvents: [] });
    expect(result.resolvedVenueId).toBeNull();
    expect(result.decision).toBe("hold");
  });
});

describe("source-aware relevance evidence (data-quality Workstream A — a generalist venue's broad category tag is never conclusive on its own)", () => {
  it("does not auto-publish a non-electronic headliner just because the venue's own broad 'electronic-other' category says so (Dizzee Rascal-type regression case)", () => {
    // Mirrors what a generalist venue adapter (e.g. Pumpehuset) supplies when
    // its only evidence is a broad, venue-wide "Elektronisk" filter tag: the
    // generic electronic-other floor at official-source-metadata/high
    // confidence, with no specific subgenre match — and the venue's own bio
    // text is centered on a different genre (grime/rap).
    const result = runIngestionPipeline(
      raw({
        title: "Dizzee Rascal",
        description: "Dizzee Rascal is a pioneering grime and hip hop MC, headlining a huge live show.",
        artists: ["Dizzee Rascal"],
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.decision).not.toBe("auto_publish");
  });

  it("does not auto-publish a metal show just because an isolated electronic-sounding keyword appears in otherwise non-electronic copy (MASTER BOOT RECORD + Fulci-type regression case)", () => {
    // "industrial" is genuinely matched (a specific, non-generic subgenre) at
    // official-description/high tier — exactly what a source's own support-
    // band-bio text evidence would credit — but the same official text is
    // centered on metal: an isolated word in otherwise non-electronic artist
    // copy must never carry an auto-publish on its own, no matter how "high"
    // the claimed confidence.
    const result = runIngestionPipeline(
      raw({
        title: "MASTER BOOT RECORD + Fulci",
        description:
          "MASTER BOOT RECORD blends chiptune and industrial metal soundscapes. Fulci is an Italian death metal band.",
        artists: ["MASTER BOOT RECORD", "Fulci"],
        genreHint: "industrial",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBe("industrial"); // evidence is real, just not sufficient alone
    expect(result.decision).not.toBe("auto_publish");
  });

  it("still auto-publishes a genuine electronic event even from a generalist-venue-style source, when a specific subgenre is corroborated in the venue's own official text (official-description/high tier, like Pumpehuset/Hangaren's own bio-text credit)", () => {
    const result = runIngestionPipeline(
      raw({
        title: "Amelie Lens",
        description: "An unmissable night of hard techno from one of the scene's leading names.",
        artists: ["Amelie Lens"],
        genreHint: "hard-techno",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBe("hard-techno");
    expect(result.decision).toBe("auto_publish");
  });

  it("does not downgrade a genuinely industrial-techno event just because 'industrial' was matched (Intercell-type case: industrial alone, no metal/punk/etc. signal, is not a negative signal)", () => {
    const result = runIngestionPipeline(
      raw({
        title: "Intercell",
        description: "A night of driving industrial techno.",
        artists: ["Intercell"],
        genreHint: "industrial",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBe("industrial");
    expect(result.decision).toBe("auto_publish");
  });

  it("caps a bare, uncorroborated generic electronic tag at review_queue even with no negative genre signal present at all", () => {
    const result = runIngestionPipeline(
      raw({
        title: "Friday Club Night",
        description: "Doors at 11pm, resident DJs all night.",
        artists: [],
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.decision).not.toBe("auto_publish");
  });

  it("auto-publishes a genuine electronic event on a generic category floor when the venue's own text explicitly asserts the artist/event's sound is electronic, even without a named specific subgenre (WITCHZ-type case, real Pumpehuset evidence)", () => {
    const result = runIngestionPipeline(
      raw({
        title: "WITCHZ",
        description:
          "Den amerikanske artist WITCHZ står klar til at forvandle Pumpehuset til et univers af dybe baslinjer, luftige vokaler og sin dragende, elektroniske lyd. En lyd der bevæger sig mellem alternativ pop, mørk electronica og industriel phonk.",
        artists: ["WITCHZ"],
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBe("electronic-other");
    expect(result.decision).toBe("auto_publish");
  });

  it("auto-publishes on a generic category floor when the source's own ticket link corroborates via Resident Advisor, a trusted electronic-music-specific aggregator (Cassius/MPH-type case)", () => {
    const result = runIngestionPipeline(
      raw({
        title: "Cassius CLUB 360°",
        description: "Special guest announced later.",
        artists: ["Cassius"],
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
        residentAdvisorUrl: "https://ra.co/events/2489286",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.decision).toBe("auto_publish");
  });

  it("assesses a real UK Garage/bassline act from its own official text, not artist-name hardcoding (Silva Bumpa-type case)", () => {
    // genreHint/genreConfidenceHint set the way the real adapter's own
    // resolveGenre() would: a specific keyword genuinely matched in the
    // venue's own official text is official-description/high tier, not the
    // pipeline's own medium-confidence deterministic-mapping fallback.
    const result = runIngestionPipeline(
      raw({
        title: "Silva Bumpa",
        description: "Klar til at indtage Danmark med sin energiske blanding af UK Garage, bassline og speed garage.",
        artists: ["Silva Bumpa"],
        genreHint: "garage",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBe("garage");
    expect(result.decision).toBe("auto_publish");
  });
});

describe("moved/rescheduled first-party events (data-quality Workstream C)", () => {
  const existingSameSource: ExistingEventForDedup = {
    id: "e-tonser-old",
    title: "tonser",
    artists: ["tonser"],
    venueId: "v-pumpehuset",
    startDatetime: "2026-09-19T21:00:00+02:00",
    sourceId: "src-pumpehuset",
    officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2026/",
    ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
    residentAdvisorUrl: null,
  };

  it("attaches a same-source candidate at a new date/URL to the existing published event when it shares a ticket URL (tonser-type regression case) — never leaves a stale canonical alongside its replacement", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "tonser",
        artists: ["tonser"],
        venueName: "Pumpehuset",
        startDatetime: "2027-02-20T21:00:00+01:00",
        officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2027-flyttet/",
        ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [existingSameSource] },
    );
    expect(result.duplicateOfEventId).toBe("e-tonser-old");
    expect(result.duplicateConfidence).toBe("high");
  });

  it("never merges/hides solely because artist/title happens to match — no shared URL, no reschedule wording", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "tonser",
        artists: ["tonser"],
        venueName: "Pumpehuset",
        startDatetime: "2027-02-20T21:00:00+01:00",
        officialEventUrl: "https://pumpehuset.dk/koncerter/tonser-2027-new-show/",
        ticketUrl: "https://www.ticketmaster.dk/event/tonser-new-billetter/999999",
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [existingSameSource] },
    );
    expect(result.duplicateOfEventId).toBeNull();
  });

  it("never checks a moved-event match across a different source", () => {
    const differentSourceExisting: ExistingEventForDedup = { ...existingSameSource, sourceId: "src-hangaren" };
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "tonser",
        artists: ["tonser"],
        venueName: "Pumpehuset",
        startDatetime: "2027-02-20T21:00:00+01:00",
        ticketUrl: "https://www.ticketmaster.dk/event/tonser-billetter/123456",
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
      }),
      { venues: VENUES, existingEvents: [differentSourceExisting] },
    );
    expect(result.duplicateOfEventId).toBeNull();
  });
});

describe("applyEnrichedGenre", () => {
  function unresolvedResult() {
    return runIngestionPipeline(
      raw({ genreHint: null, genreConfidenceHint: null, title: "Friday Night Out", description: "Drinks and vibes." }),
      { venues: VENUES, existingEvents: [] },
    );
  }

  it("moves an unresolved (hold) record into review_queue at medium confidence — never auto_publish", () => {
    const held = unresolvedResult();
    expect(held.decision).toBe("hold");

    const enriched = applyEnrichedGenre(held, "house", "medium", "", false);
    expect(enriched.genre).toBe("house");
    expect(enriched.genreConfidence).toBe("medium");
    expect(enriched.decision).toBe("review_queue");
  });

  it("throws rather than silently accept 'high' confidence from an enrichment source", () => {
    const held = unresolvedResult();
    expect(() => applyEnrichedGenre(held, "house", "high", "", false)).toThrow();
  });

  it("never overrides genre evidence the deterministic classifier already found", () => {
    // genreHint: techno/high, refined to melodic-techno by the genre-precision
    // text refinement (the fixture's own description says "melodic techno").
    const resolved = runIngestionPipeline(raw(), { venues: VENUES, existingEvents: [] });
    expect(resolved.genre).toBe("melodic-techno");
    const result = applyEnrichedGenre(resolved, "house", "medium", "", false);
    expect(result).toBe(resolved); // untouched — same object, not just same values
  });

  it("still holds if enrichment resolves nothing new (a low-confidence caller should never call this, but stay safe if it did)", () => {
    const held = unresolvedResult();
    const enriched = applyEnrichedGenre(held, "house", "low", "", false);
    // low confidence still doesn't clear the gate — same as the deterministic path would.
    expect(enriched.decision).toBe("hold");
  });
});

describe("applyEnrichedGenre — CASE B: weak-evidence corroboration (follow-up review, weak-evidence enrichment)", () => {
  function weakFloorResult() {
    // A broad-category-only event: genre resolves to the generic floor at
    // high confidence (mirrors Pumpehuset's own "Elektronisk" filter), but
    // no event-specific text corroborates relevance — same shape as the
    // real Byhaven free-entry review cases.
    return runIngestionPipeline(
      raw({
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
        title: "Byhaven: Some Free Night",
        description: "Free entry. DJ sets all night.",
        artists: ["DJ One", "DJ Two"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
  }

  it("is a genuine setup precondition: category floor genre, 'weak' relevance, review_queue", () => {
    const weak = weakFloorResult();
    expect(weak.genre).toBe("electronic-other");
    expect(weak.relevance).toBe("weak");
    expect(weak.decision).toBe("review_queue");
  });

  it("upgrades weak to strong (auto_publish) when Discogs resolves a SPECIFIC subgenre — becomes the event's own genre, same as a first-party keyword match", () => {
    const weak = weakFloorResult();
    const enriched = applyEnrichedGenre(weak, "house", "medium", "Free entry. DJ sets all night.", false);
    expect(enriched.genre).toBe("house");
    expect(enriched.genreConfidence).toBe("high"); // stays tied to the event's own already-high-confidence floor, not Discogs's own (capped) confidence
    expect(enriched.relevance).toBe("strong");
    expect(enriched.decision).toBe("auto_publish");
  });

  it("upgrades weak to strong when Discogs only confirms generic 'electronic' (no specific style) — genre stays electronic-other, but the independent corroboration itself is the strong signal", () => {
    const weak = weakFloorResult();
    const enriched = applyEnrichedGenre(weak, "electronic-other", "medium", "Free entry. DJ sets all night.", false);
    expect(enriched.genre).toBe("electronic-other");
    expect(enriched.genreConfidence).toBe("high"); // unchanged — Discogs added a relevance signal, not new genre precision
    expect(enriched.relevance).toBe("strong");
    expect(enriched.decision).toBe("auto_publish");
  });

  it("leaves a weak verdict exactly as weak when enrichment resolves nothing (never called at all when the Discogs lookup itself failed/found nothing — absence of Discogs data must never become negative evidence)", () => {
    const weak = weakFloorResult();
    // Mirrors the real call site: enrichEventGenre returning no genre means
    // sync.ts never calls applyEnrichedGenre at all — the record is simply
    // untouched, still "weak"/review_queue.
    expect(weak.relevance).toBe("weak");
    expect(weak.decision).toBe("review_queue");
  });

  it("never turns weak into 'none'/hold — enrichment can only strengthen, never weaken", () => {
    const weak = weakFloorResult();
    const enriched = applyEnrichedGenre(weak, "house", "medium", "Free entry. DJ sets all night.", false);
    expect(enriched.decision).not.toBe("hold");
  });

  it("does not touch an event whose relevance is already strong (nothing to corroborate)", () => {
    const strong = runIngestionPipeline(
      raw({
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
        title: "WITCHZ",
        description: "sin dragende, elektroniske lyd",
        artists: ["WITCHZ"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(strong.decision).toBe("auto_publish");
    const result = applyEnrichedGenre(strong, "house", "medium", "sin dragende, elektroniske lyd", false);
    expect(result).toBe(strong); // untouched — same object
  });

  it("does not touch an already-genuinely-specific genre (nothing to corroborate)", () => {
    const specific = runIngestionPipeline(raw(), { venues: VENUES, existingEvents: [] }); // melodic-techno, per the fixture
    expect(specific.genre).toBe("melodic-techno");
    const result = applyEnrichedGenre(specific, "house", "medium", "", false);
    expect(result).toBe(specific); // untouched — same object
  });
});
