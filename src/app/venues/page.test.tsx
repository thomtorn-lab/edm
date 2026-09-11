// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const VENUE = {
  id: "v1",
  slug: "culture-box",
  name: "Culture Box",
  aliases: [],
  address: "Kronprinsessegade 54",
  city: "Copenhagen" as const,
  postalCode: "1000",
  websiteUrl: null,
  description: "A techno club.",
  shortDescription: "A techno club in the city centre.",
  venueProfile: null,
};

vi.mock("@/lib/queries", () => ({
  getVenues: vi.fn(),
  getEventsForVenue: vi.fn(),
}));

const { getVenues, getEventsForVenue } = await import("@/lib/queries");
const { default: VenuesPage } = await import("./page");

async function renderPage() {
  vi.mocked(getVenues).mockResolvedValue([VENUE]);
  vi.mocked(getEventsForVenue).mockResolvedValue([]);
  const element = await VenuesPage();
  return render(element);
}

describe("/venues — top-level heading hierarchy (Round 19)", () => {
  afterEach(cleanup);

  it("renders the H1 in the accent purple with no eyebrow line above it", async () => {
    await renderPage();
    const heading = screen.getByRole("heading", { level: 1, name: "Venues" });
    expect(heading.className).toContain("text-accent");
    expect(heading.className).not.toContain("text-text-primary");
    expect(screen.queryByText(/^VENUES$/i, { selector: "p" })).toBeNull();
  });

  it("does not turn the body copy purple", async () => {
    await renderPage();
    const body = screen.getByText(/A curated guide to Copenhagen venues/);
    expect(body.className).not.toContain("text-accent");
  });
});

describe("/venues — stays curated even when a non-curated venue row exists (admin venue creation follow-up)", () => {
  afterEach(cleanup);

  it("never shows a venue row whose slug isn't in the curated list, e.g. an admin-created one", async () => {
    vi.mocked(getVenues).mockResolvedValue([
      VENUE,
      { ...VENUE, id: "v2", slug: "suporama", name: "Suporama" },
    ]);
    vi.mocked(getEventsForVenue).mockResolvedValue([]);
    const { default: VenuesPage } = await import("./page");
    render(await VenuesPage());
    expect(screen.getByRole("link", { name: /Culture Box/ })).toBeTruthy();
    expect(screen.queryByText("Suporama")).toBeNull();
  });
});

function venue(overrides: Partial<typeof VENUE> & { id: string; slug: string; name: string }) {
  return { ...VENUE, ...overrides };
}

const VEGA = venue({ id: "v-vega", slug: "vega", name: "VEGA" });
const IDEAL_BAR = venue({ id: "v-vega-ideal-bar", slug: "vega-ideal-bar", name: "Ideal Bar" });
const JOLENE = venue({ id: "v-jolene", slug: "jolene", name: "Jolene Bar" });
const BAGGEN = venue({ id: "v-baggen", slug: "baggen", name: "Baggen" });
const CULTURE_BOX = venue({ id: "v-culture-box", slug: "culture-box", name: "Culture Box" });
const H15 = venue({ id: "v-h15", slug: "h15", name: "H15" });
const HOTEL_CECIL = venue({ id: "v-hotel-cecil", slug: "hotel-cecil", name: "Hotel Cecil" });
const KLUB_WERKSTATT = venue({ id: "v-klub-werkstatt", slug: "klub-werkstatt", name: "Klub Werkstatt" });
const HALVANDET = venue({ id: "v-halvandet", slug: "halvandet", name: "Halvandet" });
const PYLONEN = venue({ id: "v-pylonen", slug: "pylonen", name: "Pylonen" });
const UNDERWERKET = venue({ id: "v-underwerket", slug: "underwerket", name: "UnderWerket" });
const MAYHEM = venue({ id: "v-mayhem", slug: "mayhem", name: "Mayhem" });
const ODDS_AND_ENDS = venue({ id: "v-odds-and-ends", slug: "odds-and-ends", name: "Odds and Ends" });
const RUST = venue({ id: "v-rust", slug: "rust", name: "RUST" });

