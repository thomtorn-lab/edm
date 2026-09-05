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

describe("VEGA room disambiguation (KultuNaut audit follow-up, 2026-09-05)", () => {
  // Real correctness risk found during the KultuNaut source audit: VEGA is a
  // multi-room building (Store VEGA, Lille VEGA, and the basement Ideal Bar
  // club room), but the only registered VEGA row is Ideal-Bar-specific
  // (v-vega-ideal-bar). resolveVenue() does exact normalized-name matching
  // (never fuzzy), so a source's own generic "VEGA" string must not silently
  // attach to that one specific room — it should remain unresolved for
  // manual review until real evidence justifies a dedicated parent-VEGA row.
  // This is a general venue-model property, independent of any one source.

  it("explicit 'Ideal Bar' resolves to the Ideal Bar room", () => {
    expect(resolveVenue("Ideal Bar", VENUES)?.id).toBe("v-vega-ideal-bar");
    expect(resolveVenue("Vega Ideal Bar", VENUES)?.id).toBe("v-vega-ideal-bar");
    expect(resolveVenue("VEGA (Ideal Bar)", VENUES)?.id).toBe("v-vega-ideal-bar");
  });

  it("bare 'VEGA' does NOT resolve to the Ideal Bar room — no legitimate parent VEGA venue is registered, so it must remain unresolved for manual review, not silently misattached to one specific room", () => {
    expect(resolveVenue("VEGA", VENUES)).toBeUndefined();
    expect(resolveVenue("vega", VENUES)).toBeUndefined();
  });

  it("'Store VEGA' does not collide with the Ideal Bar room (no such alias exists, and none should be invented without real event evidence)", () => {
    expect(resolveVenue("Store VEGA", VENUES)).toBeUndefined();
  });

  it("bare 'Lille VEGA' (without the Ideal Bar qualifier) does not collide with the Ideal Bar room — only the full 'Lille VEGA Ideal Bar' string is a real, evidenced alias", () => {
    expect(resolveVenue("Lille VEGA", VENUES)).toBeUndefined();
    expect(resolveVenue("Lille VEGA Ideal Bar", VENUES)?.id).toBe("v-vega-ideal-bar");
  });

  it("the Ideal Bar venue's own display name no longer overclaims the whole VEGA building", () => {
    const idealBar = VENUES.find((v) => v.id === "v-vega-ideal-bar");
    expect(idealBar?.name).toBe("VEGA (Ideal Bar)");
    expect(idealBar?.name).not.toBe("VEGA");
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

  it("strips a zero-width joiner left between two adjacent SoundCloud links, not just the links themselves (real production evidence: Hangaren's 'Arcanum Collective: POSSESSED' lineup)", () => {
    const result = dedupeArtistList([
      "Lulla-Li & Nihility: https://soundcloud.com/tenna-li-andersen‍   ‍https://soundcloud.com/nihility_forest",
    ]);
    expect(result).toEqual(["Lulla-Li & Nihility"]);
  });

  it("collapses duplicated label text left dangling on both sides of a removed URL (real Production evidence: Hangaren's 'Arcanum Collective: POSSESSED' — 'Fagins Reject – Wild Things Records: <soundcloud link> - Wild things Records', case differing between the two mentions)", () => {
    const result = dedupeArtistList([
      'Fagins Reject – Wild Things Records: https://soundcloud.com/fagins_reject - Wild things Records',
    ]);
    expect(result).toEqual(["Fagins Reject – Wild Things Records"]);
  });

  it("still cleanly strips a bare dangling hyphen with no duplicated text after it (Hangaren's 'Kromagon: <soundcloud link> -')", () => {
    const result = dedupeArtistList(["Kromagon: https://soundcloud.com/aragon -"]);
    expect(result).toEqual(["Kromagon"]);
  });

  it("never collapses a real, distinct affiliation or alias following a genuine '-' — only an exact (case-insensitive) trailing duplicate of the preceding label is dropped", () => {
    const result = dedupeArtistList(["DJ Example: https://soundcloud.com/example - Guest Alias"]);
    expect(result).toEqual(["DJ Example: - Guest Alias"]);
  });
});
