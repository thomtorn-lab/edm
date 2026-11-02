import { describe, expect, it } from "vitest";
import { eventMatchesGenres } from "./genreMatching";
import type { GenreSlug, GenreFilterValue } from "../taxonomy";

describe("eventMatchesGenres", () => {
  it("matches any event when the subscriber selected no genres (= all events)", () => {
    expect(eventMatchesGenres(["techno"] as GenreSlug[], [])).toBe(true);
    expect(eventMatchesGenres([], [])).toBe(true);
  });

  it("matches when the event's single genre maps to a selected group", () => {
    expect(eventMatchesGenres(["melodic-techno"] as GenreSlug[], ["techno"] as GenreFilterValue[])).toBe(true);
  });

  it("does not match when the event's genre maps to an unselected group", () => {
    expect(eventMatchesGenres(["house"] as GenreSlug[], ["techno"] as GenreFilterValue[])).toBe(false);
  });

  it("matches if EITHER of the event's two genres matches (max-two-genres-per-event OR semantics)", () => {
    const subgenres = ["house", "disco"] as GenreSlug[];
    expect(eventMatchesGenres(subgenres, ["disco"] as GenreFilterValue[])).toBe(true);
    expect(eventMatchesGenres(subgenres, ["house"] as GenreFilterValue[])).toBe(true);
    expect(eventMatchesGenres(subgenres, ["trance"] as GenreFilterValue[])).toBe(false);
  });

  it("matches a multi-genre subscriber selection against either of the event's genres", () => {
    const subgenres = ["industrial-techno"] as GenreSlug[]; // a techno subgenre
    expect(eventMatchesGenres(subgenres, ["house", "techno", "trance"] as GenreFilterValue[])).toBe(true);
  });

  it("uses the site-wide genre rule: Industrial is standalone, so a Techno subscriber doesn't get Industrial-only events; legacy sets keep their meaning (genre system revision, 2026-10-24)", () => {
    expect(eventMatchesGenres(["industrial"] as GenreSlug[], ["techno"] as GenreFilterValue[])).toBe(false);
    expect(eventMatchesGenres(["industrial"] as GenreSlug[], ["industrial"] as GenreFilterValue[])).toBe(true);
    expect(eventMatchesGenres(["dubstep"] as GenreSlug[], ["garage-bass"] as GenreFilterValue[])).toBe(true);
    expect(eventMatchesGenres(["rawstyle"] as GenreSlug[], ["hardstyle-hardcore"] as GenreFilterValue[])).toBe(true);
    expect(eventMatchesGenres(["experimental"] as GenreSlug[], ["ambient-experimental"] as GenreFilterValue[])).toBe(true);
    expect(eventMatchesGenres(["hypnotic-techno"] as GenreSlug[], ["hard-techno"] as GenreFilterValue[])).toBe(false);
  });

  it("does not match when none of the subscriber's several selected groups apply", () => {
    const subgenres = ["psytrance"] as GenreSlug[];
    expect(eventMatchesGenres(subgenres, ["house", "techno", "disco"] as GenreFilterValue[])).toBe(false);
  });

  it("an event with no subgenres at all never matches a genre-specific selection", () => {
    expect(eventMatchesGenres([], ["techno"] as GenreFilterValue[])).toBe(false);
  });
});
