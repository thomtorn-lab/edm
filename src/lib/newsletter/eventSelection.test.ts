import { describe, expect, it } from "vitest";
import { selectEventsForSubscriber, selectUpcomingEventsForNewsletter } from "./eventSelection";
import type { EventWithVenue } from "../queries";
import type { GenreSlug, MainGenreSlug } from "../taxonomy";

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
    startDatetime: "2026-10-10T20:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    subVenue: null,
    primaryGenre: "techno",
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
    venue: VENUE,
    ...overrides,
  };
}

const NOW = new Date("2026-10-08T10:00:00.000Z"); // Thursday

describe("selectUpcomingEventsForNewsletter", () => {
  it("includes an event within the next 7 days", () => {
    const events = [makeEvent({ startDatetime: "2026-10-10T20:00:00.000Z" })];
    expect(selectUpcomingEventsForNewsletter(events, NOW)).toHaveLength(1);
  });

  it("excludes an event starting before now (already past)", () => {
    const events = [makeEvent({ id: "e-past", startDatetime: "2026-10-01T20:00:00.000Z", endDatetime: "2026-10-02T02:00:00.000Z" })];
    expect(selectUpcomingEventsForNewsletter(events, NOW)).toHaveLength(0);
  });

  it("excludes an event starting beyond the 7-day window", () => {
    const events = [makeEvent({ id: "e-far", startDatetime: "2026-10-20T20:00:00.000Z" })];
    expect(selectUpcomingEventsForNewsletter(events, NOW)).toHaveLength(0);
  });

  it("includes an event right at the edge of the window (just under 7 days out)", () => {
    const events = [makeEvent({ id: "e-edge", startDatetime: "2026-10-15T09:00:00.000Z" })];
    expect(selectUpcomingEventsForNewsletter(events, NOW)).toHaveLength(1);
  });

  it("excludes a postponed event even if its stale startDatetime falls in the window", () => {
    const events = [makeEvent({ id: "e-postponed", postponed: true, startDatetime: "2026-10-10T20:00:00.000Z" })];
    expect(selectUpcomingEventsForNewsletter(events, NOW)).toHaveLength(0);
  });

  it("includes a sold-out event (sold out is not the same as unavailable/excluded)", () => {
    const events = [makeEvent({ id: "e-soldout", soldOut: true, startDatetime: "2026-10-10T20:00:00.000Z" })];
    expect(selectUpcomingEventsForNewsletter(events, NOW)).toHaveLength(1);
  });

  it("orders events chronologically by start time", () => {
    const events = [
      makeEvent({ id: "e-later", startDatetime: "2026-10-12T20:00:00.000Z" }),
      makeEvent({ id: "e-earlier", startDatetime: "2026-10-09T20:00:00.000Z" }),
    ];
    const result = selectUpcomingEventsForNewsletter(events, NOW);
    expect(result.map((e) => e.id)).toEqual(["e-earlier", "e-later"]);
  });

  it("an event already unpublished (cancelled) is never passed in by the caller, but if it somehow were, this function has no separate published check — callers must query published=true first", () => {
    // Documents the contract: selectUpcomingEventsForNewsletter trusts its
    // caller already filtered to published events, same as
    // getPublishedEventsWithVenue — it does not re-check `published` or
    // `cancelled` itself.
    const events = [makeEvent({ published: false })];
    expect(selectUpcomingEventsForNewsletter(events, NOW)).toHaveLength(1);
  });
});

describe("selectEventsForSubscriber", () => {
  const windowEvents = [
    makeEvent({ id: "e-house", primaryGenre: "house", subgenres: ["house"] as GenreSlug[], startDatetime: "2026-10-09T20:00:00.000Z" }),
    makeEvent({ id: "e-techno", primaryGenre: "techno", subgenres: ["techno"] as GenreSlug[], startDatetime: "2026-10-10T20:00:00.000Z" }),
    makeEvent({ id: "e-both", primaryGenre: "disco", subgenres: ["disco", "house"] as GenreSlug[], startDatetime: "2026-10-11T20:00:00.000Z" }),
  ];

  it("returns all events for an empty genre selection", () => {
    expect(selectEventsForSubscriber(windowEvents, []).map((e) => e.id)).toEqual(["e-house", "e-techno", "e-both"]);
  });

  it("filters to only matching events for a genre-specific selection", () => {
    const result = selectEventsForSubscriber(windowEvents, ["house"] as MainGenreSlug[]);
    expect(result.map((e) => e.id)).toEqual(["e-house", "e-both"]);
  });

  it("an event matching on its secondary genre is included (OR across both assigned genres)", () => {
    const result = selectEventsForSubscriber(windowEvents, ["disco"] as MainGenreSlug[]);
    expect(result.map((e) => e.id)).toEqual(["e-both"]);
  });

  it("an event matching multiple of the subscriber's selected genres is included exactly once, never duplicated", () => {
    const result = selectEventsForSubscriber(windowEvents, ["disco", "house"] as MainGenreSlug[]);
    const ids = result.map((e) => e.id);
    expect(ids).toEqual(["e-house", "e-both"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps the result at `max`", () => {
    const many = Array.from({ length: 30 }, (_, i) => makeEvent({ id: `e-${i}`, startDatetime: `2026-10-${10 + (i % 5)}T20:00:00.000Z` }));
    expect(selectEventsForSubscriber(many, [], 20)).toHaveLength(20);
  });

  it("returns an empty array (not an error) when nothing matches", () => {
    expect(selectEventsForSubscriber(windowEvents, ["psytrance"] as MainGenreSlug[])).toEqual([]);
  });

  it("preserves the window's chronological order", () => {
    const result = selectEventsForSubscriber(windowEvents, []);
    const starts = result.map((e) => new Date(e.startDatetime).getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
