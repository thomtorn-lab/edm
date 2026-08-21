import { describe, expect, it } from "vitest";
import { GENRES, MAIN_GENRES } from "./taxonomy";

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
