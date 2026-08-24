import { describe, expect, it } from "vitest";
import { isProtectedSubVenueName, planVenueCreation, slugifyVenueName } from "./venueCreation";
import type { Venue } from "./types";

const PUMPEHUSET: Venue = {
  id: "v-pumpehuset",
  slug: "pumpehuset",
  name: "Pumpehuset",
  aliases: ["Pumpehuset Copenhagen", "The Pumpehuset"],
  address: "Studiestræde 52, 1554 København V",
  city: "Copenhagen",
  postalCode: "1554",
  websiteUrl: "https://pumpehuset.dk/",
  description: "",
  shortDescription: null,
  venueProfile: null,
};

const CULTURE_BOX: Venue = {
  id: "v-culture-box",
  slug: "culture-box",
  name: "Culture Box",
  aliases: ["Culturebox", "CB Kbh", "Culture Box Copenhagen"],
  address: "Kronprinsessegade 54A, 1306 København K",
  city: "Copenhagen",
  postalCode: "1306",
  websiteUrl: "https://culture-box.com/",
  description: "",
  shortDescription: null,
  venueProfile: null,
};

const BAGGEN: Venue = {
  id: "v-baggen",
  slug: "baggen",
  name: "Baggen",
  aliases: ["Baggen Copenhagen", "Baggen Kødbyen"],
  address: "Flæsketorvet 19, 1711 København V",
  city: "Copenhagen",
  postalCode: "1711",
  websiteUrl: null,
  description: "",
  shortDescription: null,
  venueProfile: null,
};

const EXISTING = [PUMPEHUSET, CULTURE_BOX, BAGGEN];

describe("slugifyVenueName", () => {
  it("produces a clean, hyphenated, lowercase slug matching the seed convention", () => {
    expect(slugifyVenueName("Den Anden Side")).toBe("den-anden-side");
    expect(slugifyVenueName("VEGA (Ideal Bar)")).toBe("vega-ideal-bar");
  });

  it("strips real combining diacritics rather than dropping the whole word", () => {
    expect(slugifyVenueName("Café Sonar")).toBe("cafe-sonar");
  });

  it("never leaves leading/trailing hyphens", () => {
    expect(slugifyVenueName("  Odds & Ends  ")).toBe("odds-ends");
  });
});

describe("isProtectedSubVenueName", () => {
  it("flags Byhaven and Culture Box's rooms regardless of case/whitespace", () => {
    expect(isProtectedSubVenueName("Byhaven")).toBe(true);
    expect(isProtectedSubVenueName("byhaven")).toBe(true);
    expect(isProtectedSubVenueName("Black Box")).toBe(true);
    expect(isProtectedSubVenueName("  red   box ")).toBe(true);
  });

  it("does not flag an unrelated venue name", () => {
    expect(isProtectedSubVenueName("Hangaren")).toBe(false);
    expect(isProtectedSubVenueName("Basement")).toBe(false);
  });
});

describe("planVenueCreation — duplicate prevention (real venues, real registry)", () => {
  it("reuses an existing venue on an exact normalized name match, never creating a duplicate", () => {
    const plan = planVenueCreation(
      { name: "pumpehuset", address: "Studiestræde 52", city: "Copenhagen", postalCode: "1554" },
      EXISTING,
    );
    expect(plan.kind).toBe("existing");
    if (plan.kind === "existing") expect(plan.venue.id).toBe("v-pumpehuset");
  });

  it("reuses an existing venue when the input matches an alias, not just the primary name", () => {
    const plan = planVenueCreation(
      { name: "Baggen Kødbyen", address: "Flæsketorvet 19", city: "Copenhagen", postalCode: "1711" },
      EXISTING,
    );
    expect(plan.kind).toBe("existing");
    if (plan.kind === "existing") expect(plan.venue.id).toBe("v-baggen");
  });

  it("treats capitalization and punctuation differences as the same venue (no trivial-formatting duplicate)", () => {
    const plan = planVenueCreation(
      { name: "CULTURE-BOX!!", address: "Kronprinsessegade 54A", city: "Copenhagen", postalCode: "1306" },
      EXISTING,
    );
    expect(plan.kind).toBe("existing");
    if (plan.kind === "existing") expect(plan.venue.id).toBe("v-culture-box");
  });

  it("does NOT speculatively match a name variant with no registered alias establishing it", () => {
    // "Baggen Vesterbro" is not Baggen (Kødbyen) and no alias says otherwise —
    // must be treated as a new, distinct candidate, not silently merged.
    const plan = planVenueCreation(
      { name: "Baggen Vesterbro", address: "Somewhere else", city: "Copenhagen", postalCode: "1600" },
      EXISTING,
    );
    expect(plan.kind).toBe("create");
  });
});

