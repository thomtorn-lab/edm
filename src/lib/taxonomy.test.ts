import { describe, expect, it } from "vitest";
import { GENRES, MAIN_GENRES, displayGenres, getGenre, mainGenreOf } from "./taxonomy";

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

describe("genre display integrity — the admin-selected/classified genre is shown verbatim, never its broader filter group (2026-09-11 audit)", () => {
  it("Deep House displays as Deep House, not House", () => {
    expect(displayGenres(["deep-house"])).toEqual([getGenre("deep-house")]);
    expect(displayGenres(["deep-house"])[0].label).toBe("Deep House");
  });

  it("Melodic Techno displays as Melodic Techno, not Techno", () => {
    expect(displayGenres(["melodic-techno"])[0].label).toBe("Melodic Techno");
  });

  it("Industrial displays as Industrial, not Techno or Hard Techno", () => {
    expect(displayGenres(["industrial"])[0].label).toBe("Industrial");
  });

  it("a parent genre selected directly still displays correctly", () => {
    expect(displayGenres(["techno"])[0].label).toBe("Techno");
    expect(displayGenres(["house"])[0].label).toBe("House");
  });

  it("Trance and Psytrance stay distinguished (never collapsed into each other)", () => {
    expect(displayGenres(["trance"])[0].label).toBe("Trance");
    expect(displayGenres(["psytrance"])[0].label).toBe("Psytrance");
  });

  it("hard-techno displays as its own label, distinct from techno", () => {
    expect(displayGenres(["hard-techno"])[0].label).toBe("Hard Techno");
  });

  it("electronic-other displays its own specific label, not the filter's 'Other' shorthand", () => {
    expect(displayGenres(["electronic-other"])[0].label).toBe("Electronic / Other");
  });

  it("deduplicates by the underlying slug — the same slug repeated in subgenres is shown once", () => {
    expect(displayGenres(["deep-house", "deep-house"])).toHaveLength(1);
  });

  it("two distinct subgenres that share a filter group are still shown as two distinct badges (no display-level merging)", () => {
    const genres = displayGenres(["industrial", "melodic-techno"]);
    expect(genres).toHaveLength(2);
    expect(genres.map((g) => g.label)).toEqual(["Industrial", "Melodic Techno"]);
  });

  it("every GenreSlug displays as its own exact label — display never substitutes the broader mainGenreOf label", () => {
    for (const g of GENRES) {
      expect(displayGenres([g.slug])[0].slug).toBe(g.slug);
      expect(displayGenres([g.slug])[0].label).toBe(g.label);
    }
  });
});

describe("genre filter inheritance — mainGenreOf still groups a precise subgenre under its broader filter category (unchanged by the display fix)", () => {
  it("Deep House inherits the House filter group", () => {
    expect(mainGenreOf("deep-house")).toBe("house");
  });

  it("Melodic Techno inherits the Techno filter group", () => {
    expect(mainGenreOf("melodic-techno")).toBe("techno");
  });

  it("Industrial inherits the Techno filter group, not Hard Techno (Intercell regression case)", () => {
    expect(mainGenreOf("industrial")).toBe("techno");
  });

  it("hard-techno stays its own filter group, distinct from techno", () => {
    expect(mainGenreOf("hard-techno")).toBe("hard-techno");
  });
});
