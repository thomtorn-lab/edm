import { describe, expect, it } from "vitest";
import {
  GENRES,
  LEGACY_GENRE_FILTERS,
  NEWSLETTER_GENRE_OPTIONS,
  VISUAL_GROUPS,
  displayGenres,
  genreEditError,
  genreFilterUrlValue,
  genreLabelPagePath,
  genrePagePath,
  genresByVisualGroup,
  genresMatchedBy,
  getGenre,
  isGenreFilterValue,
  isGenreSlug,
  isMainGenre,
  isNewsletterGenreValue,
  isSelectableGenre,
  isValidSecondaryGenre,
  matchesGenreSelection,
  parentOf,
  parseGenreFilterUrlValue,
  subgenresOf,
  validateGenreTags,
  withDerivedParents,
  type GenreFilterValue,
  type GenreSlug,
} from "./taxonomy";

/**
 * Genre system revision (2026-10-24) — the approved taxonomy and its test
 * contract (T = taxonomy, F = filtering, K = classification rules, N =
 * newsletter). The same contract is exercised through the UI in
 * EventExplorer*.test.tsx and the genre page/badge tests.
 */

const EXPECTED_ORDER: [GenreSlug, string, string | null, string][] = [
  // [id, label, parent, visual group]
  ["techno", "Techno", null, "techno"],
  ["hard-techno", "Hard Techno", "techno", "techno"],
  ["industrial-techno", "Industrial Techno", "techno", "techno"],
  ["hypnotic-techno", "Hypnotic Techno", "techno", "techno"],
  ["melodic-techno", "Melodic Techno", "techno", "techno"],
  ["minimal-techno", "Minimal Techno", "techno", "techno"],
  ["house", "House", null, "house-disco"],
  ["deep-house", "Deep House", "house", "house-disco"],
  ["tech-house", "Tech House", "house", "house-disco"],
  ["progressive-house", "Progressive House", "house", "house-disco"],
  ["afro-house", "Afro House", "house", "house-disco"],
  ["disco", "Disco", null, "house-disco"],
  ["trance", "Trance", null, "trance"],
  ["psytrance", "Psytrance", "trance", "trance"],
  ["drum-and-bass", "Drum & Bass", null, "bass-breaks"],
  ["jungle", "Jungle", "drum-and-bass", "bass-breaks"],
  ["breakbeat", "Breakbeat", null, "bass-breaks"],
  ["garage", "UK Garage", null, "bass-breaks"],
  ["dubstep", "Dubstep", null, "bass-breaks"],
  ["hardstyle", "Hardstyle", null, "hard-dance"],
  ["rawstyle", "Rawstyle", "hardstyle", "hard-dance"],
  ["hardcore", "Hardcore", null, "hard-dance"],
  ["electro", "Electro", null, "electro-experimental"],
  ["industrial", "Industrial", null, "electro-experimental"],
  ["ambient", "Ambient", null, "electro-experimental"],
  ["experimental", "Experimental", null, "electro-experimental"],
  ["electronic-other", "Electronic / Other", null, "other"],
];

const ALL_STORED: GenreSlug[] = [...GENRES.map((g) => g.slug), "ambient-experimental"];

