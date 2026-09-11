import { describe, expect, it } from "vitest";
import { artistNamesMatch, dedupeArtistList, normalizeArtistName, normalizeVenueName, resolveVenue } from "./normalize";
import { VENUES } from "./data/venues";
import type { Venue } from "./types";

describe("venue normalization", () => {
  it("resolves known aliases and spelling/capitalization variants to one venue", () => {
    expect(resolveVenue("Den Anden Side", VENUES)?.venue.id).toBe("v-den-anden-side");
    expect(resolveVenue("DAS", VENUES)?.venue.id).toBe("v-den-anden-side");
    expect(resolveVenue("Den Anden Side Copenhagen", VENUES)?.venue.id).toBe("v-den-anden-side");
    expect(resolveVenue("den anden side", VENUES)?.venue.id).toBe("v-den-anden-side");
    expect(resolveVenue("DEN  ANDEN   SIDE", VENUES)?.venue.id).toBe("v-den-anden-side");
  });

  it("returns undefined for an unregistered venue name", () => {
    expect(resolveVenue("Some Random Bar", VENUES)).toBeUndefined();
  });

  // Refshaleøen neutral venue model (2026-09-07): v-refshaleoen-ved-hangaren
  // is a standalone location identity for the shared outdoor festival field
  // on Refshaleøen, registered with deliberately NO aliases (no live source
  // has ever emitted bare "Refshaleøen" as a raw venue string, and adding it
  // speculatively risks absorbing an unrelated Refshaleøen location later).
  // Karrusel 2027's real raw KultuNaut string, "Copenhell festivalplads", is
  // intentionally excluded from the registry entirely (Copenhell is a
  // separate rock festival) and so is intentionally left unresolved here —
  // it's assigned only via an admin's explicit venue selection at publish
  // time, never automatic string matching.
  it("registers Refshaleøen (ved Hangaren) as its own standalone venue, distinct from Hangaren, with no aliases", () => {
    const refshaleoen = VENUES.find((v) => v.id === "v-refshaleoen-ved-hangaren");
    expect(refshaleoen).toBeDefined();
    expect(refshaleoen?.name).toBe("Refshaleøen (ved Hangaren)");
    expect(refshaleoen?.aliases).toEqual([]);
    expect(refshaleoen?.id).not.toBe("v-hangaren");

    expect(resolveVenue("Refshaleøen (ved Hangaren)", VENUES)?.venue.id).toBe("v-refshaleoen-ved-hangaren");
    // Never auto-resolves from the raw KultuNaut string it deliberately excludes.
    expect(resolveVenue("Copenhell festivalplads", VENUES)).toBeUndefined();
    // Never absorbs a bare "Refshaleøen" or an unrelated named Refshaleøen location.
    expect(resolveVenue("Refshaleøen", VENUES)).toBeUndefined();
    expect(resolveVenue("Sønder Hoved, Refshaleøen", VENUES)).toBeUndefined();
    // Hangaren itself is untouched and remains its own separate venue.
    expect(resolveVenue("Hangaren", VENUES)?.venue.id).toBe("v-hangaren");
  });

  it("normalizeVenueName strips punctuation and collapses whitespace", () => {
    expect(normalizeVenueName("Culture Box!")).toBe("culture box");
    expect(normalizeVenueName("  Culture   Box  ")).toBe("culture box");
  });

  it("Culture Box regression (VEGA venue model cleanup, 2026-09-06): resolver behavior for Culture Box and its rooms is unchanged — Black Box/Red Box still never resolve to any venue (they're handled at the adapter level, consolidated into one Culture Box event per night, never a structural room/parent relationship) while Culture Box itself still resolves normally", () => {
    expect(resolveVenue("Culture Box", VENUES)?.venue.id).toBe("v-culture-box");
    expect(resolveVenue("Culture Box", VENUES)?.subVenue).toBeNull();
    expect(resolveVenue("Black Box", VENUES)).toBeUndefined();
    expect(resolveVenue("Red Box", VENUES)).toBeUndefined();
  });

  it("Pumpehuset/Byhaven regression (generalized sub-venue model, 2026-09-06): Pumpehuset has no `rooms` configured, so resolver behavior is completely unchanged — Byhaven still never resolves as a venue name at all (it's a title-prefix convention, see eventPresentation.ts), only Pumpehuset itself resolves", () => {
    expect(resolveVenue("Pumpehuset", VENUES)?.venue.id).toBe("v-pumpehuset");
    expect(resolveVenue("Pumpehuset", VENUES)?.subVenue).toBeNull();
    expect(resolveVenue("Byhaven", VENUES)).toBeUndefined();
  });
});

