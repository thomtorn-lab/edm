import { describe, expect, it } from "vitest";
import { GENRES, MAIN_GENRES, displayGenres, mainGenreOf } from "./taxonomy";

describe("user-facing genre taxonomy (partner-ready polish pass)", () => {
  it("never exposes 'D&B' anywhere — Drum & Bass is always spelled out, including in dense/short labels", () => {
    for (const g of GENRES) {
      expect(g.label).not.toMatch(/D&B/i);
      expect(g.shortLabel).not.toMatch(/D&B/i);
    }
    const drumAndBass = GENRES.find((g) => g.slug === "drum-and-bass")!;
    expect(drumAndBass.label).toBe("Drum & Bass");
    expect(drumAndBass.shortLabel).toBe("Drum & Bass");
  });

  it("matches the exact final user-facing primary genre taxonomy and labels", () => {
    const labels = MAIN_GENRES.map((g) => g.label);
    expect(labels).toEqual([
      "Techno",
      "Hard Techno",
      "House",
      "Trance",
      "Psytrance",
      "Drum & Bass",
      "UK Garage / Bass Music",
      "Breaks",
      "Hardstyle / Hardcore",
      "Disco",
      "Electro",
      "Ambient / Experimental",
      "Other",
    ]);
  });

  it("introduces no new primary user-facing genre labels beyond the fixed 13", () => {
    expect(MAIN_GENRES).toHaveLength(13);
  });
});

describe("genre precision — internal niche slugs roll up to the approved public taxonomy (data-quality Workstream B)", () => {
  it("Industrial rolls up to Techno publicly, not Hard Techno (Intercell regression case)", () => {
    expect(mainGenreOf("industrial")).toBe("techno");
    expect(displayGenres(["industrial"])).toEqual([{ slug: "techno", label: "Techno", shortLabel: "Techno" }]);
  });

  it("melodic-techno rolls up to Techno publicly", () => {
    expect(mainGenreOf("melodic-techno")).toBe("techno");
    expect(displayGenres(["melodic-techno"])[0].label).toBe("Techno");
  });

  it("progressive-house rolls up to House publicly", () => {
    expect(mainGenreOf("progressive-house")).toBe("house");
    expect(displayGenres(["progressive-house"])[0].label).toBe("House");
  });

  it("Trance and Psytrance stay distinguished (never collapsed into each other)", () => {
    expect(displayGenres(["trance"])[0].label).toBe("Trance");
    expect(displayGenres(["psytrance"])[0].label).toBe("Psytrance");
  });

  it("hard-techno stays its own public bucket, distinct from techno", () => {
    expect(mainGenreOf("hard-techno")).toBe("hard-techno");
    expect(displayGenres(["hard-techno"])[0].label).toBe("Hard Techno");
  });

  it("electronic-other rolls up to the genuine fallback 'Other', never a guessed specific label", () => {
    expect(displayGenres(["electronic-other"])[0].label).toBe("Other");
  });

  it("deduplicates by approved public category — two internal niche slugs sharing an umbrella are shown once", () => {
    expect(displayGenres(["industrial", "melodic-techno"])).toHaveLength(1);
    expect(displayGenres(["industrial", "melodic-techno"])[0].label).toBe("Techno");
  });

  it("filter grouping (mainGenreOf) and the public display badge (displayGenres) always agree", () => {
    for (const g of GENRES) {
      expect(displayGenres([g.slug])[0].slug).toBe(mainGenreOf(g.slug));
    }
  });
});
