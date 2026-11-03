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
  getVenuesBySlugs: vi.fn(),
  getUpcomingEventCountsByVenue: vi.fn(),
}));

const { getVenuesBySlugs, getUpcomingEventCountsByVenue } = await import("@/lib/queries");
const { default: VenuesPage } = await import("./page");

async function renderPage() {
  vi.mocked(getVenuesBySlugs).mockResolvedValue([VENUE]);
  vi.mocked(getUpcomingEventCountsByVenue).mockResolvedValue(new Map());
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

describe("/venues — introduction (2026-10-30)", () => {
  afterEach(cleanup);

  it("shows the updated introduction and the highlights-list note", async () => {
    await renderPage();
    expect(screen.getByText("A curated guide to Copenhagen venues where electronic music is the main focus.")).toBeTruthy();
    expect(
      screen.getByText(
        "This is a highlights list, not a full directory - electronic events on this site may appear at other Copenhagen venues too.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/regularly hosting standalone/)).toBeNull();
  });
});

describe("/venues — stays curated even when a non-curated venue row exists (admin venue creation follow-up)", () => {
  afterEach(cleanup);

  it("never shows a venue whose slug isn't in the curated list, e.g. an admin-created one", async () => {
    vi.mocked(getVenuesBySlugs).mockResolvedValue([
      VENUE,
      { ...VENUE, id: "v2", slug: "suporama", name: "Suporama" },
    ]);
    vi.mocked(getUpcomingEventCountsByVenue).mockResolvedValue(new Map());
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
const KLUB_WERKSTATT = venue({ id: "v-klub-werkstatt", slug: "klub-werkstatt", name: "Klub Werkstatt" });
const RUST = venue({ id: "v-rust", slug: "rust", name: "RUST" });

describe("/venues — approved nine-venue list (2026-10-30)", () => {
  afterEach(cleanup);

  it("renders a card for each of the nine approved venues, in editorial order, linking to its venue page", async () => {
    const { VENUES } = await import("@/lib/data/venues");
    vi.mocked(getVenuesBySlugs).mockResolvedValue(VENUES);
    vi.mocked(getUpcomingEventCountsByVenue).mockResolvedValue(new Map());
    const { default: VenuesPage } = await import("./page");
    const { container } = render(await VenuesPage());

    const hrefs = Array.from(container.querySelectorAll("a[href^='/venues/']")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/venues/culture-box",
      "/venues/hangaren",
      "/venues/den-anden-side",
      "/venues/module",
      "/venues/jolene",
      "/venues/baggen",
      "/venues/poolen",
      "/venues/klub-werkstatt",
      "/venues/pylonen",
    ]);
    expect(screen.getByRole("link", { name: /Klub Werkstatt/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Pylonen/ })).toBeTruthy();
  });

  it("has no Other venues section and shows no other venue, even though their registry rows still exist", async () => {
    vi.mocked(getVenuesBySlugs).mockResolvedValue([CULTURE_BOX, VEGA, IDEAL_BAR, RUST, H15]);
    vi.mocked(getUpcomingEventCountsByVenue).mockResolvedValue(new Map());
    const { default: VenuesPage } = await import("./page");
    render(await VenuesPage());

    expect(screen.queryByRole("heading", { name: /Other venues/i })).toBeNull();
    expect(screen.queryByRole("list", { name: /Other venues/i })).toBeNull();
    for (const hidden of [VEGA, IDEAL_BAR, RUST, H15]) {
      expect(screen.queryByText(hidden.name)).toBeNull();
    }
    expect(screen.getByRole("link", { name: /Culture Box/ })).toBeTruthy();
  });

  it("shows each venue's own upcoming count from the one batched count query, asked only for the listed venues", async () => {
    // Which events count as upcoming (published, not past by isPastEvent) is
    // decided by getUpcomingEventCountsByVenue itself — covered against the
    // real SQL in src/lib/queries.egress.test.ts.
    vi.mocked(getVenuesBySlugs).mockResolvedValue([CULTURE_BOX, KLUB_WERKSTATT]);
    vi.mocked(getUpcomingEventCountsByVenue).mockResolvedValue(
      new Map([
        ["v-klub-werkstatt", 2],
        ["v-culture-box", 1],
      ]),
    );
    const { default: VenuesPage } = await import("./page");
    render(await VenuesPage());

    expect(screen.getByText("2 upcoming events")).toBeTruthy();
    expect(screen.getByText("1 upcoming event")).toBeTruthy();
    const { CURATED_VENUE_SLUGS } = await import("@/lib/data/venues");
    expect(vi.mocked(getVenuesBySlugs).mock.lastCall?.[0]).toEqual(CURATED_VENUE_SLUGS);
    expect(vi.mocked(getUpcomingEventCountsByVenue).mock.lastCall?.[0]).toEqual(["v-culture-box", "v-klub-werkstatt"]);
  });

  it("a venue with no upcoming events shows no count line (zero is omitted, as before)", async () => {
    vi.mocked(getVenuesBySlugs).mockResolvedValue([CULTURE_BOX]);
    vi.mocked(getUpcomingEventCountsByVenue).mockResolvedValue(new Map());
    const { default: VenuesPage } = await import("./page");
    render(await VenuesPage());

    expect(screen.queryByText(/upcoming event/)).toBeNull();
  });

  it("Jolene and Baggen display with their public '(Club)' label instead of their canonical name", async () => {
    vi.mocked(getVenuesBySlugs).mockResolvedValue([JOLENE, BAGGEN]);
    vi.mocked(getUpcomingEventCountsByVenue).mockResolvedValue(new Map());
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
