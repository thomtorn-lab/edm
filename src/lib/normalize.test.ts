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
