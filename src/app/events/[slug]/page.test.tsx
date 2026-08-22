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
  shortDescription: null,
  venueProfile: null,
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

describe("Event detail page — FREE badge removed (frontend polish, Round 9)", () => {
  afterEach(cleanup);

  it("never renders a FREE badge, even for a free event with no other links", async () => {
    await renderPage(makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null, officialEventUrl: null }));
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.queryByText("Links")).toBeNull();
  });

  it("never renders a FREE badge for a free event that also has an official event link", async () => {
    await renderPage(
      makeEvent({
        priceFrom: 0,
        ticketUrl: null,
        residentAdvisorUrl: null,
        officialEventUrl: "https://venue.example.com/event",
      }),
    );
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.getByText(/Official event/i)).toBeTruthy();
  });

  it("shows no empty Links heading when the event has no external links", async () => {
    await renderPage(makeEvent({ ticketUrl: null, residentAdvisorUrl: null, officialEventUrl: null }));
    expect(screen.queryByText("Links")).toBeNull();
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

describe("Event detail page — clickability affordance (Round 13: brighten + underline, non-purple)", () => {
  afterEach(cleanup);

  it("gives the venue link a brighten + subtle underline on hover/focus, no purple color change", async () => {
    await renderPage(makeEvent());
    const venueLink = screen.getByRole("link", { name: "Test Venue" });
    const classes = venueLink.className.split(/\s+/);
    expect(venueLink.getAttribute("href")).toBe("/venues/test-venue");
    // Matches EventRow's venue-link treatment: brighten toward text-primary
    // plus a decoration-color-driven underline reveal, never the purple
    // accent token (Round 13 supersedes the old purple-hover behaviour).
    expect(classes).toContain("hover:text-text-primary");
    expect(classes).toContain("focus-visible:text-text-primary");
    expect(classes).toContain("hover:decoration-current");
    expect(classes).toContain("focus-visible:decoration-current");
    expect(classes).not.toContain("hover:text-accent");
    expect(classes).not.toContain("focus-visible:text-accent");
    expect(classes).not.toContain("hover:text-accent-strong");
    expect(classes).not.toContain("focus-visible:text-accent-strong");
    // The visible venue name text is a direct child of the hover-colored
    // link, not nested in a separately-colored span.
    expect(venueLink.children.length).toBe(0);
    expect(venueLink.textContent).toBe("Test Venue");
  });

  it("does not turn the event title into a link to itself", async () => {
    await renderPage(makeEvent());
    const heading = screen.getByRole("heading", { level: 1, name: "Test Event" });
    expect(heading.tagName).toBe("H1");
    expect(heading.querySelector("a")).toBeNull();
  });
});

describe("Event detail page — three-level text hierarchy (Round 18: new secondary-strong grey)", () => {
  afterEach(cleanup);

  it("puts OFFICIAL EVENT / TICKETS links on the same new secondary-strong grey used on the homepage", async () => {
    await renderPage(
      makeEvent({
        officialEventUrl: "https://venue.example.com/event",
        ticketUrl: "https://billetto.dk/e/x",
      }),
    );
    const officialEvent = screen.getByText(/Official event/i);
    const tickets = screen.getByText(/Tickets/i);
    expect(officialEvent.className).toContain("text-text-secondary-strong");
    expect(tickets.className).toContain("text-text-secondary-strong");
  });
});

describe("Event detail page — eyebrow + neutral H1 preserved (Round 19)", () => {
  afterEach(cleanup);

  it("keeps the purple EVENT eyebrow above a neutral/white H1 (detail pages keep this pattern)", async () => {
    await renderPage(makeEvent());
    const eyebrow = screen.getByText("Event");
    expect(eyebrow.className).toContain("text-accent");
    const heading = screen.getByRole("heading", { level: 1, name: "Test Event" });
    expect(heading.className).toContain("text-text-primary");
    expect(heading.className).not.toContain("text-accent");
  });
});
