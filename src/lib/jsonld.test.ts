import { describe, expect, it } from "vitest";
import { buildEventJsonLd } from "./jsonld";
import type { EventWithVenue } from "./queries";
import type { GenreSlug } from "./taxonomy";

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

function event(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id: "e-1",
    title: "Test Event",
    slug: "test-event",
    description: null,
    artists: [],
    startDatetime: "2026-09-01T22:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    primaryGenre: "techno" as GenreSlug,
    subgenres: ["techno"] as GenreSlug[],
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
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastSourceCheck: null,
    lastChanged: null,
    venue: VENUE,
    ...overrides,
  };
}

describe("buildEventJsonLd — eventStatus (event lifecycle/status handling, 2026-08-28)", () => {
  it("defaults to EventScheduled for a normal event", () => {
    expect(buildEventJsonLd(event(), "https://electroniccph.com/events/test-event").eventStatus).toBe(
      "https://schema.org/EventScheduled",
    );
  });

  it("EventCancelled takes priority over everything else", () => {
    const jsonLd = buildEventJsonLd(
      event({ cancelled: true, postponed: true, dateChanged: true }),
      "https://electroniccph.com/events/test-event",
    );
    expect(jsonLd.eventStatus).toBe("https://schema.org/EventCancelled");
  });

  it("EventPostponed when postponed and not cancelled", () => {
    const jsonLd = buildEventJsonLd(event({ postponed: true, dateChanged: true }), "https://electroniccph.com/events/test-event");
    expect(jsonLd.eventStatus).toBe("https://schema.org/EventPostponed");
  });

  it("EventRescheduled when dateChanged and not cancelled/postponed", () => {
    const jsonLd = buildEventJsonLd(event({ dateChanged: true }), "https://electroniccph.com/events/test-event");
    expect(jsonLd.eventStatus).toBe("https://schema.org/EventRescheduled");
  });

  it("a bare timeChanged (no dateChanged) does not trigger EventRescheduled — internal same-day correction only", () => {
    const jsonLd = buildEventJsonLd(event({ timeChanged: true }), "https://electroniccph.com/events/test-event");
    expect(jsonLd.eventStatus).toBe("https://schema.org/EventScheduled");
  });

  it("offers.availability reflects soldOut independently of eventStatus", () => {
    const jsonLd = buildEventJsonLd(event({ soldOut: true, ticketUrl: "https://tickets.example/x" }), "https://electroniccph.com/events/test-event");
    expect(jsonLd.offers?.availability).toBe("https://schema.org/SoldOut");
    expect(jsonLd.eventStatus).toBe("https://schema.org/EventScheduled");
  });
});
