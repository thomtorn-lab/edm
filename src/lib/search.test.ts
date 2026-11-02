import { describe, expect, it } from "vitest";
import { eventMatchesQuery } from "./search";
import type { GenreSlug } from "./taxonomy";

const event = (subgenres: GenreSlug[]) => ({ title: "Night", artists: [], subgenres, primaryGenre: subgenres[0] });

// Genre system revision (2026-10-24) — contract F15: free-text genre search
// follows the same hierarchy as the genre filter.
describe("eventMatchesQuery — genre text", () => {
  it("a main genre's name finds its subgenres", () => {
    expect(eventMatchesQuery(event(["jungle"]), undefined, "drum & bass")).toBe(true);
    expect(eventMatchesQuery(event(["rawstyle"]), undefined, "hardstyle")).toBe(true);
    expect(eventMatchesQuery(event(["psytrance"]), undefined, "trance")).toBe(true);
    expect(eventMatchesQuery(event(["hypnotic-techno"]), undefined, "techno")).toBe(true);
  });

  it("a standalone genre gets no parent: 'techno' never finds an Industrial-only event", () => {
    expect(eventMatchesQuery(event(["industrial"]), undefined, "techno")).toBe(false);
    expect(eventMatchesQuery(event(["industrial"]), undefined, "industrial")).toBe(true);
    expect(eventMatchesQuery(event(["hardcore"]), undefined, "hardstyle")).toBe(false);
  });

  it("finds UK Garage by its new label and a legacy value by its stored label", () => {
    expect(eventMatchesQuery(event(["garage"]), undefined, "uk garage")).toBe(true);
    expect(eventMatchesQuery(event(["ambient-experimental"]), undefined, "ambient")).toBe(true);
  });
});