function futureEvent(id: string, venueId: string) {
  return { id, venueId, startDatetime: "2099-01-01T20:00:00.000Z", endDatetime: null };
}

describe("/venues — VEGA overall-venue presentation (2026-09-11)", () => {
  afterEach(cleanup);

  it("shows a single 'VEGA' entry aggregating Store VEGA/Lille VEGA + Ideal Bar upcoming counts without double-counting, and never shows the old 'VEGA (Ideal Bar)' entry", async () => {
    vi.mocked(getVenues).mockResolvedValue([VEGA, IDEAL_BAR, CULTURE_BOX]);
    vi.mocked(getEventsForVenue).mockImplementation(async (id: string) => {
      if (id === "v-vega") return [futureEvent("e-store", "v-vega"), futureEvent("e-lille", "v-vega")] as never;
      if (id === "v-vega-ideal-bar") return [futureEvent("e-idealbar", "v-vega-ideal-bar")] as never;
      return [];
    });
    const { default: VenuesPage } = await import("./page");
    render(await VenuesPage());

    expect(screen.getAllByRole("link", { name: /^VEGA/ })).toHaveLength(1);
    expect(screen.queryByText(/VEGA \(Ideal Bar\)/)).toBeNull();
    expect(screen.getByText("3 upcoming events")).toBeTruthy();
  });

  it("removed venues (H15, Hotel Cecil, Klub Werkstatt, Halvandet, Pylonen, UnderWerket, Mayhem, Odds and Ends, RUST) are not listed even though the registry still returns them", async () => {
    vi.mocked(getVenues).mockResolvedValue([
      CULTURE_BOX,
      H15,
      HOTEL_CECIL,
      KLUB_WERKSTATT,
      HALVANDET,
      PYLONEN,
      UNDERWERKET,
      MAYHEM,
      ODDS_AND_ENDS,
      RUST,
    ]);
    vi.mocked(getEventsForVenue).mockResolvedValue([]);
    const { default: VenuesPage } = await import("./page");
    render(await VenuesPage());

    for (const removed of [H15, HOTEL_CECIL, KLUB_WERKSTATT, HALVANDET, PYLONEN, UNDERWERKET, MAYHEM, ODDS_AND_ENDS, RUST]) {
      expect(screen.queryByText(removed.name)).toBeNull();
    }
    // Unrelated, still-curated venue is unaffected.
    expect(screen.getByRole("link", { name: /Culture Box/ })).toBeTruthy();
  });

  it("Jolene and Baggen display with their public '(Club)' label instead of their canonical name", async () => {
    vi.mocked(getVenues).mockResolvedValue([JOLENE, BAGGEN]);
    vi.mocked(getEventsForVenue).mockResolvedValue([]);
    const { default: VenuesPage } = await import("./page");
    render(await VenuesPage());

    expect(screen.getByRole("link", { name: /Jolene \(Club\)/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Baggen \(Club\)/ })).toBeTruthy();
    expect(screen.queryByText("Jolene Bar")).toBeNull();
  });
});

describe("/venues — venue-name link affordance (Round 19)", () => {
  afterEach(cleanup);

  it("attaches a subtle arrow to the venue-name link so it reads as navigation before hover", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: /Culture Box/ });
    expect(link.getAttribute("href")).toBe("/venues/culture-box");
    expect(link.textContent).toContain("→");
    // Venue name stays the primary element — no purple default required.
    expect(link.className).toContain("text-text-primary");
    expect(link.className).not.toContain("text-accent");
  });

  it("keeps the existing brighten-on-hover/focus treatment, no whole-row hover", async () => {
    const { container } = await renderPage();
    const row = container.querySelector("li") as HTMLElement;
    // The row itself carries no hover-affecting classes — only the link does.
    expect(row.className).not.toMatch(/hover:/);
    const link = screen.getByRole("link", { name: /Culture Box/ });
    expect(link.className).toContain("hover:brightness-110");
    expect(link.className).toContain("focus-visible:brightness-110");
  });
});
