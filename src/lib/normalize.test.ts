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

  it("Culture Box regression (VEGA venue model cleanup, 2026-09-06): resolver behavior for Culture Box and its rooms is unchanged — Black Box/Red Box still never resolve to any venue (they're handled at the adapter level, consolidated into one Culture Box event per night, never a structural room/parent relationship) while Culture Box itself still resolves normally", () => {
    expect(resolveVenue("Culture Box", VENUES)?.id).toBe("v-culture-box");
    expect(resolveVenue("Black Box", VENUES)).toBeUndefined();
    expect(resolveVenue("Red Box", VENUES)).toBeUndefined();
  });
});

describe("VEGA parent/room model (venue model cleanup, 2026-09-06)", () => {
  // VEGA is a parent venue/complex with two concert-hall rooms — Store VEGA
  // and Lille VEGA — both of which resolve to the SAME parent venue id
  // (v-vega), exactly like Byhaven/Black Box/Red Box already resolve to
  // their own parent rather than becoming standalone rows (see
  // PROTECTED_SUB_VENUE_NAMES in venueCreation.ts). Ideal Bar is a
  // genuinely separate, standalone venue — never a room under VEGA, and a
  // bare "VEGA" string must never resolve there. resolveVenue() is exact
  // normalized-name-or-alias matching only (never fuzzy), so this is a
  // general venue-model property, independent of any one source.

  it("bare 'VEGA' resolves to the VEGA parent venue, not Ideal Bar", () => {
    expect(resolveVenue("VEGA", VENUES)?.id).toBe("v-vega");
    expect(resolveVenue("vega", VENUES)?.id).toBe("v-vega");
  });

  it("'Store VEGA' resolves to the VEGA parent venue", () => {
    expect(resolveVenue("Store VEGA", VENUES)?.id).toBe("v-vega");
  });

  it("'Lille VEGA' resolves to the VEGA parent venue, in either casing (real Billetto evidence supplies 'Lille Vega')", () => {
    expect(resolveVenue("Lille VEGA", VENUES)?.id).toBe("v-vega");
    expect(resolveVenue("Lille Vega", VENUES)?.id).toBe("v-vega");
  });

  it("explicit 'Ideal Bar' resolves to the separate, standalone Ideal Bar venue — never the VEGA parent", () => {
    expect(resolveVenue("Ideal Bar", VENUES)?.id).toBe("v-vega-ideal-bar");
    expect(resolveVenue("Vega Ideal Bar", VENUES)?.id).toBe("v-vega-ideal-bar");
    expect(resolveVenue("VEGA (Ideal Bar)", VENUES)?.id).toBe("v-vega-ideal-bar");
  });

  it("never maps bare 'VEGA' (or a Store/Lille VEGA variant) to Ideal Bar", () => {
    expect(resolveVenue("VEGA", VENUES)?.id).not.toBe("v-vega-ideal-bar");
    expect(resolveVenue("Store VEGA", VENUES)?.id).not.toBe("v-vega-ideal-bar");
    expect(resolveVenue("Lille VEGA", VENUES)?.id).not.toBe("v-vega-ideal-bar");
  });

  it("the removed 'Lille VEGA Ideal Bar' compound string no longer resolves to Ideal Bar — it was never real source evidence, only a conflation the cleanup removed", () => {
    expect(resolveVenue("Lille VEGA Ideal Bar", VENUES)).toBeUndefined();
  });

  it("the Ideal Bar venue's own display name still does not overclaim the whole VEGA building", () => {
    const idealBar = VENUES.find((v) => v.id === "v-vega-ideal-bar");
    expect(idealBar?.name).toBe("VEGA (Ideal Bar)");
    expect(idealBar?.name).not.toBe("VEGA");
  });

  it("the VEGA parent and Ideal Bar are two distinct venue rows, each still resolving only to itself", () => {
    const vega = VENUES.find((v) => v.id === "v-vega");
    const idealBar = VENUES.find((v) => v.id === "v-vega-ideal-bar");
    expect(vega).toBeDefined();
    expect(idealBar).toBeDefined();
    expect(vega?.id).not.toBe(idealBar?.id);
    expect(resolveVenue("VEGA", VENUES)?.id).toBe(vega?.id);
    expect(resolveVenue("Ideal Bar", VENUES)?.id).toBe(idealBar?.id);
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
