import { describe, expect, it } from "vitest";
import { eventMatchesGenres } from "./genreMatching";
import type { GenreSlug, MainGenreSlug } from "../taxonomy";

describe("eventMatchesGenres", () => {
  it("matches any event when the subscriber selected no genres (= all events)", () => {
    expect(eventMatchesGenres(["techno"] as GenreSlug[], [])).toBe(true);
    expect(eventMatchesGenres([], [])).toBe(true);
  });

  it("matches when the event's single genre maps to a selected group", () => {
    expect(eventMatchesGenres(["melodic-techno"] as GenreSlug[], ["techno"] as MainGenreSlug[])).toBe(true);
  });

  it("does not match when the event's genre maps to an unselected group", () => {
    expect(eventMatchesGenres(["house"] as GenreSlug[], ["techno"] as MainGenreSlug[])).toBe(false);
  });

  it("matches if EITHER of the event's two genres matches (max-two-genres-per-event OR semantics)", () => {
    const subgenres = ["house", "disco"] as GenreSlug[];
    expect(eventMatchesGenres(subgenres, ["disco"] as MainGenreSlug[])).toBe(true);
    expect(eventMatchesGenres(subgenres, ["house"] as MainGenreSlug[])).toBe(true);
    expect(eventMatchesGenres(subgenres, ["trance"] as MainGenreSlug[])).toBe(false);
  });

  it("matches a multi-genre subscriber selection against either of the event's genres", () => {
    const subgenres = ["industrial"] as GenreSlug[]; // maps to "techno"
    expect(eventMatchesGenres(subgenres, ["house", "techno", "trance"] as MainGenreSlug[])).toBe(true);
  });

  it("does not match when none of the subscriber's several selected groups apply", () => {
    const subgenres = ["psytrance"] as GenreSlug[];
    expect(eventMatchesGenres(subgenres, ["house", "techno", "disco"] as MainGenreSlug[])).toBe(false);
  });

  it("an event with no subgenres at all never matches a genre-specific selection", () => {
    expect(eventMatchesGenres([], ["techno"] as MainGenreSlug[])).toBe(false);
  });
});
