import { describe, expect, it } from "vitest";
import {
  CURATED_VENUE_SLUGS,
  PUBLIC_VENUE_GROUPS,
  PUBLIC_VENUE_LABEL_OVERRIDES,
  VENUES,
  getPublicVenueGroupPrimaryId,
  googleMapsUrl,
  publicVenueLabel,
} from "./venues";

/**
 * Venues-subsite visibility + VEGA overall-venue grouping (2026-09-11):
 * covers the addendum's explicit scenarios 1-13, 15 (14 and 16 are
 * exercised at the page level — src/app/venues/page.test.tsx and
 * src/app/venues/[slug]/page.test.tsx).
 */
describe("CURATED_VENUE_SLUGS — venues-subsite visibility decision (2026-09-11)", () => {
  const REMOVED = [
    "h15",
    "hotel-cecil",
    "klub-werkstatt",
    "halvandet",
    "pylonen",
    "underwerket",
    "mayhem",
    "odds-and-ends",
    "rust",
  ];

  it.each(REMOVED)("no longer lists '%s' as a public directory entry", (slug) => {
    expect(CURATED_VENUE_SLUGS).not.toContain(slug);
  });

  it("no longer lists the old 'vega-ideal-bar' entry", () => {
    expect(CURATED_VENUE_SLUGS).not.toContain("vega-ideal-bar");
  });

  it("lists the new overall 'vega' entry", () => {
    expect(CURATED_VENUE_SLUGS).toContain("vega");
  });

  it.each(REMOVED)("'%s' remains a real, event-linkable registry entry — removal is presentation-only, never a data deletion", (slug) => {
    const row = VENUES.find((v) => v.slug === slug);
    expect(row).toBeDefined();
  });

  it("unrelated, still-curated venues (e.g. Culture Box) are unaffected", () => {
    expect(CURATED_VENUE_SLUGS).toContain("culture-box");
  });
});

describe("PUBLIC_VENUE_GROUPS / getPublicVenueGroupPrimaryId — VEGA overall-venue grouping (2026-09-11)", () => {
  it("groups Ideal Bar under the VEGA parent", () => {
    expect(PUBLIC_VENUE_GROUPS["v-vega"]).toEqual(["v-vega-ideal-bar"]);
  });

  it("resolves Ideal Bar's venue id to VEGA's as the group primary", () => {
    expect(getPublicVenueGroupPrimaryId("v-vega-ideal-bar")).toBe("v-vega");
  });

  it("returns null for a venue that isn't a grouped member, including the VEGA primary itself", () => {
    expect(getPublicVenueGroupPrimaryId("v-vega")).toBeNull();
    expect(getPublicVenueGroupPrimaryId("v-culture-box")).toBeNull();
  });

  it("Ideal Bar remains its own standalone venue row in the registry — grouping is presentation-only, never a data-model merge", () => {
    const idealBar = VENUES.find((v) => v.id === "v-vega-ideal-bar");
    const vega = VENUES.find((v) => v.id === "v-vega");
    expect(idealBar).toBeDefined();
    expect(vega).toBeDefined();
    expect(idealBar?.id).not.toBe(vega?.id);
    expect(idealBar?.rooms ?? []).toHaveLength(0);
  });
});

describe("PUBLIC_VENUE_LABEL_OVERRIDES / publicVenueLabel — Jolene/Baggen public label (2026-09-11)", () => {
  it("overrides Jolene's public label to 'Jolene (Club)'", () => {
    expect(PUBLIC_VENUE_LABEL_OVERRIDES["v-jolene"]).toBe("Jolene (Club)");
    expect(publicVenueLabel({ id: "v-jolene", name: "Jolene Bar" })).toBe("Jolene (Club)");
  });

  it("overrides Baggen's public label to 'Baggen (Club)'", () => {
    expect(PUBLIC_VENUE_LABEL_OVERRIDES["v-baggen"]).toBe("Baggen (Club)");
    expect(publicVenueLabel({ id: "v-baggen", name: "Baggen" })).toBe("Baggen (Club)");
  });

  it("leaves Jolene's and Baggen's own canonical `name` untouched — only the public-subsite label is overridden", () => {
    const jolene = VENUES.find((v) => v.id === "v-jolene");
    const baggen = VENUES.find((v) => v.id === "v-baggen");
    expect(jolene?.name).toBe("Jolene Bar");
    expect(baggen?.name).toBe("Baggen");
  });

  it("falls back to the venue's own name when no override applies", () => {
    expect(publicVenueLabel({ id: "v-culture-box", name: "Culture Box" })).toBe("Culture Box");
  });
});

describe("googleMapsUrl — venue address linking (backlog)", () => {
  it("builds a keyless Google Maps search URL from a venue's address", () => {
    expect(googleMapsUrl("Kronprinsessegade 54A, 1306 København K")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Kronprinsessegade%2054A%2C%201306%20K%C3%B8benhavn%20K",
    );
  });

  it("URL-encodes every venue address in the registry without throwing", () => {
    for (const venue of VENUES) {
      expect(() => new URL(googleMapsUrl(venue.address))).not.toThrow();
    }
  });
});
