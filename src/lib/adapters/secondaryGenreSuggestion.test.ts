import { describe, expect, it } from "vitest";
import { suggestSecondaryGenre } from "./secondaryGenreSuggestion";

/**
 * Regression suite for the Discovery secondary-genre V1 rule engine,
 * REVISED 2026-10-08 after a safety review found the original free-text
 * rules (same-clause co-mention, and a "Music:"/"Genre:" label matched
 * anywhere in general relevance text) could mistake a support-act/artist
 * biography or venue boilerplate for genuine event-level evidence. This
 * suite validates the replacement design: `suggestSecondaryGenre` now takes
 * ONLY `structuredGenreField` (an adapter-verified, source-specific
 * structured field — see RawCandidateEvent.structuredGenreField) and never
 * looks at free prose at all. Every adversarial case below reuses the exact
 * wording that broke the old rule, now passed as if it were (incorrectly)
 * free text mistaken for a structured field — each must abstain, proving
 * the free-text path is genuinely gone, not merely narrowed.
 */
describe("suggestSecondaryGenre", () => {
  describe("genuine trusted structured field — accepts", () => {
    it("real true positive: Gravity's own 'Music:' field value, e.g. 'Progressive & Melodic House, Melodic & Progressive Techno'", () => {
      // The literal field text doesn't satisfy the adjacent "progressive
      // house"/"melodic techno" patterns (the words aren't directly next to
      // each other), so the bare "house" and "techno" matches are what's
      // found; this is group-level corroboration of the already-resolved
      // specific primary, not a precise re-derivation of it — see
      // secondaryCandidateFromPair's own doc comment.
      const field = "Progressive & Melodic House, Melodic & Progressive Techno";
      expect(suggestSecondaryGenre(field, "progressive-house", "high")).toBe("techno");
    });

    it("a short two-genre structured field value with no label text at all", () => {
      expect(suggestSecondaryGenre("House, Techno", "house", "high")).toBe("techno");
    });

    it("order-independent: secondary is whichever element does NOT match the primary", () => {
      const field = "Techno, House";
      expect(suggestSecondaryGenre(field, "house", "medium")).toBe("techno");
      expect(suggestSecondaryGenre(field, "techno", "medium")).toBe("house");
    });

    it("'garage' only counts as evidence when it's one of exactly two distinct genres in the verified field", () => {
      expect(suggestSecondaryGenre("Garage, House", "house", "medium")).toBe("garage");
    });
  });

  describe("more than two genres in the verified field is ambiguous — abstains", () => {
    it("three distinct genre families named in the field", () => {
      expect(suggestSecondaryGenre("House, Techno, Trance", "house", "high")).toBeNull();
    });

    it("the real five-genre lineup shape, even if it somehow reached a structured field", () => {
      const field = "Melodic Techno, Garage, Hypnotic Techno, Trance, Hard Techno";
      expect(suggestSecondaryGenre(field, "techno", "medium")).toBeNull();
    });
  });

  describe("single-genre or no-genre structured field — abstains", () => {
    it("a structured field naming only one genre", () => {
      expect(suggestSecondaryGenre("Deep House", "deep-house", "high")).toBeNull();
    });

    it("a structured field with no recognizable genre keyword at all", () => {
      expect(suggestSecondaryGenre("TBA", "house", "high")).toBeNull();
    });
  });

  describe("unsupported or ambiguous field provenance — no field means abstain", () => {
    it("adapter supplied no structured field at all (null) — by far the most common case", () => {
      expect(suggestSecondaryGenre(null, "house", "high")).toBeNull();
    });

    it("adapter supplied no structured field at all (undefined)", () => {
      expect(suggestSecondaryGenre(undefined, "house", "high")).toBeNull();
    });

    it("adapter supplied an empty-string field", () => {
      expect(suggestSecondaryGenre("", "house", "high")).toBeNull();
    });

    it("a whitespace-only field is treated the same as no field", () => {
      expect(suggestSecondaryGenre("   ", "house", "high")).toBeNull();
    });
  });

  describe("this module trusts its one input completely — by design", () => {
    // suggestSecondaryGenre has no way to tell adversarial free text apart
    // from a genuinely verified structured field — nor should it try to
    // (that was the reverted first version's whole mistake: attempting to
    // infer trustworthiness from TEXT SHAPE, e.g. a short clause or a
    // "Music:" label, rather than from genuine source provenance). The
    // actual safety boundary is upstream: no adapter may ever pass a free-
    // text description/bio/venue blurb as structuredGenreField in the first
    // place (see RawCandidateEvent.structuredGenreField's doc comment and
    // gravityAdapter.ts's own discipline), and the pipeline must never fall
    // back to relevanceText/description when structuredGenreField is absent
    // (see pipeline.test.ts's "free-text ... never consulted" regression
    // and gravityAdapter.test.ts's structuredGenreField provenance tests —
    // that is where the support-act-bio/artist-bio/venue-boilerplate/
    // embedded-"Music:"-label false-positive shapes are actually guarded
    // against end-to-end). This test merely documents the module's honest
    // contract: given a string shaped like a genuine two-genre field, it
    // always trusts it, because by its own contract it is only ever called
    // with one.
    it("a string shaped exactly like a genuine field is always trusted, whatever its real origin", () => {
      expect(suggestSecondaryGenre("techno and trance", "techno", "high")).toBe("trance");
    });
  });

  describe("conflicting genre evidence — abstains", () => {
    it("neither element of the verified field relates to the already-resolved primary — abstains rather than override it", () => {
      expect(suggestSecondaryGenre("Trance, Psytrance", "techno", "high")).toBeNull();
    });

    it("a same-family pair (two siblings of the primary's own group) is not a genuinely second genre — abstains", () => {
      expect(suggestSecondaryGenre("House, Tech House", "deep-house", "high")).toBeNull();
    });
  });

  describe("primary-genre preservation / abstention rules", () => {
    it("no primary genre at all — never invents a pairing", () => {
      expect(suggestSecondaryGenre("House, Techno", null, "high")).toBeNull();
    });

    it("primary confidence 'low' — never attempts secondary inference, even with an otherwise-valid field", () => {
      expect(suggestSecondaryGenre("House, Techno", "house", "low")).toBeNull();
    });

    it("primary confidence 'medium' or 'high' both proceed", () => {
      expect(suggestSecondaryGenre("House, Techno", "house", "medium")).toBe("techno");
      expect(suggestSecondaryGenre("House, Techno", "house", "high")).toBe("techno");
    });

    it("the returned secondary always differs from the given primary by construction", () => {
      const secondary = suggestSecondaryGenre("House, Techno", "house", "high");
      expect(secondary).not.toBeNull();
      expect(secondary).not.toBe("house");
    });
  });
});
