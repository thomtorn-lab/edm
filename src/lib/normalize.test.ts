import { describe, expect, it } from "vitest";
import { artistNamesMatch, dedupeArtistList, normalizeArtistName, normalizeVenueName, resolveVenue } from "./normalize";
import { VENUES } from "./data/venues";

describe("venue normalization", () => {
  it("resolves known aliases and spelling/capitalization variants to one venue", () => {
    expect(resolveVenue("Den Anden Side", VENUES)?.id).toBe("v-den-anden-side");
    expect(resolveVenue("DAS", VENUES)?.id).toBe("v-den-anden-side");
    expect(resolveVenue("Den Anden Side Copenhagen", VENUES)?.id).toBe("v-den-anden-side");
    expect(resolveVenue("den anden side", VENUES)?.id).toBe("v-den-anden-side");
    expect(resolveVenue("DEN  ANDEN   SIDE", VENUES)?.id).toBe("v-den-anden-side");
  });

  it("returns undefined for an unregistered venue name", () => {
    expect(resolveVenue("Some Random Bar", VENUES)).toBeUndefined();
  });

  it("normalizeVenueName strips punctuation and collapses whitespace", () => {
    expect(normalizeVenueName("Culture Box!")).toBe("culture box");
    expect(normalizeVenueName("  Culture   Box  ")).toBe("culture box");
  });
});

describe("artist normalization", () => {
  it("treats case and formatting variants as the same artist", () => {
    expect(artistNamesMatch("DJ NAME", "Dj Name")).toBe(true);
    expect(artistNamesMatch("DJ NAME", "DJ NAME (DK)")).toBe(true);
    expect(artistNamesMatch("DJ NAME (DK)", "dj name")).toBe(true);
  });

  it("does not merge genuinely different artists", () => {
    expect(artistNamesMatch("DJ NAME", "DJ OTHER")).toBe(false);
  });

  it("normalizeArtistName strips trailing parenthetical country codes", () => {
    expect(normalizeArtistName("KASST (DK)")).toBe("kasst");
  });

  it("dedupeArtistList collapses formatting duplicates while keeping distinct artists", () => {
    const result = dedupeArtistList(["KASST", "Kasst (DK)", "MRK.", "kasst"]);
    expect(result).toHaveLength(2);
  });
});

describe("URL noise stripping in artist/lineup fields (data-quality Workstream D)", () => {
  it("strips a bare (protocol-less) SoundCloud URL appended to an artist name (Arcanum Collective: POSSESSED-type evidence)", () => {
    expect(normalizeArtistName("Kromagon soundcloud.com/aragon")).toBe(normalizeArtistName("Kromagon"));
    const result = dedupeArtistList(["Kromagon soundcloud.com/aragon-dj"]);
    expect(result).toEqual(["Kromagon"]);
  });

  it("strips a schemed SoundCloud URL appended to an artist name", () => {
    const result = dedupeArtistList(["Kromagon: https://soundcloud.com/aragon -"]);
    expect(result).toEqual(["Kromagon"]);
  });

  it("strips a bare www-prefixed URL", () => {
    const result = dedupeArtistList(["DJ Nightshade www.instagram.com/djnightshade"]);
    expect(result).toEqual(["DJ Nightshade"]);
  });

  it("drops an entry that is nothing but a URL, rather than storing an empty artist name", () => {
    const result = dedupeArtistList(["Real Artist", "soundcloud.com/someone", "https://facebook.com/somepage"]);
    expect(result).toEqual(["Real Artist"]);
  });

  it("never strips legitimate artist punctuation, initials or aliases", () => {
    expect(normalizeArtistName("R.O.O.T.")).toBe("r.o.o.t.");
    expect(dedupeArtistList(["R.O.O.T.", "MRK.", "I. Hate. Models."])).toEqual(["R.O.O.T.", "MRK.", "I. Hate. Models."]);
  });

  it("keeps distinct artists distinct even after URL stripping", () => {
    const result = dedupeArtistList(["Kromagon soundcloud.com/aragon", "Other Artist soundcloud.com/other"]);
    expect(result).toHaveLength(2);
  });
});