describe("VEGA parent/room model (venue model cleanup, 2026-09-06; corrected to a real room field by the generalized sub-venue model follow-up, 2026-09-06)", () => {
  // VEGA is a parent venue/complex with two concert-hall ROOMS — Store VEGA
  // and Lille VEGA — both of which resolve to the SAME parent venue id
  // (v-vega), exactly like Byhaven/Black Box/Red Box already resolve to
  // their own parent rather than becoming standalone rows (see
  // PROTECTED_SUB_VENUE_NAMES in venueCreation.ts). Unlike an earlier,
  // interim version of this fix, Store VEGA/Lille VEGA are no longer plain
  // ALIASES (which would discard the room distinction on resolution) — they
  // are entries in v-vega's `rooms` array, so resolveVenue() reports which
  // room via `subVenue` alongside the parent venue. Ideal Bar is a
  // genuinely separate, standalone venue — never a room under VEGA, and a
  // bare "VEGA" string must never resolve there. resolveVenue() is exact
  // normalized-name-or-alias/room matching only (never fuzzy), so this is a
  // general venue-model property, independent of any one source.

  it("bare 'VEGA' resolves to the VEGA parent venue with subVenue null, not Ideal Bar", () => {
    expect(resolveVenue("VEGA", VENUES)?.venue.id).toBe("v-vega");
    expect(resolveVenue("VEGA", VENUES)?.subVenue).toBeNull();
    expect(resolveVenue("vega", VENUES)?.venue.id).toBe("v-vega");
    expect(resolveVenue("vega", VENUES)?.subVenue).toBeNull();
  });

  it("'Store VEGA' resolves to the VEGA parent venue with subVenue 'Store VEGA' — room identity is preserved, not discarded", () => {
    expect(resolveVenue("Store VEGA", VENUES)?.venue.id).toBe("v-vega");
    expect(resolveVenue("Store VEGA", VENUES)?.subVenue).toBe("Store VEGA");
  });

  it("'Lille VEGA' resolves to the VEGA parent venue with subVenue 'Lille VEGA', in either casing (real Billetto evidence supplies 'Lille Vega')", () => {
    expect(resolveVenue("Lille VEGA", VENUES)?.venue.id).toBe("v-vega");
    expect(resolveVenue("Lille VEGA", VENUES)?.subVenue).toBe("Lille VEGA");
    expect(resolveVenue("Lille Vega", VENUES)?.venue.id).toBe("v-vega");
    expect(resolveVenue("Lille Vega", VENUES)?.subVenue).toBe("Lille VEGA");
  });

  it("explicit 'Ideal Bar' resolves to the separate, standalone Ideal Bar venue — never the VEGA parent, no room", () => {
    expect(resolveVenue("Ideal Bar", VENUES)?.venue.id).toBe("v-vega-ideal-bar");
    expect(resolveVenue("Ideal Bar", VENUES)?.subVenue).toBeNull();
    expect(resolveVenue("Vega Ideal Bar", VENUES)?.venue.id).toBe("v-vega-ideal-bar");
    expect(resolveVenue("VEGA (Ideal Bar)", VENUES)?.venue.id).toBe("v-vega-ideal-bar");
  });

  it("never maps bare 'VEGA' (or a Store/Lille VEGA variant) to Ideal Bar", () => {
    expect(resolveVenue("VEGA", VENUES)?.venue.id).not.toBe("v-vega-ideal-bar");
    expect(resolveVenue("Store VEGA", VENUES)?.venue.id).not.toBe("v-vega-ideal-bar");
    expect(resolveVenue("Lille VEGA", VENUES)?.venue.id).not.toBe("v-vega-ideal-bar");
  });

  it("the removed 'Lille VEGA Ideal Bar' compound string no longer resolves to Ideal Bar — it was never real source evidence, only a conflation the cleanup removed", () => {
    expect(resolveVenue("Lille VEGA Ideal Bar", VENUES)).toBeUndefined();
  });

  it("v-vega's own aliases no longer contain 'Store VEGA'/'Lille VEGA' (generalized sub-venue model, 2026-09-06) — they live in `rooms` now, not `aliases`", () => {
    const vega = VENUES.find((v) => v.id === "v-vega");
    expect(vega?.aliases).not.toContain("Store VEGA");
    expect(vega?.aliases).not.toContain("Lille VEGA");
    expect(vega?.rooms?.map((r) => r.name)).toEqual(["Store VEGA", "Lille VEGA"]);
  });

  it("the Ideal Bar venue's own display name still does not overclaim the whole VEGA building (renamed from 'VEGA (Ideal Bar)' to 'Ideal Bar' — venue-subsite VEGA grouping, 2026-09-11)", () => {
    const idealBar = VENUES.find((v) => v.id === "v-vega-ideal-bar");
    expect(idealBar?.name).toBe("Ideal Bar");
    expect(idealBar?.name).not.toBe("VEGA");
    // Resolution is unaffected by the rename: the old "VEGA (Ideal Bar)"
    // string is still a listed alias, so every raw source string that used
    // to resolve here still does (see the "explicit 'Ideal Bar' resolves…"
    // test above).
    expect(idealBar?.aliases).toContain("VEGA (Ideal Bar)");
  });

  it("the VEGA parent and Ideal Bar are two distinct venue rows, each still resolving only to itself", () => {
    const vega = VENUES.find((v) => v.id === "v-vega");
    const idealBar = VENUES.find((v) => v.id === "v-vega-ideal-bar");
    expect(vega).toBeDefined();
    expect(idealBar).toBeDefined();
    expect(vega?.id).not.toBe(idealBar?.id);
    expect(resolveVenue("VEGA", VENUES)?.venue.id).toBe(vega?.id);
    expect(resolveVenue("Ideal Bar", VENUES)?.venue.id).toBe(idealBar?.id);
  });
});