describe("planVenueCreation — Byhaven / Culture Box room safety", () => {
  it("requires explicit confirmation before creating a standalone 'Byhaven' venue", () => {
    const plan = planVenueCreation(
      { name: "Byhaven", address: "Studiestræde 52", city: "Copenhagen", postalCode: "1554" },
      EXISTING,
    );
    expect(plan.kind).toBe("needs-confirmation");
  });

  it("requires explicit confirmation before creating a standalone 'Black Box' or 'Red Box' venue", () => {
    const black = planVenueCreation(
      { name: "Black Box", address: "Somewhere", city: "Copenhagen", postalCode: "1000" },
      EXISTING,
    );
    const red = planVenueCreation(
      { name: "Red Box", address: "Somewhere", city: "Copenhagen", postalCode: "1000" },
      EXISTING,
    );
    expect(black.kind).toBe("needs-confirmation");
    expect(red.kind).toBe("needs-confirmation");
  });

  it("proceeds to create once explicitly confirmed — an admin can still make that informed decision", () => {
    const plan = planVenueCreation(
      { name: "Byhaven", address: "Somewhere genuinely different", city: "Copenhagen", postalCode: "2200" },
      EXISTING,
      { confirmed: true },
    );
    expect(plan.kind).toBe("create");
    if (plan.kind === "create") {
      expect(plan.venue.name).toBe("Byhaven");
      expect(plan.venue.id).not.toBe("v-pumpehuset");
    }
  });

  it("an existing exact match always wins over the guard, even for a protected name", () => {
    // If "Byhaven" were ever registered as its own real venue row, reusing it
    // is never unsafe — the guard only exists to stop a NEW row being created.
    const withByhaven = [...EXISTING, { ...PUMPEHUSET, id: "v-byhaven", slug: "byhaven", name: "Byhaven", aliases: [] }];
    const plan = planVenueCreation(
      { name: "Byhaven", address: "x", city: "Copenhagen", postalCode: "1000" },
      withByhaven,
    );
    expect(plan.kind).toBe("existing");
  });
});

describe("planVenueCreation — new venue identity (genuinely new Copenhagen location)", () => {
  it("creates a deterministic, non-fabricated venue row from admin-supplied fields only", () => {
    const plan = planVenueCreation(
      { name: "Suporama", address: "Nørrebrogade 1", city: "Copenhagen", postalCode: "2200", websiteUrl: "https://suporama.example/" },
      EXISTING,
    );
    expect(plan.kind).toBe("create");
    if (plan.kind === "create") {
      expect(plan.venue.slug).toBe("suporama");
      expect(plan.venue.id).toBe("v-suporama");
      expect(plan.venue.address).toBe("Nørrebrogade 1");
      expect(plan.venue.city).toBe("Copenhagen");
      expect(plan.venue.postalCode).toBe("2200");
      expect(plan.venue.websiteUrl).toBe("https://suporama.example/");
      expect(plan.venue.aliases).toEqual([]);
      // Never fabricated editorial copy for a brand-new, non-curated venue.
      expect(plan.venue.description).toBe("");
      expect(plan.venue.shortDescription).toBeNull();
      expect(plan.venue.venueProfile).toBeNull();
    }
  });

  it("defaults websiteUrl to null when not supplied, never inventing one", () => {
    const plan = planVenueCreation(
      { name: "Another New Place", address: "Some street 1", city: "Frederiksberg", postalCode: "2000" },
      EXISTING,
    );
    expect(plan.kind).toBe("create");
    if (plan.kind === "create") expect(plan.venue.websiteUrl).toBeNull();
  });
});
