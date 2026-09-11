// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Venue } from "@/lib/types";
import type { EventWithVenue } from "@/lib/queries";

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

const permanentRedirectMock = vi.fn();
const notFoundMock = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: (...args: unknown[]) => notFoundMock(...args),
  permanentRedirect: (...args: unknown[]) => permanentRedirectMock(...args),
}));

vi.mock("@/lib/queries", () => ({
  getVenueBySlug: vi.fn(),
  getVenueById: vi.fn(),
  getEventsForVenue: vi.fn(),
}));

const { getVenueBySlug, getVenueById, getEventsForVenue } = await import("@/lib/queries");
const { default: VenueDetailPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
});

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

function venue(overrides: Partial<Venue> & { id: string; slug: string; name: string }): Venue {
  return { ...VENUE, ...overrides };
}

const VEGA = venue({ id: "v-vega", slug: "vega", name: "VEGA" });
const IDEAL_BAR = venue({ id: "v-vega-ideal-bar", slug: "vega-ideal-bar", name: "Ideal Bar" });
const JOLENE = venue({ id: "v-jolene", slug: "jolene", name: "Jolene Bar" });
const CULTURE_BOX = venue({ id: "v-culture-box", slug: "culture-box", name: "Culture Box" });

function makeEvent(overrides: Partial<EventWithVenue> & { venue: Venue }): EventWithVenue {
  return {
    id: "e-1",
    title: "Test Event",
    slug: "test-event",
    description: null,
    artists: [],
    startDatetime: "2099-01-01T20:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: overrides.venue.id,
    subVenue: null,
    primaryGenre: "drum-and-bass",
    subgenres: ["drum-and-bass"],
    genreConfidence: "high",
    officialEventUrl: null,
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    imageUrl: null,
    priceFrom: null,
    currency: null,
    soldOut: false,
    cancelled: false,
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    adminUnpublishReason: null,
    adminUnpublishNote: null,
    adminUnpublishedAt: null,
    sourceCancelledAt: null,
    sourceCancelledBySourceId: null,
    sourceCancellationEvidence: null,
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastSourceCheck: null,
    lastChanged: null,
    ...overrides,
  } as EventWithVenue;
}

describe("Venue detail page — VEGA overall-venue presentation (2026-09-11)", () => {
  afterEach(cleanup);

  it("the VEGA page aggregates Store VEGA, Lille VEGA and Ideal Bar upcoming events without double-counting, and keeps each event's own room/location label", async () => {
    vi.mocked(getVenueBySlug).mockResolvedValue(VEGA);
    vi.mocked(getEventsForVenue).mockImplementation(async (id: string) => {
      if (id === "v-vega") {
        return [
          makeEvent({ id: "e-store", venue: VEGA, title: "Store VEGA Night", subVenue: "Store VEGA" }),
          makeEvent({ id: "e-lille", venue: VEGA, title: "Lille VEGA Night", subVenue: "Lille VEGA" }),
        ];
      }
      if (id === "v-vega-ideal-bar") {
        return [makeEvent({ id: "e-idealbar", venue: IDEAL_BAR, title: "Ideal Bar Night" })];
      }
      return [];
    });
    const element = await VenueDetailPage({ params: Promise.resolve({ slug: "vega" }) } as never);
    render(element);

    expect(screen.getByRole("heading", { level: 1, name: "VEGA" })).toBeTruthy();
    expect(screen.getByText("Store VEGA Night")).toBeTruthy();
    expect(screen.getByText("Lille VEGA Night")).toBeTruthy();
    expect(screen.getByText("Ideal Bar Night")).toBeTruthy();
    // Room-level labels remain visible and correct per event.
    expect(screen.getByText("Store VEGA")).toBeTruthy();
    expect(screen.getByText("Lille VEGA")).toBeTruthy();
    // The Ideal Bar event's own venue link still reads "Ideal Bar" — the
    // grouping is presentation-only on /venues, never a rewrite of
    // event-level venue text.
    expect(screen.getByRole("link", { name: "Ideal Bar" })).toBeTruthy();
  });

  it("requesting the old /venues/vega-ideal-bar URL permanently redirects to /venues/vega instead of rendering its own page", async () => {
    vi.mocked(getVenueBySlug).mockResolvedValue(IDEAL_BAR);
    vi.mocked(getVenueById).mockResolvedValue(VEGA);
    permanentRedirectMock.mockClear();

    await VenueDetailPage({ params: Promise.resolve({ slug: "vega-ideal-bar" }) } as never);

    expect(permanentRedirectMock).toHaveBeenCalledWith("/venues/vega");
    // Bails out before doing any event aggregation for the redirected page.
    expect(getEventsForVenue).not.toHaveBeenCalled();
  });

  it("Jolene's detail heading shows the public 'Jolene (Club)' label, not its canonical 'Jolene Bar' name", async () => {
    vi.mocked(getVenueBySlug).mockResolvedValue(JOLENE);
    vi.mocked(getEventsForVenue).mockResolvedValue([]);

    const element = await VenueDetailPage({ params: Promise.resolve({ slug: "jolene" }) } as never);
    render(element);

    expect(screen.getByRole("heading", { level: 1, name: "Jolene (Club)" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Jolene Bar" })).toBeNull();
  });

  it("an unrelated, ungrouped venue's page is unaffected — own canonical name, single-id lookup, no redirect", async () => {
    vi.mocked(getVenueBySlug).mockResolvedValue(CULTURE_BOX);
    vi.mocked(getEventsForVenue).mockResolvedValue([]);
    permanentRedirectMock.mockClear();

    const element = await VenueDetailPage({ params: Promise.resolve({ slug: "culture-box" }) } as never);
    render(element);

    expect(screen.getByRole("heading", { level: 1, name: "Culture Box" })).toBeTruthy();
    expect(permanentRedirectMock).not.toHaveBeenCalled();
    expect(getEventsForVenue).toHaveBeenCalledWith("v-culture-box");
    expect(getEventsForVenue).toHaveBeenCalledTimes(1);
  });
});
