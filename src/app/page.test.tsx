// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EventWithVenue } from "@/lib/queries";
import type { GenreSlug } from "@/lib/taxonomy";
import type { Venue } from "@/lib/types";

vi.mock("@/lib/queries", () => ({
  getPublishedEventsWithVenue: vi.fn(),
  getArtistPreviewAvailabilityForLineups: vi.fn(),
}));
vi.mock("@/components/NewsletterSignupForm", () => ({ default: () => null }));

const { getPublishedEventsWithVenue, getArtistPreviewAvailabilityForLineups } = await import("@/lib/queries");
const { default: HomePage } = await import("./page");
const { default: EventExplorer } = await import("@/components/EventExplorer");

const VENUE: Venue = {
  id: "v-test", slug: "test-venue", name: "Test Venue", aliases: [], address: "Test St 1", city: "Copenhagen",
  postalCode: "1000", websiteUrl: null, description: "A club.", shortDescription: null, venueProfile: "Long venue profile.",
};

function makeEvent(id: string, startDatetime: string, endDatetime: string | null = null): EventWithVenue {
  return {
    id, title: `Event ${id}`, slug: `event-${id}`, description: `About ${id}`, artists: [`Artist ${id}`], startDatetime, endDatetime,
    timezone: "Europe/Copenhagen", venueId: VENUE.id, subVenue: null, primaryGenre: "techno" as GenreSlug, subgenres: ["techno"] as GenreSlug[],
    genreConfidence: "high", officialEventUrl: null, ticketUrl: null, facebookUrl: null, residentAdvisorUrl: null, otherSourceUrls: [],
    imageUrl: null, priceFrom: null, currency: null, soldOut: false, cancelled: false, postponed: false, dateChanged: false, timeChanged: false,
    published: true, adminUnpublishReason: null, adminUnpublishNote: "internal", adminUnpublishedAt: null, sourceCancelledAt: null,
    sourceCancelledBySourceId: null, sourceCancellationEvidence: null, manualOverride: false, overriddenFields: [], confidence: "high",
    canonicalSourceId: null, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", lastSourceCheck: null,
    lastChanged: null, venue: VENUE,
  };
}

function findElement(node: ReactNode, type: unknown): ReactElement<{ events: Record<string, unknown>[] }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<{ events: Record<string, unknown>[] }>;
  return findElement((node.props as { children?: ReactNode }).children, type);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Sat 24 Oct 2026, 03:00 Copenhagen — the middle of Friday night.
  vi.setSystemTime(new Date("2026-10-24T03:00:00+02:00"));
});
afterEach(() => vi.useRealTimers());

describe("homepage — server-side upcoming filter and projection", () => {
  const events = [
    makeEvent("tonight", "2026-10-23T23:00:00+02:00"), // still on (06:00 cutoff)
    makeEvent("ended", "2026-10-23T20:00:00+02:00", "2026-10-23T23:00:00+02:00"), // over
    makeEvent("last-week", "2026-10-16T23:00:00+02:00"), // past
    makeEvent("next-week", "2026-10-30T23:00:00+01:00"),
  ];

  it("hands EventExplorer only the not-yet-past events, as projected objects", async () => {
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue(events);
    vi.mocked(getArtistPreviewAvailabilityForLineups).mockResolvedValue([true, false]);
    const element = await HomePage();
    const explorer = findElement(element, EventExplorer);
    expect(explorer).not.toBeNull();
    const passed = explorer!.props.events;
    expect(passed.map((e) => e.id)).toEqual(["tonight", "next-week"]);
    expect(passed.map((e) => e.hasArtistPreview)).toEqual([true, false]);
    for (const e of passed) {
      expect(e).not.toHaveProperty("adminUnpublishNote");
      expect(e.venue).not.toHaveProperty("venueProfile");
    }
    // Preview lookup only runs for the events actually shown.
    expect(getArtistPreviewAvailabilityForLineups).toHaveBeenCalledWith([["Artist tonight"], ["Artist next-week"]]);
  });

  it("server-renders every upcoming event's row and link, and none of the past ones", async () => {
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue(events);
    vi.mocked(getArtistPreviewAvailabilityForLineups).mockResolvedValue([false, false]);
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('href="/events/event-tonight"');
    expect(html).toContain('href="/events/event-next-week"');
    expect(html).not.toContain("event-ended");
    expect(html).not.toContain("event-last-week");
    expect(html).not.toContain("internal");
    expect(html).not.toContain("Long venue profile");
  });
});