describe("taxonomy (T1–T7)", () => {
  it("T1: exactly 27 selectable genres, in the approved order, with unique ids, labels and URL slugs", () => {
    expect(GENRES).toHaveLength(27);
    expect(GENRES.map((g) => [g.slug, g.label, g.parent ?? null, g.visualGroup])).toEqual(EXPECTED_ORDER);
    for (const key of ["slug", "label", "urlSlug"] as const) {
      expect(new Set(GENRES.map((g) => g[key])).size, key).toBe(GENRES.length);
    }
  });

  it("T2: every subgenre's parent is a main genre; the hierarchy is one level deep", () => {
    for (const g of GENRES) {
      if (!g.parent) continue;
      expect(isSelectableGenre(g.parent), g.slug).toBe(true);
      expect(parentOf(g.parent), `${g.slug} -> ${g.parent}`).toBeNull();
      expect(isMainGenre(g.parent)).toBe(true);
    }
    expect(GENRES.filter((g) => isMainGenre(g.slug)).map((g) => g.slug)).toEqual(["techno", "house", "trance", "drum-and-bass", "hardstyle"]);
  });

  it("T3/T4: approved parents — and the genres that must stay standalone", () => {
    expect(parentOf("industrial-techno")).toBe("techno");
    expect(parentOf("hypnotic-techno")).toBe("techno");
    expect(parentOf("psytrance")).toBe("trance");
    expect(parentOf("jungle")).toBe("drum-and-bass");
    expect(parentOf("rawstyle")).toBe("hardstyle");
    for (const slug of ["industrial", "garage", "dubstep", "breakbeat", "electro", "disco", "hardcore", "ambient", "experimental", "electronic-other"] as GenreSlug[]) {
      expect(parentOf(slug), slug).toBeNull();
      expect(isMainGenre(slug), slug).toBe(false);
    }
  });

  it("T5: UK Garage keeps its stored id 'garage', with URL slug 'uk-garage' and alias 'garage'", () => {
    const g = getGenre("garage");
    expect(g.label).toBe("UK Garage");
    expect(g.urlSlug).toBe("uk-garage");
    expect(g.urlAliases).toEqual(["garage"]);
  });

  it("T6: 'ambient-experimental' is a legacy stored value — displayable, not selectable", () => {
    expect(isGenreSlug("ambient-experimental")).toBe(true);
    expect(isSelectableGenre("ambient-experimental")).toBe(false);
    expect(GENRES.some((g) => g.slug === "ambient-experimental")).toBe(false);
    expect(getGenre("ambient-experimental").label).toBe("Ambient / Experimental");
  });

  it("T7: visual groups are headings over exactly the approved genres, in display order", () => {
    expect(VISUAL_GROUPS.map((g) => g.label)).toEqual(["Techno", "House & Disco", "Trance", "Bass & Breaks", "Hard Dance", "Electro & Experimental", "Other"]);
    const grouped = genresByVisualGroup();
    expect(grouped.flatMap((x) => x.genres.map((g) => g.slug))).toEqual(GENRES.map((g) => g.slug));
    expect(grouped.find((x) => x.group.slug === "bass-breaks")!.genres.map((g) => g.label)).toEqual(["Drum & Bass", "Jungle", "Breakbeat", "UK Garage", "Dubstep"]);
    expect(grouped.find((x) => x.group.slug === "hard-dance")!.genres.map((g) => g.label)).toEqual(["Hardstyle", "Rawstyle", "Hardcore"]);
    // A visual group is never a filter value or URL.
    for (const group of VISUAL_GROUPS) {
      if (isSelectableGenre(group.slug)) continue; // "techno"/"trance" share a name with their main genre
      expect(isGenreFilterValue(group.slug), group.slug).toBe(false);
      expect(parseGenreFilterUrlValue(group.slug), group.slug).toBeNull();
    }
  });

  it("never exposes 'D&B' anywhere — Drum & Bass is always spelled out, including in dense/short labels", () => {
    for (const g of GENRES) {
      expect(g.label).not.toMatch(/D&B/i);
      expect(g.shortLabel).not.toMatch(/D&B/i);
    }
    const drumAndBass = GENRES.find((g) => g.slug === "drum-and-bass")!;
    expect(drumAndBass.label).toBe("Drum & Bass");
    expect(drumAndBass.shortLabel).toBe("Drum & Bass");
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

describe("filtering (F1–F11) — matchesGenreSelection", () => {
  const matched = (selection: GenreFilterValue) => ALL_STORED.filter((slug) => matchesGenreSelection([slug], selection)).sort();

  it("F1: Techno = Techno + its five subgenres — never Industrial or Hardcore", () => {
    expect(matched("techno")).toEqual(["hard-techno", "hypnotic-techno", "industrial-techno", "melodic-techno", "minimal-techno", "techno"]);
  });

  it("F2/F3: House, Trance, Drum & Bass and Hardstyle include exactly their subgenres", () => {
    expect(matched("house")).toEqual(["afro-house", "deep-house", "house", "progressive-house", "tech-house"]);
    expect(matched("trance")).toEqual(["psytrance", "trance"]);
    expect(matched("drum-and-bass")).toEqual(["drum-and-bass", "jungle"]);
    expect(matched("hardstyle")).toEqual(["hardstyle", "rawstyle"]);
  });

  it("F4: every subgenre and standalone genre matches only itself", () => {
    for (const g of GENRES.filter((x) => !isMainGenre(x.slug))) {
      expect(matched(g.slug), g.slug).toEqual([g.slug]);
    }
  });

  it("F5: two subgenres of one main genre — matched once by the main genre and by each subgenre", () => {
    const tags: GenreSlug[] = ["hard-techno", "hypnotic-techno"];
    for (const sel of ["techno", "hard-techno", "hypnotic-techno"] as const) expect(matchesGenreSelection(tags, sel)).toBe(true);
    expect(matchesGenreSelection(tags, "melodic-techno")).toBe(false);
  });

  it("F6: Techno + Industrial shows under both; Industrial alone never under Techno", () => {
    expect(matchesGenreSelection(["techno", "industrial"], "techno")).toBe(true);
    expect(matchesGenreSelection(["techno", "industrial"], "industrial")).toBe(true);
    expect(matchesGenreSelection(["industrial"], "techno")).toBe(false);
    expect(matchesGenreSelection(["industrial-techno"], "industrial")).toBe(false);
  });

  it("F7: House + Disco shows under House and under Disco", () => {
    expect(matchesGenreSelection(["house", "disco"], "house")).toBe(true);
    expect(matchesGenreSelection(["house", "disco"], "disco")).toBe(true);
    expect(matchesGenreSelection(["disco"], "house")).toBe(false);
  });

  it("F9–F11: legacy sets keep their original meaning", () => {
    expect(matched("garage-bass")).toEqual(["dubstep", "garage"]);
    expect(matched("hardstyle-hardcore")).toEqual(["hardcore", "hardstyle", "rawstyle"]);
    expect(matched("ambient-experimental")).toEqual(["ambient", "ambient-experimental", "experimental"]);
    expect(genresMatchedBy("garage-bass")).not.toContain("breakbeat");
    expect(genresMatchedBy("garage-bass")).not.toContain("drum-and-bass");
    expect(Object.keys(LEGACY_GENRE_FILTERS)).toEqual(["garage-bass", "hardstyle-hardcore", "ambient-experimental"]);
  });

  it("parents are derived, never stored: withDerivedParents adds each parent once", () => {
    expect(withDerivedParents(["hard-techno", "hypnotic-techno"])).toEqual(["hard-techno", "techno", "hypnotic-techno"]);
    expect(withDerivedParents(["industrial"])).toEqual(["industrial"]);
    expect(subgenresOf("drum-and-bass")).toEqual(["jungle"]);
  });
});

describe("URL values (F12–F13)", () => {
  it("F12: ?genre=garage and ?genre=uk-garage both select UK Garage, written back as uk-garage", () => {
    expect(parseGenreFilterUrlValue("garage")).toBe("garage");
    expect(parseGenreFilterUrlValue("uk-garage")).toBe("garage");
    expect(genreFilterUrlValue("garage")).toBe("uk-garage");
  });

  it("every selectable genre round-trips through its URL value; legacy sets map to themselves", () => {
    for (const g of GENRES) expect(parseGenreFilterUrlValue(genreFilterUrlValue(g.slug))).toBe(g.slug);
    for (const key of Object.keys(LEGACY_GENRE_FILTERS) as (keyof typeof LEGACY_GENRE_FILTERS)[]) {
      expect(parseGenreFilterUrlValue(key)).toBe(key);
      expect(genreFilterUrlValue(key)).toBe(key);
    }
  });

  it("F13: unknown values resolve to nothing", () => {
    for (const raw of ["polka", "breaks", "bass-breaks", "hard-dance", "", null]) expect(parseGenreFilterUrlValue(raw)).toBeNull();
  });
});

describe("classification rules (K3) — validateGenreTags", () => {
  const ok = (tags: string[]) => expect(validateGenreTags(tags), tags.join("+")).toEqual([]);
  const bad = (tags: string[], kind: string) => expect(validateGenreTags(tags).map((p) => p.kind), tags.join("+")).toContain(kind);

  it("accepts one genre, two from different families, and two subgenres of one main genre", () => {
    ok(["techno"]);
    ok(["house", "disco"]);
    ok(["hard-techno", "hypnotic-techno"]);
    ok(["techno", "industrial"]);
    ok(["garage", "dubstep"]);
    ok(["hardstyle", "hardcore"]);
    ok(["electronic-other"]);
  });

  it("rejects a main genre with its own subgenre, in either order", () => {
    for (const [parent, child] of [["techno", "hard-techno"], ["house", "deep-house"], ["trance", "psytrance"], ["drum-and-bass", "jungle"], ["hardstyle", "rawstyle"]]) {
      bad([parent, child], "parent-and-subgenre");
      bad([child, parent], "parent-and-subgenre");
    }
  });

  it("rejects more than two tags, duplicates, unknown values, and Electronic / Other in a pair", () => {
    bad(["techno", "house", "trance"], "too-many");
    bad(["techno", "techno"], "duplicate");
    bad(["polka"], "unknown");
    bad(["electronic-other", "house"], "fallback-combined");
    bad(["afro-house", "electronic-other"], "fallback-combined");
  });

  it("rejects a newly chosen legacy value, but lets an untouched stored one stay", () => {
    bad(["ambient-experimental"], "legacy");
    expect(validateGenreTags(["ambient-experimental"], ["ambient-experimental"])).toEqual([]);
    expect(genreEditError(["ambient-experimental", "industrial"], ["industrial", "ambient-experimental"])).toBeNull();
    expect(genreEditError(["house", "deep-house"], [])).toMatch(/Deep House already belongs to House/);
  });

  it("isValidSecondaryGenre offers only valid pairs", () => {
    expect(isValidSecondaryGenre("hard-techno", "hypnotic-techno")).toBe(true);
    expect(isValidSecondaryGenre("techno", "hard-techno")).toBe(false);
    expect(isValidSecondaryGenre("house", "electronic-other")).toBe(false);
    expect(isValidSecondaryGenre("electronic-other", "house")).toBe(false);
    expect(isValidSecondaryGenre("house", "house")).toBe(false);
    expect(isValidSecondaryGenre("house", "ambient-experimental")).toBe(false);
  });
});

describe("genre landing page helpers (Techno pilot, 2026-10-09)", () => {
  it("only Techno has a landing page so far", () => {
    expect(genrePagePath("techno")).toBe("/genres/techno");
    for (const g of GENRES.filter((m) => m.slug !== "techno")) expect(genrePagePath(g.slug), g.slug).toBeNull();
  });

  it("a genre badge only ever links to the page for that exact genre (same meaning as the homepage filter)", () => {
    for (const g of GENRES) {
      const href = genreLabelPagePath(g.slug);
      if (href !== null) expect(href, g.slug).toBe(genrePagePath(g.slug));
    }
  });

  it("genreLabelPagePath links only the plain Techno label, never a subgenre label", () => {
    expect(genreLabelPagePath("techno")).toBe("/genres/techno");
    for (const slug of ["melodic-techno", "minimal-techno", "industrial", "hard-techno", "house"] as GenreSlug[]) {
      expect(genreLabelPagePath(slug), slug).toBeNull();
    }
  });
});

describe("newsletter genre values (N)", () => {
  it("offers a short list of broad choices built on the shared model", () => {
    expect(NEWSLETTER_GENRE_OPTIONS).toHaveLength(12);
    for (const v of NEWSLETTER_GENRE_OPTIONS) expect(isGenreFilterValue(v), v).toBe(true);
  });

  it("keeps every value from the earlier 12-group model valid (backward compatibility, no migration)", () => {
    const OLD_VALUES = ["techno", "hard-techno", "house", "trance", "psytrance", "drum-and-bass", "garage-bass", "hardstyle-hardcore", "disco", "electro", "ambient-experimental", "electronic-other"];
    for (const v of OLD_VALUES) expect(isNewsletterGenreValue(v), v).toBe(true);
    expect(isNewsletterGenreValue("polka")).toBe(false);
  });

  it("old values keep their meaning: Techno still covers Melodic and Minimal Techno; Garage / Bass still covers UK Garage and Dubstep", () => {
    expect(matchesGenreSelection(["melodic-techno"], "techno")).toBe(true);
    expect(matchesGenreSelection(["dubstep"], "garage-bass")).toBe(true);
  });
});
