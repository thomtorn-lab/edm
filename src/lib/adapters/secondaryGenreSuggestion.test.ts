import { describe, expect, it } from "vitest";
import { suggestSecondaryGenre } from "./secondaryGenreSuggestion";

/**
 * Regression suite for the Discovery secondary-genre V1 rule engine. Where
 * practical, fixtures reuse the exact real Production wording quoted in the
 * prior read-only investigation (both validated true positives and the
 * documented causes of the naive rule's 15 real false positives), so this
 * suite is itself a direct check against reintroducing that 68%
 * false-positive failure pattern.
 */
describe("suggestSecondaryGenre", () => {
  describe("valid same-clause co-mention (evidence pattern 1)", () => {
    it("real true positive: HvadErPå 9HRS of ESCAPISM — 'A multi-room journey through house and techno.'", () => {
      const text = "9HRS of ESCAPISM: Octave One Live. A multi-room journey through house and techno. Experience Detroit techno royalty.";
      expect(suggestSecondaryGenre(text, "house", "medium")).toBe("techno");
    });

    it("real true positive: Culture Box New Year's Eve — 'Experience the ultimate in house, techno, and everything in between.'", () => {
      const text = "CULTURE BOX NEW YEAR'S EVE. Experience the ultimate in house, techno, and everything in between. Two rooms, 12 hours.";
      expect(suggestSecondaryGenre(text, "house", "high")).toBe("techno");
    });

    it("the real Mika Heggemann/Hangaren wording, isolated to its own safe two-genre clause", () => {
      // The real quote in full ("...blending the euphoria of trance with the
      // raw edge of techno and the bounce of hard house") carries a THIRD
      // incidental genre mention ("hard house") and is long — see the
      // "ambiguous wording" describe block below for why the FULL real
      // sentence correctly abstains. This isolates the clean two-genre
      // clause shape the rule is meant to catch.
      const text = "Mika Heggemann is pioneering Nu Trance. blending the euphoria of trance with the raw edge of techno.";
      expect(suggestSecondaryGenre(text, "techno", "high")).toBe("trance");
    });

    it("order-independent: secondary is whichever element does NOT match the primary", () => {
      const text = "A night of techno and house for everyone.";
      expect(suggestSecondaryGenre(text, "house", "medium")).toBe("techno");
      expect(suggestSecondaryGenre(text, "techno", "medium")).toBe("house");
    });
  });

  describe("valid dedicated structured-field evidence (evidence pattern 2)", () => {
    it("real true positive: Gravity's own 'Music:' field — 'Music: Progressive & Melodic House, Melodic & Progressive Techno'", () => {
      const text = "ERIC PRYDZ. Full GRAVITY audiovisual production. Music: Progressive & Melodic House, Melodic & Progressive Techno";
      // The literal field text doesn't satisfy the adjacent "progressive
      // house"/"melodic techno" patterns (the words aren't directly next to
      // each other — "Progressive & Melodic House"), so the bare "house"
      // and "techno" matches are what's found; this is group-level
      // corroboration of the already-resolved specific primary, not a
      // precise re-derivation of it — see secondaryCandidateFromPair's own
      // doc comment.
      expect(suggestSecondaryGenre(text, "progressive-house", "high")).toBe("techno");
    });

    it("a 'Genre:' label works the same way as 'Music:'", () => {
      const text = "Friday night. Genre: House, Techno";
      expect(suggestSecondaryGenre(text, "house", "high")).toBe("techno");
    });

    it("more than two genres in a structured field is ambiguous — abstains", () => {
      const text = "Music: House, Techno, Trance";
      expect(suggestSecondaryGenre(text, "house", "high")).toBeNull();
    });
  });

  describe("single-genre events — no secondary", () => {
    it("a plain single-genre description never suggests a secondary", () => {
      const text = "A night of deep house with DJ Someone.";
      expect(suggestSecondaryGenre(text, "deep-house", "high")).toBeNull();
    });

    it("no genre text at all — abstains", () => {
      expect(suggestSecondaryGenre("Doors at 22:00. Free entry before midnight.", "house", "high")).toBeNull();
    });
  });

  describe("ambiguous wording — abstains rather than guess", () => {
    it("the full real Mika Heggemann sentence (three distinct genres via the incidental 'hard house' mention) correctly abstains", () => {
      const text =
        "Mika Heggemann is pioneering Nu Trance - a new wave of club music blending the euphoria of trance with the raw edge of techno and the bounce of hard house.";
      expect(suggestSecondaryGenre(text, "techno", "high")).toBeNull();
    });

    it("real false-positive shape: a lineup 'spanning' five named genres in one clause (NECKLESS Halloween Edition) — too ambiguous to pick two", () => {
      const text = "a diverse lineup spanning Melodic Techno, Garage, Hypnotic Techno, Trance, and Hard Techno";
      expect(suggestSecondaryGenre(text, "techno", "medium")).toBeNull();
    });

    it("a three-genre plain clause abstains even though it would contain a valid pair as a subset", () => {
      const text = "house, techno and trance all night long";
      expect(suggestSecondaryGenre(text, "house", "medium")).toBeNull();
    });
  });

  describe("artist biographies and support acts — scattered mentions never qualify", () => {
    it("real false-positive shape: Poolen 'Nico Moreno' — genre words scattered across separate sentences describing different influences, never co-mentioned", () => {
      const text =
        "Nico Moreno is known for his hard techno sound. His early releases leaned industrial. Tonight's lineup explores the full spectrum of techno.";
      expect(suggestSecondaryGenre(text, "hard-techno", "medium")).toBeNull();
    });

    it("real false-positive shape: Hangaren 'Konfusia, AELVA K, Eusherr' — a psytrance influence named in one sentence, the night's own techno genre in another", () => {
      const text = "Konfusia draws on his psytrance roots from years on the Goa scene. Tonight's lineup brings pure techno to Hangaren.";
      expect(suggestSecondaryGenre(text, "techno", "medium")).toBeNull();
    });

    it("a support act's own distinct genre, named in its own separate sentence, never pairs with the headliner's genre", () => {
      const text = "Headliner X plays techno all night. Support act Y is known for their trance sets elsewhere.";
      expect(suggestSecondaryGenre(text, "techno", "high")).toBeNull();
    });
  });

  describe("venue boilerplate — a general range never qualifies as this event's own evidence", () => {
    it("real false-positive shape: HvadErPå 'MIAW' — a venue-level range spanning four families across a longer paragraph, not a short co-mention", () => {
      const text =
        "This venue regularly hosts nights across disco, house, techno and trance depending on the week. Tonight's specific lineup and sound will be announced closer to the date.";
      expect(suggestSecondaryGenre(text, "electronic-other", "medium")).toBeNull();
    });
  });

  describe("house/garage homonyms never independently trigger", () => {
    it("a bare, isolated 'house' mention alone never produces a secondary", () => {
      const text = "Join us for a house party this Friday.";
      expect(suggestSecondaryGenre(text, "house", "high")).toBeNull();
    });

    it("a bare, isolated 'garage' mention alone never produces a secondary (and never even resembles a genre claim)", () => {
      const text = "Please note the venue entrance is next to a public parking garage.";
      expect(suggestSecondaryGenre(text, "techno", "high")).toBeNull();
    });

    it("'garage' only counts as evidence when explicitly co-mentioned with another genre in one short clause — never alone", () => {
      const text = "A night of garage and house classics.";
      expect(suggestSecondaryGenre(text, "house", "medium")).toBe("garage");
    });
  });

  describe("conflicting genre evidence — abstains", () => {
    it("neither element of a qualifying pair relates to the already-resolved primary — abstains rather than override it", () => {
      const text = "A night of trance and psytrance for everyone.";
      expect(suggestSecondaryGenre(text, "techno", "high")).toBeNull();
    });

    it("two different clauses propose two different, disagreeing secondaries — abstains rather than pick one", () => {
      const text = "The main room plays house and techno all night. The after-hours room shifts to house and trance until close.";
      expect(suggestSecondaryGenre(text, "house", "high")).toBeNull();
    });

    it("a same-family pair (two siblings of the primary's own group) is not a genuinely second genre — abstains", () => {
      const text = "An evening of house and tech house.";
      expect(suggestSecondaryGenre(text, "deep-house", "high")).toBeNull();
    });
  });

  describe("preservation / abstention rules", () => {
    it("no primary genre at all — never invents a pairing", () => {
      const text = "A multi-room journey through house and techno.";
      expect(suggestSecondaryGenre(text, null, "high")).toBeNull();
    });

    it("primary confidence 'low' — never attempts secondary inference, even with otherwise-clean evidence", () => {
      const text = "A multi-room journey through house and techno.";
      expect(suggestSecondaryGenre(text, "house", "low")).toBeNull();
    });

    it("primary confidence 'medium' or 'high' both proceed", () => {
      const text = "A multi-room journey through house and techno.";
      expect(suggestSecondaryGenre(text, "house", "medium")).toBe("techno");
      expect(suggestSecondaryGenre(text, "house", "high")).toBe("techno");
    });

    it("the returned secondary always differs from the given primary by construction", () => {
      const text = "A multi-room journey through house and techno.";
      const secondary = suggestSecondaryGenre(text, "house", "high");
      expect(secondary).not.toBeNull();
      expect(secondary).not.toBe("house");
    });
  });
});
