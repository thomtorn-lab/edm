// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EventWithVenue } from "@/lib/queries";
import type { GenreSlug } from "@/lib/taxonomy";

const VENUE = {
  id: "v-test",
  slug: "test-venue",
  name: "Test Venue",
  aliases: [],
  address: "Test St 1",
  city: "Copenhagen" as const,
  postalCode: "1000",
  websiteUrl: null,
  description: "",
};

function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id: "e-1",
    title: "Test Event",
    slug: "test-event",
    description: null,
    artists: [],
    startDatetime: "2026-08-10T20:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    primaryGenre: "drum-and-bass" as GenreSlug,
    subgenres: ["drum-and-bass"] as GenreSlug[],
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
    dateChanged: false,
    timeChanged: false,
    published: true,
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastSourceCheck: null,
    lastChanged: null,
    venue: VENUE,
    ...overrides,
  };
}

vi.mock("@/lib/queries", () => ({
  getEventBySlugWithVenue: vi.fn(),
}));

const { getEventBySlugWithVenue } = await import("@/lib/queries");
const { default: EventDetailPage } = await import("./page");

async function renderPage(event: EventWithVenue) {
  vi.mocked(getEventBySlugWithVenue).mockResolvedValue(event);
  const element = await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) } as never);
  render(element);
}

describe("Event detail page — FREE badge and Links section (frontend polish, Round 7)", () => {
  afterEach(cleanup);

  it("places FREE to the right of OFFICIAL EVENT — never before it", async () => {
    await renderPage(
      makeEvent({
        priceFrom: 0,
        ticketUrl: null,
        residentAdvisorUrl: null,
        officialEventUrl: "https://venue.example.com/event",
      }),
    );
    const officialEvent = screen.getByText(/Official event/i);
    const free = screen.getByText("Free");
    expect(officialEvent.compareDocumentPosition(free) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the Links heading for real links only — FREE is not one of its items", async () => {
    await renderPage(
      makeEvent({
        priceFrom: 0,
        ticketUrl: null,
        residentAdvisorUrl: null,
        officialEventUrl: "https://venue.example.com/event",
      }),
    );
    const linksHeading = screen.getByText("Links");
    const free = screen.getByText("Free");
    expect(free.tagName).toBe("SPAN"); // never rendered as a link (<a>)
    // The heading's own container (its link-list wrapper) never contains FREE.
    expect(linksHeading.parentElement?.contains(free)).toBe(false);
  });

  it("shows no empty Links heading for a free event with no actual links", async () => {
    await renderPage(makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null, officialEventUrl: null }));
    expect(screen.queryByText("Links")).toBeNull();
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("renders FREE in white with comparable weight to OFFICIAL EVENT, not a dim secondary note", async () => {
    await renderPage(makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null }));
    const free = screen.getByText("Free");
    expect(free.className).toContain("text-text-primary");
    expect(free.className).toContain("font-semibold");
  });

  it("shows no '+1' overnight annotation next to the end time", async () => {
    await renderPage(
      // 22:00 CEST -> 06:00 CEST next day.
      makeEvent({ startDatetime: "2026-08-10T20:00:00.000Z", endDatetime: "2026-08-11T04:00:00.000Z" }),
    );
    expect(screen.getByText(/22:00/).closest("dd")?.textContent).not.toMatch(/\+1/);
    expect(screen.getByText(/22:00/).closest("dd")?.textContent).toContain("06:00");
  });
});
