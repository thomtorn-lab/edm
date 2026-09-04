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

  // Public event-integrity audit (2026-09-04): title sanitization is applied
  // exactly once, here, by mutating the candidate object in place — every
  // downstream consumer (src/db/sync.ts's create/patch writes, discovery-
  // queue insert) reads raw.title from this SAME object afterwards, so this
  // proves the fix actually reaches storage rather than only existing as an
  // unused helper. See sanitizeExtractedTitle in htmlExtraction.ts.
  it("sanitizes a contaminated title in place, before it's used for dedup or storage", () => {
    const candidate = raw({
      title: "Endurance One last Hangaren session in 2026, do not miss out — grab your presale tickets. View Event →",
    });
    runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [] });
    expect(candidate.title).not.toContain("View Event");
    expect(candidate.title.startsWith("Endurance")).toBe(true);
  });

  it("leaves an already-clean title byte-for-byte unchanged", () => {
    const candidate = raw({ title: "Endurance" });
    runIngestionPipeline(candidate, { venues: VENUES, existingEvents: [] });
    expect(candidate.title).toBe("Endurance");
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

describe("Final EDM Relevance Rule (2026-08-30) — relevanceText must carry the same evidence genre resolution itself used", () => {
  // Real production incident, exactly as it happened on the 2026-08-30
  // Pumpehuset sync: Käärijä's own detail-page bio is Danish, so the
  // adapter's English-language guard nulls `description` for public
  // display — but genre resolution (and Discogs enrichment afterward) had
  // already used the FULL bio as evidence, including "...Pumpehuset bliver
  // fyldt af hans karakteristiske mix af elektroniske beats, punk-rap og
  // energifyldt klublyd" (his own description of his sound, naming
  // punk-rap as part of the mix — a real non-electronic signal). Before
  // this fix, that evidence was silently discarded before relevance ever
  // saw it (relevanceText was reconstructed from `description`, already
  // null), so a Discogs "Electro" style match on one of his releases sailed
  // through unopposed to auto_publish. Käärijä is fundamentally a pop/rap
  // crossover artist (Eurovision 2023 viral hit "Cha Cha Cha") — not
  // defined by EDM — so this must never reach auto_publish.
  //
  // With BOTH fixes in place (relevanceText carrying his real bio, and
  // "beats" no longer alone sufficient for hasExplicitElectronicAssertion —
  // see relevance.ts's EXPLICIT_ELECTRONIC_ASSERTION_RE doc comment), his
  // own bio's only textual evidence is "elektroniske beats" (no longer a
  // strong signal) contradicted by "punk-rap" (still a real negative
  // signal) — so the pipeline now holds him with negative_relevance at
  // initial classification, BEFORE Discogs enrichment ever runs (see
  // db/sync.ts's needsEnrichment guard, which deliberately skips enrichment
  // once holdReason is already "negative_relevance" — a stronger, cheaper
  // fix than relying on relevance being merely "weak" post-enrichment).
  const kaarijaBio =
    'Finsk Eurovision-superstjerne kommer forbi Danmark. Efter at have lanceret det største show i sin karriere i Veikkaus Arena i Helsinki næste forår, fortsætter Käärijä sit store koncertår med at indtage Europa på sin hidtil mest omfattende turné i efteråret 2026. Eurodisko Tour byder på 24 shows. Käärijä er blevet et internationalt fænomen og har modtaget fem finske Grammy-priser samt prisen som Best Nordic Artist ved MTV EMA. Han skrev finsk musikhistorie ved at vinde publikumsafstemningen ved Eurovision Song Contest 2023 med sangen "Cha Cha Cha". Pumpehuset bliver fyldt af hans karakteristiske mix af elektroniske beats, punk-rap og energifyldt klublyd.';

  it("Käärijä: real bio surfaces a genuine 'punk-rap' negative signal once relevanceText carries it, holding a Discogs-corroborated specific genre instead of letting it auto_publish", () => {
    const withoutRelevanceText = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "Käärijä",
        description: null, // nulled by the adapter's English-language guard, same as real Production
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
        artists: ["Käärijä"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    // The Discogs corroboration step (applyEnrichedGenre) as sync.ts calls
    // it — BEFORE the fix, its relevanceText argument was reconstructed
    // from `description` alone (null here), so it never saw the negative
    // "punk-rap" signal either.
    const enrichedWithoutRelevanceText = applyEnrichedGenre(withoutRelevanceText, "electro", "medium", "Käärijä", false);
    expect(enrichedWithoutRelevanceText.decision).toBe("auto_publish"); // the real, now-fixed bug — documents the failure mode this test guards against

    const withRelevanceText = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "Käärijä",
        description: null,
        relevanceText: kaarijaBio, // what pumpehusetAdapter.ts now populates before nulling description
        genreHint: "electronic-other",
        genreConfidenceHint: "high",
        artists: ["Käärijä"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    // "punk-rap" is real, unsuppressed negative evidence, and "elektroniske
    // beats" no longer counts as a strong offsetting signal — genuinely no
    // evidence left to justify publishing, so this holds outright rather
    // than merely landing in review.
    expect(withRelevanceText.relevance).toBe("none");
    expect(withRelevanceText.decision).toBe("hold");
    expect(withRelevanceText.holdReason).toBe("negative_relevance");
    expect(withRelevanceText.decision).not.toBe("auto_publish");
  });

  // Real production incident: Tinie Tempah's own Danish bio says "Hans
  // ørehængende blanding af hiphop, grime og pop..." (his own genre, in his
  // own words) in the same paragraph that name-drops collaborator "Swedish
  // House Mafia" — whose own name contains the bare word "house", producing
  // a false-positive deterministic genre match with nothing to do with
  // Tinie Tempah's own sound. Before this fix, the Danish bio (including
  // the real "hiphop, grime og pop" self-description) was nulled for
  // display and never reached relevance assessment at all.
  const tinieTempahBio =
    "Den britiske rapstjerne og hitmager Tinie Tempah rammer Pumpehuset med et katalog fyldt med internationale hits. Hans ørehængende blanding af hiphop, grime og pop krydret med en karismatisk scenetilstedeværelse har resulteret i samarbejder med blandt andre Calvin Harris, Zara Larsson, Wiz Khalifa, Ellie Goulding, Swedish House Mafia, Jess Glynne og Kelly Rowland.";

  it("Tinie Tempah: a collaborator name-drop ('Swedish House Mafia') produces a false 'house' genre match, but relevanceText now also carries his own 'hiphop, grime og pop' self-description to weigh against it", () => {
    const withoutRelevanceText = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "Tinie Tempah",
        description: null,
        genreHint: "house", // the real false-positive deterministicGenreFromText match on "Swedish House Mafia"
        genreConfidenceHint: "high",
        artists: ["Tinie Tempah"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(withoutRelevanceText.decision).toBe("auto_publish"); // the real, now-fixed bug

    const withRelevanceText = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "Tinie Tempah",
        description: null,
        relevanceText: tinieTempahBio,
        genreHint: "house",
        genreConfidenceHint: "high",
        artists: ["Tinie Tempah"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(withRelevanceText.relevance).toBe("weak"); // his own "hiphop, grime og pop" is real, unsuppressed negative evidence
    expect(withRelevanceText.decision).toBe("review_queue"); // fixed: no longer auto-published
  });

  it("does not suppress a genuinely EDM-crossover borderline artist just because pop/R&B is mentioned as an INFLUENCE alongside a real specific-genre match (MNEK-type reference case — house/UK garage genuinely substantial to the artist's identity stays reviewable, not auto-excluded)", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "MNEK",
        description: null,
        relevanceText:
          "MNEK er en britisk sanger og producer, hvis egen lyd bevæger sig i krydsfeltet mellem UK garage, house og pop-krydsfelt-hits.",
        genreHint: "house",
        genreConfidenceHint: "high",
        artists: ["MNEK"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    // A real specific-genre match (house) with no contradicting negative
    // signal in this text stays a genuine strong signal — still correctly
    // publishable/reviewable, not wrongly held, unlike Käärijä/Tinie Tempah
    // above where a real negative signal was present.
    expect(result.relevance).toBe("strong");
    expect(result.decision).toBe("auto_publish");
  });
});

describe("Binding reference regression suite — Final EDM Relevance Rule (2026-08-30 audit)", () => {
  // Every case below exercises the GENERAL pipeline/relevance functions —
  // none of them special-case an artist or event name. Byhaven: Juno +
  // MONSUN, the two EPIC Drag Show fixtures, and Twilight Rave don't have a
  // captured detail-page fixture the way Käärijä/Tinie Tempah/WITCHZ do, so
  // their bio text below is realistic constructed copy built directly from
  // the user's own binding characterization of each ("synth-pop/alt-pop",
  // "drag/performance core, music supports the show", "mainly soundtracks/
  // dark pop/emo/indie/2000s hits") — the same technique already used for
  // the MNEK positive control above.

  it("Byhaven: Juno + MONSUN — a synth-pop/alt-pop bill stays capped below auto_publish even with a broad venue-level 'Elektronisk' tag and no contradicting genre-word", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "Byhaven: Juno + MONSUN",
        description: null,
        // A broad venue/platform tag alone (medium confidence, per the genre
        // evidence hierarchy) — the same kind of secondary "Elektronisk" tag
        // that legitimately justifies DISCOVERY (Pumpehuset completeness
        // fix), not yet event-specific corroboration.
        genreHint: "electronic-other",
        genreConfidenceHint: "medium",
        relevanceText:
          "Byhaven byder på en aften med MONSUN og Juno, to af den danske alt-pop-scenes mest efterspurgte navne. MONSUN er kendt for sine melankolske synths og fængende omkvæd, mens Juno bidrager med sin egen blanding af dreampop og introspektiv sangskrivning.",
        artists: ["MONSUN", "Juno"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    // No specific EDM subgenre keyword and no first-party "this is
    // electronic music" self-description anywhere in the text — only the
    // generic category floor, so relevance can never clear "strong".
    expect(result.relevance).not.toBe("strong");
    expect(result.decision).not.toBe("auto_publish");
  });

  it("The EPIC Drag Show — DJ presence and pop/R&B hits are not, on their own, EDM evidence (music supports the show, not the reverse)", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "The EPIC Drag Show",
        description: null,
        genreHint: null, // let deterministic keyword mapping run — nothing in this text should match
        relevanceText:
          "The EPIC Drag Show er en overdådig aften med Danmarks skarpeste dragqueens, kostumeskift og liveoptrædener. DJ'en holder gulvet fyldt hele natten med et miks af pop- og R&B-hits, mens værterne guider publikum gennem showets numre.",
        artists: [],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBeNull(); // no EDM subgenre keyword anywhere — "DJ" and "pop/R&B hits" alone never resolve one
    expect(result.decision).not.toBe("auto_publish");
  });

  it("The EPIC Halloween Drag Show — same drag/performance-core pattern under different seasonal copy, confirming this is a general rule and not a fixed phrase match", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "The EPIC Halloween Drag Show",
        description: null,
        genreHint: null,
        relevanceText:
          "Tag kostumet på og mød op til årets uhyggeligste dragshow. The EPIC Halloween Drag Show byder på gyseragtige looks, konkurrencer om bedste kostume, og en DJ der spiller de største Halloween-hits og pop-klassikere hele aftenen.",
        artists: [],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBeNull();
    expect(result.decision).not.toBe("auto_publish");
  });

  it("KLIKEN — 'electronic beats' alone (no named subgenre) is not sufficient EDM evidence", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "KLIKEN",
        description: null,
        genreHint: null,
        relevanceText: "KLIKEN spiller elektroniske beats hele natten på Pumpehusets ståendegulv.",
        artists: ["KLIKEN"],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    // "elektroniske beats" is deliberately excluded from
    // hasExplicitElectronicAssertion's qualifying-noun list (see
    // EXPLICIT_ELECTRONIC_ASSERTION_RE's doc comment) and no specific
    // subgenre keyword (house/techno/trance/etc.) appears, so nothing here
    // resolves a genre or a strong signal at all.
    expect(result.genre).toBeNull();
    expect(result.decision).not.toBe("auto_publish");
  });

  it("Twilight Rave — 'rave' in the title alone is not EDM evidence when the actual content is soundtracks/dark pop/emo/indie/2000s hits", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "Twilight Rave",
        description: null,
        genreHint: null, // "rave" is not a keyword deterministicGenreFromText recognizes at all
        relevanceText:
          "Twilight Rave tager dig tilbage til 2000'erne med en aften fyldt af filmmusik, mørk pop, emo-klassikere og indie-hits. Syng med på dine yndlingssoundtracks og nostalgiske ørehængere fra ungdomsårene.",
        artists: [],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBeNull(); // the word "rave" in the title never substitutes for real genre evidence
    expect(result.decision).not.toBe("auto_publish");
  });

  it("a bare source-level 'Elektronisk' tag with no event-specific corroboration at all stays capped at the generic floor — never auto_publish, but still enters the pipeline (discovery vs. publication stay separate)", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-pumpehuset",
        title: "Untitled Club Night",
        description: null,
        genreHint: "electronic-other", // the venue's own broad secondary tag — discovery-level evidence only
        genreConfidenceHint: "medium",
        relevanceText: "Dørene åbner kl. 23 og der er baradgang hele aftenen. Billetter kan afhentes ved indgangen.",
        artists: [],
      }),
      { venues: VENUES, existingEvents: [] },
    );
    // Genre resolves (so this candidate is genuinely DISCOVERED — the
    // Pumpehuset completeness fix stays intact), but with zero event-
    // specific corroboration relevance can only ever be the generic-floor
    // "weak", never "strong" — publication relevance is a separate,
    // stricter bar.
    expect(result.genre).toBe("electronic-other");
    expect(result.relevance).toBe("weak");
    expect(result.decision).toBe("review_queue");
    expect(result.decision).not.toBe("auto_publish");
  });
});

