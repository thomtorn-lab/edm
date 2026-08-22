// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Venue } from "@/lib/types";

const VENUE: Venue = {
  id: "v-test",
  slug: "test-venue",
  name: "Test Venue",
  aliases: [],
  address: "Test St 1",
  city: "Copenhagen",
  postalCode: "1000",
  websiteUrl: null,
  description: "A club.",
  shortDescription: null,
  venueProfile: null,
};

vi.mock("@/lib/queries", () => ({
  getVenueBySlug: vi.fn(),
  getEventsForVenue: vi.fn(),
}));

const { getVenueBySlug, getEventsForVenue } = await import("@/lib/queries");
const { default: VenueDetailPage } = await import("./page");

async function renderPage(venue: Venue) {
  vi.mocked(getVenueBySlug).mockResolvedValue(venue);
  vi.mocked(getEventsForVenue).mockResolvedValue([]);
  const element = await VenueDetailPage({ params: Promise.resolve({ slug: venue.slug }) } as never);
  render(element);
}

describe("Venue detail page — eyebrow + neutral H1 preserved (Round 19)", () => {
  afterEach(cleanup);

  it("keeps the purple VENUE eyebrow above a neutral/white H1 (detail pages keep this pattern)", async () => {
    await renderPage(VENUE);
    const eyebrow = screen.getByText("Venue");
    expect(eyebrow.className).toContain("text-accent");
    const heading = screen.getByRole("heading", { level: 1, name: "Test Venue" });
    expect(heading.className).toContain("text-text-primary");
    expect(heading.className).not.toContain("text-accent");
  });
});
