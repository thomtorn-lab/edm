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

// Genre storage (2026-11-02): search matches only the genres an event shows.
describe("eventMatchesQuery — only shown genres are searchable", () => {
  it("a stored primaryGenre that disagrees with subgenres is not searchable", () => {
    const inconsistent = { title: "Night", artists: [], primaryGenre: "electronic-other" as GenreSlug, subgenres: ["house", "techno"] as GenreSlug[] };
    expect(eventMatchesQuery(inconsistent, undefined, "electronic")).toBe(false);
    expect(eventMatchesQuery(inconsistent, undefined, "house")).toBe(true);
    expect(eventMatchesQuery(inconsistent, undefined, "techno")).toBe(true);
  });

  it("a hidden subgenre's parent is not searchable either (Steamboi: industrial-techno hidden, Industrial + Trance shown)", () => {
    const steamboi = { title: "Black Box", artists: [], primaryGenre: "industrial-techno" as GenreSlug, subgenres: ["industrial", "trance"] as GenreSlug[] };
    expect(eventMatchesQuery(steamboi, undefined, "industrial techno")).toBe(false);
    expect(eventMatchesQuery(steamboi, undefined, "techno")).toBe(false);
    expect(eventMatchesQuery(steamboi, undefined, "industrial")).toBe(true);
  });

  it("a row with no subgenres falls back to primaryGenre", () => {
    expect(eventMatchesQuery({ title: "Night", artists: [], primaryGenre: "techno", subgenres: [] }, undefined, "techno")).toBe(true);
  });
});