describe("Billetto Discovery Queue noise (data-quality Workstream, 2026-08-24 queue audit — a general aggregator's own inventory is mostly not music at all, not just wrong-genre)", () => {
  function billettoRaw(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
    return raw({
      sourceId: "src-billetto",
      genreHint: null,
      genreConfidenceHint: null,
      description: "",
      artists: [],
      venueName: "Culture Box", // resolved, so the negative-signal branch (not "incomplete_data") is what's under test
      ...overrides,
    });
  }

  it("holds and never queues the real 'SpeedDating i København 25-35 år' Billetto candidate — no genre evidence at all, and a strong non-music-event signal", () => {
    const result = runIngestionPipeline(billettoRaw({ title: "SpeedDating i København 25-35 år" }), { venues: VENUES, existingEvents: [] });
    expect(result.genre).toBeNull();
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("negative_relevance");
  });

  it("holds real observed non-music Billetto titles the same way: chamber music, flea market, wine tasting, makeup class, guided walk", () => {
    const titles = [
      "Unge Talenter // Kammermusikforeningen af 1911",
      "Byens Lopper X Trianglen",
      "Ølsmagning med Brygmester",
      "DRAG MAKEUP MASTERCLASS",
      "By, brand og borgere – en byvandring i Københavns Kulturkvarter",
    ];
    for (const title of titles) {
      const result = runIngestionPipeline(billettoRaw({ title }), { venues: VENUES, existingEvents: [] });
      expect(result.decision, title).toBe("hold");
      expect(result.holdReason, title).toBe("negative_relevance");
    }
  });

  it("does NOT discard a genuinely electronic candidate merely because an incidental word overlaps a negative pattern (false-negative safety)", () => {
    // Real specific-genre keyword evidence present — must never be treated
    // as irrelevant, even though the description also happens to mention a
    // wine reception (an unrelated, incidental detail of the night).
    const result = runIngestionPipeline(
      billettoRaw({
        title: "Techno Warehouse Night",
        description: "A night of techno. Doors open early with a complimentary wine tasting before the DJs start.",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.genre).toBe("techno");
    expect(result.holdReason).not.toBe("negative_relevance");
  });

  it("still holds a plausible-but-unclear Billetto title as ordinary 'incomplete_data' (no strong signal either way) rather than discarding it", () => {
    const result = runIngestionPipeline(billettoRaw({ title: "Melting Monday" }), { venues: VENUES, existingEvents: [] });
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("incomplete_data"); // reaches the queue — a human can judge it, unlike the negative-relevance cases above
  });
});

describe("trusted-electronic sources (Section 6 — corrected per explicit product decision 2026-08-24: source identity is DEFINITIVE relevance evidence, not a safety-net-gated bypass)", () => {
  function hangarenRaw(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
    return raw({
      sourceId: "src-hangaren",
      genreHint: null,
      genreConfidenceHint: null,
      description: "",
      artists: ["Miley Serious"],
      venueName: "Hangaren",
      title: "Miley Serious",
      ...overrides,
    });
  }

  function cultureBoxRaw(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
    return raw({
      sourceId: "src-culture-box",
      genreHint: null,
      genreConfidenceHint: null,
      description: "",
      artists: ["Black Box: BIESMANS, KAWUN, WILLE"],
      venueName: "Culture Box",
      title: "Black Box: BIESMANS, KAWUN, WILLE",
      ...overrides,
    });
  }

  it("Hangaren: auto-publishes a complete, valid candidate even with zero genre keyword evidence at all (the real 'Miley Serious' case)", () => {
    const result = runIngestionPipeline(hangarenRaw(), { venues: VENUES, existingEvents: [], trustedElectronicSource: true });
    expect(result.genre).toBeNull(); // stays honest — sync.ts falls back to "electronic-other" at creation time
    expect(result.decision).toBe("auto_publish");
    expect(result.holdReason).toBeNull();
  });

  it("Hangaren: auto-publishes even when a genre keyword resolves at only medium/low confidence — exact genre confidence alone is never a reason to review a trusted-electronic source", () => {
    const result = runIngestionPipeline(
      hangarenRaw({ title: "Oliver Koletzki", description: "A night of tech house." }),
      { venues: VENUES, existingEvents: [], trustedElectronicSource: true },
    );
    expect(result.genreConfidence).toBe("medium");
    expect(result.decision).toBe("auto_publish");
  });

  it("Hangaren: still publishes even with a misleading/non-electronic text phrase — source identity is definitive, not a safety-net-gated bypass (explicit product decision: 'a generic/non-electronic text-signal must NOT by itself send these sources to Discovery Queue')", () => {
    const result = runIngestionPipeline(
      hangarenRaw({ title: "Comedy Night at Hangaren", description: "An evening of stand-up comedy." }),
      { venues: VENUES, existingEvents: [], trustedElectronicSource: true },
    );
    expect(result.decision).toBe("auto_publish");
    expect(result.holdReason).toBeNull();
  });

  it("Hangaren: still holds on a genuine operational blocker (unresolved venue) even for a trusted-electronic source", () => {
    const result = runIngestionPipeline(hangarenRaw({ venueName: "Some Totally Unknown Bar" }), {
      venues: VENUES,
      existingEvents: [],
      trustedElectronicSource: true,
    });
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("incomplete_data");
  });

  it("Hangaren: still holds on a missing required field (no date) even for a trusted-electronic source", () => {
    const result = runIngestionPipeline(hangarenRaw({ startDatetime: null }), {
      venues: VENUES,
      existingEvents: [],
      trustedElectronicSource: true,
    });
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("incomplete_data");
  });

  it("Culture Box: auto-publishes a complete, valid candidate with low genre confidence (mirrors Hangaren)", () => {
    const result = runIngestionPipeline(cultureBoxRaw(), { venues: VENUES, existingEvents: [], trustedElectronicSource: true });
    expect(result.genre).toBeNull();
    expect(result.decision).toBe("auto_publish");
    expect(result.holdReason).toBeNull();
  });

  it("Culture Box: still publishes even with a misleading/non-electronic text phrase (mirrors Hangaren)", () => {
    const result = runIngestionPipeline(
      cultureBoxRaw({ title: "Quiz Night at Culture Box", description: "A pub quiz before the DJs take over." }),
      { venues: VENUES, existingEvents: [], trustedElectronicSource: true },
    );
    expect(result.decision).toBe("auto_publish");
    expect(result.holdReason).toBeNull();
  });

  it("Culture Box: still holds on a genuine operational blocker (unresolved venue)", () => {
    const result = runIngestionPipeline(cultureBoxRaw({ venueName: "Some Totally Unknown Bar" }), {
      venues: VENUES,
      existingEvents: [],
      trustedElectronicSource: true,
    });
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("incomplete_data");
  });

  it("Hangaren/Culture Box: still holds on a real duplicate/canonical conflict needing review — the trusted-source bypass never skips dedup", () => {
    const existing: ExistingEventForDedup = {
      id: "e-existing",
      title: "Miley Serious",
      artists: ["Miley Serious"],
      venueId: VENUES.find((v) => v.name === "Hangaren")!.id,
      startDatetime: hangarenRaw().startDatetime!,
      sourceId: "src-hangaren",
      officialEventUrl: hangarenRaw().officialEventUrl,
      ticketUrl: null,
      residentAdvisorUrl: null,
    };
    const result = runIngestionPipeline(hangarenRaw(), { venues: VENUES, existingEvents: [existing], trustedElectronicSource: true });
    expect(result.decision).not.toBe("auto_publish"); // exact match resolves via findSyncMatch's update path in db/sync.ts, never a second create
  });

  it("ALICE does NOT inherit trusted-electronic-source behavior — same candidate shape, trustedElectronicSource omitted", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-alice",
        genreHint: null,
        genreConfidenceHint: null,
        description: "",
        artists: ["Some ALICE Act"],
        venueName: "ALICE",
        title: "Some ALICE Act",
      }),
      { venues: VENUES, existingEvents: [] }, // trustedElectronicSource omitted — defaults false
    );
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("incomplete_data"); // genre never resolved, and ALICE gets no relevance bypass
  });

  it("ALICE with a misleading/non-electronic text phrase is held, unlike Hangaren/Culture Box with the same shape (proves the rule is genuinely source-scoped, not accidentally global)", () => {
    const result = runIngestionPipeline(
      raw({
        sourceId: "src-alice",
        genreHint: null,
        genreConfidenceHint: null,
        artists: ["Some ALICE Act"],
        venueName: "ALICE",
        title: "Comedy Night at ALICE",
        description: "An evening of stand-up comedy.",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("negative_relevance"); // genre still null, non-electronic category signal fires, ALICE gets no bypass
  });
});

describe("venueResolvedCounterfactual (venue-block visibility precision fix, follow-up to 2026-08-31's freshness work)", () => {
  it("1. venue is the ONLY blocker + would auto-publish once resolved -> counterfactual {auto_publish, null}, even though the real decision is 'hold'", () => {
    const result = runIngestionPipeline(raw({ venueName: "Some Unknown Bar" }), { venues: VENUES, existingEvents: [] });
    expect(result.resolvedVenueId).toBeNull();
    expect(result.decision).toBe("hold"); // real decision: still blocked, venue never resolved
    expect(result.venueResolvedCounterfactual).toEqual({ decision: "auto_publish", holdReason: null });
  });

  it("2. venue is the ONLY blocker + would reach review once resolved -> counterfactual {review_queue, null}", () => {
    const result = runIngestionPipeline(raw({ venueName: "Some Unknown Bar", genreConfidenceHint: "medium" }), {
      venues: VENUES,
      existingEvents: [],
    });
    expect(result.decision).toBe("hold");
    expect(result.venueResolvedCounterfactual).toEqual({ decision: "review_queue", holdReason: null });
  });

  it("3. venue unresolved AND another required field missing -> counterfactual stays 'hold' (venue is NOT the only blocker)", () => {
    const result = runIngestionPipeline(raw({ venueName: "Some Unknown Bar", title: "" }), { venues: VENUES, existingEvents: [] });
    expect(result.missingFields).toContain("title");
    expect(result.missingFields).toContain("venue (unresolved against registry)");
    expect(result.venueResolvedCounterfactual).toEqual({ decision: "hold", holdReason: "incomplete_data" });
  });

  it("4. venue unresolved AND genre confidence below the review bar -> counterfactual 'hold'/'low_confidence' (never presented as a valuable opportunity)", () => {
    const result = runIngestionPipeline(
      raw({ venueName: "Some Unknown Bar", genreHint: null, genreConfidenceHint: null, title: "Untitled Night", description: "" }),
      { venues: VENUES, existingEvents: [] },
    );
    // No genre evidence at all here (deliberately vague copy) — the real
    // decision AND the counterfactual both read as incomplete_data (missing
    // credible electronic relevance), not low_confidence — see case 6 for
    // the genuinely negative-relevance shape.
    expect(result.venueResolvedCounterfactual).toEqual({ decision: "hold", holdReason: "incomplete_data" });
  });

  it("5. venue unresolved AND a genuine negative-relevance signal -> counterfactual 'hold'/'negative_relevance' (never a valuable opportunity, matches test 3's real-decision case)", () => {
    const result = runIngestionPipeline(
      raw({
        venueName: "Some Unknown Bar",
        genreHint: null,
        genreConfidenceHint: null,
        title: "Wine Tasting Evening",
        description: "Join us for a wine tasting event, nothing to do with electronic music.",
      }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(result.decision).toBe("hold");
    expect(result.holdReason).toBe("negative_relevance");
    expect(result.venueResolvedCounterfactual).toEqual({ decision: "hold", holdReason: "negative_relevance" });
  });

  it("6. venue already resolves -> counterfactual is null (not applicable, the question itself doesn't apply)", () => {
    const result = runIngestionPipeline(raw(), { venues: VENUES, existingEvents: [] }); // default fixture's venueName resolves cleanly
    expect(result.resolvedVenueId).not.toBeNull();
    expect(result.venueResolvedCounterfactual).toBeNull();
  });

  it("7. no venueName provided at all -> counterfactual is null (nothing to hypothetically resolve)", () => {
    const result = runIngestionPipeline(raw({ venueName: null }), { venues: VENUES, existingEvents: [] });
    expect(result.missingFields).toContain("venue");
    expect(result.missingFields).not.toContain("venue (unresolved against registry)");
    expect(result.venueResolvedCounterfactual).toBeNull();
  });

  it("8. Discogs enrichment (applyEnrichedGenre CASE A) recomputes the counterfactual using the enriched genre, not the stale pre-enrichment one", () => {
    const held = runIngestionPipeline(
      raw({ venueName: "Some Unknown Bar", genreHint: null, genreConfidenceHint: null, title: "Untitled Night", description: "" }),
      { venues: VENUES, existingEvents: [] },
    );
    expect(held.venueResolvedCounterfactual?.decision).toBe("hold"); // no genre evidence yet -> not applicable-quality, still "hold"

    const enriched = applyEnrichedGenre(held, "house", "medium", "", false);
    // The REAL decision stays "hold" — venue is still unresolved, enrichment
    // never touches venue resolution — but its holdReason narrows from
    // "incomplete_data" (no genre AND no venue) to reflect genre now being
    // resolved (venue is the sole remaining gap).
    expect(enriched.decision).toBe("hold");
    expect(enriched.resolvedVenueId).toBeNull();
    // The COUNTERFACTUAL is what actually improves, proving it recomputes
    // from the enriched genre rather than staying frozen at the
    // pre-enrichment ("no genre at all") snapshot.
    expect(enriched.venueResolvedCounterfactual).toEqual({ decision: "review_queue", holdReason: null });
  });
});