describe("generalized room-resolution model (2026-09-06) — synthetic venues, independent of VEGA", () => {
  // A minimal synthetic registry proves the room model is generalized (any
  // venue with a `rooms` array behaves this way), not hardcoded to VEGA.
  const PARENT: Venue = {
    id: "v-test-parent",
    slug: "test-parent",
    name: "Test Parent",
    aliases: ["TP"],
    rooms: [{ name: "North Hall", aliases: ["N Hall", "NH"] }, { name: "South Hall" }],
    address: "Test Street 1",
    city: "Copenhagen",
    postalCode: "1000",
    websiteUrl: null,
    description: "",
    shortDescription: null,
    venueProfile: null,
  };
  const OTHER: Venue = {
    id: "v-other",
    slug: "other",
    name: "Other Venue",
    aliases: [],
    address: "Elsewhere 1",
    city: "Copenhagen",
    postalCode: "1000",
    websiteUrl: null,
    description: "",
    shortDescription: null,
    venueProfile: null,
  };
  const TEST_VENUES = [PARENT, OTHER];

  it("a venue's own name/aliases still resolve with subVenue null", () => {
    expect(resolveVenue("Test Parent", TEST_VENUES)).toEqual({ venue: PARENT, subVenue: null });
    expect(resolveVenue("TP", TEST_VENUES)).toEqual({ venue: PARENT, subVenue: null });
  });

  it("a room's own name resolves to the parent venue with that room reported", () => {
    expect(resolveVenue("North Hall", TEST_VENUES)).toEqual({ venue: PARENT, subVenue: "North Hall" });
    expect(resolveVenue("South Hall", TEST_VENUES)).toEqual({ venue: PARENT, subVenue: "South Hall" });
  });

  it("a room's own configured ALIASES also resolve to that same room", () => {
    expect(resolveVenue("N Hall", TEST_VENUES)).toEqual({ venue: PARENT, subVenue: "North Hall" });
    expect(resolveVenue("NH", TEST_VENUES)).toEqual({ venue: PARENT, subVenue: "North Hall" });
  });

  it("never fuzzy/substring matches a room name", () => {
    expect(resolveVenue("North Hall Extra", TEST_VENUES)).toBeUndefined();
    expect(resolveVenue("North", TEST_VENUES)).toBeUndefined();
  });

  it("a venue with no `rooms` configured at all behaves exactly as before — no room ever reported", () => {
    expect(resolveVenue("Other Venue", TEST_VENUES)).toEqual({ venue: OTHER, subVenue: null });
  });

  it("a venue's own name/alias is checked before any venue's rooms — a room name can never shadow a real venue identity", () => {
    const SHADOW_PARENT: Venue = { ...PARENT, rooms: [{ name: "Other Venue" }] };
    const registry = [SHADOW_PARENT, OTHER];
    // "Other Venue" is OTHER's own real name — that must win over
    // SHADOW_PARENT's room of the same name.
    expect(resolveVenue("Other Venue", registry)?.venue.id).toBe("v-other");
    expect(resolveVenue("Other Venue", registry)?.subVenue).toBeNull();
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
