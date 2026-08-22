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
